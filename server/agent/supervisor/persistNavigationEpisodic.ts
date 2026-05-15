/**
 * 导航情景记忆兜底写入（STORE-003，0423 升级）
 *
 * 当规划已含导航成功结果，但本轮无任何成功的 memory_store 工具调用时，
 * 由服务端根据 dialogueSlots + 导航步骤输出直接写入一条 SceneEpisode 记忆，
 * 避免仅依赖 LLM 漏记，并复用与"午睡模式"相同的场景流程结构。
 *
 * 升级要点（参考 docs/OPTIMIZATION_PLAN_0423.md 第二节）：
 * 1. 从原来的 `kind=episodic, type=fact` 升级为 SceneEpisode 标准的 `episodic+behavior`
 * 2. 写入 metadata.{domain="navigation", sceneName, triggerPhrases, navOrigin, ...}
 * 3. 默认 safetyLevel = "confirm_before_execute"，召回时由 Agent 复述并征求用户确认
 * 4. 通过 sceneEpisode 模块统一接口，与车控午睡场景共用召回与执行链路
 */

import type { SupervisorStateType } from "./state";
import { persistSceneEpisode, type SceneAction } from "../../memory/sceneEpisode";

function hasRouteSlots(
  slots: NonNullable<SupervisorStateType["dialogueSlots"]>
): boolean {
  return (
    (slots.navWaypoints && slots.navWaypoints.length > 0) ||
    (!!slots.navOrigin && !!slots.navDestination)
  );
}

/**
 * 根据 dialogueSlots 推导导航场景的常见触发短语。
 *
 * 规则保守，避免引入虚构信息：
 * - 起点 + 终点存在时，生成"X 到 Y 路线 / 怎么去 Y"等候选
 * - 仅有 waypoints 时，生成"老路线 / 上次的路"
 * - 总是包含通用触发"通勤路线 / 上下班路线"
 */
function deriveTriggerPhrases(
  slots: NonNullable<SupervisorStateType["dialogueSlots"]>
): string[] {
  const phrases = new Set<string>(["通勤路线", "上下班路线", "上次的路线"]);
  if (slots.navOrigin && slots.navDestination) {
    phrases.add(`${slots.navOrigin}到${slots.navDestination}`);
    phrases.add(`怎么去${slots.navDestination}`);
    phrases.add(`从${slots.navOrigin}出发`);
  } else if (slots.navDestination) {
    phrases.add(`怎么去${slots.navDestination}`);
  }
  if (slots.navWaypoints?.length) {
    phrases.add(`经过${slots.navWaypoints[0]}的路`);
  }
  return Array.from(phrases);
}

/**
 * 构造导航场景的动作序列（actions）。
 *
 * 注意：根据"召回与执行分离"原则，这里只描述一个声明式的导航动作，
 * 真正执行需要在 Agent 召回 + 用户确认后再调用真正的 maps_direction_driving 工具。
 */
function buildNavigationActions(
  slots: NonNullable<SupervisorStateType["dialogueSlots"]>
): SceneAction[] {
  if (!slots.navOrigin && !slots.navDestination) return [];
  return [
    {
      tool: "maps_direction_driving",
      command: "navigate",
      args: {
        origin: slots.navOrigin,
        destination: slots.navDestination,
        waypoints: slots.navWaypoints,
        mode: "driving",
      },
    },
  ];
}

/**
 * 条件满足时写入一条导航场景的 SceneEpisode（versionGroup 去重）。
 */
export async function persistNavigationEpisodicIfNeeded(
  state: SupervisorStateType
): Promise<void> {
  const slots = state.dialogueSlots;
  const ctx = state.context;
  if (!slots || !ctx?.userId) return;
  if (!hasRouteSlots(slots)) return;

  const userId = parseInt(ctx.userId, 10);
  if (!Number.isFinite(userId) || userId <= 0) return;

  const plan = state.plan || [];
  const stepResults = state.stepResults || [];

  const navSuccess = stepResults.some((r) => {
    if (r.status !== "success") return false;
    const step = plan.find((s) => s.id === r.stepId);
    return step?.targetAgent === "navigationAgent";
  });
  if (!navSuccess) return;

  const hadMemoryStore = stepResults.some((r) =>
    (r.toolCalls || []).some(
      (tc) => tc.toolName === "memory_store" && tc.status === "success"
    )
  );
  if (hadMemoryStore) {
    console.log(
      "[PersistNavigationEpisodic] Skipped: memory_store already succeeded in this turn"
    );
    return;
  }

  const navResult = [...stepResults]
    .filter((r) => {
      const step = plan.find((s) => s.id === r.stepId);
      return r.status === "success" && step?.targetAgent === "navigationAgent";
    })
    .pop();

  // ----- 文本摘要（content） -----
  const parts: string[] = ["本次通勤/路线规划情景"];
  if (slots.regionHint) parts.push(`区域：${slots.regionHint}`);
  if (slots.navOrigin) parts.push(`出发：${slots.navOrigin}`);
  if (slots.navDestination) parts.push(`目的：${slots.navDestination}`);
  if (slots.navWaypoints?.length) {
    parts.push(`途经：${slots.navWaypoints.join("；")}`);
  }
  if (navResult?.output?.trim()) {
    const t = navResult.output.trim().slice(0, 600).replace(/\s+/g, " ");
    parts.push(`助手规划摘要：${t}`);
  }
  const summary = parts.join("。");

  // ----- 动作序列（声明式） -----
  const actions = buildNavigationActions(slots);
  const triggerPhrases = deriveTriggerPhrases(slots);

  // ----- 场景名称：尽量贴近用户语义 -----
  const sceneName = (() => {
    if (slots.navOrigin && slots.navDestination) {
      return `${slots.navOrigin} → ${slots.navDestination}`;
    }
    if (slots.navDestination) return `去 ${slots.navDestination}`;
    return "通勤路线";
  })();

  try {
    const row = await persistSceneEpisode({
      userId,
      domain: "navigation",
      sceneName,
      summary,
      triggerPhrases,
      actions,
      // 路线即使是声明式的，也请用户确认：避免误导航
      safetyLevel: "confirm_before_execute",
      importance: 0.75,
      confidence: 0.85,
      tags: ["导航", "通勤", "路线"],
      versionGroup: "commute_route_episodic_v2",
      navOrigin: slots.navOrigin,
      navDestination: slots.navDestination,
      navWaypoints: slots.navWaypoints,
      navMode: "driving",
    });

    if (row) {
      console.log(
        `[PersistNavigationEpisodic] Saved scene episode id=${row.id} sceneName="${sceneName}" for userId=${userId}`
      );
    }
  } catch (err) {
    console.warn(
      `[PersistNavigationEpisodic] Failed to persist scene episode: ${(err as Error).message}`
    );
  }
}
