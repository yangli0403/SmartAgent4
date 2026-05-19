/**
 * diskCache.ts — 磁盘持久化缓存模块
 *
 * 提供基于文件系统的 TTL 缓存，服务重启后仍可命中。
 * 适用于高德 API 返回的 geocode / POI / driving 结果等变化频率低的数据。
 *
 * 设计原则：
 * - 每条缓存写为独立 JSON 文件，文件名为 SHA1(key) + ".json"
 * - 文件内容：{ key, data, expireAt, createdAt }
 * - 读取时检查 expireAt，过期自动删除
 * - 写入时异步非阻塞，不影响主流程
 * - 启动时加载索引到内存（Map），后续读写走内存索引 + 按需落盘
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ES module 化境下模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 常量 ====================

/** 缓存文件存放目录（相对于本文件） */
const CACHE_DIR = path.resolve(__dirname, "data");

/** 默认 TTL：24 小时 */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** geocode 结果 TTL：7 天（地理编码基本不变） */
export const GEOCODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** POI 搜索结果 TTL：6 小时 */
export const POI_TTL_MS = 6 * 60 * 60 * 1000;

/** 路径规划结果 TTL：1 小时 */
export const DRIVING_TTL_MS = 60 * 60 * 1000;

// ==================== 类型 ====================

interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  expireAt: number;
  createdAt: number;
}

// ==================== 内存索引 ====================

/** 内存索引：key → CacheEntry（已加载到内存，避免每次读磁盘） */
const memIndex = new Map<string, CacheEntry>();

/** 是否已完成初始化加载 */
let initialized = false;

// ==================== 工具函数 ====================

function hashKey(key: string): string {
  return crypto.createHash("sha1").update(key).digest("hex");
}

function cacheFilePath(key: string): string {
  return path.join(CACHE_DIR, `${hashKey(key)}.json`);
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// ==================== 初始化 ====================

/**
 * 启动时扫描 cache/data 目录，将所有未过期条目加载到内存索引。
 * 过期条目直接删除。
 */
export function initDiskCache(): void {
  if (initialized) return;
  initialized = true;
  ensureCacheDir();
  let loaded = 0;
  let expired = 0;
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(CACHE_DIR, file), "utf-8");
        const entry = JSON.parse(raw) as CacheEntry;
        if (entry.expireAt > Date.now()) {
          memIndex.set(entry.key, entry);
          loaded++;
        } else {
          fs.unlinkSync(path.join(CACHE_DIR, file));
          expired++;
        }
      } catch {
        // 损坏文件跳过
      }
    }
    console.log(
      `[DiskCache] Initialized: ${loaded} entries loaded, ${expired} expired entries removed`
    );
  } catch (e) {
    console.warn("[DiskCache] Init failed:", (e as Error).message);
  }
}

// ==================== 读写 API ====================

/**
 * 读取缓存。命中返回数据，未命中或过期返回 null。
 */
export function diskCacheGet<T = unknown>(key: string): T | null {
  if (!initialized) initDiskCache();
  const entry = memIndex.get(key);
  if (!entry) return null;
  if (entry.expireAt <= Date.now()) {
    // 过期：清理内存索引和磁盘文件
    memIndex.delete(key);
    const filePath = cacheFilePath(key);
    fs.unlink(filePath, () => {});
    return null;
  }
  return entry.data as T;
}

/**
 * 写入缓存（异步落盘，不阻塞调用方）。
 * @param key 缓存键
 * @param data 缓存数据
 * @param ttlMs TTL 毫秒数，默认 24 小时
 */
export function diskCacheSet<T = unknown>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  if (!initialized) initDiskCache();
  const entry: CacheEntry<T> = {
    key,
    data,
    expireAt: Date.now() + ttlMs,
    createdAt: Date.now(),
  };
  memIndex.set(key, entry as CacheEntry);
  // 异步落盘
  const filePath = cacheFilePath(key);
  fs.writeFile(filePath, JSON.stringify(entry), "utf-8", (err) => {
    if (err) {
      console.warn(`[DiskCache] Write failed for key "${key.substring(0, 50)}":`, err.message);
    }
  });
}

/**
 * 删除缓存条目。
 */
export function diskCacheDelete(key: string): void {
  memIndex.delete(key);
  const filePath = cacheFilePath(key);
  fs.unlink(filePath, () => {});
}

/**
 * 获取当前缓存统计信息。
 */
export function diskCacheStats(): { count: number; dir: string } {
  return { count: memIndex.size, dir: CACHE_DIR };
}
