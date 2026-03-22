/**
 * Forgetting Service — 动态遗忘服务 (SmartMem)
 *
 * 基于艾宾浩斯遗忘曲线的指数衰减模型，动态调整记忆重要性分数。
 * 公式：R = e^(-t/S)
 *   - R: 保留率
 *   - t: 距上次访问的时间（天）
 *   - S: 记忆强度（由 accessCount 和初始 importance 决定）
 *
 * 来源：SmartMem/src/services/forgettingService.ts
 */

import { eq, and, sql, lt } from "drizzle-orm";
import { getDb } from "../db";
import { memories, type Memory } from "../../drizzle/schema";

// ==================== 常量 ====================

/** 最低重要性阈值，低于此值的记忆将被标记为可删除 */
const MIN_IMPORTANCE_THRESHOLD = 0.05;

/** 基础记忆强度（天），访问次数越多强度越高 */
const BASE_STRENGTH = 7;

/** 每次访问增加的强度（天） */
const STRENGTH_PER_ACCESS = 3;

/** 语义记忆的强度加成倍数（语义记忆比情景记忆衰减更慢） */
const SEMANTIC_STRENGTH_MULTIPLIER = 3;

/** 人格记忆不参与遗忘 */
const EXEMPT_KINDS = ["persona"];

// ==================== 核心逻辑 ====================

/**
 * 计算记忆强度 S
 *
 * 记忆强度由以下因素决定：
 * - 基础强度
 * - 访问次数加成
 * - 记忆种类加成（语义记忆衰减更慢）
 * - 初始重要性加成
 */
function calculateStrength(memory: Memory): number {
  let strength = BASE_STRENGTH + memory.accessCount * STRENGTH_PER_ACCESS;

  // 语义记忆衰减更慢
  if (memory.kind === "semantic") {
    strength *= SEMANTIC_STRENGTH_MULTIPLIER;
  }

  // 初始重要性越高，衰减越慢
  strength *= 1 + memory.importance;

  return strength;
}

/**
 * 计算保留率 R = e^(-t/S)
 *
 * @param daysSinceAccess - 距上次访问的天数
 * @param strength - 记忆强度
 * @returns 保留率 (0-1)
 */
function calculateRetention(daysSinceAccess: number, strength: number): number {
  if (daysSinceAccess <= 0) return 1;
  if (strength <= 0) return 0;
  return Math.exp(-daysSinceAccess / strength);
}

// ==================== 导出接口 ====================

export interface ForgettingResult {
  memoriesDecayed: number;
  memoriesRemoved: number;
}

/**
 * 对指定用户的记忆执行衰减计算
 *
 * 工作流程：
 * 1. 查询用户所有非豁免类型的记忆
 * 2. 计算每条记忆的保留率
 * 3. 将 importance 乘以保留率进行衰减
 * 4. 删除 importance 低于阈值的记忆
 */
export async function applyForgettingDecay(
  userId: number
): Promise<ForgettingResult> {
  const result: ForgettingResult = {
    memoriesDecayed: 0,
    memoriesRemoved: 0,
  };

  const db = await getDb();
  if (!db) {
    console.warn("[Forgetting] Database not available");
    return result;
  }

  try {
    // 1. 查询所有非豁免记忆
    const allMemories = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          sql`${memories.kind} NOT IN ('persona')`
        )
      );

    if (allMemories.length === 0) return result;

    const now = new Date();
    const toRemove: number[] = [];

    // 2. 逐条计算衰减
    for (const memory of allMemories) {
      // 检查时效性：如果记忆已过期，直接标记删除
      if (
        (memory as any).validUntil &&
        new Date((memory as any).validUntil) < now
      ) {
        toRemove.push(memory.id);
        continue;
      }

      const lastAccessed = new Date(memory.lastAccessedAt);
      const daysSinceAccess =
        (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

      // 最近 1 天内访问过的不衰减
      if (daysSinceAccess < 1) continue;

      const strength = calculateStrength(memory);
      const retention = calculateRetention(daysSinceAccess, strength);

      // 新的重要性 = 当前重要性 * 保留率
      const newImportance = memory.importance * retention;

      if (newImportance < MIN_IMPORTANCE_THRESHOLD) {
        // 重要性过低，标记删除
        toRemove.push(memory.id);
      } else if (Math.abs(newImportance - memory.importance) > 0.01) {
        // 有显著变化，更新
        await db
          .update(memories)
          .set({ importance: parseFloat(newImportance.toFixed(4)) })
          .where(eq(memories.id, memory.id));
        result.memoriesDecayed++;
      }
    }

    // 3. 删除过低重要性的记忆
    for (const id of toRemove) {
      await db.delete(memories).where(eq(memories.id, id));
      result.memoriesRemoved++;
    }

    if (result.memoriesDecayed > 0 || result.memoriesRemoved > 0) {
      console.log(
        `[Forgetting] User ${userId}: decayed ${result.memoriesDecayed} memories, removed ${result.memoriesRemoved} memories.`
      );
    }

    return result;
  } catch (error) {
    console.error("[Forgetting] Error:", error);
    return result;
  }
}
