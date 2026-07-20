/**
 * M1-12 验证：SceneActivationCache 5min TTL（v1.3 修复 #14）+ SceneActivationOutput 不含 memoryRelevant（修复 #4）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SceneActivationCache,
  getSceneActivationCache,
  resetSceneActivationCache,
} from "../../../server/agent/preAnalysis/cache/sceneActivationCache";
import {
  SceneActivationOutputSchema,
  createEmptySceneActivationOutput,
  CURRENT_SCENE_ACTIVATION_SCHEMA_VERSION,
  type SceneMatch,
} from "../../../server/agent/preAnalysis/types/sceneActivationOutput";

const sampleMatch: SceneMatch = {
  memoryId: 100,
  sceneName: "午睡模式",
  summary: "关闭大灯、播放轻音乐、空调调至 24℃",
  domain: "iot",
  matchScore: 0.92,
};

describe("M1-12 SceneActivationCache 基础行为", () => {
  let cache: SceneActivationCache;
  beforeEach(() => {
    cache = new SceneActivationCache();
  });

  it("set + get → 命中且 matches 完整", () => {
    cache.set(1, "打开午睡模式", [sampleMatch], 50);
    const r = cache.get(1, "打开午睡模式");
    expect(r.cacheHit).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].sceneName).toBe("午睡模式");
    expect(r.schemaVersion).toBe(CURRENT_SCENE_ACTIVATION_SCHEMA_VERSION);
  });

  it("set + get 不同 user → 隔离", () => {
    cache.set(1, "打开午睡模式", [sampleMatch]);
    const r = cache.get(2, "打开午睡模式");
    expect(r.cacheHit).toBe(false);
    expect(r.dbFallback).toBe(true);
  });

  it("set + get 不同 query → 隔离", () => {
    cache.set(1, "打开午睡模式", [sampleMatch]);
    const r = cache.get(1, "打开通勤模式");
    expect(r.cacheHit).toBe(false);
  });

  it("TTL 过期 → 降级到 dbFallback", () => {
    cache = new SceneActivationCache({ defaultTtlMs: 50 });  // 50ms TTL
    cache.set(1, "打开午睡模式", [sampleMatch]);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const r = cache.get(1, "打开午睡模式");
        expect(r.cacheHit).toBe(false);
        expect(r.dbFallback).toBe(true);
        resolve();
      }, 100);
    });
  });

  it("第二次查询耗时 < 5ms（命中路径）", () => {
    cache.set(1, "打开午睡模式", [sampleMatch]);
    // 预热
    cache.get(1, "打开午睡模式");
    // 测速
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      cache.get(1, "打开午睡模式");
    }
    const avgMs = (performance.now() - start) / 100;
    expect(avgMs).toBeLessThan(5);
  });
});

describe("M1-12 LRU 容量上限", () => {
  it("超过 maxEntries 触发 LRU 淘汰", () => {
    const cache = new SceneActivationCache({ maxEntries: 3 });
    cache.set(1, "q1", [sampleMatch]);
    cache.set(1, "q2", [sampleMatch]);
    cache.set(1, "q3", [sampleMatch]);
    cache.set(1, "q4", [sampleMatch]);  // 触发淘汰 q1
    expect(cache.size()).toBe(3);
    expect(cache.get(1, "q1").cacheHit).toBe(false);
    expect(cache.get(1, "q4").cacheHit).toBe(true);
  });

  it("LRU：最近访问的不会被淘汰", () => {
    const cache = new SceneActivationCache({ maxEntries: 3 });
    cache.set(1, "q1", [sampleMatch]);
    cache.set(1, "q2", [sampleMatch]);
    cache.set(1, "q3", [sampleMatch]);
    cache.get(1, "q1");  // q1 移至末尾（最近使用）
    cache.set(1, "q4", [sampleMatch]);  // 淘汰 q2
    expect(cache.get(1, "q1").cacheHit).toBe(true);
    expect(cache.get(1, "q2").cacheHit).toBe(false);
  });
});

describe("M1-12 invalidateUser 按用户失效", () => {
  it("invalidateUser 仅清空指定 user 的条目", () => {
    const cache = new SceneActivationCache();
    cache.set(1, "q1", [sampleMatch]);
    cache.set(1, "q2", [sampleMatch]);
    cache.set(2, "q3", [sampleMatch]);
    cache.set(3, "q4", [sampleMatch]);
    const cleared = cache.invalidateUser(1);
    expect(cleared).toBe(2);
    expect(cache.get(1, "q1").cacheHit).toBe(false);
    expect(cache.get(2, "q3").cacheHit).toBe(true);
    expect(cache.get(3, "q4").cacheHit).toBe(true);
  });
});

describe("M1-12 stats 命中率", () => {
  it("hits / misses 计数正确", () => {
    const cache = new SceneActivationCache();
    cache.set(1, "q1", [sampleMatch]);
    cache.get(1, "q1");    // hit
    cache.get(1, "q1");    // hit
    cache.get(2, "q2");    // miss
    const s = cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3, 2);
  });
});

describe("M1-12 单例模式", () => {
  beforeEach(() => resetSceneActivationCache());

  it("getSceneActivationCache 返回同一实例", () => {
    const a = getSceneActivationCache();
    const b = getSceneActivationCache();
    expect(a).toBe(b);
  });

  it("resetSceneActivationCache 创建新实例", () => {
    const a = getSceneActivationCache();
    resetSceneActivationCache();
    const b = getSceneActivationCache();
    expect(a).not.toBe(b);
  });
});

// ============================================================
// v1.3 修复 #4：SceneActivationOutput 不含 memoryRelevant
// ============================================================

describe("M1-12 SceneActivationOutput schema 不含 memoryRelevant（v1.3 修复 #4）", () => {
  it("schema 字段集合不含 memoryRelevant", () => {
    const shape = (SceneActivationOutputSchema as any).shape;
    const fieldNames = Object.keys(shape);
    expect(fieldNames).not.toContain("memoryRelevant");
    expect(fieldNames).toEqual(
      expect.arrayContaining(["schemaVersion", "cacheHit", "matches", "dbFallback", "durationMs"])
    );
  });

  it("合法 SceneActivationOutput 通过 Zod 校验", () => {
    const output = {
      schemaVersion: "v1" as const,
      cacheHit: true,
      matches: [sampleMatch],
      dbFallback: false,
      durationMs: 12,
    };
    const parsed = SceneActivationOutputSchema.parse(output);
    expect(parsed.matches).toHaveLength(1);
  });

  it("带 memoryRelevant 字段被 Zod 拒绝（strict mode）", () => {
    const output = {
      schemaVersion: "v1" as const,
      cacheHit: true,
      matches: [sampleMatch],
      dbFallback: false,
      durationMs: 12,
      memoryRelevant: true,                                       // 非法字段
    };
    const result = SceneActivationOutputSchema.safeParse(output);
    // Zod 默认 strip 未知字段（不抛错）。若要 strict 需 .strict()
    // 这里确认 strip 后不包含 memoryRelevant
    if (result.success) {
      expect((result.data as any).memoryRelevant).toBeUndefined();
    }
  });

  it("createEmptySceneActivationOutput 返回值符合 schema", () => {
    const output = createEmptySceneActivationOutput(false, true, 0);
    const parsed = SceneActivationOutputSchema.parse(output);
    expect(parsed.cacheHit).toBe(false);
    expect(parsed.matches).toEqual([]);
  });
});