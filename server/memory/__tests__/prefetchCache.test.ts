/**
 * PrefetchCache 单元测试
 *
 * 测试上下文预取缓存的核心功能：
 * - 缓存写入与读取
 * - TTL 过期机制
 * - 最大条目数淘汰
 * - 缓存统计
 * - 清理功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createPrefetchCache,
  type PrefetchCacheEntry,
  type PredictedIntent,
} from "../prefetchCache";

// ==================== 测试辅助 ====================

function createMockIntent(userId: number): PredictedIntent {
  return {
    userId,
    intent: `用户 ${userId} 可能需要查看天气`,
    confidence: 0.8,
    suggestedQueries: ["天气", "今日天气"],
    reasoning: "基于用户历史行为推断",
    predictedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  };
}

function createMockEntry(userId: number, ttlMs?: number): PrefetchCacheEntry {
  const now = Date.now();
  return {
    userId,
    predictedIntent: createMockIntent(userId),
    prefetchedMemories: [],
    formattedContext: `- [fact] 用户 ${userId} 的记忆上下文`,
    createdAt: now,
    expiresAt: now + (ttlMs ?? 4 * 60 * 60 * 1000),
  };
}

// ==================== 测试用例 ====================

describe("PrefetchCache", () => {
  let cache: ReturnType<typeof createPrefetchCache>;

  beforeEach(() => {
    cache = createPrefetchCache();
  });

  afterEach(() => {
    cache.stop();
  });

  describe("基本读写", () => {
    it("应该能写入和读取缓存条目", () => {
      const entry = createMockEntry(1);
      cache.set(entry);

      const result = cache.get(1);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe(1);
      expect(result!.formattedContext).toContain("用户 1");
    });

    it("读取不存在的条目应返回 null", () => {
      const result = cache.get(999);
      expect(result).toBeNull();
    });

    it("应该能覆盖同一用户的缓存", () => {
      cache.set(createMockEntry(1));

      const newEntry = createMockEntry(1);
      newEntry.formattedContext = "更新后的上下文";
      cache.set(newEntry);

      const result = cache.get(1);
      expect(result!.formattedContext).toBe("更新后的上下文");
    });
  });

  describe("TTL 过期", () => {
    it("过期的条目应返回 null", () => {
      // 创建一个已经过期的条目
      const entry = createMockEntry(1, -1000); // TTL 为负数，已过期
      cache.set(entry);

      const result = cache.get(1);
      expect(result).toBeNull();
    });

    it("未过期的条目应正常返回", () => {
      const entry = createMockEntry(1, 60 * 60 * 1000); // 1 小时后过期
      cache.set(entry);

      const result = cache.get(1);
      expect(result).not.toBeNull();
    });
  });

  describe("缓存统计", () => {
    it("应该正确统计命中和未命中", () => {
      cache.set(createMockEntry(1));

      cache.get(1); // 命中
      cache.get(1); // 命中
      cache.get(999); // 未命中

      const stats = cache.getStats();
      expect(stats.hitCount).toBe(2);
      expect(stats.missCount).toBe(1);
      expect(stats.size).toBe(1);
    });
  });

  describe("手动失效", () => {
    it("应该能手动失效缓存条目", () => {
      cache.set(createMockEntry(1));
      expect(cache.get(1)).not.toBeNull();

      cache.invalidate(1);
      expect(cache.get(1)).toBeNull();
    });

    it("失效不存在的条目不应报错", () => {
      expect(() => cache.invalidate(999)).not.toThrow();
    });
  });

  describe("清理", () => {
    it("cleanup 应该移除所有过期条目", () => {
      cache.set(createMockEntry(1, -1000)); // 已过期
      cache.set(createMockEntry(2, -1000)); // 已过期
      cache.set(createMockEntry(3, 60 * 60 * 1000)); // 未过期

      cache.cleanup();

      const stats = cache.getStats();
      expect(stats.size).toBe(1);
      expect(cache.get(3)).not.toBeNull();
    });
  });

  describe("stop", () => {
    it("stop 应该清空所有数据和计数器", () => {
      cache.set(createMockEntry(1));
      cache.get(1);

      cache.stop();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hitCount).toBe(0);
      expect(stats.missCount).toBe(0);
    });
  });
});
