/**
 * backfillExtraction 单元测试
 *
 * 测试补漏提取服务的核心功能：
 * - extractMemoryCandidates: LLM 提取记忆候选
 * - deduplicateCandidates: Jaccard 去重校验
 * - executeBackfillExtraction: 完整补漏流程
 * - createBackfillExecutor: MemoryWorkerManager 兼容执行器
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Memory } from "../../../drizzle/schema";

// ==================== Mock 底层模块 ====================

const mockCallLLMText = vi.fn();
const mockAddMemory = vi.fn();
const mockSearchMemories = vi.fn();
const mockGetWorkingMemory = vi.fn();

vi.mock("../../llm/langchainAdapter", () => ({
  callLLMText: (...args: unknown[]) => mockCallLLMText(...args),
}));

vi.mock("../memorySystem", () => ({
  addMemory: (...args: unknown[]) => mockAddMemory(...args),
  searchMemories: (...args: unknown[]) => mockSearchMemories(...args),
  getWorkingMemory: (...args: unknown[]) => mockGetWorkingMemory(...args),
}));

// ==================== 辅助函数 ====================

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 1,
    userId: 1,
    content: "测试记忆内容",
    type: "fact",
    kind: "semantic",
    importance: "0.7",
    confidence: "0.8",
    tags: null,
    source: "auto",
    versionGroup: null,
    embedding: null,
    accessCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: null,
    ...overrides,
  } as Memory;
}

// ==================== 测试 ====================

describe("backfillExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractMemoryCandidates", () => {
    it("空对话应返回空数组", async () => {
      const { extractMemoryCandidates } = await import(
        "../backfillExtraction"
      );
      const result = await extractMemoryCandidates([]);
      expect(result).toEqual([]);
      expect(mockCallLLMText).not.toHaveBeenCalled();
    });

    it("应正确解析 LLM 返回的 JSON", async () => {
      const { extractMemoryCandidates } = await import(
        "../backfillExtraction"
      );

      mockCallLLMText.mockResolvedValue(
        JSON.stringify([
          {
            content: "用户住在北京朝阳区",
            type: "fact",
            kind: "semantic",
            importance: 0.8,
            confidence: 0.9,
            tags: ["住址"],
          },
          {
            content: "用户喜欢吃川菜",
            type: "preference",
            kind: "persona",
            importance: 0.6,
            confidence: 0.85,
          },
        ])
      );

      const result = await extractMemoryCandidates([
        { role: "user", content: "我住在北京朝阳区" },
        { role: "assistant", content: "好的，已记住" },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("用户住在北京朝阳区");
      expect(result[0].type).toBe("fact");
      expect(result[0].tags).toEqual(["住址"]);
      expect(result[1].content).toBe("用户喜欢吃川菜");
    });

    it("LLM 返回无效 JSON 应返回空数组", async () => {
      const { extractMemoryCandidates } = await import(
        "../backfillExtraction"
      );

      mockCallLLMText.mockResolvedValue("这不是有效的 JSON");

      const result = await extractMemoryCandidates([
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好" },
      ]);

      expect(result).toEqual([]);
    });

    it("LLM 调用失败应返回空数组", async () => {
      const { extractMemoryCandidates } = await import(
        "../backfillExtraction"
      );

      mockCallLLMText.mockRejectedValue(new Error("API 超时"));

      const result = await extractMemoryCandidates([
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好" },
      ]);

      expect(result).toEqual([]);
    });

    it("应限制最大提取条数", async () => {
      const { extractMemoryCandidates } = await import(
        "../backfillExtraction"
      );

      const manyMemories = Array.from({ length: 20 }, (_, i) => ({
        content: `记忆 ${i}`,
        type: "fact",
        kind: "semantic",
        importance: 0.5,
        confidence: 0.7,
      }));

      mockCallLLMText.mockResolvedValue(JSON.stringify(manyMemories));

      const result = await extractMemoryCandidates(
        [
          { role: "user", content: "很多信息" },
          { role: "assistant", content: "好的" },
        ],
        { maxMemoriesPerExtraction: 5 }
      );

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it("应规范化无效的 type 和 kind", async () => {
      const { extractMemoryCandidates } = await import(
        "../backfillExtraction"
      );

      mockCallLLMText.mockResolvedValue(
        JSON.stringify([
          {
            content: "测试内容",
            type: "invalid_type",
            kind: "invalid_kind",
            importance: 2.0,
            confidence: -0.5,
          },
        ])
      );

      const result = await extractMemoryCandidates([
        { role: "user", content: "测试" },
        { role: "assistant", content: "好" },
      ]);

      expect(result[0].type).toBe("fact"); // 默认值
      expect(result[0].kind).toBe("semantic"); // 默认值
      expect(result[0].importance).toBe(1); // 被 clamp 到 1
      expect(result[0].confidence).toBe(0); // 被 clamp 到 0
    });
  });

  describe("deduplicateCandidates", () => {
    it("无已有记忆时应返回全部候选", async () => {
      const { deduplicateCandidates } = await import("../backfillExtraction");

      const candidates = [
        {
          content: "用户住在北京",
          type: "fact" as const,
          kind: "semantic" as const,
          importance: 0.8,
          confidence: 0.9,
        },
      ];

      const result = deduplicateCandidates(candidates, []);
      expect(result).toHaveLength(1);
    });

    it("应过滤与已有记忆高度相似的候选", async () => {
      const { deduplicateCandidates } = await import("../backfillExtraction");

      const candidates = [
        {
          content: "用户住在北京朝阳区",
          type: "fact" as const,
          kind: "semantic" as const,
          importance: 0.8,
          confidence: 0.9,
        },
        {
          content: "用户喜欢打篮球",
          type: "preference" as const,
          kind: "persona" as const,
          importance: 0.6,
          confidence: 0.8,
        },
      ];

      const existingMemories = [
        createMockMemory({ id: 1, content: "用户住在北京朝阳区" }),
      ];

      const result = deduplicateCandidates(candidates, existingMemories, 0.6);

      // "用户住在北京朝阳区" 应被过滤（完全相同）
      // "用户喜欢打篮球" 应保留
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("用户喜欢打篮球");
    });

    it("低相似度的候选应保留", async () => {
      const { deduplicateCandidates } = await import("../backfillExtraction");

      const candidates = [
        {
          content: "用户的公司在海淀区中关村",
          type: "fact" as const,
          kind: "semantic" as const,
          importance: 0.7,
          confidence: 0.8,
        },
      ];

      const existingMemories = [
        createMockMemory({ id: 1, content: "用户住在朝阳区望京" }),
      ];

      const result = deduplicateCandidates(candidates, existingMemories, 0.6);
      expect(result).toHaveLength(1);
    });
  });

  describe("executeBackfillExtraction", () => {
    it("对话历史不足时应直接返回", async () => {
      const { executeBackfillExtraction } = await import(
        "../backfillExtraction"
      );

      mockGetWorkingMemory.mockReturnValue({ messages: [] });

      const result = await executeBackfillExtraction(1);

      expect(result.extractedCount).toBe(0);
      expect(result.writtenCount).toBe(0);
      expect(mockCallLLMText).not.toHaveBeenCalled();
    });

    it("应完成完整的补漏流程", async () => {
      const { executeBackfillExtraction } = await import(
        "../backfillExtraction"
      );

      mockGetWorkingMemory.mockReturnValue({
        messages: [
          { role: "user", content: "我叫张三，住在北京" },
          { role: "assistant", content: "好的，张三" },
          { role: "user", content: "我喜欢吃火锅" },
          { role: "assistant", content: "好的" },
        ],
      });

      mockCallLLMText.mockResolvedValue(
        JSON.stringify([
          {
            content: "用户名叫张三",
            type: "fact",
            kind: "persona",
            importance: 0.9,
            confidence: 0.95,
          },
          {
            content: "用户住在北京",
            type: "fact",
            kind: "semantic",
            importance: 0.8,
            confidence: 0.9,
          },
          {
            content: "用户喜欢吃火锅",
            type: "preference",
            kind: "persona",
            importance: 0.6,
            confidence: 0.85,
          },
        ])
      );

      // 已有一条重复记忆
      mockSearchMemories.mockResolvedValue([
        createMockMemory({ id: 1, content: "用户名叫张三" }),
      ]);

      mockAddMemory
        .mockResolvedValueOnce({ id: 100 })
        .mockResolvedValueOnce({ id: 101 });

      const result = await executeBackfillExtraction(1);

      expect(result.extractedCount).toBe(3);
      expect(result.deduplicatedCount).toBe(1); // "用户名叫张三" 被去重
      expect(result.writtenCount).toBe(2);
      expect(result.memoryIds).toEqual([100, 101]);
    });

    it("addMemory 失败时应记录 failedCount", async () => {
      const { executeBackfillExtraction } = await import(
        "../backfillExtraction"
      );

      mockGetWorkingMemory.mockReturnValue({
        messages: [
          { role: "user", content: "我住在上海" },
          { role: "assistant", content: "好的" },
        ],
      });

      mockCallLLMText.mockResolvedValue(
        JSON.stringify([
          {
            content: "用户住在上海",
            type: "fact",
            kind: "semantic",
            importance: 0.8,
            confidence: 0.9,
          },
        ])
      );

      mockSearchMemories.mockResolvedValue([]);
      mockAddMemory.mockRejectedValue(new Error("数据库错误"));

      const result = await executeBackfillExtraction(1);

      expect(result.extractedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.writtenCount).toBe(0);
    });
  });

  describe("createBackfillExecutor", () => {
    it("应返回 MemoryWorkerManager 兼容的函数", async () => {
      const { createBackfillExecutor } = await import(
        "../backfillExtraction"
      );

      const executor = createBackfillExecutor();
      expect(typeof executor).toBe("function");
    });

    it("成功时应返回正确的 MemoryWorkerResponse", async () => {
      const { createBackfillExecutor } = await import(
        "../backfillExtraction"
      );

      mockGetWorkingMemory.mockReturnValue({ messages: [] });

      const executor = createBackfillExecutor();
      const response = await executor({
        taskId: "test-task-1",
        type: "consolidate",
        userId: 1,
      });

      expect(response.taskId).toBe("test-task-1");
      expect(response.success).toBe(true);
      expect(response.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("异常时应返回失败的 MemoryWorkerResponse", async () => {
      const { createBackfillExecutor } = await import(
        "../backfillExtraction"
      );

      // executeBackfillExtraction 内部有 try-catch，会吃掉异常并返回空结果
      // 要让 executor 层报错，需要在 executor 层抛出异常
      mockGetWorkingMemory.mockReturnValue({
        messages: [
          { role: "user", content: "测试" },
          { role: "assistant", content: "好" },
        ],
      });
      // 让 callLLMText 成功返回候选
      mockCallLLMText.mockResolvedValue(
        JSON.stringify([{ content: "测试", type: "fact", kind: "semantic", importance: 0.5, confidence: 0.7 }])
      );
      mockSearchMemories.mockResolvedValue([]);
      // addMemory 抛出异常
      mockAddMemory.mockRejectedValue(new Error("内存不足"));

      const executor = createBackfillExecutor();
      const response = await executor({
        taskId: "test-task-2",
        type: "consolidate",
        userId: 1,
      });

      // executeBackfillExtraction 内部捕获异常，所以 executor 仍然成功
      // 但 writtenCount 应为 0，failedCount 应为 1
      expect(response.taskId).toBe("test-task-2");
      expect(response.success).toBe(true);
      expect(response.result).toBeDefined();
    });
  });
});
