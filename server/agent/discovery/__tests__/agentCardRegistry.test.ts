/**
 * AgentCardRegistry 单元测试
 *
 * 测试 Agent Card 动态注册表的所有核心方法：
 * - 注册、注销、查询、绑定
 * - 从目录加载 JSON 文件
 * - 按能力和领域查找
 * - 单例工厂
 * - 错误处理和边界情况
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AgentCardRegistry,
  AgentCardSchema,
  getAgentCardRegistry,
  resetAgentCardRegistry,
} from "../agentCardRegistry";
import type { AgentCard } from "../types";
import type { DomainAgentInterface } from "../../domains/types";
import * as path from "path";

// ==================== 测试辅助函数 ====================

/**
 * 创建一个有效的 Agent Card 测试数据
 */
function createTestCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    id: "testAgent",
    name: "测试专员",
    description: "用于测试的 Agent",
    capabilities: ["test_capability", "another_capability"],
    tools: ["tool_a", "tool_b"],
    domain: "general",
    implementationClass: "TestAgent",
    llmConfig: {
      temperature: 0.7,
      maxTokens: 4096,
      maxIterations: 5,
    },
    systemPromptTemplate: "你是一个测试 Agent。",
    enabled: true,
    priority: 50,
    ...overrides,
  };
}

/**
 * 创建一个 Mock Agent 实例
 */
function createMockAgent(name: string = "testAgent"): DomainAgentInterface {
  return {
    name,
    description: "Mock Agent",
    availableTools: ["tool_a"],
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: "mock output",
      toolCalls: [],
    }),
    getSystemPrompt: vi.fn().mockReturnValue("mock prompt"),
    parseStructuredData: vi.fn().mockReturnValue(null),
  };
}

// ==================== 测试套件 ====================

describe("AgentCardRegistry", () => {
  let registry: AgentCardRegistry;

  beforeEach(() => {
    registry = new AgentCardRegistry();
  });

  // ==================== register / has / size ====================

  describe("register()", () => {
    it("应能注册一个有效的 Agent Card", () => {
      const card = createTestCard();
      registry.register(card);

      expect(registry.has("testAgent")).toBe(true);
      expect(registry.size()).toBe(1);
    });

    it("应能注册 Card 并同时绑定 Agent 实例", () => {
      const card = createTestCard();
      const agent = createMockAgent();
      registry.register(card, agent);

      expect(registry.getCard("testAgent")).toEqual(card);
      expect(registry.getAgent("testAgent")).toBe(agent);
    });

    it("重复注册同一 ID 应覆盖旧 Card", () => {
      const card1 = createTestCard({ name: "第一版" });
      const card2 = createTestCard({ name: "第二版" });

      registry.register(card1);
      registry.register(card2);

      expect(registry.size()).toBe(1);
      expect(registry.getCard("testAgent")?.name).toBe("第二版");
    });

    it("应能注册多个不同 ID 的 Card", () => {
      registry.register(createTestCard({ id: "agent1" }));
      registry.register(createTestCard({ id: "agent2" }));
      registry.register(createTestCard({ id: "agent3" }));

      expect(registry.size()).toBe(3);
      expect(registry.has("agent1")).toBe(true);
      expect(registry.has("agent2")).toBe(true);
      expect(registry.has("agent3")).toBe(true);
    });
  });

  // ==================== unregister ====================

  describe("unregister()", () => {
    it("应能注销已注册的 Agent", () => {
      registry.register(createTestCard());
      expect(registry.has("testAgent")).toBe(true);

      registry.unregister("testAgent");
      expect(registry.has("testAgent")).toBe(false);
      expect(registry.size()).toBe(0);
    });

    it("注销不存在的 Agent 应静默处理", () => {
      expect(() => registry.unregister("nonexistent")).not.toThrow();
    });
  });

  // ==================== getCard / getAgent ====================

  describe("getCard()", () => {
    it("应返回已注册的 Card", () => {
      const card = createTestCard();
      registry.register(card);

      const result = registry.getCard("testAgent");
      expect(result).toEqual(card);
    });

    it("查询不存在的 ID 应返回 undefined", () => {
      expect(registry.getCard("nonexistent")).toBeUndefined();
    });
  });

  describe("getAgent()", () => {
    it("未绑定 Agent 时应返回 undefined", () => {
      registry.register(createTestCard());
      expect(registry.getAgent("testAgent")).toBeUndefined();
    });

    it("绑定 Agent 后应返回实例", () => {
      const agent = createMockAgent();
      registry.register(createTestCard(), agent);

      expect(registry.getAgent("testAgent")).toBe(agent);
    });
  });

  // ==================== bindAgent ====================

  describe("bindAgent()", () => {
    it("应能将 Agent 实例绑定到已注册的 Card", () => {
      registry.register(createTestCard());
      const agent = createMockAgent();

      registry.bindAgent("testAgent", agent);
      expect(registry.getAgent("testAgent")).toBe(agent);
    });

    it("绑定到不存在的 Card 应静默处理（不抛异常）", () => {
      const agent = createMockAgent();
      expect(() => registry.bindAgent("nonexistent", agent)).not.toThrow();
    });

    it("重复绑定应覆盖旧实例", () => {
      registry.register(createTestCard());
      const agent1 = createMockAgent("agent1");
      const agent2 = createMockAgent("agent2");

      registry.bindAgent("testAgent", agent1);
      registry.bindAgent("testAgent", agent2);

      expect(registry.getAgent("testAgent")).toBe(agent2);
    });
  });

  // ==================== getAllEnabled ====================

  describe("getAllEnabled()", () => {
    it("应只返回 enabled=true 的 Card", () => {
      registry.register(createTestCard({ id: "enabled1", enabled: true }));
      registry.register(createTestCard({ id: "enabled2", enabled: true }));
      registry.register(createTestCard({ id: "disabled1", enabled: false }));

      const enabled = registry.getAllEnabled();
      expect(enabled.length).toBe(2);
      expect(enabled.map((c) => c.id)).toContain("enabled1");
      expect(enabled.map((c) => c.id)).toContain("enabled2");
      expect(enabled.map((c) => c.id)).not.toContain("disabled1");
    });

    it("空注册表应返回空数组", () => {
      expect(registry.getAllEnabled()).toEqual([]);
    });
  });

  // ==================== getAllIds ====================

  describe("getAllIds()", () => {
    it("应返回所有已注册的 ID（包括禁用的）", () => {
      registry.register(createTestCard({ id: "a", enabled: true }));
      registry.register(createTestCard({ id: "b", enabled: false }));

      const ids = registry.getAllIds();
      expect(ids).toContain("a");
      expect(ids).toContain("b");
      expect(ids.length).toBe(2);
    });
  });

  // ==================== findByCapability ====================

  describe("findByCapability()", () => {
    beforeEach(() => {
      registry.register(
        createTestCard({
          id: "fileAgent",
          capabilities: ["file_search", "file_management"],
          priority: 50,
        })
      );
      registry.register(
        createTestCard({
          id: "navAgent",
          capabilities: ["poi_search", "route_planning"],
          priority: 60,
        })
      );
      registry.register(
        createTestCard({
          id: "musicAgent",
          capabilities: ["music_search", "music_playback"],
          priority: 40,
        })
      );
    });

    it("应精确匹配能力标签", () => {
      const result = registry.findByCapability("file_search");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("fileAgent");
    });

    it("精确匹配不应返回部分匹配的结果", () => {
      // "search" 不应匹配 "file_search" 或 "poi_search"
      const result = registry.findByCapability("search");
      expect(result.length).toBe(0);
    });

    it("应支持大小写不敏感匹配", () => {
      const result = registry.findByCapability("FILE_SEARCH");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("fileAgent");
    });

    it("结果应按 priority 降序排列", () => {
      // 注册两个都有 "common_cap" 的 Agent
      registry.register(
        createTestCard({
          id: "lowPriority",
          capabilities: ["common_cap"],
          priority: 10,
        })
      );
      registry.register(
        createTestCard({
          id: "highPriority",
          capabilities: ["common_cap"],
          priority: 90,
        })
      );

      const result = registry.findByCapability("common_cap");
      expect(result.length).toBe(2);
      expect(result[0].id).toBe("highPriority");
      expect(result[1].id).toBe("lowPriority");
    });

    it("查找不存在的能力应返回空数组", () => {
      expect(registry.findByCapability("nonexistent")).toEqual([]);
    });

    it("应排除 disabled 的 Agent", () => {
      registry.register(
        createTestCard({
          id: "disabledAgent",
          capabilities: ["file_search"],
          enabled: false,
        })
      );

      const result = registry.findByCapability("file_search");
      // 只有 fileAgent（enabled），不包含 disabledAgent
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("fileAgent");
    });
  });

  // ==================== findByDomain ====================

  describe("findByDomain()", () => {
    beforeEach(() => {
      registry.register(createTestCard({ id: "file1", domain: "file_system", priority: 50 }));
      registry.register(createTestCard({ id: "file2", domain: "file_system", priority: 70 }));
      registry.register(createTestCard({ id: "nav1", domain: "navigation", priority: 60 }));
    });

    it("应返回指定领域的所有已启用 Agent", () => {
      const result = registry.findByDomain("file_system");
      expect(result.length).toBe(2);
    });

    it("结果应按 priority 降序排列", () => {
      const result = registry.findByDomain("file_system");
      expect(result[0].id).toBe("file2"); // priority 70
      expect(result[1].id).toBe("file1"); // priority 50
    });

    it("查找空领域应返回空数组", () => {
      expect(registry.findByDomain("custom")).toEqual([]);
    });
  });

  // ==================== clear ====================

  describe("clear()", () => {
    it("应清空所有注册条目", () => {
      registry.register(createTestCard({ id: "a" }));
      registry.register(createTestCard({ id: "b" }));
      expect(registry.size()).toBe(2);

      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.has("a")).toBe(false);
    });
  });

  // ==================== loadFromDirectory ====================

  describe("loadFromDirectory()", () => {
    it("应能从真实的 agent-cards 目录加载 JSON 文件", async () => {
      const cardsDir = path.resolve(
        __dirname,
        "../../agent-cards"
      );

      await registry.loadFromDirectory(cardsDir);

      // 应加载 4 个 Agent Card
      expect(registry.size()).toBe(4);
      expect(registry.has("fileAgent")).toBe(true);
      expect(registry.has("navigationAgent")).toBe(true);
      expect(registry.has("multimediaAgent")).toBe(true);
      expect(registry.has("generalAgent")).toBe(true);
    });

    it("加载后的 Card 应通过 Zod Schema 校验", async () => {
      const cardsDir = path.resolve(
        __dirname,
        "../../agent-cards"
      );

      await registry.loadFromDirectory(cardsDir);

      const navCard = registry.getCard("navigationAgent");
      expect(navCard).toBeDefined();
      expect(navCard!.domain).toBe("navigation");
      expect(navCard!.tools.length).toBeGreaterThan(0);
      expect(navCard!.capabilities.length).toBeGreaterThan(0);
    });

    it("不存在的目录应静默处理", async () => {
      await expect(
        registry.loadFromDirectory("/nonexistent/path")
      ).resolves.not.toThrow();
      expect(registry.size()).toBe(0);
    });
  });

  // ==================== AgentCardSchema ====================

  describe("AgentCardSchema (Zod)", () => {
    it("应接受有效的 Agent Card 数据", () => {
      const validData = {
        id: "testAgent",
        name: "测试",
        description: "测试描述",
        domain: "general",
        implementationClass: "TestAgent",
        llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
      };

      const result = AgentCardSchema.parse(validData);
      expect(result.id).toBe("testAgent");
      // 默认值应被填充
      expect(result.capabilities).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.enabled).toBe(true);
      expect(result.priority).toBe(50);
    });

    it("应拒绝缺少必填字段的数据", () => {
      const invalidData = {
        id: "testAgent",
        // 缺少 name、description、domain 等
      };

      expect(() => AgentCardSchema.parse(invalidData)).toThrow();
    });

    it("应拒绝空的 domain", () => {
      const invalidData = {
        id: "testAgent",
        name: "测试",
        description: "测试",
        domain: "",
        implementationClass: "TestAgent",
        llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
      };

      expect(() => AgentCardSchema.parse(invalidData)).toThrow();
    });

    it("应接受自定义 domain 字符串", () => {
      const data = {
        id: "testAgent",
        name: "测试",
        description: "测试",
        domain: "storage_maintenance",
        implementationClass: "TestAgent",
        llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
      };
      const result = AgentCardSchema.parse(data);
      expect(result.domain).toBe("storage_maintenance");
    });

    it("应拒绝超出范围的 temperature", () => {
      const invalidData = {
        id: "testAgent",
        name: "测试",
        description: "测试",
        domain: "general",
        implementationClass: "TestAgent",
        llmConfig: { temperature: 3.0, maxTokens: 4096, maxIterations: 5 },
      };

      expect(() => AgentCardSchema.parse(invalidData)).toThrow();
    });

    it("应拒绝空字符串 ID", () => {
      const invalidData = {
        id: "",
        name: "测试",
        description: "测试",
        domain: "general",
        implementationClass: "TestAgent",
        llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
      };

      expect(() => AgentCardSchema.parse(invalidData)).toThrow();
    });
  });

  // ==================== 单例工厂 ====================

  describe("单例工厂", () => {
    afterEach(() => {
      resetAgentCardRegistry();
    });

    it("getAgentCardRegistry 应返回同一实例", () => {
      const instance1 = getAgentCardRegistry();
      const instance2 = getAgentCardRegistry();
      expect(instance1).toBe(instance2);
    });

    it("resetAgentCardRegistry 后应返回新实例", () => {
      const instance1 = getAgentCardRegistry();
      resetAgentCardRegistry();
      const instance2 = getAgentCardRegistry();
      expect(instance1).not.toBe(instance2);
    });
  });
});
