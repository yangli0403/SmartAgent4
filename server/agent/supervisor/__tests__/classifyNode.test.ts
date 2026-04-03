/**
 * ClassifyNode 单元测试
 *
 * 测试路由函数 routeByComplexity 和降级逻辑。
 * classifyNode 本身依赖 LLM，通过 mock 测试。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  routeByComplexity,
  CLASSIFY_SYSTEM_PROMPT,
  resolveAgentsForDomain,
} from "../classifyNode";
import { AgentCardRegistry } from "../../discovery/agentCardRegistry";
import type { AgentCard } from "../../discovery/types";
import type { SupervisorStateType, TaskClassification } from "../state";
import { HumanMessage } from "@langchain/core/messages";

/**
 * 创建模拟 SupervisorState
 */
function createMockState(
  overrides: Partial<SupervisorStateType> = {}
): SupervisorStateType {
  return {
    messages: overrides.messages || [new HumanMessage("测试消息")],
    taskClassification: overrides.taskClassification || null,
    plan: overrides.plan || [],
    currentStepIndex: overrides.currentStepIndex || 0,
    stepResults: overrides.stepResults || [],
    finalResponse: overrides.finalResponse || "",
    context: overrides.context || null,
  };
}

describe("ClassifyNode", () => {
  // ==================== CLASSIFY_SYSTEM_PROMPT ====================

  describe("CLASSIFY_SYSTEM_PROMPT", () => {
    it("应包含所有可用领域", () => {
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("navigation");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("multimedia");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("file_system");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("general");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("cross_domain");
    });

    it("应包含所有复杂度级别", () => {
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("simple");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("moderate");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("complex");
    });

    it("应包含所有可用 Agent", () => {
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("fileAgent");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("navigationAgent");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("multimediaAgent");
      expect(CLASSIFY_SYSTEM_PROMPT).toContain("generalAgent");
    });
  });

  // ==================== routeByComplexity ====================

  describe("routeByComplexity", () => {
    it("simple 任务应路由到 execute", () => {
      const state = createMockState({
        taskClassification: {
          domain: "navigation",
          complexity: "simple",
          reasoning: "简单查询",
          requiredAgents: ["navigationAgent"],
        },
      });
      expect(routeByComplexity(state)).toBe("execute");
    });

    it("moderate 任务应路由到 plan", () => {
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

    it("complex 任务应路由到 plan", () => {
      const state = createMockState({
        taskClassification: {
          domain: "cross_domain",
          complexity: "complex",
          reasoning: "跨领域复杂任务",
          requiredAgents: ["navigationAgent", "fileAgent"],
        },
      });
      expect(routeByComplexity(state)).toBe("plan");
    });

    it("无分类结果时应路由到 execute（降级）", () => {
      const state = createMockState({
        taskClassification: null,
      });
      expect(routeByComplexity(state)).toBe("execute");
    });
  });

  describe("resolveAgentsForDomain", () => {
    function minimalCard(
      id: string,
      domain: string,
      priority = 50
    ): AgentCard {
      return {
        id,
        name: id,
        description: "t",
        capabilities: [],
        tools: [],
        domain,
        implementationClass: "GeneralAgent",
        llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
        systemPromptTemplate: "",
        enabled: true,
        priority,
      };
    }

    it("应通过 findByDomain 解析自定义领域到对应 Agent", () => {
      const r = new AgentCardRegistry();
      r.register(minimalCard("customA", "my_custom_domain", 80));
      expect(resolveAgentsForDomain("my_custom_domain", r)).toEqual([
        "customA",
      ]);
    });

    it("同域多 Card 时应取 priority 最高者（注册表已排序）", () => {
      const r = new AgentCardRegistry();
      r.register(minimalCard("low", "file_system", 10));
      r.register(minimalCard("high", "file_system", 90));
      expect(resolveAgentsForDomain("file_system", r)).toEqual(["high"]);
    });

    it("cross_domain 应只返回注册表中存在的 Agent", () => {
      const r = new AgentCardRegistry();
      r.register(minimalCard("navigationAgent", "navigation"));
      expect(resolveAgentsForDomain("cross_domain", r)).toEqual([
        "navigationAgent",
      ]);
    });

    it("无 Card 时 file_system 应回退到 fileAgent", () => {
      const r = new AgentCardRegistry();
      expect(resolveAgentsForDomain("file_system", r)).toEqual(["fileAgent"]);
    });
  });
});
