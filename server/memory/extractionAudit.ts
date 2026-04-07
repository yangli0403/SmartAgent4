/**
 * 提取审计层
 *
 * 在 Agent 调用 memory_store 时执行质量把控，包括：
 * - 重要性门控：拦截低质量记忆（importance < 阈值）
 * - 去重校验：检测与已有记忆的 Jaccard 相似度，拦截或触发合并
 *
 * 设计决策参考：MEMORY_OPTIMIZATION_ARCHITECTURE.md 决策 4
 * 审计层放在 memoryTools 层（而非 memorySystem 层），
 * 仅对 Agent 主动写入进行审计，不影响服务端兜底写入和补漏提取。
 *
 * @module extractionAudit
 */

import type { Memory } from "../../drizzle/schema";
import { searchMemories } from "./memorySystem";

// ==================== 类型定义 ====================

/** 审计结果状态 */
export type AuditVerdict = "PASS" | "REJECT" | "MERGE";

/** 拒绝原因 */
export type RejectReason =
  | "low_importance"
  | "duplicate_content"
  | "missing_required_fields";

/** 审计结果 */
export interface AuditResult {
  /** 审计判定：通过 / 拒绝 / 合并 */
  verdict: AuditVerdict;
  /** 拒绝原因（仅在 verdict=REJECT 时有值） */
  rejectReason?: RejectReason;
  /** 匹配到的已有记忆（仅在 verdict=MERGE 或 REJECT(duplicate) 时有值） */
  matchedMemory?: Memory;
  /** Jaccard 相似度分数（仅在去重校验时有值） */
  similarityScore?: number;
  /** 面向 Agent 的反馈消息（人类可读） */
  feedbackMessage: string;
}

/** 待审计的记忆写入请求 */
export interface AuditInput {
  /** 用户 ID */
  userId: number;
  /** 记忆内容 */
  content: string;
  /** 记忆类型 */
  type: "fact" | "behavior" | "preference" | "emotion";
  /** 记忆大类 */
  kind?: "episodic" | "semantic" | "persona";
  /** 重要性分数 */
  importance: number;
  /** 置信度 */
  confidence?: number;
  /** 版本分组 */
  versionGroup?: string;
  /** 标签 */
  tags?: string[];
}

/** 审计层配置 */
export interface AuditConfig {
  /** 重要性门控阈值（低于此值的记忆将被拦截，默认 0.3） */
  importanceThreshold?: number;
  /** Jaccard 去重阈值（高于此值视为重复，默认 0.6） */
  deduplicationThreshold?: number;
  /** 去重校验时查询的已有记忆数量上限（默认 50） */
  deduplicationSearchLimit?: number;
}

// ==================== 默认配置 ====================

const DEFAULT_AUDIT_CONFIG: Required<AuditConfig> = {
  importanceThreshold: parseFloat(
    process.env.AUDIT_IMPORTANCE_THRESHOLD ?? "0.3"
  ),
  deduplicationThreshold: parseFloat(
    process.env.AUDIT_DEDUP_THRESHOLD ?? "0.6"
  ),
  deduplicationSearchLimit: parseInt(
    process.env.AUDIT_DEDUP_SEARCH_LIMIT ?? "50",
    10
  ),
};

// ==================== 核心函数 ====================

/**
 * 重要性门控检查
 *
 * 检查记忆的重要性分数是否达到写入阈值。
 *
 * @param importance - 记忆的重要性分数（0-1）
 * @param threshold - 门控阈值
 * @returns 是否通过门控
 */
export function checkImportanceGate(
  importance: number,
  threshold?: number
): boolean {
  const t = threshold ?? DEFAULT_AUDIT_CONFIG.importanceThreshold;
  return importance >= t;
}

/**
 * 计算两段文本的 Jaccard 相似度
 *
 * 基于分词后的词集合计算 Jaccard 系数：|A ∩ B| / |A ∪ B|。
 *
 * @param textA - 文本 A
 * @param textB - 文本 B
 * @returns Jaccard 相似度（0-1）
 */
export function computeJaccardSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;

  // 使用字符级分词（适用于中文），同时按空格分割（适用于英文）
  const tokenize = (text: string): Set<string> => {
    const tokens = new Set<string>();
    // 按空格和标点分词
    const words = text.toLowerCase().split(/[\s,，。！？、；：""''（）\(\)\[\]]+/);
    for (const word of words) {
      if (word.length > 0) tokens.add(word);
    }
    // 对中文文本额外进行 bigram 分词
    const cleaned = text.toLowerCase().replace(/\s+/g, "");
    for (let i = 0; i < cleaned.length - 1; i++) {
      tokens.add(cleaned.substring(i, i + 2));
    }
    return tokens;
  };

  const setA = tokenize(textA);
  const setB = tokenize(textB);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 去重校验
 *
 * 将新记忆与已有记忆列表进行 Jaccard 相似度比对，
 * 仅比对同一类型的记忆。返回最高相似度的匹配。
 *
 * @param input - 待审计的记忆写入请求
 * @param existingMemories - 同一用户的已有记忆列表
 * @param threshold - 去重阈值
 * @returns 去重校验结果，null 表示无重复
 */
export function checkDeduplication(
  input: AuditInput,
  existingMemories: Memory[],
  threshold?: number
): { matchedMemory: Memory; similarityScore: number } | null {
  const t = threshold ?? DEFAULT_AUDIT_CONFIG.deduplicationThreshold;

  let bestMatch: Memory | null = null;
  let bestScore = 0;

  for (const existing of existingMemories) {
    // 仅比对同一类型的记忆
    if (existing.type !== input.type) continue;

    const score = computeJaccardSimilarity(input.content, existing.content);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = existing;
    }
  }

  if (bestMatch && bestScore >= t) {
    return { matchedMemory: bestMatch, similarityScore: bestScore };
  }

  return null;
}

/**
 * 执行完整的提取审计（主入口函数）
 *
 * 审计流程：
 * 1. 基础字段校验（content 非空、type 合法）
 * 2. 重要性门控（importance >= 阈值）
 * 3. 去重校验（Jaccard 相似度 < 阈值）
 *
 * @param input - 待审计的记忆写入请求
 * @param config - 可选的审计配置
 * @returns 审计结果
 *
 * @example
 * ```typescript
 * const result = await auditMemoryExtraction({
 *   userId: 1,
 *   content: "用户喜欢吃川菜",
 *   type: "preference",
 *   importance: 0.7
 * });
 *
 * if (result.verdict === "PASS") {
 *   // 继续写入
 * } else if (result.verdict === "REJECT") {
 *   // 返回 result.feedbackMessage 给 Agent
 * } else if (result.verdict === "MERGE") {
 *   // 合并到 result.matchedMemory
 * }
 * ```
 */
export async function auditMemoryExtraction(
  input: AuditInput,
  config?: AuditConfig
): Promise<AuditResult> {
  const mergedConfig: Required<AuditConfig> = {
    ...DEFAULT_AUDIT_CONFIG,
    ...config,
  };

  // 1. 基础字段校验
  if (!input.content || input.content.trim().length === 0) {
    return {
      verdict: "REJECT",
      rejectReason: "missing_required_fields",
      feedbackMessage: "记忆内容不能为空，请提供有效的记忆内容。",
    };
  }

  const validTypes = ["fact", "behavior", "preference", "emotion"];
  if (!input.type || !validTypes.includes(input.type)) {
    return {
      verdict: "REJECT",
      rejectReason: "missing_required_fields",
      feedbackMessage: `记忆类型无效，必须是 ${validTypes.join("/")} 之一。`,
    };
  }

  // 2. 重要性门控
  if (!checkImportanceGate(input.importance, mergedConfig.importanceThreshold)) {
    console.log(
      `[ExtractionAudit] 拦截低重要性记忆: importance=${input.importance} < threshold=${mergedConfig.importanceThreshold}`
    );
    return {
      verdict: "REJECT",
      rejectReason: "low_importance",
      feedbackMessage:
        `记忆重要性过低（${input.importance}），未达到写入阈值（${mergedConfig.importanceThreshold}）。` +
        `请仅存储对用户有实际价值的信息。`,
    };
  }

  // 3. 去重校验 — 查询同一用户的已有记忆
  try {
    const existingMemories = await searchMemories({
      userId: input.userId,
      query: input.content,
      type: input.type,
      limit: mergedConfig.deduplicationSearchLimit,
    });

    const dupResult = checkDeduplication(
      input,
      existingMemories,
      mergedConfig.deduplicationThreshold
    );

    if (dupResult) {
      const { matchedMemory, similarityScore } = dupResult;

      // 高相似度（>= 0.8）直接拒绝，中等相似度建议合并
      if (similarityScore >= 0.8) {
        console.log(
          `[ExtractionAudit] 拦截重复记忆: similarity=${similarityScore.toFixed(2)}, ` +
            `matchedId=${matchedMemory.id}`
        );
        return {
          verdict: "REJECT",
          rejectReason: "duplicate_content",
          matchedMemory,
          similarityScore,
          feedbackMessage:
            `记忆内容与已有记忆高度重复（相似度: ${(similarityScore * 100).toFixed(0)}%，` +
            `已有记忆ID: ${matchedMemory.id}）。无需重复存储。`,
        };
      }

      // 中等相似度，建议合并
      console.log(
        `[ExtractionAudit] 建议合并记忆: similarity=${similarityScore.toFixed(2)}, ` +
          `matchedId=${matchedMemory.id}`
      );
      return {
        verdict: "MERGE",
        matchedMemory,
        similarityScore,
        feedbackMessage:
          `记忆内容与已有记忆相似（相似度: ${(similarityScore * 100).toFixed(0)}%，` +
          `已有记忆ID: ${matchedMemory.id}）。建议合并更新而非新增。`,
      };
    }
  } catch (error) {
    // 去重查询失败不应阻塞写入，记录警告后放行
    console.warn(
      "[ExtractionAudit] 去重校验查询失败，放行写入:",
      (error as Error).message
    );
  }

  // 全部通过
  return {
    verdict: "PASS",
    feedbackMessage: "审计通过，记忆可以写入。",
  };
}
