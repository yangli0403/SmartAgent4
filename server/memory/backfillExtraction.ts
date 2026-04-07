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
  MemoryWorkerTaskType,
} from "./worker/types";

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

// ==================== 核心函数 ====================

/**
 * 从对话历史中提取记忆候选
 *
 * 调用 LLM 分析对话内容，提取出有价值的个人信息。
 * 复用现有 memorySystem.ts 中的提取 Prompt 模板。
 *
 * @param conversations - 对话历史（role + content 数组）
 * @param config - 配置选项
 * @returns 提取出的记忆候选列表
 */
export async function extractMemoryCandidates(
  conversations: Array<{ role: string; content: string }>,
  config?: BackfillConfig
): Promise<ExtractedMemoryCandidate[]> {
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
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
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
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
 *
 * @example
 * ```typescript
 * const result = await executeBackfillExtraction(userId);
 * console.log(
 *   `提取: ${result.extractedCount}, ` +
 *   `去重: ${result.deduplicatedCount}, ` +
 *   `写入: ${result.writtenCount}`
 * );
 * ```
 */
export async function executeBackfillExtraction(
  userId: number,
  config?: BackfillConfig
): Promise<BackfillResult> {
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
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
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
}
