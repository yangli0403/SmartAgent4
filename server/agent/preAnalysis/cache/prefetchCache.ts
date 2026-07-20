/**
 * server/agent/preAnalysis/cache/prefetchCache.ts
 *
 * PrefetchCache — 主动预测缓存（v1.3 修复 #7：schemaVersion 字段）
 *
 * 保留与 server/memory/prefetchCache.ts 的概念一致，
 * 但本实现聚焦"预分析节点的输入缓存"，而非原系统的全局预取缓存。
 */

import { CURRENT_SCHEMA_VERSION, type PreAnalyzerOutput, Source } from "../types/preAnalyzerOutput";

// ============================================================
// 缓存条目
// ============================================================

export interface PrefetchCacheEntry {
  /** 输入 hash 作为 key */
  inputHash: string;
  /** 缓存的预分析结果 */
  output: PreAnalyzerOutput;
  /** schema 版本（v1.3 新增） */
  schemaVersion: string;
  /** 写入时间 */
  cachedAt: number;
  /** TTL (ms) */
  ttlMs: number;
}

// ============================================================
// 自定义错误
// ============================================================

export class SchemaVersionMismatchError extends Error {
  constructor(
    public inputHash: string,
    public actual: string | undefined,
    public expected: string
  ) {
    super(`schemaVersion 不匹配: actual=${actual}, expected=${expected}, key=${inputHash}`);
    this.name = "SchemaVersionMismatchError";
  }
}

// ============================================================
// PrefetchCache
// ============================================================

interface LookupResult {
  hit: boolean;
  output?: PreAnalyzerOutput;
  /** true 表示 schema 不匹配，需要降级 */
  schemaMismatch?: boolean;
}

export class PrefetchCache {
  private store = new Map<string, PrefetchCacheEntry>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /** 写入（自动注入 schemaVersion） */
  set(input: string, output: PreAnalyzerOutput, ttlMs?: number): void {
    const entry: PrefetchCacheEntry = {
      inputHash: this.hash(input),
      output: { ...output, schemaVersion: CURRENT_SCHEMA_VERSION },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    };
    this.store.set(entry.inputHash, entry);
  }

  /**
   * 直接写入原始条目（绕过 hash 函数）
   * 用于：
   * 1. 旧版本 schema 条目注入（schema 迁移场景）
   * 2. 测试场景：直接构造特定 schemaVersion 的条目
   */
  setRaw(entry: PrefetchCacheEntry): void {
    this.store.set(entry.inputHash, entry);
  }

  /** 暴露 hash 函数（用于测试 seam） */
  computeHash(input: string): string {
    return this.hash(input);
  }

  /**
   * 查询缓存
   * - 命中且 schemaVersion 匹配 → hit=true, output=...
   * - 命中但 schemaVersion 不匹配 → hit=false, schemaMismatch=true（v1.3 修复 #7）
   * - 未命中 / 已过期 → hit=false
   */
  get(input: string): LookupResult {
    const key = this.hash(input);
    const entry = this.store.get(key);

    if (!entry) return { hit: false };

    // TTL 检查
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.store.delete(key);
      return { hit: false };
    }

    // v1.3 修复 #7：schemaVersion 不匹配 → 标记 mismatch
    if (entry.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      return { hit: false, schemaMismatch: true };
    }

    return { hit: true, output: entry.output };
  }

  /**
   * 显式标记 schema 不匹配（用于上层构建 invalid_version 结果）
   */
  getInvalid(input: string): PreAnalyzerOutput | null {
    const result = this.get(input);
    if (result.hit) return result.output!;
    // schema mismatch 或 miss → 返回 invalid_version 标记
    return null;
  }

  /** 清空 */
  clear(): void {
    this.store.clear();
  }

  /** 调试用 */
  size(): number {
    return this.store.size;
  }

  /** 列出所有 key（测试用） */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  private hash(input: string): string {
    // 简单 hash（生产用 crypto.createHash）
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return `pf_${h}_${input.length}`;
  }
}

// ============================================================
// 全局单例
// ============================================================

let _instance: PrefetchCache | null = null;

export function getPrefetchCache(): PrefetchCache {
  if (!_instance) _instance = new PrefetchCache();
  return _instance;
}

export function resetPrefetchCache(): void {
  _instance = null;
}