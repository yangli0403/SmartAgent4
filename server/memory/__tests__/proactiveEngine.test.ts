/**
 * ProactiveEngine 单元测试
 *
 * 测试意图预测引擎的核心功能：
 * - 用户开关检查
 * - LLM 意图预测
 * - 预测结果验证
 * - 预测周期执行
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock 所有外部依赖
vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getUserPreferences: vi.fn(),
  getRecentConversations: vi.fn(),
}));

vi.mock("../memorySystem", () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
  getUserProfileSnapshot: vi.fn().mockResolvedValue({
    displayName: "测试用户",
    activePreferences: [],
    relevantRelationships: [],
  }),
}));

vi.mock("../behaviorDetector", () => ({
  getUserPatterns: vi.fn().mockResolvedValue([]),
}));

vi.mock("../profileBuilder", () => ({
  formatMemoriesForContext: vi.fn().mockReturnValue("模拟的记忆上下文"),
}));

vi.mock("../prefetchCache", () => {
  const mockCache = {
    set: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    getStats: vi.fn().mockReturnValue({ size: 0, hitCount: 0, missCount: 0 }),
    cleanup: vi.fn(),
    stop: vi.fn(),
  };
  return {
    getPrefetchCache: vi.fn().mockReturnValue(mockCache),
    PREFETCH_TTL: 4 * 60 * 60 * 1000,
  };
});

vi.mock("../../llm/langchainAdapter", () => ({
  callLLMText: vi.fn(),
}));

vi.mock("../../../drizzle/schema", () => ({
  users: { id: "id" },
  conversations: {
    userId: "userId",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
  gt: vi.fn(),
}));

import { getUserPreferences, getRecentConversations } from "../../db";
import { callLLMText } from "../../llm/langchainAdapter";
import { predictIntent, runPredictionCycle } from "../proactiveEngine";

// ==================== 测试用例 ====================

describe("ProactiveEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("predictIntent", () => {
    it("proactiveService 为 disabled 时应返回 null", async () => {
      vi.mocked(getUserPreferences).mockResolvedValue({
        id: 1,
        userId: 1,
        personality: "professional",
        responseStyle: "balanced",
        proactiveService: "disabled",
        notificationPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await predictIntent(1);
      expect(result).toBeNull();
    });

    it("没有最近对话时应返回 null", async () => {
      vi.mocked(getUserPreferences).mockResolvedValue({
        id: 1,
        userId: 1,
        personality: "professional",
        responseStyle: "balanced",
        proactiveService: "enabled",
        notificationPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(getRecentConversations).mockResolvedValue([]);

      const result = await predictIntent(1);
      expect(result).toBeNull();
    });

    it("应该正确解析 LLM 的预测结果", async () => {
      vi.mocked(getUserPreferences).mockResolvedValue({
        id: 1,
        userId: 1,
        personality: "professional",
        responseStyle: "balanced",
        proactiveService: "enabled",
        notificationPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(getRecentConversations).mockResolvedValue([
        {
          id: 1,
          userId: 1,
          sessionId: 1,
          role: "user",
          content: "帮我查天气",
          metadata: null,
          createdAt: new Date(),
        },
        {
          id: 2,
          userId: 1,
          sessionId: 1,
          role: "assistant",
          content: "今天晴天",
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue(
        JSON.stringify({
          intent: "用户可能需要查看明天的天气预报",
          confidence: 0.75,
          suggestedQueries: ["天气预报", "明天天气"],
          reasoning: "用户最近频繁查询天气",
        })
      );

      const result = await predictIntent(1);

      expect(result).not.toBeNull();
      expect(result!.intent).toBe("用户可能需要查看明天的天气预报");
      expect(result!.confidence).toBe(0.75);
      expect(result!.suggestedQueries).toHaveLength(2);
      expect(result!.userId).toBe(1);
    });

    it("低置信度预测应返回 null", async () => {
      vi.mocked(getUserPreferences).mockResolvedValue({
        id: 1,
        userId: 1,
        personality: "professional",
        responseStyle: "balanced",
        proactiveService: "enabled",
        notificationPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(getRecentConversations).mockResolvedValue([
        {
          id: 1,
          userId: 1,
          sessionId: 1,
          role: "user",
          content: "你好",
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue(
        JSON.stringify({
          intent: "不确定",
          confidence: 0.1,
          suggestedQueries: [],
          reasoning: "信息不足",
        })
      );

      const result = await predictIntent(1);
      expect(result).toBeNull();
    });

    it("LLM 返回非法 JSON 时应返回 null", async () => {
      vi.mocked(getUserPreferences).mockResolvedValue({
        id: 1,
        userId: 1,
        personality: "professional",
        responseStyle: "balanced",
        proactiveService: "enabled",
        notificationPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(getRecentConversations).mockResolvedValue([
        {
          id: 1,
          userId: 1,
          sessionId: 1,
          role: "user",
          content: "你好",
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue("这不是 JSON");

      const result = await predictIntent(1);
      expect(result).toBeNull();
    });

    it("getUserPreferences 返回 null 时应返回 null", async () => {
      vi.mocked(getUserPreferences).mockResolvedValue(null);

      const result = await predictIntent(1);
      expect(result).toBeNull();
    });
  });

  describe("runPredictionCycle", () => {
    it("没有活跃用户时应正常完成", async () => {
      // getDb 返回 null，getActiveUserIds 会返回空数组
      await expect(runPredictionCycle()).resolves.not.toThrow();
    });
  });
});
