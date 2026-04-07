/**
 * embeddingService 单元测试
 *
 * 通过 mock OpenAI SDK 验证 Embedding 服务的核心逻辑：
 * - 单条文本向量化
 * - 批量文本向量化
 * - 空输入处理
 * - API 失败时优雅降级
 * - 配置管理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock openai SDK
vi.mock("openai", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

import OpenAI from "openai";
import {
  initEmbeddingService,
  getEmbeddingService,
  generateEmbedding,
  generateEmbeddingBatch,
  _resetServiceForTesting,
} from "../embeddingService";

// 获取 mock 函数引用
const mockCreate = (await import("openai") as any).__mockCreate as ReturnType<typeof vi.fn>;

/** 生成指定维度的假向量 */
function fakeVector(dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => i * 0.001);
}

describe("embeddingService", () => {
  beforeEach(() => {
    _resetServiceForTesting();
    mockCreate.mockReset();
    // 初始化服务，使用测试配置
    initEmbeddingService({
      apiKey: "test-api-key",
      baseURL: "https://test.api.com/v1",
      model: "test-model",
      dimensions: 1024,
      timeoutMs: 3000,
      batchSize: 2,
    });
  });

  afterEach(() => {
    _resetServiceForTesting();
  });

  // ==================== 单条 Embedding 生成 ====================

  describe("generateEmbedding（单条）", () => {
    it("应成功生成 Embedding 向量", async () => {
      const vector = fakeVector(1024);
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: vector, index: 0 }],
        usage: { total_tokens: 10 },
      });

      const result = await generateEmbedding("用户喜欢打篮球");

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1024);
      expect(result).toEqual(vector);
      expect(mockCreate).toHaveBeenCalledWith({
        model: "test-model",
        input: "用户喜欢打篮球",
        dimensions: 1024,
      });
    });

    it("空文本应返回 null", async () => {
      const result = await generateEmbedding("");
      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("纯空白文本应返回 null", async () => {
      const result = await generateEmbedding("   ");
      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("API 调用失败时应返回 null（不抛出异常）", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API 超时"));

      const result = await generateEmbedding("测试文本");

      expect(result).toBeNull();
    });

    it("应自动 trim 输入文本", async () => {
      const vector = fakeVector(1024);
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: vector, index: 0 }],
        usage: { total_tokens: 5 },
      });

      await generateEmbedding("  用户住在上海  ");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: "用户住在上海" })
      );
    });
  });

  // ==================== 批量 Embedding 生成 ====================

  describe("generateEmbeddingBatch（批量）", () => {
    it("应成功批量生成 Embedding 向量", async () => {
      const v1 = fakeVector(1024);
      const v2 = fakeVector(1024);

      // batchSize=2，3条文本分2批
      mockCreate
        .mockResolvedValueOnce({
          data: [
            { embedding: v1, index: 0 },
            { embedding: v2, index: 1 },
          ],
          usage: { total_tokens: 20 },
        })
        .mockResolvedValueOnce({
          data: [{ embedding: v1, index: 0 }],
          usage: { total_tokens: 10 },
        });

      const result = await generateEmbeddingBatch([
        "文本1",
        "文本2",
        "文本3",
      ]);

      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.embeddings).toHaveLength(3);
      expect(result.embeddings[0]).toEqual(v1);
      expect(result.embeddings[1]).toEqual(v2);
      expect(result.embeddings[2]).toEqual(v1);
      expect(result.totalTokenUsage).toBe(30);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("空数组应返回空结果", async () => {
      const result = await generateEmbeddingBatch([]);

      expect(result.embeddings).toHaveLength(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("包含空文本的条目应被跳过并计为失败", async () => {
      const v1 = fakeVector(1024);
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: v1, index: 0 }],
        usage: { total_tokens: 10 },
      });

      const result = await generateEmbeddingBatch(["有效文本", "", "  "]);

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(2);
      expect(result.embeddings[0]).toEqual(v1);
      expect(result.embeddings[1]).toBeNull();
      expect(result.embeddings[2]).toBeNull();
    });

    it("某一批失败不应影响其他批次", async () => {
      const v1 = fakeVector(1024);

      // 第1批成功，第2批失败
      mockCreate
        .mockResolvedValueOnce({
          data: [
            { embedding: v1, index: 0 },
            { embedding: v1, index: 1 },
          ],
          usage: { total_tokens: 20 },
        })
        .mockRejectedValueOnce(new Error("网络错误"));

      const result = await generateEmbeddingBatch([
        "文本1",
        "文本2",
        "文本3",
      ]);

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.embeddings[0]).toEqual(v1);
      expect(result.embeddings[1]).toEqual(v1);
      expect(result.embeddings[2]).toBeNull();
    });
  });

  // ==================== 配置管理 ====================

  describe("配置管理", () => {
    it("getConfig 应返回当前配置的只读副本", () => {
      const service = getEmbeddingService();
      const config = service.getConfig();

      expect(config.model).toBe("test-model");
      expect(config.dimensions).toBe(1024);
      expect(config.apiKey).toBe("test-api-key");
    });

    it("initEmbeddingService 应覆盖之前的实例", () => {
      initEmbeddingService({
        apiKey: "new-key",
        model: "new-model",
        dimensions: 512,
      });

      const config = getEmbeddingService().getConfig();
      expect(config.apiKey).toBe("new-key");
      expect(config.model).toBe("new-model");
      expect(config.dimensions).toBe(512);
    });

    it("未配置 API Key 时调用 generateEmbedding 应返回 null", async () => {
      _resetServiceForTesting();
      initEmbeddingService({ apiKey: "" });

      const result = await generateEmbedding("测试");
      expect(result).toBeNull();
    });
  });

  // ==================== getEmbeddingService 自动初始化 ====================

  describe("自动初始化", () => {
    it("未手动初始化时 getEmbeddingService 应自动创建实例", () => {
      _resetServiceForTesting();
      // 不调用 initEmbeddingService，直接获取
      const service = getEmbeddingService();
      expect(service).toBeDefined();
      expect(service.getConfig()).toBeDefined();
    });
  });
});
