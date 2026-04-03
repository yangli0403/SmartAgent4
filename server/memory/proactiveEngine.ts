/**
 * Proactive Engine — 意图预测引擎（第四轮迭代新增）
 *
 * 基于用户的长期记忆、行为模式和最近对话，预测用户下一次可能的意图，
 * 并提前执行记忆检索（预取），将结果存入 PrefetchCache。
 *
 * 由 memoryCron.ts 定期触发（每 2 小时），仅对开启 proactiveService 的活跃用户执行。
 *
 * 设计原则：
 * - 后台异步执行，不影响前台对话性能
 * - 仅对近 24 小时有活跃会话的用户执行预测，节省 LLM 成本
 * - 预测结果带 TTL，过期自动失效
 */

import { eq, desc, sql, gt } from "drizzle-orm";
import { getDb } from "../db";
import { getUserPreferences, getRecentConversations } from "../db";
import {
  users,
  conversations,
  type Conversation,
} from "../../drizzle/schema";
import { searchMemories, getUserProfileSnapshot } from "./memorySystem";
import { getUserPatterns } from "./behaviorDetector";
import { formatMemoriesForContext } from "./profileBuilder";
import {
  getPrefetchCache,
  PREFETCH_TTL,
  type PredictedIntent,
  type PrefetchCacheEntry,
} from "./prefetchCache";
import { callLLMText } from "../llm/langchainAdapter";

// ==================== 配置 ====================

/** 预测周期间隔（毫秒），默认 2 小时 */
export const PREDICTION_INTERVAL = 2 * 60 * 60 * 1000;

/** 活跃用户判定窗口（毫秒），默认 24 小时 */
const ACTIVE_WINDOW = 24 * 60 * 60 * 1000;

/** 预测时使用的最近对话数量 */
const RECENT_CONVERSATIONS_LIMIT = 30;

/** 预取时检索的记忆数量 */
const PREFETCH_MEMORY_LIMIT = 15;

// ==================== LLM Prompt ====================

const INTENT_PREDICTION_PROMPT = `你是一个用户意图预测专家。基于以下用户信息，预测该用户下一次与 AI 助手交互时最可能的需求。

## 输出格式（严格 JSON）
{
  "intent": "预测的意图描述",
  "confidence": 0.0-1.0,
  "suggestedQueries": ["用于检索相关记忆的查询1", "查询2"],
  "reasoning": "推理过程"
}

## 注意事项
- 基于行为模式和最近对话推断，不要凭空猜测
- suggestedQueries 应该是能从记忆系统中检索到有用信息的查询（2-4 个）
- 如果信息不足以做出有意义的预测，将 confidence 设为 0
- intent 应该是具体可操作的描述，而非泛泛的猜测
- 请只输出 JSON，不要包含其他文字`;

// ==================== 核心功能 ====================

/**
 * 为指定用户预测下一步意图
 */
export async function predictIntent(
  userId: number
): Promise<PredictedIntent | null> {
  try {
    // 1. 检查 proactiveService 开关
    const prefs = await getUserPreferences(userId);
    if (!prefs || prefs.proactiveService !== "enabled") {
      console.log(
        `[ProactiveEngine] Skipping user ${userId}: proactiveService disabled`
      );
      return null;
    }

    // 2. 获取最近对话
    const recentConversations = await getRecentConversations(
      userId,
      RECENT_CONVERSATIONS_LIMIT
    );
    if (recentConversations.length === 0) {
      console.log(
        `[ProactiveEngine] Skipping user ${userId}: no recent conversations`
      );
      return null;
    }

    // 3. 获取行为模式
    const patterns = await getUserPatterns(userId, 10);

    // 4. 获取用户画像
    const profile = await getUserProfileSnapshot(userId);

    // 5. 构建 LLM 输入
    const inputParts: string[] = [];

    // 用户画像
    inputParts.push(`## 用户画像`);
    if (profile.displayName) {
      inputParts.push(`- 称呼: ${profile.displayName}`);
    }
    if (profile.activePreferences.length > 0) {
      inputParts.push(`- 偏好: ${profile.activePreferences.map((p) => `${p.key}=${p.value}`).join(", ")}`);
    }

    // 行为模式
    if (patterns.length > 0) {
      inputParts.push(`\n## 行为模式`);
      for (const p of patterns) {
        inputParts.push(
          `- [${p.patternType}] ${p.description} (置信度=${p.confidence.toFixed(2)}, 频次=${p.frequency})`
        );
      }
    }

    // 最近对话
    inputParts.push(`\n## 最近对话（最新 ${recentConversations.length} 条）`);
    for (const conv of recentConversations.slice(-20)) {
      const content =
        conv.content.length > 200
          ? conv.content.substring(0, 200) + "..."
          : conv.content;
      inputParts.push(`${conv.role}: ${content}`);
    }

    // 当前时间上下文
    inputParts.push(`\n## 当前时间`);
    inputParts.push(new Date().toISOString());

    const analysisInput = inputParts.join("\n");

    // 6. 调用 LLM 预测
    const response = await callLLMText(
      INTENT_PREDICTION_PROMPT,
      analysisInput,
      { temperature: 0.3 }
    );

    // 7. 解析预测结果
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(
        `[ProactiveEngine] Failed to parse prediction for user ${userId}`
      );
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]);

    // 验证
    if (
      typeof raw.confidence !== "number" ||
      raw.confidence < 0.3 ||
      !raw.intent ||
      !Array.isArray(raw.suggestedQueries)
    ) {
      console.log(
        `[ProactiveEngine] Low confidence or invalid prediction for user ${userId}: ${raw.confidence}`
      );
      return null;
    }

    const now = new Date();
    const predicted: PredictedIntent = {
      userId,
      intent: raw.intent,
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      suggestedQueries: raw.suggestedQueries.slice(0, 4),
      reasoning: raw.reasoning || "",
      predictedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PREFETCH_TTL).toISOString(),
    };

    console.log(
      `[ProactiveEngine] Predicted intent for user ${userId}: ` +
        `"${predicted.intent.substring(0, 60)}" (conf=${predicted.confidence.toFixed(2)})`
    );

    return predicted;
  } catch (error) {
    console.error(
      `[ProactiveEngine] Prediction failed for user ${userId}:`,
      (error as Error).message
    );
    return null;
  }
}

/**
 * 根据预测意图预取记忆上下文
 */
async function prefetchContext(
  userId: number,
  predicted: PredictedIntent
): Promise<void> {
  try {
    // 使用 suggestedQueries 执行 hybridSearch
    const allMemories: any[] = [];

    for (const query of predicted.suggestedQueries) {
      const results = await searchMemories({
        userId,
        query,
        limit: PREFETCH_MEMORY_LIMIT,
        minImportance: 0.3,
        useHybridSearch: false, // 使用基础文本搜索，避免向量计算开销
      });
      allMemories.push(...results);
    }

    // 去重（按 id）
    const uniqueMemories = Array.from(
      new Map(allMemories.map((m) => [m.id, m])).values()
    );

    if (uniqueMemories.length === 0) {
      console.log(
        `[ProactiveEngine] No memories found for prefetch (user ${userId})`
      );
      return;
    }

    // 格式化上下文
    const formattedContext = formatMemoriesForContext(
      uniqueMemories,
      2000
    );

    // 写入缓存
    const now = Date.now();
    const cacheEntry: PrefetchCacheEntry = {
      userId,
      predictedIntent: predicted,
      prefetchedMemories: uniqueMemories,
      formattedContext,
      createdAt: now,
      expiresAt: now + PREFETCH_TTL,
    };

    const cache = getPrefetchCache();
    cache.set(cacheEntry);

    console.log(
      `[ProactiveEngine] Prefetched ${uniqueMemories.length} memories for user ${userId}`
    );
  } catch (error) {
    console.error(
      `[ProactiveEngine] Prefetch failed for user ${userId}:`,
      (error as Error).message
    );
  }
}

/**
 * 获取近期活跃用户 ID 列表
 */
async function getActiveUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW);

    // 查询在活跃窗口内有对话的用户
    const activeUsers = await db
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(gt(conversations.createdAt, cutoff))
      .groupBy(conversations.userId);

    return activeUsers.map((u) => u.userId);
  } catch (error) {
    console.error(
      "[ProactiveEngine] Failed to get active users:",
      (error as Error).message
    );
    return [];
  }
}

/**
 * 执行一轮完整的预测周期（遍历所有活跃用户）
 *
 * 由 memoryCron.ts 定期调用。
 */
export async function runPredictionCycle(): Promise<void> {
  console.log("[ProactiveEngine] Starting prediction cycle...");

  const activeUserIds = await getActiveUserIds();
  if (activeUserIds.length === 0) {
    console.log("[ProactiveEngine] No active users, skipping cycle");
    return;
  }

  console.log(
    `[ProactiveEngine] Processing ${activeUserIds.length} active users`
  );

  let predictedCount = 0;
  let prefetchedCount = 0;

  for (const userId of activeUserIds) {
    try {
      const predicted = await predictIntent(userId);
      if (predicted) {
        predictedCount++;
        await prefetchContext(userId, predicted);
        prefetchedCount++;
      }
    } catch (error) {
      console.error(
        `[ProactiveEngine] Error processing user ${userId}:`,
        (error as Error).message
      );
    }
  }

  const cache = getPrefetchCache();
  const stats = cache.getStats();

  console.log(
    `[ProactiveEngine] Cycle complete: ` +
      `${predictedCount}/${activeUserIds.length} predicted, ` +
      `${prefetchedCount} prefetched, ` +
      `cache size=${stats.size}`
  );
}

/**
 * 手动触发：为指定用户执行意图预测 + 记忆预取（与定时任务中的单用户逻辑一致）。
 * 若未开启 proactiveService、无近期对话或置信度不足，会返回 ok:false。
 */
export async function runPredictionAndPrefetchForUser(
  userId: number
): Promise<{ ok: boolean; message: string }> {
  const predicted = await predictIntent(userId);
  if (!predicted) {
    return {
      ok: false,
      message:
        "未执行预测/预取（需开启 proactiveService、有近期对话且模型置信度足够）",
    };
  }
  await prefetchContext(userId, predicted);
  return {
    ok: true,
    message: `已预测并预取：${predicted.intent.slice(0, 120)}`,
  };
}

// ==================== 单例导出 ====================

let engineStarted = false;

/**
 * 获取引擎状态
 */
export function isEngineStarted(): boolean {
  return engineStarted;
}

/**
 * 标记引擎已启动
 */
export function markEngineStarted(): void {
  engineStarted = true;
}
