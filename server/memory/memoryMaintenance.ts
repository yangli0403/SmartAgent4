/**
 * 记忆后台任务 — 手动触发入口（与 memoryCron 定时任务对应）
 *
 * 定时策略见 memoryCron.ts：巩固约 6h、遗忘约 24h、意图预测约 2h、预取缓存清理约 30min；
 * 预取条目 TTL 见 prefetchCache（默认 4h）。
 */

import { consolidateMemories, forgetMemories } from "./memorySystem";
import { runPredictionAndPrefetchForUser } from "./proactiveEngine";
import { getPrefetchCache } from "./prefetchCache";

export const MEMORY_JOB_IDS = [
  "consolidation",
  "forgetting",
  "prediction",
  "prefetch_cache_cleanup",
] as const;

export type MemoryJobId = (typeof MEMORY_JOB_IDS)[number];

export interface UserMemoryMaintenanceResult {
  /** 巩固合并的记忆条数（近似） */
  consolidationCount: number;
  /** 遗忘衰减触达的条数 */
  forgettingCount: number;
  /** 意图预测 + 预取 */
  prediction: { ok: boolean; message: string };
  /** 全局预取缓存里清理的过期条目数 */
  prefetchCacheExpiredRemoved: number;
}

/**
 * 为当前用户执行所选后台任务（prediction 为单用户；prefetch_cache_cleanup 为全局过期清理）。
 */
export async function runUserMemoryMaintenance(
  userId: number,
  jobs: MemoryJobId[] | "all"
): Promise<UserMemoryMaintenanceResult> {
  const list: MemoryJobId[] =
    jobs === "all" ? [...MEMORY_JOB_IDS] : jobs;

  let consolidationCount = 0;
  let forgettingCount = 0;
  let prediction: { ok: boolean; message: string } = {
    ok: false,
    message: "未执行",
  };
  let prefetchCacheExpiredRemoved = 0;

  for (const job of list) {
    switch (job) {
      case "consolidation":
        consolidationCount = await consolidateMemories(userId);
        break;
      case "forgetting":
        forgettingCount = await forgetMemories(userId);
        break;
      case "prediction":
        prediction = await runPredictionAndPrefetchForUser(userId);
        break;
      case "prefetch_cache_cleanup":
        prefetchCacheExpiredRemoved = getPrefetchCache().cleanup();
        break;
      default:
        break;
    }
  }

  return {
    consolidationCount,
    forgettingCount,
    prediction,
    prefetchCacheExpiredRemoved,
  };
}
