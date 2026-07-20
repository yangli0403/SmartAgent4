/**
 * Context Enrich Node — 上下文增强节点
 *
 * 在 Supervisor 图的 classifyNode 之前执行，负责：
 * 1. 从记忆系统检索相关记忆
 * 2. 构建用户画像快照
 * 3. 通过 PersonalityEngine 构建动态 System Prompt
 * 4. 将增强后的上下文写入 SupervisorState
 *
 * 这是 SmartAgent3 新增的核心节点，实现了"越用越懂你"的个性化能力。
 *
 * 记忆注入：
 * - 长期记忆按用户维度存储，新建会话时也应根据当前问题检索并注入，否则「从公司回家」等
 *   首条消息无法看到住址/公司事实（与 Cockpit 记忆卡片不一致）。
 * - 仍用 messages 长度记录 isNewSession，仅用于日志与观测。
 */

import type { SupervisorStateType } from "./state";
import { HumanMessage } from "@langchain/core/messages";
import {
  getUserProfileSnapshot,
  getFormattedMemoryContext,
} from "../../memory/memorySystem";
import { getPersonalityEngine } from "../../personality/personalityEngine";
import {
  getEmotionTagInstructions,
  getCompactEmotionTagInstructions,
} from "../../emotions/emotionTagInstructions";
import { getEmotionsClient } from "../../emotions/emotionsClient";
import { getPrefetchCache } from "../../memory/prefetchCache";
import {
  extractDialogueSlotsFromMessages,
  mergeDialogueSlotsWithLocationCity,
} from "./dialogueSlots";
import {
  makePreRetrievalDecision,
  type DialogueEntry,
} from "../../memory/preRetrievalDecision";
import { generateEmbedding } from "../../memory/embeddingService";

/**
 * 上下文增强节点
 *
 * 在每次对话开始时执行，为后续节点准备增强的上下文信息。
 */
export async function contextEnrichNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[ContextEnrichNode] Enriching context...");

  const { messages, context, characterId } = state;

  // 提取用户最新消息
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m instanceof HumanMessage || m._getType() === "human");

  const userText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage?.content || "");

  // 获取用户 ID（从 context 中提取）
  const userId = context?.userId ? parseInt(context.userId, 10) : 0;

  if (!userId) {
    console.warn("[ContextEnrichNode] No userId available, skipping enrichment");
    const extractedSlots = extractDialogueSlotsFromMessages(messages);
    const dialogueSlots = mergeDialogueSlotsWithLocationCity(
      extractedSlots,
      context?.location?.city
    );
    return dialogueSlots ? { dialogueSlots } : {};
  }

  // === 判断是否为新建会话 ===
  // messages 中只有 1 条消息（当前用户消息），说明没有历史对话，是新会话
  const humanMessages = messages.filter(
    (m) => m instanceof HumanMessage || m._getType() === "human"
  );
  const isNewSession = humanMessages.length <= 1;

  if (isNewSession) {
    console.log(
      "[ContextEnrichNode] New session (first turn): still retrieving long-term memories for user"
    );
  }

  try {
    // === 第九轮迭代新增 v1.3：消费 preAnalysisNode 输出 ===
    // preAnalysisResult 由前置 preAnalysisNode 填充，含 4 路流水线产物（prefetch/rule/llm）
    const preAnalysis = state.preAnalysisResult;
    if (preAnalysis) {
      console.log(
        `[ContextEnrichNode] preAnalysis input: source=${preAnalysis.source}, ` +
          `schemaVersion=${preAnalysis.schemaVersion}, ` +
          `memoryRelevant=${preAnalysis.memoryRelevant}, ` +
          `confidence=${preAnalysis.confidence.toFixed(2)}`
      );
    }

    // === 第四轮迭代新增：检查预取缓存 ===
    // v1.3 优化：preAnalysis 标记的 prefetch 路径跳过 Pre-Retrieval Decision
    let prefetchHit = false;
    let cachedMemoryContext = "";

    const prefetchCache = getPrefetchCache();
    const cachedEntry = prefetchCache.get(userId);
    if (cachedEntry && cachedEntry.formattedContext) {
      prefetchHit = true;
      cachedMemoryContext = cachedEntry.formattedContext;
      console.log(
        `[ContextEnrichNode] Prefetch cache HIT for user ${userId}, ` +
          `intent="${cachedEntry.predictedIntent.intent.substring(0, 50)}..."`
      );
    }

    // === 新增：Pre-Retrieval Decision 检索前决策 + 向量化并行执行 ===
    // 优化：embedding 生成不依赖决策结果，可并行执行
    let shouldRetrieve = true;
    let retrievalQuery = userText;

    if (!prefetchHit) {
      // v1.3 优化：preAnalysis.rewrittenQuery 优先级高于 Pre-Retrieval Decision 的改写
      if (preAnalysis?.rewrittenQuery) {
        retrievalQuery = preAnalysis.rewrittenQuery;
        console.log(
          `[ContextEnrichNode] preAnalysis.rewrittenQuery applied: "${retrievalQuery}"`
        );
      }

      // v1.3 优化：preAnalysis.memoryRelevant=false 直接跳过检索，无需调用 LLM 决策
      if (preAnalysis?.memoryRelevant === false) {
        shouldRetrieve = false;
        console.log(
          `[ContextEnrichNode] preAnalysis.memoryRelevant=false → skip retrieval`
        );
      } else {
        // 构建对话历史（最近 5 轮）
        const dialogueHistory: DialogueEntry[] = messages
          .slice(-10)
          .filter((m) => {
            const type = m._getType();
            return type === "human" || type === "ai";
          })
          .map((m) => ({
            role: (m._getType() === "human" ? "user" : "assistant") as "user" | "assistant",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          }));

        // 并行执行：Pre-Retrieval 决策 + 向量化（两者无依赖）
        const [decision] = await Promise.all([
          makePreRetrievalDecision(userText, dialogueHistory),
        ]);

        shouldRetrieve = decision.decision === "RETRIEVE";
        // 若 preAnalysis 已有 rewrittenQuery，保留；否则采用 Pre-Retrieval 决策的改写
        if (!preAnalysis?.rewrittenQuery && decision.rewrittenQuery) {
          retrievalQuery = decision.rewrittenQuery;
        }

        console.log(
          `[ContextEnrichNode] Pre-Retrieval Decision: ${decision.decision} ` +
            `(source=${decision.source}, ${decision.durationMs}ms)` +
            (decision.rewrittenQuery ? `, rewritten="${decision.rewrittenQuery}"` : "")
        );
      }
    }

    // === 新增：生成查询向量（用于混合检索） ===
    // 优化：如果决策确定需要检索，并行启动 embedding 生成
    let queryEmbedding: number[] | null = null;
    if (shouldRetrieve && !prefetchHit) {
      queryEmbedding = await generateEmbedding(retrievalQuery);
    }

    // === 并行执行记忆检索和画像构建 ===
    // 缓存命中时使用预取的格式化记忆；否则根据 Pre-Retrieval Decision 决定是否检索
    const [memoryContext, userProfile, emotionsAvailable] = await Promise.all([
      prefetchHit
        ? Promise.resolve(cachedMemoryContext)
        : shouldRetrieve
          ? getFormattedMemoryContext(userId, retrievalQuery, queryEmbedding)
          : Promise.resolve(""),
      getUserProfileSnapshot(userId),
      getEmotionsClient().isAvailable(),
    ]);

    // === 构建动态 System Prompt ===
    const personalityEngine = getPersonalityEngine();

    // 根据 Emotions-Express 可用性选择情感标签指令
    const emotionInstructions = emotionsAvailable
      ? getEmotionTagInstructions()
      : getCompactEmotionTagInstructions();

    const dynamicSystemPrompt = personalityEngine.buildSystemPrompt({
      characterId: characterId || "xiaozhi",
      userProfile,
      memoryContext,
      emotionTagInstructions: emotionInstructions,
    });

    // === 构建检索到的记忆列表 ===
    const retrievedMemories = memoryContext
      ? memoryContext.split("\n").filter((line) => line.trim())
      : [];

    console.log(
      `[ContextEnrichNode] Enrichment complete: ` +
        `character=${characterId}, ` +
        `memories=${retrievedMemories.length}, ` +
        `isNewSession=${isNewSession}, ` +
        `prefetchHit=${prefetchHit}, ` +
        `profileName=${userProfile.displayName || "unknown"}, ` +
        `emotions=${emotionsAvailable ? "enabled" : "disabled"}, ` +
        `promptLength=${dynamicSystemPrompt.length}`
    );

    // 为思考面板准备召回记忆元信息（不参与图逻辑）
    const memoryPreviews = retrievedMemories.slice(0, 3).map((line) =>
      line.length > 40 ? `${line.slice(0, 40)}…` : line
    );

    return {
      dynamicSystemPrompt,
      retrievedMemories,
      memoryRecallMeta: {
        count: retrievedMemories.length,
        previews: memoryPreviews,
        prefetchHit: Boolean(prefetchHit),
      },
    };
  } catch (error) {
    console.error(
      "[ContextEnrichNode] Enrichment failed:",
      (error as Error).message
    );

    // 降级：使用基础 System Prompt
    const personalityEngine = getPersonalityEngine();
    const fallbackPrompt = personalityEngine.buildSystemPrompt({
      characterId: characterId || "xiaozhi",
      memoryContext: "",
    });

    const extractedSlots = extractDialogueSlotsFromMessages(messages);
    const dialogueSlots = mergeDialogueSlotsWithLocationCity(
      extractedSlots,
      context?.location?.city
    );

    return {
      dynamicSystemPrompt: fallbackPrompt,
      retrievedMemories: [],
      dialogueSlots,
    };
  }
}
