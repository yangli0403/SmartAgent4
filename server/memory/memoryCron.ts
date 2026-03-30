/**
 * Memory Cron — 记忆系统定时任务 (SmartAgent4)
 *
 * 定期执行记忆巩固、遗忘衰减和主动意图预测任务。
 * 在应用启动时调用 startMemoryCron() 即可。
 *
 * 来源：SmartMem 的定时任务机制
 * 第四轮迭代新增：主动记忆引擎的意图预测周期
 */

import { consolidateMemories, forgetMemories } from "./memorySystem";
import { runPredictionCycle, PREDICTION_INTERVAL } from "./proactiveEngine";
import { getPrefetchCache } from "./prefetchCache";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";

// ==================== 配置 ====================

/** 巩固任务间隔（毫秒），默认 6 小时 */
const CONSOLIDATION_INTERVAL = 6 * 60 * 60 * 1000;

/** 遗忘衰减任务间隔（毫秒），默认 24 小时 */
const FORGETTING_INTERVAL = 24 * 60 * 60 * 1000;

/** 缓存清理间隔（毫秒），默认 30 分钟 */
const CACHE_CLEANUP_INTERVAL = 30 * 60 * 1000;

// ==================== 定时器引用 ====================

let consolidationTimer: ReturnType<typeof setInterval> | null = null;
let forgettingTimer: ReturnType<typeof setInterval> | null = null;
let predictionTimer: ReturnType<typeof setInterval> | null = null;
let cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;

// ==================== 任务执行 ====================

/**
 * 获取所有活跃用户 ID
 */
async function getActiveUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    return allUsers.map((u) => u.id);
  } catch (error) {
    console.error("[MemoryCron] Failed to get user IDs:", error);
    return [];
  }
}

/**
 * 执行巩固任务
 */
async function runConsolidation(): Promise<void> {
  console.log("[MemoryCron] Running consolidation task...");
  const userIds = await getActiveUserIds();

  let totalConsolidated = 0;
  for (const userId of userIds) {
    try {
      const count = await consolidateMemories(userId);
      totalConsolidated += count;
    } catch (error) {
      console.error(
        `[MemoryCron] Consolidation failed for user ${userId}:`,
        error
      );
    }
  }

  console.log(
    `[MemoryCron] Consolidation complete: ${totalConsolidated} memories consolidated across ${userIds.length} users.`
  );
}

/**
 * 执行意图预测任务（第四轮迭代新增）
 */
async function runPrediction(): Promise<void> {
  console.log("[MemoryCron] Running intent prediction task...");
  try {
    await runPredictionCycle();
  } catch (error) {
    console.error(
      "[MemoryCron] Prediction cycle failed:",
      (error as Error).message
    );
  }
}

/**
 * 执行遗忘衰减任务
 */
async function runForgetting(): Promise<void> {
  console.log("[MemoryCron] Running forgetting decay task...");
  const userIds = await getActiveUserIds();

  let totalAffected = 0;
  for (const userId of userIds) {
    try {
      const count = await forgetMemories(userId);
      totalAffected += count;
    } catch (error) {
      console.error(
        `[MemoryCron] Forgetting failed for user ${userId}:`,
        error
      );
    }
  }

  console.log(
    `[MemoryCron] Forgetting complete: ${totalAffected} memories affected across ${userIds.length} users.`
  );
}

// ==================== 导出接口 ====================

/**
 * 启动记忆系统定时任务
 */
export function startMemoryCron(): void {
  if (consolidationTimer || forgettingTimer) {
    console.warn("[MemoryCron] Already running, skipping duplicate start.");
    return;
  }

  console.log("[MemoryCron] Starting memory cron tasks...");
  console.log(
    `  - Consolidation: every ${CONSOLIDATION_INTERVAL / 3600000}h`
  );
  console.log(`  - Forgetting: every ${FORGETTING_INTERVAL / 3600000}h`);
  console.log(
    `  - Prediction: every ${PREDICTION_INTERVAL / 3600000}h`
  );
  console.log(
    `  - Cache cleanup: every ${CACHE_CLEANUP_INTERVAL / 60000}min`
  );

  // 延迟 5 分钟后首次执行，避免启动时负载过高
  setTimeout(() => {
    runConsolidation().catch(console.error);
  }, 5 * 60 * 1000);

  setTimeout(() => {
    runForgetting().catch(console.error);
  }, 10 * 60 * 1000);

  // 延迟 15 分钟后首次执行预测
  setTimeout(() => {
    runPrediction().catch(console.error);
  }, 15 * 60 * 1000);

  // 设置定期执行
  consolidationTimer = setInterval(() => {
    runConsolidation().catch(console.error);
  }, CONSOLIDATION_INTERVAL);

  forgettingTimer = setInterval(() => {
    runForgetting().catch(console.error);
  }, FORGETTING_INTERVAL);

  predictionTimer = setInterval(() => {
    runPrediction().catch(console.error);
  }, PREDICTION_INTERVAL);

  // 缓存清理定时器
  cacheCleanupTimer = setInterval(() => {
    getPrefetchCache().cleanup();
  }, CACHE_CLEANUP_INTERVAL);
}

/**
 * 停止记忆系统定时任务
 */
export function stopMemoryCron(): void {
  if (consolidationTimer) {
    clearInterval(consolidationTimer);
    consolidationTimer = null;
  }
  if (forgettingTimer) {
    clearInterval(forgettingTimer);
    forgettingTimer = null;
  }
  if (predictionTimer) {
    clearInterval(predictionTimer);
    predictionTimer = null;
  }
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
  // 停止缓存
  getPrefetchCache().stop();
  console.log("[MemoryCron] Memory cron tasks stopped.");
}
