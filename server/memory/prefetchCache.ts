/**
 * Prefetch Cache — 上下文预取缓存（第四轮迭代新增）
 *
 * 存储意图预测引擎预取的记忆上下文，供 contextEnrichNode 快速读取。
 * 使用内存 Map 实现，带 TTL 和最大条目数限制。
 *
 * 设计原则：
 * - 缓存仅作为加速手段，未命中时降级到实时检索
 * - 自动清理过期条目，防止内存泄漏
 * - 线程安全（Node.js 单线程，无需额外锁）
 */

import type { Memory } from "../../drizzle/schema";

// ==================== 类型定义 ====================

/**
 * 预测的用户意图
 */
export interface PredictedIntent {
  /** 用户 ID */
  userId: number;
  /** 预测的意图描述 */
  intent: string;
  /** 预测置信度 (0.0-1.0) */
  confidence: number;
  /** 建议的记忆检索查询 */
  suggestedQueries: string[];
  /** 预测的推理过程 */
  reasoning: string;
  /** 预测时间（ISO 格式） */
  predictedAt: string;
  /** 预测过期时间（ISO 格式） */
  expiresAt: string;
}

/**
 * 预取缓存条目
 */
export interface PrefetchCacheEntry {
  /** 用户 ID */
  userId: number;
  /** 对应的意图预测结果 */
  predictedIntent: PredictedIntent;
  /** 预取的记忆列表 */
  prefetchedMemories: Memory[];
  /** 预格式化的上下文字符串（可直接注入 System Prompt） */
  formattedContext: string;
  /** 缓存创建时间戳（ms） */
  createdAt: number;
  /** 缓存过期时间戳（ms） */
  expiresAt: number;
}

/**
 * 缓存统计信息
 */
export interface PrefetchCacheStats {
  /** 当前缓存条目数 */
  size: number;
  /** 缓存命中次数 */
  hitCount: number;
  /** 缓存未命中次数 */
  missCount: number;
}

// ==================== 配置常量 ====================

/** 默认 TTL：4 小时 */
const DEFAULT_TTL = 4 * 60 * 60 * 1000;

/** 最大缓存条目数 */
const MAX_CACHE_SIZE = 1000;

/** 清理间隔：30 分钟 */
const CLEANUP_INTERVAL = 30 * 60 * 1000;

// ==================== 缓存实现 ====================

class PrefetchCacheManager {
  private store: Map<number, PrefetchCacheEntry> = new Map();
  private hitCount = 0;
  private missCount = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 启动定期清理
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
  }

  /**
   * 写入缓存条目
   */
  set(entry: PrefetchCacheEntry): void {
    // 检查是否超出最大条目数
    if (this.store.size >= MAX_CACHE_SIZE && !this.store.has(entry.userId)) {
      this.evictOldest();
    }

    this.store.set(entry.userId, entry);
    console.log(
      `[PrefetchCache] Cached context for user ${entry.userId}, ` +
        `memories=${entry.prefetchedMemories.length}, ` +
        `intent="${entry.predictedIntent.intent.substring(0, 50)}..."`
    );
  }

  /**
   * 获取缓存条目（自动检查过期）
   */
  get(userId: number): PrefetchCacheEntry | null {
    const entry = this.store.get(userId);

    if (!entry) {
      this.missCount++;
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.store.delete(userId);
      this.missCount++;
      console.log(`[PrefetchCache] Entry expired for user ${userId}`);
      return null;
    }

    this.hitCount++;
    console.log(
      `[PrefetchCache] Cache HIT for user ${userId}, ` +
        `intent="${entry.predictedIntent.intent.substring(0, 50)}..."`
    );
    return entry;
  }

  /**
   * 手动失效缓存
   */
  invalidate(userId: number): void {
    const deleted = this.store.delete(userId);
    if (deleted) {
      console.log(`[PrefetchCache] Invalidated cache for user ${userId}`);
    }
  }

  /**
   * 清理所有过期条目
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(
        `[PrefetchCache] Cleanup: removed ${cleaned} expired entries, ` +
          `${this.store.size} remaining`
      );
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): PrefetchCacheStats {
    return {
      size: this.store.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
    };
  }

  /**
   * 淘汰最早过期的条目
   */
  private evictOldest(): void {
    let oldestKey: number | null = null;
    let oldestExpiry = Infinity;

    for (const [userId, entry] of this.store.entries()) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = userId;
      }
    }

    if (oldestKey !== null) {
      this.store.delete(oldestKey);
      console.log(
        `[PrefetchCache] Evicted oldest entry for user ${oldestKey}`
      );
    }
  }

  /**
   * 停止清理定时器（用于测试和关闭）
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }
}

// ==================== 单例导出 ====================

let cacheInstance: PrefetchCacheManager | null = null;

/**
 * 获取预取缓存单例
 */
export function getPrefetchCache(): PrefetchCacheManager {
  if (!cacheInstance) {
    cacheInstance = new PrefetchCacheManager();
  }
  return cacheInstance;
}

/**
 * 创建新的缓存实例（用于测试）
 */
export function createPrefetchCache(): PrefetchCacheManager {
  return new PrefetchCacheManager();
}

/**
 * 默认 TTL 常量导出（用于外部配置）
 */
export const PREFETCH_TTL = DEFAULT_TTL;
