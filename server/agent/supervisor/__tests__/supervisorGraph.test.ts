/**
 * Supervisor Graph 集成测试
 *
 * 测试 Supervisor 图的构建和节点连接正确性。
 * 不涉及实际 LLM 调用，验证图结构和路由逻辑。
 */
import { describe, it, expect, vi } from "vitest";
import { routeByComplexity } from "../classifyNode";
import { shouldContinueAfterReplan } from "../replanNode";
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

describe("Supervisor Graph Integration", () => {
  // ==================== 场景1：简单导航任务 ====================

  describe("场景1：简单导航任务流程", () => {
    it("simple 分类应跳过 plan 直接进入 execute", () => {
      const state = createMockState({
        taskClassification: {
          domain: "navigation",
          complexity: "simple",
          reasoning: "简单的位置查询",
          requiredAgents: ["navigationAgent"],
        },
        plan: [
          {
            id: 1,
            description: "搜索附近充电桩",
            targetAgent: "navigationAgent",
            expectedTools: ["maps_search_around"],
            dependsOn: [],
            inputMapping: {},
          },
        ],
      });

      // classify → execute（跳过 plan）
      expect(routeByComplexity(state)).toBe("execute");
    });

    it("执行完成后应路由到 respond", () => {
      const state = createMockState({
        plan: [
          {
            id: 1,
            description: "搜索",
            targetAgent: "navigationAgent",
            expectedTools: [],
            dependsOn: [],
            inputMapping: {},
          },
        ],
        currentStepIndex: 1, // 已执行完所有步骤
        stepResults: [
          { stepId: 1, status: "success", output: "找到充电桩", durationMs: 1000 },
        ],
      });

      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });
  });

  // ==================== 场景2：复杂导航任务 ====================

  describe("场景2：复杂导航任务流程", () => {
    const complexPlan: PlanStep[] = [
      {
        id: 1,
        description: "获取用户位置",
        targetAgent: "navigationAgent",
        expectedTools: ["maps_ip_location"],
        dependsOn: [],
        inputMapping: {},
      },
      {
        id: 2,
        description: "搜索附近3公里充电桩",
        targetAgent: "navigationAgent",
        expectedTools: ["maps_search_around"],
        dependsOn: [1],
        inputMapping: { location: "step_1.output" },
      },
      {
        id: 3,
        description: "筛选小桔充电并按价格排序",
        targetAgent: "navigationAgent",
        expectedTools: [],
        dependsOn: [2],
        inputMapping: { chargerList: "step_2.output" },
      },
    ];

    it("moderate 分类应先进入 plan", () => {
      const state = createMockState({
        taskClassification: {
          domain: "navigation",
          complexity: "moderate",
          reasoning: "需要多步操作",
          requiredAgents: ["navigationAgent"],
        },
      });
      expect(routeByComplexity(state)).toBe("plan");
    });

    it("第1步完成后应继续执行第2步", () => {
      const state = createMockState({
        plan: complexPlan,
        currentStepIndex: 1, // 下一步是 step 2
        stepResults: [
          { stepId: 1, status: "success", output: "位置: 北京", durationMs: 500 },
        ],
      });
      expect(shouldContinueAfterReplan(state)).toBe("execute");
    });

    it("所有步骤完成后应路由到 respond", () => {
      const state = createMockState({
        plan: complexPlan,
        currentStepIndex: 3,
        stepResults: [
          { stepId: 1, status: "success", output: "位置", durationMs: 500 },
          { stepId: 2, status: "success", output: "充电桩列表", durationMs: 1000 },
          { stepId: 3, status: "success", output: "排序结果", durationMs: 200 },
        ],
      });
      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });
  });

  // ==================== 场景3：音乐搜索任务 ====================

  describe("场景3：音乐搜索任务流程", () => {
    it("simple 音乐任务应直接执行", () => {
      const state = createMockState({
        taskClassification: {
          domain: "multimedia",
          complexity: "simple",
          reasoning: "简单的音乐搜索",
          requiredAgents: ["multimediaAgent"],
        },
      });
      expect(routeByComplexity(state)).toBe("execute");
    });
  });

  // ==================== 场景4：文件搜索任务（保留能力验证） ====================

  describe("场景4：文件搜索任务流程", () => {
    it("simple 文件任务应直接执行", () => {
      const state = createMockState({
        taskClassification: {
          domain: "file_system",
          complexity: "simple",
          reasoning: "简单的文件搜索",
          requiredAgents: ["fileAgent"],
        },
      });
      expect(routeByComplexity(state)).toBe("execute");
    });
  });

  // ==================== 场景5：跨领域任务 ====================

  describe("场景5：跨领域任务流程", () => {
    it("cross_domain 任务应标记为 complex 并进入 plan", () => {
      const state = createMockState({
        taskClassification: {
          domain: "cross_domain",
          complexity: "complex",
          reasoning: "涉及导航和文件两个领域",
          requiredAgents: ["navigationAgent", "fileAgent"],
        },
      });
      expect(routeByComplexity(state)).toBe("plan");
    });
  });

  // ==================== 场景6：错误处理和降级 ====================

  describe("场景6：错误处理和降级", () => {
    it("分类失败（null）应降级到 execute", () => {
      const state = createMockState({
        taskClassification: null,
      });
      expect(routeByComplexity(state)).toBe("execute");
    });

    it("abort 后应路由到 respond", () => {
      const state = createMockState({
        plan: [
          {
            id: 1,
            description: "test",
            targetAgent: "navigationAgent",
            expectedTools: [],
            dependsOn: [],
            inputMapping: {},
          },
        ],
        currentStepIndex: 1,
        finalResponse: "任务已中止：MCP Server 不可用",
      });
      expect(shouldContinueAfterReplan(state)).toBe("respond");
    });
  });
});
