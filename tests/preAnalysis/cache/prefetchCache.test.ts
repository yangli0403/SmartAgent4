/**
 * M1-10/11 验证：PrefetchCache + schemaVersion
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PrefetchCache,
  SchemaVersionMismatchError,
} from "../../../server/agent/preAnalysis/cache/prefetchCache";
import {
  createDefaultPreAnalyzerOutput,
  CURRENT_SCHEMA_VERSION,
} from "../../../server/agent/preAnalysis/types/preAnalyzerOutput";

describe("M1-10 PrefetchCache schemaVersion（v1.3 修复 #7）", () => {
  let cache: PrefetchCache;
  beforeEach(() => {
    cache = new PrefetchCache();
  });

  it("set 自动写入 schemaVersion='v1'", () => {
    cache.set(
      "打开灯",
      createDefaultPreAnalyzerOutput({ domain: "iot" })
    );
    const entry = (cache as any).store.values().next().value;
    expect(entry.schemaVersion).toBe("v1");
  });

  it("get 命中 → 返回缓存 output", () => {
    cache.set(
      "打开灯",
      createDefaultPreAnalyzerOutput({ domain: "iot", confidence: 0.9 })
    );
    const r = cache.get("打开灯");
    expect(r.hit).toBe(true);
    expect(r.output?.domain).toBe("iot");
  });

  it("get 未命中 → hit=false", () => {
    const r = cache.get("不存在的输入");
    expect(r.hit).toBe(false);
    expect(r.schemaMismatch).toBeUndefined();
  });

  it("TTL 过期 → hit=false", () => {
    cache = new PrefetchCache(50);                            // 50ms TTL
    cache.set("打开灯", createDefaultPreAnalyzerOutput({ domain: "iot" }));
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const r = cache.get("打开灯");
        expect(r.hit).toBe(false);
        resolve();
      }, 100);
    });
  });

  it("schemaVersion 不匹配 → schemaMismatch=true（v1.3 修复 #7）", () => {
    // 用 setRaw 注入旧版本条目（schema 迁移场景）
    const key = cache.computeHash("打开灯");
    cache.setRaw({
      inputHash: key,
      output: createDefaultPreAnalyzerOutput({ domain: "iot" }),
      schemaVersion: "v0",
      cachedAt: Date.now(),
      ttlMs: 60000,
    });
    const r = cache.get("打开灯");
    expect(r.hit).toBe(false);
    expect(r.schemaMismatch).toBe(true);
  });

  it("缺 schemaVersion 字段（旧条目）→ 视为 invalid_version", () => {
    const key = cache.computeHash("打开灯");
    cache.setRaw({
      inputHash: key,
      output: createDefaultPreAnalyzerOutput({ domain: "iot" }),
      // schemaVersion 缺失
      cachedAt: Date.now(),
      ttlMs: 60000,
    } as any);
    const r = cache.get("打开灯");
    expect(r.schemaMismatch).toBe(true);
  });
});

describe("M1-11 invalid_version 降级路径", () => {
  it("命中但 schema 不匹配 → 上游应降级到 invalid_version 路径", () => {
    const cache = new PrefetchCache();
    const key = cache.computeHash("打开灯");
    cache.setRaw({
      inputHash: key,
      output: createDefaultPreAnalyzerOutput(),
      schemaVersion: "v0",
      cachedAt: Date.now(),
      ttlMs: 60000,
    });
    const r = cache.get("打开灯");
    // 上层根据 r.schemaMismatch 标记 source='invalid_version'
    const fallbackSource = r.schemaMismatch ? "invalid_version" : "prefetch";
    expect(fallbackSource).toBe("invalid_version");
  });

  it("CURRENT_SCHEMA_VERSION 常量正确", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("v1");
  });

  it("clear 清空", () => {
    const cache = new PrefetchCache();
    cache.set("x", createDefaultPreAnalyzerOutput());
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe("SchemaVersionMismatchError", () => {
  it("构造包含 actual/expected", () => {
    const e = new SchemaVersionMismatchError("key1", "v0", "v1");
    expect(e.inputHash).toBe("key1");
    expect(e.actual).toBe("v0");
    expect(e.expected).toBe("v1");
    expect(e.message).toContain("v0");
    expect(e.message).toContain("v1");
  });
});