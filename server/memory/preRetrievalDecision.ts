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

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<PreRetrievalConfig> = {
  enableLLM: process.env.PRE_RETRIEVAL_ENABLE_LLM !== "false",
  llmTimeoutMs: parseInt(process.env.PRE_RETRIEVAL_LLM_TIMEOUT_MS ?? "2000", 10),
  llmModel: process.env.PRE_RETRIEVAL_LLM_MODEL ?? "",
};

// ==================== 规则层 ====================

/**
 * 闲聊模式正则表达式集合
 *
 * 匹配明显不需要记忆检索的用户输入
 */
const CHITCHAT_PATTERNS: RegExp[] = [
  // 问候语
  /^(你好|您好|hi|hello|hey|嗨|喂|早上好|下午好|晚上好|早安|午安|晚安|good\s*(morning|afternoon|evening))[\s!！。.]*$/i,
  // 感谢语
  /^(谢谢|感谢|多谢|thanks|thank\s*you|thx|3q)[\s!！。.]*$/i,
  // 告别语
  /^(再见|拜拜|bye|goodbye|晚安|see\s*you)[\s!！。.]*$/i,
  // 简短确认/回应
  /^(好的|好|嗯|嗯嗯|ok|okay|行|可以|没问题|收到|明白|了解|知道了|对|是的|没错|哦|噢)[\s!！。.]*$/i,
  // 纯表情/符号（使用 Unicode 属性转义）
  /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]+$/u,
  // 纯笑声
  /^(哈哈|呵呵|嘿嘿|嘻嘻|hiahia|haha|hehe|lol|lmao)+[\s!！。.]*$/i,
];

/**
 * 记忆相关模式正则表达式集合
 *
 * 匹配明显需要记忆检索的用户输入
 */
const MEMORY_RELATED_PATTERNS: RegExp[] = [
  // 明确的记忆查询
  /我(之前|以前|上次|昨天|前天|上周|上个月)(说|提|聊|讲|告诉)/,
  /你(还)?记得|你(还)?记不记得|你(还)?知道/,
  /我(跟你|和你)说过/,
  // 个人信息引用
  /我(住在?|在)(哪|哪里|哪儿|什么地方)/,
  /我(叫|是|名字)/,
  /我(的|是)(职业|工作|年龄|生日|电话|邮箱|地址)/,
  /我(多大|几岁|什么时候生)/,
  // 偏好引用
  /我(喜欢|爱|讨厌|不喜欢|偏好|常去|经常|最爱|最喜欢)/,
  /我(的|平时)(习惯|爱好|兴趣)/,
  // 上下文引用（需要历史对话）
  /上次(那个|那家|那位|推荐的)/,
  /之前(说的|提到的|聊的|推荐的)/,
  // 个性化请求
  /根据我的(喜好|偏好|习惯|情况)/,
  /适合我的/,
  /你(了解|知道)我/,
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
  const trimmed = userQuery.trim();

  if (!trimmed) {
    return { decision: "NO_RETRIEVE", reason: "用户输入为空" };
  }

  // 检查闲聊模式
  for (const pattern of CHITCHAT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        decision: "NO_RETRIEVE",
        reason: `规则层命中闲聊模式: ${pattern.source.substring(0, 30)}...`,
      };
    }
  }

  // 检查记忆相关模式
  for (const pattern of MEMORY_RELATED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        decision: "RETRIEVE",
        reason: `规则层命中记忆相关模式: ${pattern.source.substring(0, 30)}...`,
      };
    }
  }

  // 规则层无法确定
  return null;
}

// ==================== LLM 层 ====================

/** LLM 二分类 + 查询重写的 Prompt */
const LLM_DECISION_PROMPT = `你是一个记忆检索决策助手。请分析用户的最新消息，判断是否需要从长期记忆中检索相关信息。

## 判断标准
需要检索（RETRIEVE）：
- 用户提到了个人信息、偏好、习惯、经历
- 用户引用了之前的对话内容
- 用户的请求可以通过了解其个人背景来更好地回答
- 用户询问与自身相关的问题

不需要检索（NO_RETRIEVE）：
- 纯粹的闲聊、问候、感谢
- 通用知识问答（不涉及用户个人信息）
- 简单的工具调用请求（如"帮我算一下"、"翻译一下"）
- 纯指令性请求（不需要个性化）

## 如果需要检索
请将用户的模糊查询重写为自包含的、明确的检索查询。
重写规则：
- 解析代词引用（如"那个"→具体事物）
- 补充对话上下文中的关键信息
- 去除无关的语气词和修饰

## 输出格式（严格 JSON）
{"decision": "RETRIEVE" 或 "NO_RETRIEVE", "query": "重写后的查询（NO_RETRIEVE时为null）", "reason": "简短理由"}`;

/**
 * LLM 层二分类 + 查询重写
 *
 * 当规则层无法确定时，调用轻量 LLM 进行判断。
 *
 * @param userQuery - 用户原始输入
 * @param dialogueHistory - 最近的对话历史（用于上下文理解）
 * @param config - 配置选项
 * @returns LLM 层判断结果
 */
export async function llmBasedDecision(
  userQuery: string,
  dialogueHistory: DialogueEntry[],
  config?: PreRetrievalConfig
): Promise<{
  decision: RetrievalDecision;
  rewrittenQuery: string | null;
  reason: string;
}> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // 构建对话上下文摘要
  const contextLines = dialogueHistory
    .slice(-5)
    .map((d) => `${d.role === "user" ? "用户" : "助手"}: ${d.content}`)
    .join("\n");

  const prompt = `${LLM_DECISION_PROMPT}

## 最近对话
${contextLines || "（无历史对话）"}

## 用户最新消息
${userQuery}

请输出 JSON：`;

  try {
    const response = await Promise.race([
      callLLMText(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("LLM 超时")), mergedConfig.llmTimeoutMs)
      ),
    ]);

    // 解析 LLM 响应
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[PreRetrieval] LLM 响应无法解析为 JSON，默认 RETRIEVE");
      return {
        decision: "RETRIEVE",
        rewrittenQuery: userQuery,
        reason: "LLM 响应格式异常，保守选择 RETRIEVE",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const decision: RetrievalDecision =
      parsed.decision === "NO_RETRIEVE" ? "NO_RETRIEVE" : "RETRIEVE";
    const rewrittenQuery =
      decision === "RETRIEVE" ? (parsed.query || userQuery) : null;

    return {
      decision,
      rewrittenQuery,
      reason: parsed.reason || "LLM 判断",
    };
  } catch (error) {
    console.warn(
      "[PreRetrieval] LLM 调用失败，保守选择 RETRIEVE:",
      (error as Error).message
    );
    return {
      decision: "RETRIEVE",
      rewrittenQuery: userQuery,
      reason: `LLM 调用失败: ${(error as Error).message}，保守选择 RETRIEVE`,
    };
  }
}

// ==================== 查询重写（独立调用） ====================

/** 独立查询重写的 Prompt */
const QUERY_REWRITE_PROMPT = `你是一个查询重写助手。请将用户的模糊查询重写为自包含的、适合记忆检索的明确查询。

重写规则：
1. 解析代词引用（如"那个"→具体事物，根据对话上下文推断）
2. 补充对话上下文中的关键信息
3. 去除无关的语气词和修饰
4. 保持简洁，只输出重写后的查询文本，不要任何解释

如果查询已经足够明确，直接返回原始查询。`;

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
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // 如果没有对话历史，查询可能已经足够明确
  if (dialogueHistory.length === 0) {
    return userQuery;
  }

  const contextLines = dialogueHistory
    .slice(-5)
    .map((d) => `${d.role === "user" ? "用户" : "助手"}: ${d.content}`)
    .join("\n");

  const prompt = `${QUERY_REWRITE_PROMPT}

最近对话：
${contextLines}

用户最新查询：${userQuery}

重写后的查询：`;

  try {
    const response = await Promise.race([
      callLLMText(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("LLM 超时")), mergedConfig.llmTimeoutMs)
      ),
    ]);

    const rewritten = response.trim();
    if (rewritten && rewritten.length > 0 && rewritten.length < 500) {
      return rewritten;
    }
    return userQuery;
  } catch (error) {
    console.warn(
      "[PreRetrieval] 查询重写失败，使用原始查询:",
      (error as Error).message
    );
    return userQuery;
  }
}

// ==================== 主入口 ====================

/**
 * 执行 Pre-Retrieval Decision（主入口函数）
 *
 * 完整的决策流程：
 * 1. 规则层快速判断 → 若命中 NO_RETRIEVE，直接返回
 * 2. 规则层命中 RETRIEVE → 调用查询重写后返回
 * 3. 规则层不确定 → LLM 层二分类 + 查询重写
 * 4. LLM 层禁用 → 保守选择 RETRIEVE
 *
 * @param userQuery - 用户原始输入
 * @param dialogueHistory - 最近的对话历史（建议最近 5 轮）
 * @param config - 配置选项
 * @returns 完整的决策结果
 */
export async function makePreRetrievalDecision(
  userQuery: string,
  dialogueHistory: DialogueEntry[],
  config?: PreRetrievalConfig
): Promise<PreRetrievalResult> {
  const startTime = Date.now();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // 1. 规则层快速判断
  const ruleResult = ruleBasedDecision(userQuery);

  if (ruleResult) {
    if (ruleResult.decision === "NO_RETRIEVE") {
      // 闲聊 → 直接返回，无需检索
      return {
        decision: "NO_RETRIEVE",
        source: "rule",
        rewrittenQuery: null,
        reason: ruleResult.reason,
        durationMs: Date.now() - startTime,
      };
    }

    // 规则层判定 RETRIEVE → 尝试查询重写
    let rewrittenQuery: string | null = null;
    if (mergedConfig.enableLLM) {
      try {
        rewrittenQuery = await rewriteQuery(
          userQuery,
          dialogueHistory,
          mergedConfig
        );
      } catch {
        // 重写失败不影响检索决策
      }
    }

    return {
      decision: "RETRIEVE",
      source: "rule",
      rewrittenQuery: rewrittenQuery || userQuery,
      reason: ruleResult.reason,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. 规则层不确定 → LLM 层
  if (mergedConfig.enableLLM) {
    const llmResult = await llmBasedDecision(
      userQuery,
      dialogueHistory,
      mergedConfig
    );

    return {
      decision: llmResult.decision,
      source: "llm",
      rewrittenQuery: llmResult.rewrittenQuery,
      reason: llmResult.reason,
      durationMs: Date.now() - startTime,
    };
  }

  // 3. LLM 层禁用 → 保守选择 RETRIEVE
  return {
    decision: "RETRIEVE",
    source: "rule",
    rewrittenQuery: userQuery,
    reason: "规则层不确定且 LLM 层禁用，保守选择 RETRIEVE",
    durationMs: Date.now() - startTime,
  };
}
