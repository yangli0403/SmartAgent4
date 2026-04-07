/**
 * 补漏提取服务
 *
 * 在做梦机制（DreamGatekeeper）触发时，对最近未被 Agent 主动记录的
 * 对话进行批量回溯提取。作为 MemoryWorkerManager 的执行器注入。
 *
 * 工作流程：
 * 1. 查询最近 N 轮未被提取的对话（工作记忆中的对话历史）
 * 2. 调用 LLM 提取管道进行批量提取
 * 3. 与已有记忆去重校验
 * 4. 通过 addMemory（含 Embedding 生成）写入新记忆
 *
 * @module backfillExtraction
 */

import type { Memory } from "../../drizzle/schema";
import type {
  MemoryWorkerRequest,
  MemoryWorkerResponse,
} from "./worker/types";
import {
  addMemory,
  searchMemories,
  getWorkingMemory,
} from "./memorySystem";
import { callLLMText } from "../llm/langchainAdapter";

// ==================== 类型定义 ====================

/** 补漏提取配置 */
export interface BackfillConfig {
  /** 回溯的最大对话轮数（默认 20） */
  maxTurnsToBackfill?: number;
  /** 去重 Jaccard 阈值（默认 0.6） */
  deduplicationThreshold?: number;
  /** 单次提取的最大记忆条数（默认 10） */
  maxMemoriesPerExtraction?: number;
  /** LLM 调用超时时间（毫秒，默认 10000） */
  llmTimeoutMs?: number;
}

/** 补漏提取结果 */
export interface BackfillResult {
  /** 提取出的新记忆条数 */
  extractedCount: number;
  /** 被去重过滤的条数 */
  deduplicatedCount: number;
  /** 成功写入的条数 */
  writtenCount: number;
  /** 失败的条数 */
  failedCount: number;
  /** 提取的记忆 ID 列表 */
  memoryIds: number[];
  /** 总耗时（毫秒） */
  durationMs: number;
}

/** 从对话中提取的原始记忆候选 */
export interface ExtractedMemoryCandidate {
  /** 记忆内容 */
  content: string;
  /** 记忆类型 */
  type: "fact" | "behavior" | "preference" | "emotion";
  /** 记忆大类 */
  kind: "episodic" | "semantic" | "persona";
  /** 重要性分数 */
  importance: number;
  /** 置信度 */
  confidence: number;
  /** 版本分组 */
  versionGroup?: string;
  /** 标签 */
  tags?: string[];
}

// ==================== 默认配置 ====================

const DEFAULT_BACKFILL_CONFIG: Required<BackfillConfig> = {
  maxTurnsToBackfill: parseInt(
    process.env.BACKFILL_MAX_TURNS ?? "20",
    10
  ),
  deduplicationThreshold: parseFloat(
    process.env.BACKFILL_DEDUP_THRESHOLD ?? "0.6"
  ),
  maxMemoriesPerExtraction: parseInt(
    process.env.BACKFILL_MAX_MEMORIES ?? "10",
    10
  ),
  llmTimeoutMs: parseInt(
    process.env.BACKFILL_LLM_TIMEOUT_MS ?? "10000",
    10
  ),
};

// ==================== LLM 提取 Prompt ====================

const BACKFILL_EXTRACTION_PROMPT = `你是一个记忆提取专家。请从以下对话历史中提取出有价值的个人信息和事实。

提取规则：
1. 只提取明确表达的事实和偏好，不推测
2. 每条记忆应是独立的、完整的陈述
3. 优先提取：个人信息（姓名、职业、住址等）、偏好（饮食、出行等）、重要事件
4. 忽略：闲聊、问候、系统指令、重复信息

输出格式：JSON 数组，每个元素包含：
- content: 记忆内容（完整的陈述句）
- type: "fact" | "behavior" | "preference" | "emotion"
- kind: "episodic" | "semantic" | "persona"
- importance: 0.0-1.0（重要程度）
- confidence: 0.0-1.0（确定程度）
- tags: 标签数组（可选）

如果没有值得提取的信息，返回空数组 []。`;

// ==================== 工具函数 ====================

/**
 * 计算两个字符串的 Jaccard 相似度（基于字符级 bigram）
 */
function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const getBigrams = (str: string): Set<string> => {
    const normalized = str.toLowerCase().replace(/\s+/g, "");
    const bigrams = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) {
      bigrams.add(normalized.substring(i, i + 2));
    }
    return bigrams;
  };

  const setA = getBigrams(a);
  const setB = getBigrams(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const bigram of setA) {
    if (setB.has(bigram)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ==================== 核心函数 ====================

/**
 * 从对话历史中提取记忆候选
 *
 * 调用 LLM 分析对话内容，提取出有价值的个人信息。
 *
 * @param conversations - 对话历史（role + content 数组）
 * @param config - 配置选项
 * @returns 提取出的记忆候选列表
 */
export async function extractMemoryCandidates(
  conversations: Array<{ role: string; content: string }>,
  config?: BackfillConfig
): Promise<ExtractedMemoryCandidate[]> {
  const mergedConfig = { ...DEFAULT_BACKFILL_CONFIG, ...config };

  if (conversations.length === 0) return [];

  // 截取最近 N 轮对话
  const recentConversations = conversations.slice(
    -mergedConfig.maxTurnsToBackfill * 2
  );

  const conversationText = recentConversations
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const userMessage = `对话内容：\n${conversationText}\n\n请提取记忆（JSON 数组格式）：`;

  try {
    const response = await callLLMText(
      BACKFILL_EXTRACTION_PROMPT,
      userMessage,
      { temperature: 0.1 }
    );

    // 解析 JSON 响应
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[BackfillExtraction] LLM 未返回有效 JSON");
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // 校验和规范化每条记忆
    const validTypes = ["fact", "behavior", "preference", "emotion"];
    const validKinds = ["episodic", "semantic", "persona"];

    const candidates: ExtractedMemoryCandidate[] = parsed
      .filter(
        (item: any) =>
          item &&
          typeof item.content === "string" &&
          item.content.trim().length > 0
      )
      .slice(0, mergedConfig.maxMemoriesPerExtraction)
      .map((item: any) => ({
        content: item.content.trim(),
        type: validTypes.includes(item.type) ? item.type : "fact",
        kind: validKinds.includes(item.kind) ? item.kind : "semantic",
        importance: Math.max(
          0,
          Math.min(1, Number(item.importance) || 0.5)
        ),
        confidence: Math.max(
          0,
          Math.min(1, Number(item.confidence) || 0.7)
        ),
        versionGroup: item.versionGroup || undefined,
        tags: Array.isArray(item.tags) ? item.tags : undefined,
      }));

    console.log(
      `[BackfillExtraction] LLM 提取到 ${candidates.length} 条候选记忆`
    );
    return candidates;
  } catch (error) {
    console.error(
      "[BackfillExtraction] LLM 提取失败:",
      (error as Error).message
    );
    return [];
  }
}

/**
 * 对提取的候选记忆进行去重校验
 *
 * 将候选记忆与已有记忆进行 Jaccard 相似度比对，
 * 过滤掉与已有记忆高度重复的候选。
 *
 * @param candidates - 提取出的记忆候选列表
 * @param existingMemories - 同一用户的已有记忆列表
 * @param threshold - 去重阈值
 * @returns 去重后的候选列表
 */
export function deduplicateCandidates(
  candidates: ExtractedMemoryCandidate[],
  existingMemories: Memory[],
  threshold?: number
): ExtractedMemoryCandidate[] {
  const deduplicationThreshold =
    threshold ?? DEFAULT_BACKFILL_CONFIG.deduplicationThreshold;

  if (existingMemories.length === 0) return [...candidates];

  return candidates.filter((candidate) => {
    for (const existing of existingMemories) {
      const similarity = jaccardSimilarity(
        candidate.content,
        existing.content
      );
      if (similarity >= deduplicationThreshold) {
        console.log(
          `[BackfillExtraction] 去重过滤: "${candidate.content.substring(0, 40)}..." ` +
            `与已有记忆 ID:${existing.id} 相似度 ${similarity.toFixed(2)} >= ${deduplicationThreshold}`
        );
        return false;
      }
    }
    return true;
  });
}

/**
 * 执行补漏提取（主入口函数）
 *
 * 完整的补漏提取流程：
 * 1. 获取用户最近的工作记忆（对话历史）
 * 2. 调用 LLM 提取记忆候选
 * 3. 查询已有记忆，执行去重校验
 * 4. 通过 addMemory 写入通过校验的记忆（含 Embedding 生成）
 *
 * @param userId - 目标用户 ID
 * @param config - 可选的补漏配置
 * @returns 补漏提取结果
 */
export async function executeBackfillExtraction(
  userId: number,
  config?: BackfillConfig
): Promise<BackfillResult> {
  const startTime = Date.now();
  const mergedConfig = { ...DEFAULT_BACKFILL_CONFIG, ...config };

  const result: BackfillResult = {
    extractedCount: 0,
    deduplicatedCount: 0,
    writtenCount: 0,
    failedCount: 0,
    memoryIds: [],
    durationMs: 0,
  };

  try {
    // 1. 获取工作记忆中的对话历史
    // 尝试从所有可能的 sessionId 获取（做梦时可能没有活跃 session）
    const workingMemoryData = getWorkingMemory(userId, "default");
    const conversations: Array<{ role: string; content: string }> =
      workingMemoryData?.messages || [];

    if (conversations.length < 2) {
      console.log(
        `[BackfillExtraction] 用户 ${userId} 对话历史不足（${conversations.length} 条），跳过补漏`
      );
      result.durationMs = Date.now() - startTime;
      return result;
    }

    console.log(
      `[BackfillExtraction] 开始补漏提取: userId=${userId}, ` +
        `对话轮数=${Math.floor(conversations.length / 2)}`
    );

    // 2. 调用 LLM 提取记忆候选
    const candidates = await extractMemoryCandidates(
      conversations,
      mergedConfig
    );
    result.extractedCount = candidates.length;

    if (candidates.length === 0) {
      console.log(
        `[BackfillExtraction] 用户 ${userId} 未提取到候选记忆`
      );
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // 3. 查询已有记忆，执行去重
    const existingMemories = await searchMemories({
      userId,
      limit: 200,
      minImportance: 0,
    });

    const deduplicated = deduplicateCandidates(
      candidates,
      existingMemories,
      mergedConfig.deduplicationThreshold
    );
    result.deduplicatedCount = candidates.length - deduplicated.length;

    // 4. 逐条写入通过校验的记忆
    for (const candidate of deduplicated) {
      try {
        const saved = await addMemory({
          userId,
          content: candidate.content,
          type: candidate.type,
          kind: candidate.kind,
          importance: candidate.importance,
          confidence: candidate.confidence,
          tags: candidate.tags || null,
          source: "backfill",
          versionGroup: candidate.versionGroup,
        });

        if (saved) {
          result.writtenCount++;
          result.memoryIds.push(saved.id);
        } else {
          result.failedCount++;
        }
      } catch (error) {
        console.error(
          `[BackfillExtraction] 写入失败: "${candidate.content.substring(0, 40)}..."`,
          (error as Error).message
        );
        result.failedCount++;
      }
    }

    result.durationMs = Date.now() - startTime;

    console.log(
      `[BackfillExtraction] 补漏完成: userId=${userId}, ` +
        `提取=${result.extractedCount}, 去重=${result.deduplicatedCount}, ` +
        `写入=${result.writtenCount}, 失败=${result.failedCount}, ` +
        `耗时=${result.durationMs}ms`
    );

    return result;
  } catch (error) {
    console.error(
      `[BackfillExtraction] 补漏提取异常: userId=${userId}`,
      (error as Error).message
    );
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

/**
 * 创建 MemoryWorkerManager 兼容的执行器
 *
 * 将 executeBackfillExtraction 封装为 MemoryWorkerManager 的
 * TaskExecutor 接口，使其可以被做梦机制调用。
 *
 * @param config - 可选的补漏配置
 * @returns TaskExecutor 兼容的异步函数
 *
 * @example
 * ```typescript
 * import { createBackfillExecutor } from "./backfillExtraction";
 *
 * const executor = createBackfillExecutor();
 * initMemoryWorkerManager(config, executor);
 * ```
 */
export function createBackfillExecutor(
  config?: BackfillConfig
): (request: MemoryWorkerRequest) => Promise<MemoryWorkerResponse> {
  return async (
    request: MemoryWorkerRequest
  ): Promise<MemoryWorkerResponse> => {
    const startTime = Date.now();

    try {
      const backfillResult = await executeBackfillExtraction(
        request.userId,
        config
      );

      return {
        taskId: request.taskId,
        success: true,
        result: {
          type: "consolidate",
          clustersCreated: 0,
          memoriesConsolidated: backfillResult.writtenCount,
          semanticMemoriesCreated: backfillResult.writtenCount,
        },
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        taskId: request.taskId,
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    }
  };
}
