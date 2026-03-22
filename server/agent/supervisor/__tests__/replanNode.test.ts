/**
 * ReplanNode 单元测试
 *
 * 测试路由函数 shouldContinueAfterReplan 的决策逻辑。
 */
import { describe, it, expect } from "vitest";
import { shouldContinueAfterReplan, REPLAN_SYSTEM_PROMPT } from "../replanNode";
import type { SupervisorStateType, PlanStep, StepResult } from "../state";
import { HumanMessage } from "@langchain/core/messages";

function createMockState(
  overrides: Partial<SupervisorStateType> = {}
): SupervisorStateType {
  return {
    messages: overrides.messages || [new HumanMessage("测试")],
    taskClassification: overrides.taskClassification || null,
    plan: overrides.plan || [],
    currentStepIndex: overrides.currentStepIndex ?? 0,
    stepResults: overrides.stepResults || [],
    finalResponse: overrides.finalResponse || "",
    context: overrides.context || null,
  };
}

const samplePlan: PlanStep[] = [
  {
    id: 1,
    description: "搜索充电桩",
    targetAgent: "navigationAgent",
    expectedTools: ["maps_search_around"],
    dependsOn: [],
    inputMapping: {},
  },
  {
    id: 2,
    description: "筛选最便宜的",
    targetAgent: "navigationAgent",
    expectedTools: [],
    dependsOn: [1],
    inputMapping: {},
  },
  {
    id: 3,
    description: "生成路线",
    targetAgent: "navigationAgent",
    expectedTools: ["maps_direction_driving"],
    dependsOn: [2],
    inputMapping: {},
  },
];

describe("ReplanNode", () => {
  // ==================== REPLAN_SYSTEM_PROMPT ====================

  describe("REPLAN_SYSTEM_PROMPT", () => {
    it("应包含所有决策动作", () => {
      expect(REPLAN_SYSTEM_PROMPT).toContain("continue");
      expect(REPLAN_SYSTEM_PROMPT).toContain("replan");
      expect(REPLAN_SYSTEM_PROMPT).toContain("complete");
      expect(REPLAN_SYSTEM_PROMPT).toContain("abort");
    });
  });

  // ==================== shouldContinueAfterReplan ====================

  describe("shouldContinueAfterReplan", () => {
    it("有 finalResponse 时应路由到 respond", () => {
      const state = createMockState({
        plan: samplePlan,
        currentStepIndex: 1,
        finalResponse: "这是最终回复",
      });
      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });

    it("还有剩余步骤时应路由到 execute", () => {
      const state = createMockState({
        plan: samplePlan,
        currentStepIndex: 1, // 还有 step 2 和 3
        finalResponse: "",
      });
      expect(shouldContinueAfterReplan(state)).toBe("execute");
    });

    it("所有步骤完成且无 finalResponse 时应路由到 respond", () => {
      const state = createMockState({
        plan: samplePlan,
        currentStepIndex: 3, // 等于 plan.length
        stepResults: [
          { stepId: 1, status: "success", output: "ok", durationMs: 100 },
          { stepId: 2, status: "success", output: "ok", durationMs: 100 },
          { stepId: 3, status: "success", output: "ok", durationMs: 100 },
        ],
        finalResponse: "",
      });
      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });

    it("空计划时应路由到 respond", () => {
      const state = createMockState({
        plan: [],
        currentStepIndex: 0,
        finalResponse: "",
      });
      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });

    it("abort 后（currentStepIndex >= plan.length）应路由到 respond", () => {
      const state = createMockState({
        plan: samplePlan,
        currentStepIndex: samplePlan.length,
        finalResponse: "任务已中止",
      });
      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });
  });
});
