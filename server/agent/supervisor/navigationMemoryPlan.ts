/**
 * 导航多轮情景记忆（STORE-003）
 *
 * 当会话槽位已具备「通勤/路线」完整度（起终点或途经点）且计划中含导航步骤时，
 * 追加一步 generalAgent + memory_store，避免仅 navigationAgent 执行而无法写入情景记忆。
 */

import type { SupervisorStateType, PlanStep } from "./state";

function planHasMemoryFollowUp(steps: PlanStep[]): boolean {
  return steps.some(
    (s) =>
      s.targetAgent === "generalAgent" &&
      (s.expectedTools?.includes("memory_store") ||
        /memory_store|情景记忆|episodic/i.test(s.description))
  );
}

/**
 * 若满足条件，在计划末尾追加「用 memory_store 记录本次导航情景」的 generalAgent 步骤。
 */
export function appendGeneralAgentMemoryStepIfNeeded(
  state: SupervisorStateType,
  steps: PlanStep[]
): PlanStep[] {
  const slots = state.dialogueSlots;
  if (!slots || steps.length === 0) return steps;

  const hasRouteContext =
    (slots.navWaypoints && slots.navWaypoints.length > 0) ||
    (!!slots.navOrigin && !!slots.navDestination);

  if (!hasRouteContext) return steps;

  const navSteps = steps.filter((s) => s.targetAgent === "navigationAgent");
  if (navSteps.length === 0) return steps;

  if (planHasMemoryFollowUp(steps)) return steps;

  const lastNav = navSteps[navSteps.length - 1];
  const maxId = Math.max(...steps.map((s) => s.id));

  const memoryStep: PlanStep = {
    id: maxId + 1,
    description:
      "根据对话槽位与上一步导航/路线结果，调用 memory_store 写入一条 episodic 情景记忆，完整概括本次通勤（起点、终点、途经点/偏好）。content 用自然语言一句即可；tags 可含 导航、通勤、路线。",
    targetAgent: "generalAgent",
    expectedTools: ["memory_store"],
    dependsOn: [lastNav.id],
    inputMapping: {
      navigationResult: `step_${lastNav.id}.output`,
    },
  };

  console.log(
    `[NavigationMemoryPlan] Appended memory_store step ${memoryStep.id} after navigation step ${lastNav.id}`
  );

  return [...steps, memoryStep];
}
