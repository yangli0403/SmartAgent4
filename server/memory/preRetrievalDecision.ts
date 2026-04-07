/**
 * Pre-Retrieval Decision — 检索前决策服务
 *
 * 在 contextEnrichNode 执行记忆检索之前，快速判断当前用户查询
 * 是否需要触发记忆检索。采用"规则 + 轻量 LLM"混合路径：
 * - 规则层：正则匹配明确的闲聊模式，零延迟判断
 * - LLM 层：对不确定的查询调用轻量模型做二分类 + 查询重写
 *
 * 设计决策参考：MEMORY_OPTIMIZATION_ARCHITECTURE.md 决策 2、3
 *
 * @module preRetrievalDecision
 */

import { callLLMText } from "../llm/langchainAdapter";

// ==================== 类型定义 ====================

/** 检索决策结果 */
export type RetrievalDecision = "RETRIEVE" | "NO_RETRIEVE";

/** 决策来源 */
export type DecisionSource = "rule" | "llm";

/** Pre-Retrieval Decision 的完整输出 */
export interface PreRetrievalResult {
  /** 检索决策：是否需要触发记忆检索 */
  decision: RetrievalDecision;
  /** 决策来源：规则层还是 LLM 层 */
  source: DecisionSource;
  /** 重写后的查询（仅在 decision=RETRIEVE 时有值） */
  rewrittenQuery: string | null;
  /** 决策理由（用于日志和调试） */
  reason: string;
  /** 决策耗时（毫秒） */
  durationMs: number;
}

/** 对话历史条目（用于查询重写的上下文） */
export interface DialogueEntry {
  role: "user" | "assistant";
  content: string;
}

/** Pre-Retrieval Decision 配置 */
export interface PreRetrievalConfig {
  /** 是否启用 LLM 层（默认 true，设为 false 则仅使用规则层） */
  enableLLM?: boolean;
  /** LLM 调用超时时间（毫秒，默认 2000） */
  llmTimeoutMs?: number;
  /** LLM 模型名称（默认使用 langchainAdapter 的默认模型） */
  llmModel?: string;
}

// ==================== 规则层 ====================

/**
 * 闲聊模式正则表达式集合
 *
 * 匹配明显不需要记忆检索的用户输入，如：
 * - 问候语（你好、早上好）
 * - 感谢语（谢谢、感谢）
 * - 纯表情/符号
 * - 简短确认（好的、嗯、OK）
 */
const CHITCHAT_PATTERNS: RegExp[] = [
  // TODO: 第4阶段实现 — 填充闲聊模式正则
];

/**
 * 记忆相关模式正则表达式集合
 *
 * 匹配明显需要记忆检索的用户输入，如：
 * - 明确的记忆查询（"我之前说过"、"你还记得"）
 * - 个人信息引用（"我住在哪"、"我叫什么"）
 * - 偏好引用（"我喜欢的"、"我常去的"）
 */
const MEMORY_RELATED_PATTERNS: RegExp[] = [
  // TODO: 第4阶段实现 — 填充记忆相关模式正则
];

/**
 * 规则层快速判断
 *
 * 对用户输入进行正则匹配，快速判断明确的闲聊或记忆查询场景。
 * 若规则层无法确定，返回 null 表示需要 LLM 层介入。
 *
 * @param userQuery - 用户原始输入
 * @returns 规则层判断结果，null 表示不确定
 */
export function ruleBasedDecision(
  userQuery: string
): { decision: RetrievalDecision; reason: string } | null {
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
}

// ==================== LLM 层 ====================

/**
 * LLM 层二分类 + 查询重写
 *
 * 当规则层无法确定时，调用轻量 LLM 进行：
 * 1. 二分类：判断用户查询是否需要记忆检索
 * 2. 查询重写：若需要检索，将模糊查询重写为自包含的明确查询
 *
 * 两个任务在同一次 LLM 调用中完成（设计决策 3）。
 *
 * @param userQuery - 用户原始输入
 * @param dialogueHistory - 最近的对话历史（用于上下文理解）
 * @param config - 配置选项
 * @returns LLM 层判断结果，包含决策和重写查询
 */
export async function llmBasedDecision(
  userQuery: string,
  dialogueHistory: DialogueEntry[],
  config?: PreRetrievalConfig
): Promise<{ decision: RetrievalDecision; rewrittenQuery: string | null; reason: string }> {
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
}

// ==================== 查询重写（独立调用） ====================

/**
 * 独立的查询重写
 *
 * 当规则层已判定为 RETRIEVE（无 LLM 调用）时，
 * 需要单独调用一次轻量 LLM 进行查询重写。
 *
 * @param userQuery - 用户原始输入
 * @param dialogueHistory - 最近的对话历史
 * @param config - 配置选项
 * @returns 重写后的查询，失败时返回原始查询
 */
export async function rewriteQuery(
  userQuery: string,
  dialogueHistory: DialogueEntry[],
  config?: PreRetrievalConfig
): Promise<string> {
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
}

// ==================== 主入口 ====================

/**
 * 执行 Pre-Retrieval Decision（主入口函数）
 *
 * 完整的决策流程：
 * 1. 规则层快速判断 → 若命中，直接返回
 * 2. LLM 层二分类 + 查询重写 → 若启用
 * 3. 若规则层判定 RETRIEVE 但无重写，单独调用查询重写
 *
 * @param userQuery - 用户原始输入
 * @param dialogueHistory - 最近的对话历史（建议最近 5 轮）
 * @param config - 配置选项
 * @returns 完整的决策结果
 *
 * @example
 * ```typescript
 * const result = await makePreRetrievalDecision(
 *   "上次那家餐厅叫什么来着？",
 *   [
 *     { role: "user", content: "帮我推荐个好吃的火锅店" },
 *     { role: "assistant", content: "推荐海底捞..." }
 *   ]
 * );
 * if (result.decision === "RETRIEVE") {
 *   const query = result.rewrittenQuery || userQuery;
 *   // 使用 query 进行记忆检索
 * }
 * ```
 */
export async function makePreRetrievalDecision(
  userQuery: string,
  dialogueHistory: DialogueEntry[],
  config?: PreRetrievalConfig
): Promise<PreRetrievalResult> {
  // TODO: 第4阶段实现
  throw new Error("Not implemented");
}
