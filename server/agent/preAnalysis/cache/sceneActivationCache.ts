/**
 * server/agent/preAnalysis/cache/sceneActivationCache.ts
 *
 * SceneActivationCache — 场景激活查询结果缓存（v1.3 修复 #14）
 *
 * 设计动机：
 * - 原 classifyNode 中 `searchSceneEpisodes` 是 DB 查询（50~200ms）
 * - 同一用户短时间内重复触发同一场景的概率高（"打开午睡模式" 一天可能触发 10+ 次）
 * - 5min TTL 内存缓存可消除重复 DB 查询，避免阻塞 preAnalysisNode 主流程
 *
 * 与 PrefetchCache 区别：
 * - PrefetchCache: 缓存 PreAnalyzerOutput（包含完整 6 字段 + 2 meta）
 * - SceneActivationCache: 缓存 SceneActivationOutput（仅匹配结果，不含 memoryRelevant）
 */

import {
  createEmptySceneActivationOutput,
  CURRENT_SCENE_ACTIVATION_SCHEMA_VERSION,
  type SceneActivationOutput,
  type SceneMatch,
} from "../types/sceneActivationOutput";

// ============================================================
// 缓存条目
// ============================================================

interface SceneActivationCacheEntry {
  /** key = `${userId}:${queryHash}` */
  key: string;
  /** 缓存的输出（已含 schemaVersion） */
  output: SceneActivationOutput;
  /** 写入时间 */
  cachedAt: number;
  /** TTL (ms) */
  ttlMs: number;
}

// ============================================================
// LRU 实现（基于 Map 插入顺序）
// ============================================================

class LRUMap<V> {
  private map = new Map<string, V>();
  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // 命中 → 移到末尾（最近使用）
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // LRU 淘汰：删除最早的
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }
}

// ============================================================
// SceneActivationCache
// ============================================================

export interface SceneActivationCacheOptions {
  /** TTL（ms），默认 5min（v1.3 修复 #14） */
  defaultTtlMs?: number;
  /** 最大缓存条目数（LRU），默认 1000 */
  maxEntries?: number;
}

export class SceneActivationCache {
  private store: LRUMap<SceneActivationCacheEntry>;
  private defaultTtlMs: number;
  private maxEntries: number;
  /** 命中率统计 */
  private hits = 0;
  private misses = 0;

  constructor(opts: SceneActivationCacheOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 5 * 60 * 1000;  // 5min
    this.maxEntries = opts.maxEntries ?? 1000;
    this.store = new LRUMap(this.maxEntries);
  }

  /** 写入场景匹配结果 */
  set(userId: number, query: string, matches: SceneMatch[], durationMs = 0, ttlMs?: number): void {
    const key = this.buildKey(userId, query);
    const output: SceneActivationOutput = {
      schemaVersion: CURRENT_SCENE_ACTIVATION_SCHEMA_VERSION,
      cacheHit: true,                                          // 标记为命中（下次查询时即为 cache hit）
      matches,
      dbFallback: false,
      durationMs,
    };
    this.store.set(key, {
      key,
      output,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  /**
   * 查询缓存
   * - 命中且 schemaVersion 匹配 → 返回完整 output（cacheHit=true）
   * - 命中但 schemaVersion 不匹配 → 返回空 output（cacheHit=false, dbFallback=true）
   * - 未命中 / 已过期 → 返回空 output（cacheHit=false, dbFallback=true）
   */
  get(userId: number, query: string): SceneActivationOutput {
    const key = this.buildKey(userId, query);
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return createEmptySceneActivationOutput(false, true, 0);
    }

    // TTL 检查
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.store.delete(key);
      this.misses++;
      return createEmptySceneActivationOutput(false, true, 0);
    }

    // schema 版本检查
    if (entry.output.schemaVersion !== CURRENT_SCENE_ACTIVATION_SCHEMA_VERSION) {
      this.store.delete(key);
      this.misses++;
      return createEmptySceneActivationOutput(false, true, 0);
    }

    this.hits++;
    // 返回拷贝 + 标记 cacheHit=true（命中状态）
    return {
      ...entry.output,
      cacheHit: true,
      matches: [...entry.output.matches],
    };
  }

  /** 失效：用户级 clear（登出/数据迁移） */
  invalidateUser(userId: number): number {
    let cleared = 0;
    const prefix = `${userId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /** 全清 */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** 统计 */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size(),
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /** 调试用 */
  size(): number {
    return this.store.size();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private buildKey(userId: number, query: string): string {
    return `${userId}:${this.hash(query)}`;
  }

  private hash(input: string): string {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return `s_${h}_${input.length}`;
  }
}

// ============================================================
// 全局单例
// ============================================================

let _instance: SceneActivationCache | null = null;

export function getSceneActivationCache(): SceneActivationCache {
  if (!_instance) _instance = new SceneActivationCache();
  return _instance;
}

export function resetSceneActivationCache(): void {
  _instance = null;
}