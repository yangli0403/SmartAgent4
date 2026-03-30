/**
 * BehaviorDetector 单元测试
 *
 * 测试行为模式检测器的核心功能：
 * - LLM 驱动的模式检测
 * - 模式验证和过滤
 * - 数据库持久化（mock）
 * - 便捷方法 detectAndPersistPatterns
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock 依赖
vi.mock("../../llm/langchainAdapter", () => ({
  callLLMText: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../drizzle/schema", () => ({
  behaviorPatterns: {
    id: "id",
    userId: "userId",
    patternType: "patternType",
    description: "description",
    confidence: "confidence",
    frequency: "frequency",
    lastObserved: "lastObserved",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ type: "eq", args })),
  and: vi.fn((...args: any[]) => ({ type: "and", args })),
  sql: vi.fn(),
  desc: vi.fn(),
}));

import { callLLMText } from "../../llm/langchainAdapter";
import { getDb } from "../../db";
import {
  detectPatterns,
  persistPatterns,
  detectAndPersistPatterns,
  type BehaviorPatternInput,
  type DetectedPattern,
} from "../behaviorDetector";

// ==================== 测试辅助 ====================

function createMockInput(): BehaviorPatternInput {
  return {
    userId: 1,
    conversationHistory: [
      { role: "user", content: "帮我查一下明天北京的天气" },
      { role: "assistant", content: "明天北京天气晴朗，气温 15-25°C" },
      { role: "user", content: "谢谢，再帮我看看上海的" },
      { role: "assistant", content: "上海明天多云，气温 18-28°C" },
    ],
    extractedMemories: [
      {
        kind: "semantic",
        type: "preference",
        content: "用户经常查询天气信息",
        importance: 0.6,
        confidence: 0.8,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ==================== 测试用例 ====================

describe("BehaviorDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectPatterns", () => {
    it("应该正确解析 LLM 返回的有效模式", async () => {
      const mockResponse = JSON.stringify([
        {
          patternType: "topic_preference",
          description: "用户经常查询天气信息",
          confidence: 0.8,
        },
        {
          patternType: "communication_style",
          description: "用户偏好简短直接的回复",
          confidence: 0.6,
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue(mockResponse);

      const input = createMockInput();
      const patterns = await detectPatterns(input);

      expect(patterns).toHaveLength(2);
      expect(patterns[0].patternType).toBe("topic_preference");
      expect(patterns[0].description).toBe("用户经常查询天气信息");
      expect(patterns[0].confidence).toBe(0.8);
      expect(patterns[0].frequency).toBe(1);
    });

    it("应该过滤掉置信度低于 0.5 的模式", async () => {
      const mockResponse = JSON.stringify([
        {
          patternType: "topic_preference",
          description: "用户可能喜欢运动",
          confidence: 0.3,
        },
        {
          patternType: "schedule",
          description: "用户通常在晚上活跃",
          confidence: 0.7,
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue(mockResponse);

      const patterns = await detectPatterns(createMockInput());

      expect(patterns).toHaveLength(1);
      expect(patterns[0].patternType).toBe("schedule");
    });

    it("应该过滤掉无效的 patternType", async () => {
      const mockResponse = JSON.stringify([
        {
          patternType: "invalid_type",
          description: "无效模式",
          confidence: 0.9,
        },
        {
          patternType: "task_habit",
          description: "用户喜欢先列计划再执行",
          confidence: 0.7,
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue(mockResponse);

      const patterns = await detectPatterns(createMockInput());

      expect(patterns).toHaveLength(1);
      expect(patterns[0].patternType).toBe("task_habit");
    });

    it("LLM 返回空数组时应返回空结果", async () => {
      vi.mocked(callLLMText).mockResolvedValue("[]");

      const patterns = await detectPatterns(createMockInput());
      expect(patterns).toHaveLength(0);
    });

    it("LLM 返回非法 JSON 时应返回空结果", async () => {
      vi.mocked(callLLMText).mockResolvedValue("这不是 JSON");

      const patterns = await detectPatterns(createMockInput());
      expect(patterns).toHaveLength(0);
    });

    it("LLM 调用失败时应返回空结果", async () => {
      vi.mocked(callLLMText).mockRejectedValue(new Error("LLM 不可用"));

      const patterns = await detectPatterns(createMockInput());
      expect(patterns).toHaveLength(0);
    });

    it("应该将 confidence 限制在 0-1 范围内", async () => {
      const mockResponse = JSON.stringify([
        {
          patternType: "schedule",
          description: "用户在早上活跃",
          confidence: 1.5,
        },
      ]);

      vi.mocked(callLLMText).mockResolvedValue(mockResponse);

      const patterns = await detectPatterns(createMockInput());
      expect(patterns[0].confidence).toBe(1);
    });
  });

  describe("persistPatterns", () => {
    it("数据库不可用时应返回 0", async () => {
      vi.mocked(getDb).mockResolvedValue(null);

      const patterns: DetectedPattern[] = [
        {
          patternType: "schedule",
          description: "用户在早上活跃",
          confidence: 0.8,
          frequency: 1,
        },
      ];

      const count = await persistPatterns(1, patterns);
      expect(count).toBe(0);
    });
  });

  describe("detectAndPersistPatterns", () => {
    it("没有检测到模式时应返回 0", async () => {
      vi.mocked(callLLMText).mockResolvedValue("[]");

      const count = await detectAndPersistPatterns(createMockInput());
      expect(count).toBe(0);
    });
  });
});
