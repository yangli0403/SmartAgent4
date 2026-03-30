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
 * 优化（v2）：
 * - 新建会话（对话历史为空）时不注入历史记忆，避免跨会话污染
 * - 通过 messages 列表长度判断是否为新会话（只有 1 条消息 = 当前用户消息）
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
    return {};
  }

  // === 判断是否为新建会话 ===
  // messages 中只有 1 条消息（当前用户消息），说明没有历史对话，是新会话
  const humanMessages = messages.filter(
    (m) => m instanceof HumanMessage || m._getType() === "human"
  );
  const isNewSession = humanMessages.length <= 1;

  if (isNewSession) {
    console.log("[ContextEnrichNode] New session detected, skipping memory injection to avoid cross-session contamination");
  }

  try {
    // === 第四轮迭代新增：检查预取缓存 ===
    let prefetchHit = false;
    let cachedMemoryContext = "";

    if (!isNewSession) {
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
    }

    // === 并行执行记忆检索和画像构建 ===
    // 新建会话时跳过记忆检索，只获取用户画像（称呼等基本信息）
    // 缓存命中时使用缓存的上下文，跳过实时检索
    const [memoryContext, userProfile, emotionsAvailable] = await Promise.all([
      isNewSession
        ? Promise.resolve("")
        : prefetchHit
          ? Promise.resolve(cachedMemoryContext)
          : getFormattedMemoryContext(userId, userText),
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
      memoryContext,  // 新建会话时为空字符串，不会注入记忆段
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

    return {
      dynamicSystemPrompt,
      retrievedMemories,
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

    return {
      dynamicSystemPrompt: fallbackPrompt,
      retrievedMemories: [],
    };
  }
}
