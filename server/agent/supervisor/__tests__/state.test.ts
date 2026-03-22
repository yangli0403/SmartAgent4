/**
 * Supervisor State 单元测试
 *
 * 测试状态类型定义和 Annotation 的正确性。
 */
import { describe, it, expect } from "vitest";
import {
  SupervisorState,
  type TaskClassification,
  type PlanStep,
  type StepResult,
  type ReplanDecision,
  type UserContext,
  type UserLocation,
} from "../state";

describe("Supervisor State Types", () => {
  // ==================== TaskClassification ====================

  describe("TaskClassification", () => {
    it("应能创建有效的分类对象", () => {
      const classification: TaskClassification = {
        domain: "navigation",
        complexity: "moderate",
        reasoning: "用户要求搜索充电桩，属于导航领域",
        requiredAgents: ["navigationAgent"],
      };
      expect(classification.domain).toBe("navigation");
      expect(classification.complexity).toBe("moderate");
      expect(classification.requiredAgents).toContain("navigationAgent");
    });

    it("cross_domain 应支持多个 Agent", () => {
      const classification: TaskClassification = {
        domain: "cross_domain",
        complexity: "complex",
        reasoning: "跨领域任务",
        requiredAgents: ["navigationAgent", "fileAgent", "multimediaAgent"],
      };
      expect(classification.requiredAgents.length).toBe(3);
    });
  });

  // ==================== PlanStep ====================

  describe("PlanStep", () => {
    it("应能创建有效的计划步骤", () => {
      const step: PlanStep = {
        id: 1,
        description: "搜索附近的充电桩",
        targetAgent: "navigationAgent",
        expectedTools: ["maps_search_around"],
        dependsOn: [],
        inputMapping: {},
      };
      expect(step.id).toBe(1);
      expect(step.targetAgent).toBe("navigationAgent");
    });

    it("应支持步骤间依赖", () => {
      const step: PlanStep = {
        id: 2,
        description: "筛选最便宜的充电桩",
        targetAgent: "navigationAgent",
        expectedTools: [],
        dependsOn: [1],
        inputMapping: { chargerList: "step_1.output" },
      };
      expect(step.dependsOn).toContain(1);
      expect(step.inputMapping["chargerList"]).toBe("step_1.output");
    });
  });

  // ==================== StepResult ====================

  describe("StepResult", () => {
    it("成功结果应包含 output", () => {
      const result: StepResult = {
        stepId: 1,
        status: "success",
        output: "找到 5 个充电桩",
        durationMs: 1500,
        toolCalls: [
          {
            toolName: "maps_search_around",
            serverId: "amap",
            input: { keywords: "充电桩" },
            output: { count: 5 },
            status: "success",
            durationMs: 1200,
          },
        ],
      };
      expect(result.status).toBe("success");
      expect(result.output).toBeDefined();
      expect(result.toolCalls!.length).toBe(1);
    });

    it("失败结果应包含 error", () => {
      const result: StepResult = {
        stepId: 2,
        status: "error",
        error: "MCP Server 连接超时",
        durationMs: 30000,
      };
      expect(result.status).toBe("error");
      expect(result.error).toBeDefined();
    });
  });

  // ==================== ReplanDecision ====================

  describe("ReplanDecision", () => {
    it("continue 决策应只有 reasoning", () => {
      const decision: ReplanDecision = {
        action: "continue",
        reasoning: "当前步骤成功，继续执行下一步",
      };
      expect(decision.action).toBe("continue");
    });

    it("replan 决策应包含 updatedPlan", () => {
      const decision: ReplanDecision = {
        action: "replan",
        reasoning: "搜索结果不理想，调整搜索策略",
        updatedPlan: [
          {
            id: 1,
            description: "扩大搜索范围",
            targetAgent: "navigationAgent",
            expectedTools: ["maps_search_around"],
            dependsOn: [],
            inputMapping: {},
          },
        ],
      };
      expect(decision.updatedPlan!.length).toBe(1);
    });

    it("complete 决策应包含 finalResponse", () => {
      const decision: ReplanDecision = {
        action: "complete",
        reasoning: "已获得足够信息",
        finalResponse: "为您找到了最便宜的充电桩...",
      };
      expect(decision.finalResponse).toBeDefined();
    });

    it("abort 决策应包含 abortReason", () => {
      const decision: ReplanDecision = {
        action: "abort",
        reasoning: "关键工具不可用",
        abortReason: "高德地图 MCP Server 无法连接",
      };
      expect(decision.abortReason).toBeDefined();
    });
  });

  // ==================== UserContext ====================

  describe("UserContext", () => {
    it("应能创建完整的用户上下文", () => {
      const ctx: UserContext = {
        userId: "user-1",
        sessionId: "session-1",
        location: {
          latitude: 39.9,
          longitude: 116.4,
          city: "北京",
          address: "北京市朝阳区",
        },
        currentTime: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        platform: "windows",
        personality: "friendly",
        responseStyle: "balanced",
      };
      expect(ctx.userId).toBe("user-1");
      expect(ctx.location!.city).toBe("北京");
      expect(ctx.platform).toBe("windows");
    });

    it("location 应为可选字段", () => {
      const ctx: UserContext = {
        userId: "user-1",
        sessionId: "session-1",
        currentTime: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        platform: "linux",
        personality: "friendly",
        responseStyle: "balanced",
      };
      expect(ctx.location).toBeUndefined();
    });
  });

  // ==================== SupervisorState Annotation ====================

  describe("SupervisorState Annotation", () => {
    it("应能正确定义 State 类型", () => {
      // 验证 SupervisorState 是一个有效的 Annotation
      expect(SupervisorState).toBeDefined();
      // Annotation.Root 返回的对象包含 spec 属性
      expect(SupervisorState.spec).toBeDefined();
    });
  });
});
