/**
 * Confidence 演化服务
 *
 * 在记忆写入和更新时，根据已有记忆的匹配情况动态调整置信度。
 * - 内容一致：提升已有记忆的置信度（增量 ≤ 0.15，上限 1.0），跳过写入
 * - 内容矛盾：降低已有记忆的置信度，继续写入新记忆
 *
 * 基于 versionGroup 匹配 + 语义相似度判断内容一致性。
 * 人格类型（persona kind）记忆不参与动态演化。
 *
 * @module confidenceEvolution
 */

import type { Memory } from "../../drizzle/schema";
import { computeJaccardSimilarity } from "./extractionAudit";

// ==================== 类型定义 ====================

/** 演化动作 */
export type EvolutionAction =
  | "BOOST"       // 提升已有记忆置信度，跳过写入
  | "SUPERSEDE"   // 降低已有记忆置信度，继续写入新记忆
  | "NO_MATCH"    // 无匹配的已有记忆，正常写入
  | "SKIP";       // 人格记忆等不参与演化的类型

/** 演化结果 */
export interface EvolutionResult {
  /** 演化动作 */
  action: EvolutionAction;
  /** 受影响的已有记忆（仅在 BOOST 或 SUPERSEDE 时有值） */
  affectedMemory?: Memory;
  /** 调整前的置信度 */
  previousConfidence?: number;
  /** 调整后的置信度 */
  newConfidence?: number;
  /** 演化理由（用于日志） */
  reason: string;
}

/** 演化配置 */
export interface EvolutionConfig {
  /** 置信度提升增量上限（默认 0.15） */
  boostIncrement?: number;
  /** 置信度上限（默认 1.0） */
  maxConfidence?: number;
  /** 置信度降低增量（默认 0.2） */
  supersedePenalty?: number;
  /** 置信度下限（默认 0.1） */
  minConfidence?: number;
  /** 内容一致性判断的 Jaccard 阈值（默认 0.5） */
  consistencyThreshold?: number;
}

// ==================== 默认配置 ====================

const DEFAULT_EVOLUTION_CONFIG: Required<EvolutionConfig> = {
  boostIncrement: parseFloat(
    process.env.CONFIDENCE_BOOST_INCREMENT ?? "0.15"
  ),
  maxConfidence: parseFloat(
    process.env.CONFIDENCE_MAX ?? "1.0"
  ),
  supersedePenalty: parseFloat(
    process.env.CONFIDENCE_SUPERSEDE_PENALTY ?? "0.2"
  ),
  minConfidence: parseFloat(
    process.env.CONFIDENCE_MIN ?? "0.1"
  ),
  consistencyThreshold: parseFloat(
    process.env.CONFIDENCE_CONSISTENCY_THRESHOLD ?? "0.5"
  ),
};

// ==================== 核心函数 ====================

/**
 * 判断新记忆与已有记忆的内容关系
 *
 * 基于 Jaccard 相似度判断：
 * - 相似度 >= consistencyThreshold → 内容一致（确认）
 * - 相似度 < consistencyThreshold → 内容矛盾（更新）
 *
 * @param newContent - 新记忆内容
 * @param existingContent - 已有记忆内容
 * @param threshold - 一致性阈值
 * @returns "consistent"（一致）或 "contradictory"（矛盾）
 */
export function judgeContentRelation(
  newContent: string,
  existingContent: string,
  threshold?: number
): "consistent" | "contradictory" {
  const t = threshold ?? DEFAULT_EVOLUTION_CONFIG.consistencyThreshold;
  const similarity = computeJaccardSimilarity(newContent, existingContent);
  return similarity >= t ? "consistent" : "contradictory";
}

/**
 * 计算置信度提升值
 *
 * 基于当前置信度和确认次数（accessCount）动态计算提升增量。
 * 已有较高置信度的记忆，提升增量递减。
 *
 * 公式：increment = boostIncrement * (1 - currentConfidence) * decay
 * 其中 decay = 1 / (1 + accessCount * 0.1)，确认次数越多衰减越快。
 *
 * @param currentConfidence - 当前置信度
 * @param accessCount - 已有的访问/确认次数
 * @param config - 演化配置
 * @returns 提升增量（0 ~ boostIncrement）
 */
export function calculateBoostIncrement(
  currentConfidence: number,
  accessCount: number,
  config?: EvolutionConfig
): number {
  const mergedConfig = { ...DEFAULT_EVOLUTION_CONFIG, ...config };

  // 置信度越高，提升空间越小
  const headroom = 1 - currentConfidence;
  if (headroom <= 0) return 0;

  // 确认次数越多，提升增量衰减
  const decay = 1 / (1 + (accessCount || 0) * 0.1);

  // 最终增量 = 基础增量 * 剩余空间比例 * 衰减因子
  const increment = mergedConfig.boostIncrement * headroom * decay;

  // 确保不超过 boostIncrement 上限
  return Math.min(increment, mergedConfig.boostIncrement);
}

/**
 * 执行 Confidence 演化（主入口函数）
 *
 * 演化流程：
 * 1. 检查新记忆是否为人格类型 → 若是，返回 SKIP
 * 2. 检查是否有已有记忆可匹配
 * 3. 若无匹配 → 返回 NO_MATCH，正常写入
 * 4. 判断内容关系：
 *    - 一致 → BOOST：提升已有记忆置信度，跳过写入
 *    - 矛盾 → SUPERSEDE：降低已有记忆置信度，继续写入
 *
 * 注意：本函数只计算演化结果，不执行数据库更新。
 * 数据库更新由调用方（memorySystem.addMemory）负责。
 *
 * @param newMemory - 待写入的新记忆
 * @param existingMemories - 同一 versionGroup 的已有记忆列表
 * @param config - 可选的演化配置
 * @returns 演化结果
 */
export async function evolveConfidence(
  newMemory: {
    content: string;
    kind?: string;
    versionGroup?: string;
    userId: number;
  },
  existingMemories: Memory[],
  config?: EvolutionConfig
): Promise<EvolutionResult> {
  const mergedConfig: Required<EvolutionConfig> = {
    ...DEFAULT_EVOLUTION_CONFIG,
    ...config,
  };

  // 1. 人格记忆不参与演化
  if (newMemory.kind === "persona") {
    return {
      action: "SKIP",
      reason: "人格类型记忆不参与 Confidence 动态演化",
    };
  }

  // 2. 无 versionGroup 或无已有记忆 → NO_MATCH
  if (!newMemory.versionGroup || existingMemories.length === 0) {
    return {
      action: "NO_MATCH",
      reason: newMemory.versionGroup
        ? "同一 versionGroup 下无已有记忆"
        : "新记忆未指定 versionGroup，无法匹配",
    };
  }

  // 3. 找到最相关的已有记忆（按置信度降序，取最高置信度的）
  const sortedMemories = [...existingMemories].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );
  const targetMemory = sortedMemories[0];

  // 4. 判断内容关系
  const relation = judgeContentRelation(
    newMemory.content,
    targetMemory.content,
    mergedConfig.consistencyThreshold
  );

  if (relation === "consistent") {
    // BOOST：内容一致，提升已有记忆置信度
    const previousConfidence = targetMemory.confidence ?? 0.5;
    const increment = calculateBoostIncrement(
      previousConfidence,
      targetMemory.accessCount ?? 0,
      mergedConfig
    );
    const newConfidence = Math.min(
      previousConfidence + increment,
      mergedConfig.maxConfidence
    );

    console.log(
      `[ConfidenceEvolution] BOOST: memoryId=${targetMemory.id}, ` +
        `confidence ${previousConfidence.toFixed(2)} → ${newConfidence.toFixed(2)} ` +
        `(+${increment.toFixed(3)})`
    );

    return {
      action: "BOOST",
      affectedMemory: targetMemory,
      previousConfidence,
      newConfidence,
      reason:
        `新记忆与已有记忆内容一致（versionGroup="${newMemory.versionGroup}"），` +
        `提升置信度 ${previousConfidence.toFixed(2)} → ${newConfidence.toFixed(2)}`,
    };
  } else {
    // SUPERSEDE：内容矛盾，降低已有记忆置信度
    const previousConfidence = targetMemory.confidence ?? 0.5;
    const newConfidence = Math.max(
      previousConfidence - mergedConfig.supersedePenalty,
      mergedConfig.minConfidence
    );

    console.log(
      `[ConfidenceEvolution] SUPERSEDE: memoryId=${targetMemory.id}, ` +
        `confidence ${previousConfidence.toFixed(2)} → ${newConfidence.toFixed(2)} ` +
        `(-${mergedConfig.supersedePenalty})`
    );

    return {
      action: "SUPERSEDE",
      affectedMemory: targetMemory,
      previousConfidence,
      newConfidence,
      reason:
        `新记忆与已有记忆内容矛盾（versionGroup="${newMemory.versionGroup}"），` +
        `降低旧记忆置信度 ${previousConfidence.toFixed(2)} → ${newConfidence.toFixed(2)}`,
    };
  }
}
