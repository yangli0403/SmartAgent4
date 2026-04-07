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
    // === 第四轮迭代新增：检查预取缓存 ===
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

    // === 并行执行记忆检索和画像构建 ===
    // 缓存命中时使用预取的格式化记忆；否则按用户 + 当前问句检索长期记忆
    const [memoryContext, userProfile, emotionsAvailable] = await Promise.all([
      prefetchHit
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
