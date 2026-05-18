import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "../db";
import { behaviorPatterns } from "../../drizzle/schema";
import type { PlanStep, StepResult, ToolCallRecord } from "../agent/supervisor/state";
import {
  persistSceneEpisode,
  type SceneAction,
  type SceneDomain,
} from "./sceneEpisode";

export interface DeterministicPatternInput {
  userId: number;
  userText: string;
  step: PlanStep;
  result: StepResult;
}

const VEHICLE_TOOL_HINTS = [
  "vehicle",
  "car",
  "light",
  "lights",
  "ac",
  "air",
  "seat",
  "noise",
  "window",
  "sunroof",
];

/**
 * P1 修复：不再等待 10 轮 LLM 行为检测，也不依赖自由文本 memories。
 * 对车控、灯光、空调、座椅、音乐/白噪音等可执行工具调用生成确定性签名，
 * 每次成功执行后直接累计 behavior_patterns.frequency；达到 3 次时立即可被主动建议链路命中，
 * 同时补写 scene_episode + actions，保证“记录为 X 模式/下次叫 X”类场景可复用、可执行。
 */
export async function recordDeterministicActionPatterns(
  input: DeterministicPatternInput
): Promise<void> {
  const { userId, userText, step, result } = input;
  if (!userId || userId <= 0 || result.status !== "success") return;

  const toolCalls = normalizeToolCalls(result.toolCalls);
  if (toolCalls.length === 0) return;

  const domain = inferSceneDomain(step.targetAgent, toolCalls, userText);
  if (!domain) return;

  const actions = toolCalls
    .filter((call) => call.status !== "error")
    .map(toolCallToSceneAction)
    .filter((a): a is SceneAction => Boolean(a));
  if (actions.length === 0) return;

  const signature = buildActionSignature(domain, actions);
  const patternType = `det:${domain}:${hashSignature(signature)}`;
  const description = buildPatternDescription(domain, actions, userText);

  const db = await getDb();
  if (!db) return;

  const existing = await db
    .select()
    .from(behaviorPatterns)
    .where(
      and(
        eq(behaviorPatterns.userId, userId),
        eq(behaviorPatterns.patternType, patternType)
      )
    )
    .orderBy(desc(behaviorPatterns.updatedAt))
    .limit(1);

  const now = new Date();
  const nextFrequency = existing[0] ? existing[0].frequency + 1 : 1;

  if (existing[0]) {
    await db
      .update(behaviorPatterns)
      .set({
        description,
        frequency: nextFrequency,
        confidence: Math.min(0.95, Math.max(existing[0].confidence, 0.7 + nextFrequency * 0.06)),
        lastObserved: now,
        updatedAt: now,
      })
      .where(eq(behaviorPatterns.id, existing[0].id));
  } else {
    await db.insert(behaviorPatterns).values({
      userId,
      patternType,
      description,
      confidence: 0.76,
      frequency: 1,
      lastObserved: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (nextFrequency >= 3) {
    await persistSceneEpisode({
      userId,
      domain,
      sceneName: suggestSceneName(domain, actions),
      summary: `${description}。系统已检测到该可执行操作重复 ${nextFrequency} 次，可保存为命名场景并在下次确认后执行。`,
      triggerPhrases: buildTriggerPhrases(domain, actions, userText),
      actions,
      safetyLevel: "confirm_before_execute",
      importance: 0.82,
      confidence: Math.min(0.95, 0.75 + nextFrequency * 0.05),
      tags: ["deterministic_pattern", `pattern:${patternType}`],
      versionGroup: `scene:${patternType}`,
    }).catch((error) => {
      console.warn("[DeterministicBehaviorAggregator] persist scene failed:", (error as Error).message);
      return null;
    });
  }
}

function normalizeToolCalls(toolCalls: StepResult["toolCalls"]): ToolCallRecord[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls as ToolCallRecord[];
}

function inferSceneDomain(
  targetAgent: string | undefined,
  toolCalls: ToolCallRecord[],
  userText: string
): SceneDomain | null {
  const haystack = [
    targetAgent ?? "",
    userText,
    ...toolCalls.map((call) => `${call.toolName ?? ""} ${JSON.stringify(call.input ?? {})}`),
  ]
    .join(" ")
    .toLowerCase();

  if (VEHICLE_TOOL_HINTS.some((hint) => haystack.includes(hint))) {
    return "vehicle_control";
  }
  if (/music|audio|media|noise|白噪音|音乐|播放/.test(haystack)) {
    return "multimedia";
  }
  return null;
}

function toolCallToSceneAction(call: ToolCallRecord): SceneAction | null {
  const tool = call.toolName || call.serverId || "unknown_tool";
  if (!tool || tool === "unknown_tool") return null;
  const args = sanitizeArgs(call.input);
  return {
    tool,
    command: inferCommand(tool, args),
    args,
  };
}

function sanitizeArgs(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([key]) => !/[\r\n]/.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function inferCommand(tool: string, args?: Record<string, unknown>): string {
  const normalized = `${tool} ${JSON.stringify(args ?? {})}`.toLowerCase();
  if (/off|close|关闭/.test(normalized)) return "off";
  if (/on|open|开启|打开/.test(normalized)) return "on";
  if (/set|temperature|temp|volume|调整|设置/.test(normalized)) return "set";
  if (/play|播放/.test(normalized)) return "play";
  return "execute";
}

function buildActionSignature(domain: SceneDomain, actions: SceneAction[]): string {
  return JSON.stringify({
    domain,
    actions: actions.map((a) => ({
      tool: a.tool,
      command: a.command,
      args: a.args ? Object.fromEntries(Object.entries(a.args).sort(([aKey], [bKey]) => aKey.localeCompare(bKey))) : undefined,
    })),
  });
}

function hashSignature(signature: string): string {
  return createHash("sha1").update(signature).digest("hex").slice(0, 12);
}

function buildPatternDescription(domain: SceneDomain, actions: SceneAction[], userText: string): string {
  const actionText = actions
    .map((a) => `${a.tool}:${a.command}${a.args ? ` ${JSON.stringify(a.args)}` : ""}`)
    .join("；");
  const domainText = domain === "vehicle_control" ? "车控" : domain;
  return `用户多次执行相同${domainText}操作：${actionText}${userText ? `。最近表达：“${userText.slice(0, 80)}”` : ""}`;
}

function suggestSceneName(domain: SceneDomain, actions: SceneAction[]): string {
  const signature = actions.map((a) => `${a.tool} ${a.command} ${JSON.stringify(a.args ?? {})}`).join(" ").toLowerCase();
  if (domain === "vehicle_control") {
    if (/ac|temperature|空调|temp/.test(signature)) return "舒适空调模式";
    if (/light|灯/.test(signature)) return "常用灯光模式";
    if (/seat|座椅/.test(signature)) return "座椅偏好模式";
    if (/noise|白噪音|music|audio/.test(signature)) return "安静车内模式";
    return "常用车控模式";
  }
  if (domain === "multimedia") return "常用媒体模式";
  return "常用场景";
}

function buildTriggerPhrases(domain: SceneDomain, actions: SceneAction[], userText: string): string[] {
  const phrases = new Set<string>();
  if (userText.trim()) phrases.add(userText.trim().slice(0, 80));
  const name = suggestSceneName(domain, actions);
  phrases.add(name);
  phrases.add(`开启${name}`);
  phrases.add(`执行${name}`);
  return Array.from(phrases);
}
