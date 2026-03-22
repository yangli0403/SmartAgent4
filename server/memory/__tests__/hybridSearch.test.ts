/**
 * Hybrid Search — 混合检索模块单元测试
 *
 * 测试 BM25 文本检索、向量余弦相似度和混合检索的正确性。
 */

import { describe, it, expect } from "vitest";
import { hybridSearch, type HybridSearchResult } from "../hybridSearch";

// ==================== 测试数据 ====================

function createMockMemory(
  id: number,
  content: string,
  embedding?: number[] | null
): any {
  return {
    id,
    userId: 1,
    kind: "episodic",
    type: "fact",
    content,
    importance: 0.5,
    confidence: 0.8,
    accessCount: 1,
    clusterId: null,
    embedding: embedding ?? null,
    validFrom: null,
    validUntil: null,
    tags: null,
    source: "test",
    versionGroup: null,
    metadata: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    updatedAt: new Date(),
  };
}

// ==================== 测试用例 ====================

describe("hybridSearch", () => {
  it("应该在空候选集时返回空结果", () => {
    const results = hybridSearch({
      query: "测试查询",
      candidates: [],
      limit: 10,
    });
    expect(results).toEqual([]);
  });

  it("应该通过 BM25 正确匹配英文关键词", () => {
    // 使用英文内容避免中文分词问题
    const candidates = [
      createMockMemory(1, "user likes coffee and latte"),
      createMockMemory(2, "user runs every morning"),
      createMockMemory(3, "user works as software engineer"),
      createMockMemory(4, "user drinks coffee at starbucks"),
    ];

    const results = hybridSearch({
      query: "coffee",
      candidates,
      limit: 4,
      alpha: 1.0, // 纯 BM25 模式
    });

    expect(results.length).toBe(4);
    // 包含 "coffee" 的记忆应该有更高的 BM25 分数
    const coffeeResults = results.filter(
      (r) => r.memory.id === 1 || r.memory.id === 4
    );
    for (const r of coffeeResults) {
      expect(r.bm25Score).toBeGreaterThan(0);
    }
    // 前两名应该是包含 coffee 的记忆
    const topIds = results.slice(0, 2).map((r) => r.memory.id);
    expect(topIds).toContain(1);
    expect(topIds).toContain(4);
  });

  it("应该通过向量相似度正确匹配", () => {
    // 模拟简单的向量
    const candidates = [
      createMockMemory(1, "memory A", [1, 0, 0]),
      createMockMemory(2, "memory B", [0, 1, 0]),
      createMockMemory(3, "memory C", [0.9, 0.1, 0]),
    ];

    const results = hybridSearch({
      query: "any query",
      queryEmbedding: [1, 0, 0], // 与记忆A和C最相似
      candidates,
      limit: 3,
      alpha: 0.0, // 纯向量模式
    });

    expect(results.length).toBe(3);
    // 向量 [1,0,0] 与记忆A (id=1) 最相似
    expect(results[0].memory.id).toBe(1);
    // 记忆C (id=3) 应该排第二
    expect(results[1].memory.id).toBe(3);
  });

  it("混合模式应该综合两种分数", () => {
    const candidates = [
      createMockMemory(1, "user likes coffee", [0.1, 0.9, 0]),
      createMockMemory(2, "weather is nice today", [0.9, 0.1, 0]),
      createMockMemory(3, "coffee is the most popular drink", [0.8, 0.2, 0]),
    ];

    const results = hybridSearch({
      query: "coffee",
      queryEmbedding: [1, 0, 0], // 与记忆2和3的向量更接近
      candidates,
      limit: 3,
      alpha: 0.5, // 均衡模式
    });

    expect(results.length).toBe(3);
    // 所有结果应该有有效的分数
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
    // 记忆3 在 BM25（含 "coffee"）和向量（接近查询向量）上都有不错的分数
    // 应该在前两名
    const topIds = results.slice(0, 2).map((r) => r.memory.id);
    expect(topIds).toContain(3);
  });

  it("应该正确限制返回数量", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      createMockMemory(i + 1, `memory content ${i + 1}`)
    );

    const results = hybridSearch({
      query: "memory",
      candidates,
      limit: 5,
    });

    expect(results.length).toBe(5);
  });

  it("每个结果应包含正确的分数结构", () => {
    const candidates = [
      createMockMemory(1, "test memory content", [1, 0]),
    ];

    const results = hybridSearch({
      query: "test",
      queryEmbedding: [1, 0],
      candidates,
      limit: 1,
    });

    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty("memory");
    expect(results[0]).toHaveProperty("score");
    expect(results[0]).toHaveProperty("bm25Score");
    expect(results[0]).toHaveProperty("vectorScore");
    expect(typeof results[0].score).toBe("number");
  });
});
