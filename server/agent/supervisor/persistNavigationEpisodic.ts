/**
 * 导航情景记忆兜底写入（STORE-003）
 *
 * 当规划已含导航成功结果，但本轮无任何成功的 memory_store 工具调用时，
 * 由服务端根据 dialogueSlots + 导航步骤输出直接写入 episodic，避免仅依赖 LLM。
 */

import type { SupervisorStateType } from "./state";
import { addMemory } from "../../memory/memorySystem";

function hasRouteSlots(
  slots: NonNullable<SupervisorStateType["dialogueSlots"]>
): boolean {
  return (
    (slots.navWaypoints && slots.navWaypoints.length > 0) ||
    (!!slots.navOrigin && !!slots.navDestination)
  );
}

/**
 * 条件满足时写入一条 episodic（versionGroup 去重更新同一路线摘要）。
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
  const content = parts.join("。");

  const row = await addMemory({
    userId,
    content,
    type: "fact",
    kind: "episodic",
    importance: 0.75,
    confidence: 0.85,
    tags: ["导航", "通勤", "路线"],
    source: "agent_skill",
    versionGroup: "commute_route_episodic_v1",
  });

  if (row) {
    console.log(
      `[PersistNavigationEpisodic] Saved episodic memory id=${row.id} for userId=${userId}`
    );
  }
}
