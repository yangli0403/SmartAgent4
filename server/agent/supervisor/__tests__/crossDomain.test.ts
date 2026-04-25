/**
 * 跨域协同集成测试
 *
 * 测试 classifyNode、planNode 和 executeNode 在跨域场景下的协作：
 * 1. 行程规划 → 飞书发送（NavigationAgent → OfficeAgent）
 * 2. 餐厅搜索 → 飞书建群（ServiceAgent → OfficeAgent）
 *
 * 由于 classifyNode/planNode 依赖 LLM，此处主要测试：
 * - resolveAgentsForDomain 对新领域的正确映射
 * - resolveInputMapping 的跨步骤数据传递
 * - executeNode 的 Agent 分发逻辑
 *
 * 关联用户测试用例：UTC-B5-1 ~ UTC-B5-4, UTC-B9-1 ~ UTC-B9-4
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveInputMapping } from "../executeNode";
import { resolveAgentsForDomain } from "../classifyNode";
import type { PlanStep, StepResult } from "../state";

// ==================== Mock AgentCardRegistry ====================
const mockRegistry = {
  size: () => 6,
  has: (id: string) =>
    [
      "fileAgent",
      "navigationAgent",
      "multimediaAgent",
      "generalAgent",
      "officeAgent",
      "serviceAgent",
    ].includes(id),
  getAllEnabled: () => [
    { id: "fileAgent", domain: "file_system" },
    { id: "navigationAgent", domain: "navigation" },
    { id: "multimediaAgent", domain: "multimedia" },
    { id: "generalAgent", domain: "general" },
    { id: "officeAgent", domain: "office" },
    { id: "serviceAgent", domain: "service" },
  ],
  getAllIds: () => [
    "fileAgent",
    "navigationAgent",
    "multimediaAgent",
    "generalAgent",
    "officeAgent",
    "serviceAgent",
  ],
  findByDomain: (domain: string) => {
    const map: Record<string, { id: string; domain: string }[]> = {
      navigation: [{ id: "navigationAgent", domain: "navigation" }],
      multimedia: [{ id: "multimediaAgent", domain: "multimedia" }],
      file_system: [{ id: "fileAgent", domain: "file_system" }],
      general: [{ id: "generalAgent", domain: "general" }],
      office: [{ id: "officeAgent", domain: "office" }],
      service: [{ id: "serviceAgent", domain: "service" }],
    };
    return map[domain] || [];
  },
  getCard: vi.fn(),
};

// ==================== 测试 ====================
describe("Cross-Domain Collaboration", () => {
  // ==================== resolveAgentsForDomain ====================
  describe("resolveAgentsForDomain", () => {
    // UTC-B5-1: office 领域应映射到 officeAgent
    it("office 领域应返回 officeAgent", () => {
      const agents = resolveAgentsForDomain("office", mockRegistry as any);
      expect(agents).toEqual(["officeAgent"]);
    });

    // UTC-B5-2: service 领域应映射到 serviceAgent
    it("service 领域应返回 serviceAgent", () => {
      const agents = resolveAgentsForDomain("service", mockRegistry as any);
      expect(agents).toEqual(["serviceAgent"]);
    });

    // UTC-B5-3: cross_domain 应包含所有可用 Agent
    it("cross_domain 应包含所有已注册 Agent", () => {
      const agents = resolveAgentsForDomain(
        "cross_domain",
        mockRegistry as any
      );
      expect(agents).toContain("navigationAgent");
      expect(agents).toContain("officeAgent");
      expect(agents).toContain("serviceAgent");
      expect(agents.length).toBeGreaterThanOrEqual(5);
    });

    // UTC-B5-4: 保持原有领域映射不变
    it("navigation 领域仍应返回 navigationAgent", () => {
      const agents = resolveAgentsForDomain(
        "navigation",
        mockRegistry as any
      );
      expect(agents).toEqual(["navigationAgent"]);
    });

    it("general 领域仍应返回 generalAgent", () => {
      const agents = resolveAgentsForDomain(
        "general",
        mockRegistry as any
      );
      expect(agents).toEqual(["generalAgent"]);
    });
  });

  // ==================== resolveInputMapping ====================
  describe("resolveInputMapping (cross-domain data passing)", () => {
    // UTC-B9-1: 行程数据应能传递到飞书发送步骤
    it("应从 step_1 的 output 中提取行程数据传递到 step_2", () => {
      const itineraryOutput = JSON.stringify({
        destination: "上海",
        date: "2026-04-26",
        stops: [
          {
            time: "09:00",
            location: "外滩",
            activity: "观光",
            duration: "1.5h",
          },
        ],
        totalDuration: "8小时",
      });

      const step2: PlanStep = {
        id: 2,
        description: "将行程规划结果发送到飞书群",
        targetAgent: "officeAgent",
        expectedTools: ["feishu_send_message"],
        dependsOn: [1],
        inputMapping: {
          itineraryData: "step_1.output",
        },
      };

      const completedResults: StepResult[] = [
        {
          stepId: 1,
          status: "success",
          output: itineraryOutput,
          durationMs: 100,
          toolCalls: [],
        },
      ];

      const resolved = resolveInputMapping(step2, completedResults);
      expect(resolved.itineraryData).toBe(itineraryOutput);
    });

    // UTC-B9-2: 应能从 JSON output 中提取嵌套字段
    it("应能从 step_1 的 JSON output 中提取 destination 字段", () => {
      const itineraryOutput = JSON.stringify({
        destination: "上海",
        date: "2026-04-26",
        stops: [],
      });

      const step2: PlanStep = {
        id: 2,
        description: "发送行程到飞书",
        targetAgent: "officeAgent",
        expectedTools: ["feishu_send_message"],
        dependsOn: [1],
        inputMapping: {
          destination: "step_1.destination",
        },
      };

      const completedResults: StepResult[] = [
        {
          stepId: 1,
          status: "success",
          output: itineraryOutput,
          durationMs: 100,
          toolCalls: [],
        },
      ];

      const resolved = resolveInputMapping(step2, completedResults);
      expect(resolved.destination).toBe("上海");
    });

    // UTC-B9-3: 多步骤数据传递
    it("应支持从多个前置步骤提取数据", () => {
      const step3: PlanStep = {
        id: 3,
        description: "汇总行程和餐厅信息发送到飞书",
        targetAgent: "officeAgent",
        expectedTools: ["feishu_send_message"],
        dependsOn: [1, 2],
        inputMapping: {
          itinerary: "step_1.output",
          restaurants: "step_2.output",
        },
      };

      const completedResults: StepResult[] = [
        {
          stepId: 1,
          status: "success",
          output: "上海一日游行程",
          durationMs: 100,
          toolCalls: [],
        },
        {
          stepId: 2,
          status: "success",
          output: "推荐餐厅列表",
          durationMs: 80,
          toolCalls: [],
        },
      ];

      const resolved = resolveInputMapping(step3, completedResults);
      expect(resolved.itinerary).toBe("上海一日游行程");
      expect(resolved.restaurants).toBe("推荐餐厅列表");
    });

    // UTC-B9-4: 前置步骤失败时的降级处理
    it("前置步骤结果不存在时应跳过映射", () => {
      const step2: PlanStep = {
        id: 2,
        description: "发送行程到飞书",
        targetAgent: "officeAgent",
        expectedTools: ["feishu_send_message"],
        dependsOn: [1],
        inputMapping: {
          itineraryData: "step_1.output",
        },
      };

      // 没有 step_1 的结果
      const completedResults: StepResult[] = [];

      const resolved = resolveInputMapping(step2, completedResults);
      expect(resolved.itineraryData).toBeUndefined();
    });

    it("前置步骤状态为 error 时仍可提取 error 信息", () => {
      const step2: PlanStep = {
        id: 2,
        description: "汇总结果",
        targetAgent: "generalAgent",
        expectedTools: [],
        dependsOn: [1],
        inputMapping: {
          errorInfo: "step_1.error",
          stepStatus: "step_1.status",
        },
      };

      const completedResults: StepResult[] = [
        {
          stepId: 1,
          status: "error",
          error: "行程规划失败：目的地不存在",
          durationMs: 50,
          toolCalls: [],
        },
      ];

      const resolved = resolveInputMapping(step2, completedResults);
      expect(resolved.errorInfo).toBe("行程规划失败：目的地不存在");
      expect(resolved.stepStatus).toBe("error");
    });
  });
});
