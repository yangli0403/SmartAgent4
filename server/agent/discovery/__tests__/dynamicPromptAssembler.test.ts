/**
 * DynamicPromptAssembler 单元测试
 *
 * 测试动态 Prompt 组装器的核心方法：
 * - buildClassifyPrompt()：分类节点 Prompt 生成
 * - buildPlanPrompt()：规划节点 Prompt 生成
 * - getAgentCapabilitySummary()：能力摘要
 * - buildSeparatedClassifyPrompt()：分离的分类 Prompt（V5 新增）
 * - buildSeparatedPlanPrompt()：分离的规划 Prompt（V5 新增）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DynamicPromptAssembler,
  createDynamicPromptAssembler,
} from "../dynamicPromptAssembler";
import { AgentCardRegistry } from "../agentCardRegistry";
import type { AgentCard } from "../types";

// ==================== 测试辅助函数 ====================

function createTestCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    id: "testAgent",
    name: "测试专员",
    description: "用于测试的 Agent",
    capabilities: ["test_capability"],
    tools: ["tool_a", "tool_b"],
    domain: "general",
    implementationClass: "TestAgent",
    llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
    systemPromptTemplate: "你是一个测试 Agent。",
    enabled: true,
    priority: 50,
    ...overrides,
  };
}

// ==================== 测试套件 ====================

describe("DynamicPromptAssembler", () => {
  let registry: AgentCardRegistry;
  let assembler: DynamicPromptAssembler;

  beforeEach(() => {
    registry = new AgentCardRegistry();
    assembler = new DynamicPromptAssembler(registry);
  });

  // ==================== buildClassifyPrompt ====================

  describe("buildClassifyPrompt()", () => {
    it("应包含所有已注册 Agent 的 ID 和描述", () => {
      registry.register(
        createTestCard({ id: "fileAgent", description: "文件管理专员" })
      );
      registry.register(
        createTestCard({ id: "navAgent", description: "导航出行专员" })
      );

      const prompt = assembler.buildClassifyPrompt();

      expect(prompt).toContain("fileAgent");
      expect(prompt).toContain("文件管理专员");
      expect(prompt).toContain("navAgent");
      expect(prompt).toContain("导航出行专员");
    });

    it("应包含领域分类规则", () => {
      registry.register(createTestCard());
      const prompt = assembler.buildClassifyPrompt();

      expect(prompt).toContain("navigation");
      expect(prompt).toContain("multimedia");
      expect(prompt).toContain("file_system");
      expect(prompt).toContain("general");
      expect(prompt).toContain("cross_domain");
    });

    it("应包含复杂度判断规则", () => {
      registry.register(createTestCard());
      const prompt = assembler.buildClassifyPrompt();

      expect(prompt).toContain("simple");
      expect(prompt).toContain("moderate");
      expect(prompt).toContain("complex");
    });

    it("应包含 JSON 输出格式要求", () => {
      registry.register(createTestCard());
      const prompt = assembler.buildClassifyPrompt();

      expect(prompt).toContain("domain");
      expect(prompt).toContain("complexity");
      expect(prompt).toContain("reasoning");
      expect(prompt).toContain("requiredAgents");
    });

    it("requiredAgents 示例应包含所有已注册 Agent 的 ID", () => {
      registry.register(createTestCard({ id: "agentA" }));
      registry.register(createTestCard({ id: "agentB" }));

      const prompt = assembler.buildClassifyPrompt();

      expect(prompt).toContain('"agentA"');
      expect(prompt).toContain('"agentB"');
    });

    it("应排除 disabled 的 Agent", () => {
      registry.register(createTestCard({ id: "enabled", enabled: true }));
      registry.register(createTestCard({ id: "disabled", enabled: false }));

      const prompt = assembler.buildClassifyPrompt();

      expect(prompt).toContain("enabled");
      expect(prompt).not.toContain("- disabled:");
    });

    it("空注册表应生成无 Agent 描述的 Prompt", () => {
      const prompt = assembler.buildClassifyPrompt();

      // 仍然应包含基本结构
      expect(prompt).toContain("可用的 Agent");
      expect(prompt).toContain("输出格式");
    });
  });

  // ==================== buildPlanPrompt ====================

  describe("buildPlanPrompt()", () => {
    it("应包含每个 Agent 的详细信息段", () => {
      registry.register(
        createTestCard({
          id: "fileAgent",
          name: "文件管理专员",
          description: "文件搜索和管理",
          capabilities: ["file_search", "file_management"],
          tools: ["search_files", "open_file"],
        })
      );

      const prompt = assembler.buildPlanPrompt();

      expect(prompt).toContain("### fileAgent: 文件管理专员");
      expect(prompt).toContain("文件搜索和管理");
      expect(prompt).toContain("file_search, file_management");
      expect(prompt).toContain("search_files, open_file");
    });

    it("无工具的 Agent 应显示'纯 LLM 对话'", () => {
      registry.register(
        createTestCard({
          id: "generalAgent",
          name: "通用专员",
          tools: [],
        })
      );

      const prompt = assembler.buildPlanPrompt();

      expect(prompt).toContain("纯 LLM 对话");
    });

    it("应包含并行执行提示", () => {
      registry.register(createTestCard());
      const prompt = assembler.buildPlanPrompt();

      expect(prompt).toContain("dependsOn");
      expect(prompt).toContain("并行执行");
    });

    it("应包含规划原则", () => {
      registry.register(createTestCard());
      const prompt = assembler.buildPlanPrompt();

      expect(prompt).toContain("规划原则");
      expect(prompt).toContain("原子操作");
      expect(prompt).toContain("inputMapping");
    });

    it("应包含 JSON 输出格式", () => {
      registry.register(createTestCard());
      const prompt = assembler.buildPlanPrompt();

      expect(prompt).toContain("goal");
      expect(prompt).toContain("steps");
      expect(prompt).toContain("targetAgent");
      expect(prompt).toContain("expectedTools");
    });
  });

  // ==================== buildSeparatedClassifyPrompt (V5 新增) ====================

  describe("buildSeparatedClassifyPrompt()", () => {
    it("应返回包含 staticSystemPrompt 和 dynamicContentMessage 的载荷", () => {
      registry.register(createTestCard({ id: "fileAgent" }));

      const payload = assembler.buildSeparatedClassifyPrompt();

      expect(payload).toHaveProperty("staticSystemPrompt");
      expect(payload).toHaveProperty("dynamicContentMessage");
      expect(typeof payload.staticSystemPrompt).toBe("string");
      expect(typeof payload.dynamicContentMessage).toBe("string");
    });

    it("静态部分不应包含动态 Agent 信息", () => {
      registry.register(
        createTestCard({ id: "fileAgent", description: "文件管理专员" })
      );

      const payload = assembler.buildSeparatedClassifyPrompt();

      // 静态部分不应包含具体的 Agent ID
      expect(payload.staticSystemPrompt).not.toContain("fileAgent");
      expect(payload.staticSystemPrompt).not.toContain("文件管理专员");
    });

    it("静态部分应包含固定的规则和格式", () => {
      registry.register(createTestCard());

      const payload = assembler.buildSeparatedClassifyPrompt();

      expect(payload.staticSystemPrompt).toContain("智能任务分类器");
      expect(payload.staticSystemPrompt).toContain("领域分类规则");
      expect(payload.staticSystemPrompt).toContain("复杂度判断规则");
      expect(payload.staticSystemPrompt).toContain("输出格式");
    });

    it("动态部分应包含所有已注册 Agent 的信息", () => {
      registry.register(
        createTestCard({ id: "fileAgent", description: "文件管理专员" })
      );
      registry.register(
        createTestCard({ id: "navAgent", description: "导航出行专员" })
      );

      const payload = assembler.buildSeparatedClassifyPrompt();

      expect(payload.dynamicContentMessage).toContain("fileAgent");
      expect(payload.dynamicContentMessage).toContain("文件管理专员");
      expect(payload.dynamicContentMessage).toContain("navAgent");
      expect(payload.dynamicContentMessage).toContain("导航出行专员");
    });

    it("注册表变化时静态部分应保持不变", () => {
      const payload1 = assembler.buildSeparatedClassifyPrompt();

      registry.register(createTestCard({ id: "newAgent" }));
      const payload2 = assembler.buildSeparatedClassifyPrompt();

      expect(payload1.staticSystemPrompt).toBe(payload2.staticSystemPrompt);
      expect(payload1.dynamicContentMessage).not.toBe(
        payload2.dynamicContentMessage
      );
    });

    it("应排除 disabled 的 Agent", () => {
      registry.register(createTestCard({ id: "enabled", enabled: true }));
      registry.register(createTestCard({ id: "disabled", enabled: false }));

      const payload = assembler.buildSeparatedClassifyPrompt();

      expect(payload.dynamicContentMessage).toContain("enabled");
      expect(payload.dynamicContentMessage).not.toContain("- disabled:");
    });
  });

  // ==================== buildSeparatedPlanPrompt (V5 新增) ====================

  describe("buildSeparatedPlanPrompt()", () => {
    it("应返回包含 staticSystemPrompt 和 dynamicContentMessage 的载荷", () => {
      registry.register(createTestCard());

      const payload = assembler.buildSeparatedPlanPrompt();

      expect(payload).toHaveProperty("staticSystemPrompt");
      expect(payload).toHaveProperty("dynamicContentMessage");
    });

    it("静态部分不应包含动态 Agent 信息", () => {
      registry.register(
        createTestCard({
          id: "fileAgent",
          name: "文件管理专员",
          tools: ["search_files"],
        })
      );

      const payload = assembler.buildSeparatedPlanPrompt();

      expect(payload.staticSystemPrompt).not.toContain("fileAgent");
      expect(payload.staticSystemPrompt).not.toContain("search_files");
    });

    it("静态部分应包含规划原则", () => {
      registry.register(createTestCard());

      const payload = assembler.buildSeparatedPlanPrompt();

      expect(payload.staticSystemPrompt).toContain("规划原则");
      expect(payload.staticSystemPrompt).toContain("原子操作");
      expect(payload.staticSystemPrompt).toContain("并行执行");
    });

    it("动态部分应包含 Agent 的工具列表", () => {
      registry.register(
        createTestCard({
          id: "fileAgent",
          name: "文件管理专员",
          tools: ["search_files", "open_file"],
        })
      );

      const payload = assembler.buildSeparatedPlanPrompt();

      expect(payload.dynamicContentMessage).toContain("search_files, open_file");
    });

    it("注册表变化时静态部分应保持不变", () => {
      const payload1 = assembler.buildSeparatedPlanPrompt();

      registry.register(createTestCard({ id: "newAgent" }));
      const payload2 = assembler.buildSeparatedPlanPrompt();

      expect(payload1.staticSystemPrompt).toBe(payload2.staticSystemPrompt);
    });
  });

  // ==================== getAgentCapabilitySummary ====================

  describe("getAgentCapabilitySummary()", () => {
    it("应返回所有已启用 Agent 的能力摘要", () => {
      registry.register(
        createTestCard({
          id: "fileAgent",
          name: "文件管理专员",
          description: "文件搜索和管理",
          capabilities: ["file_search", "file_management"],
        })
      );
      registry.register(
        createTestCard({
          id: "navAgent",
          name: "导航专员",
          description: "导航和位置",
          capabilities: ["poi_search", "route_planning"],
        })
      );

      const summary = assembler.getAgentCapabilitySummary();

      expect(summary).toContain("[fileAgent]");
      expect(summary).toContain("文件管理专员");
      expect(summary).toContain("file_search, file_management");
      expect(summary).toContain("[navAgent]");
      expect(summary).toContain("导航专员");
      expect(summary).toContain("poi_search, route_planning");
    });

    it("空注册表应返回空字符串", () => {
      expect(assembler.getAgentCapabilitySummary()).toBe("");
    });
  });

  // ==================== 工厂函数 ====================

  describe("createDynamicPromptAssembler()", () => {
    it("应创建有效的 DynamicPromptAssembler 实例", () => {
      const instance = createDynamicPromptAssembler(registry);
      expect(instance).toBeInstanceOf(DynamicPromptAssembler);
    });
  });
});
