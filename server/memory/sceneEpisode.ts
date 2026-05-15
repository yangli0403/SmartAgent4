/**
 * Scene Episode — 场景流程记忆
 *
 * 将"路线情景"和"车控（午睡模式等）情景"统一抽象为 SceneEpisode，
 * 复用 memories 表的 episodic 大类与 metadata JSON 结构。
 *
 * 设计目标（参考 docs/OPTIMIZATION_PLAN_0423.md 第二节）：
 * 1. 结构化保存动作序列（actions）、触发短语（triggerPhrases）等元数据
 * 2. 召回与执行严格分离：默认 safetyLevel = "confirm_before_execute"
 * 3. 支持基于 triggerPhrases 的预过滤召回，提升 BM25/向量混合命中率
 * 4. 与现有 navigationMemoryPlan / persistNavigationEpisodic 平滑兼容
 */
import { addMemory, searchMemories } from "./memorySystem";
import type { InsertMemory, Memory } from "../../drizzle/schema";

// ==================== 类型定义 ====================

export type SceneDomain =
  | "vehicle_control"
  | "navigation"
  | "multimedia"
  | "smart_home"
  | "office"
  | "service"
  | "general";

export interface SceneAction {
  /** 底层工具名，如 "vehicle.lights.off" 或 "maps_direction_driving" */
  tool: string;
  /** 动作语义，如 "set"、"toggle"、"navigate" */
  command: string;
  /** 动作参数（不限制结构，由具体 Agent 解释） */
  args?: Record<string, unknown>;
}

export interface SceneEpisodeInput {
  userId: number;
  /** 场景所属领域 */
  domain: SceneDomain;
  /** 场景名称，如"午睡模式"、"通勤路线" */
  sceneName: string;
  /** 文本摘要，用于 hybrid search 命中以及给用户复述 */
  summary: string;
  /** 触发该场景的常见用户表达 */
  triggerPhrases?: string[];
  /** 时间规律，如 "weekday 12:00-14:00" */
  timePattern?: string;
  /** 场景下的动作序列（可空，例如纯导航回忆只保存路线） */
  actions?: SceneAction[];
  /** 安全等级：默认 confirm_before_execute */
  safetyLevel?: "confirm_before_execute" | "auto_execute";
  /** 重要度（默认 0.75：场景流程通常具备较高复用价值） */
  importance?: number;
  confidence?: number;
  /** 业务标签（除自动注入的 scene/{domain} 外的额外标签） */
  tags?: string[];
  /** 版本分组：如同名场景多次保存时复用 */
  versionGroup?: string;
  /** 导航场景专用槽位 */
  navOrigin?: string;
  navDestination?: string;
  navWaypoints?: string[];
  navMode?: string;
}

// ==================== 常量 ====================

/** 场景流程记忆的标准 source 标记 */
export const SCENE_EPISODE_SOURCE = "scene_episode";

/**
 * 自动注入的标签前缀，便于按域批量召回。
 * 例如 "scene", "scene:vehicle_control", "scene:navigation"
 */
export function buildSceneTags(
  domain: SceneDomain,
  extra?: string[]
): string[] {
  const baseline = ["scene", `scene:${domain}`];
  if (!extra || extra.length === 0) return baseline;
  // 去重
  return Array.from(new Set([...baseline, ...extra]));
}

// ==================== API ====================

/**
 * 保存一条场景流程记忆。
 *
 * - kind = "episodic"
 * - type = "behavior"（动作模式 / 行为模板）
 * - 自动写入 metadata.{domain, sceneName, triggerPhrases, actions, safetyLevel, ...}
 * - 默认 safetyLevel = "confirm_before_execute"
 */
export async function persistSceneEpisode(
  input: SceneEpisodeInput
): Promise<Memory | null> {
  if (!input.userId || input.userId <= 0) {
    throw new Error("persistSceneEpisode: userId is required");
  }
  if (!input.sceneName || !input.summary) {
    throw new Error(
      "persistSceneEpisode: sceneName and summary are required"
    );
  }

  const tags = buildSceneTags(input.domain, input.tags);
  const safetyLevel: "confirm_before_execute" | "auto_execute" =
    input.safetyLevel ?? "confirm_before_execute";

  const memory: InsertMemory = {
    userId: input.userId,
    kind: "episodic",
    type: "behavior",
    content: input.summary,
    importance: clamp01(input.importance ?? 0.75),
    confidence: clamp01(input.confidence ?? 0.85),
    tags,
    source: SCENE_EPISODE_SOURCE,
    versionGroup: input.versionGroup,
    metadata: {
      source: SCENE_EPISODE_SOURCE,
      tags,
      domain: input.domain,
      sceneName: input.sceneName,
      triggerPhrases: input.triggerPhrases,
      timePattern: input.timePattern,
      actions: input.actions,
      safetyLevel,
      navOrigin: input.navOrigin,
      navDestination: input.navDestination,
      navWaypoints: input.navWaypoints,
      navMode: input.navMode,
    },
  };

  return addMemory(memory);
}

/**
 * 在用户的场景流程记忆中查找匹配 query 的候选场景。
 *
 * 使用 BM25 + 向量混合检索（已在 searchMemories 中实现），
 * 并在结果中排除非 episodic/behavior 的记录。
 */
export async function searchSceneEpisodes(opts: {
  userId: number;
  query: string;
  domain?: SceneDomain;
  limit?: number;
}): Promise<Memory[]> {
  const { userId, query, domain, limit = 5 } = opts;
  const results = await searchMemories({
    userId,
    query,
    kind: "episodic",
    type: "behavior",
    limit: Math.max(1, Math.min(20, limit)),
    useHybridSearch: true,
    alpha: 0.5,
  });
  if (!domain) return results;
  return results.filter((m) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    return meta.domain === domain;
  });
}

// ==================== 安全 / 召回执行分离 ====================

export interface SceneExecutionPlan {
  sceneName: string;
  domain: SceneDomain;
  /** 给用户的复述文本，包含动作清单与次序 */
  summary: string;
  /** 待执行动作列表 */
  actions: SceneAction[];
  /** 是否需要在执行前显式确认 */
  requiresConfirmation: boolean;
  /** 来源记忆 ID，便于审计 */
  sourceMemoryId: number;
}

/**
 * 将一条场景记忆转换为执行计划，并附带是否需要用户确认的标记。
 *
 * Agent 在收到该计划后必须：
 * 1. 当 requiresConfirmation=true：先向用户复述 summary，等用户明确同意后再调用工具
 * 2. 当 requiresConfirmation=false：可直接执行（仅限 safetyLevel="auto_execute" 的场景）
 */
export function buildExecutionPlanFromMemory(
  memory: Memory
): SceneExecutionPlan | null {
  const meta = (memory.metadata ?? {}) as {
    domain?: SceneDomain;
    sceneName?: string;
    actions?: SceneAction[];
    safetyLevel?: "confirm_before_execute" | "auto_execute";
  };
  if (!meta.sceneName || !meta.domain || !meta.actions || meta.actions.length === 0) {
    return null;
  }
  const requiresConfirmation = meta.safetyLevel !== "auto_execute";
  const lines = meta.actions.map((a, i) => {
    const argStr = a.args
      ? Object.entries(a.args)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ")
      : "";
    return `${i + 1}. ${a.tool} ${a.command}${argStr ? ` (${argStr})` : ""}`;
  });
  const summary =
    `场景：${meta.sceneName}（域：${meta.domain}）\n` +
    `共 ${meta.actions.length} 个动作：\n` +
    lines.join("\n");
  return {
    sceneName: meta.sceneName,
    domain: meta.domain,
    summary,
    actions: meta.actions,
    requiresConfirmation,
    sourceMemoryId: memory.id,
  };
}

// ==================== 工具函数 ====================

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
