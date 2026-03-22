/**
 * Memory Extraction Node — 记忆提取节点
 *
 * 在 respondNode 之后执行，负责：
 * 1. 从本轮对话中异步提取新记忆
 * 2. 更新工作记忆
 *
 * 这是一个"fire-and-forget"节点，不阻塞回复的返回。
 * 来源：SmartAgent2 的 extractor.ts 的异步记忆提取逻辑。
 */

import type { SupervisorStateType } from "./state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  extractMemoriesFromConversation,
  appendWorkingMemory,
} from "../../memory/memorySystem";

/**
 * 记忆提取节点
 *
 * 在每次对话回复生成后执行，异步提取并存储新记忆。
 * 不修改 SupervisorState，仅触发副作用。
 */
export async function memoryExtractionNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[MemoryExtractionNode] Starting memory extraction...");

  const { messages, context, finalResponse } = state;

  // 获取用户 ID
  const userId = context?.userId ? parseInt(context.userId, 10) : 0;
  const sessionId = context?.sessionId || "default";

  if (!userId) {
    console.warn(
      "[MemoryExtractionNode] No userId available, skipping extraction"
    );
    return {};
  }

  // 提取最近的对话消息
  const conversationHistory: Array<{ role: string; content: string }> = [];

  for (const msg of messages) {
    const type = msg._getType();
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

    if (type === "human") {
      conversationHistory.push({ role: "user", content });
    } else if (type === "ai" && content) {
      conversationHistory.push({ role: "assistant", content });
    }
  }

  // 添加最终回复
  if (finalResponse) {
    conversationHistory.push({ role: "assistant", content: finalResponse });
  }

  // === 更新工作记忆 ===
  const lastUserMsg = conversationHistory
    .filter((m) => m.role === "user")
    .pop();
  if (lastUserMsg) {
    appendWorkingMemory(userId, sessionId, lastUserMsg);
  }
  if (finalResponse) {
    appendWorkingMemory(userId, sessionId, {
      role: "assistant",
      content: finalResponse,
    });
  }

  // === 异步提取记忆（fire-and-forget） ===
  // 使用 Promise 但不 await，避免阻塞响应
  extractMemoriesFromConversation({
    userId,
    conversationHistory,
  })
    .then((memories) => {
      if (memories.length > 0) {
        console.log(
          `[MemoryExtractionNode] Extracted ${memories.length} new memories for user ${userId}`
        );
      }
    })
    .catch((error) => {
      console.error(
        "[MemoryExtractionNode] Memory extraction failed:",
        (error as Error).message
      );
    });

  // 不修改状态，仅触发副作用
  return {};
}
