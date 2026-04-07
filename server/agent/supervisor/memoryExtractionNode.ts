/**
 * Memory Extraction Node — 记忆提取节点
 *
 * 在 respondNode 之后执行，负责：
 * 1. 更新工作记忆（始终执行）
 * 2. 从本轮对话中异步提取新记忆（可通过开关控制）
 *
 * 记忆系统技能化改造：
 * - 新增 AUTO_EXTRACTION_ENABLED 开关，默认关闭自动提取
 * - Agent 已具备 memory_store 等主动记忆技能，不再依赖每轮自动提取
 * - 工作记忆更新始终保留，确保会话上下文完整性
 * - 行为模式检测仅在自动提取启用时触发
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
import { detectAndPersistPatterns } from "../../memory/behaviorDetector";

// ==================== 配置 ====================

/**
 * 自动记忆提取开关
 *
 * 记忆系统技能化改造后，Agent 已具备 memory_store / memory_search 等
 * 主动记忆技能，可在多轮任务结束时主动进行全局总结并存储。
 *
 * 设为 false 时：
 * - 跳过每轮对话的自动 extractMemoriesFromConversation 调用
 * - 大幅降低 LLM Token 消耗（预计降低 50%-80%）
 * - 工作记忆更新不受影响
 *
 * 设为 true 时：
 * - 恢复旧行为，每轮对话自动触发四层过滤管道提取
 * - 适用于需要兼容旧模式或 Agent 主动记忆能力不足的场景
 *
 * 可通过环境变量 MEMORY_AUTO_EXTRACTION 覆盖：
 * - MEMORY_AUTO_EXTRACTION=true  启用自动提取
 * - MEMORY_AUTO_EXTRACTION=false 禁用自动提取（默认）
 */
export const AUTO_EXTRACTION_ENABLED: boolean =
  process.env.MEMORY_AUTO_EXTRACTION === "true" ? true : false;

/** 行为检测触发阈值（对话轮数） */
const BEHAVIOR_DETECTION_THRESHOLD = parseInt(
  process.env.BEHAVIOR_DETECTION_THRESHOLD ?? "10",
  10
);

/** 每个用户的对话轮数计数器 */
const userDialogueCounters = new Map<number, number>();

/**
 * 记忆提取节点
 *
 * 在每次对话回复生成后执行。
 * - 始终更新工作记忆（内存级，不消耗 LLM Token）
 * - 根据 AUTO_EXTRACTION_ENABLED 开关决定是否触发自动提取
 * 不修改 SupervisorState，仅触发副作用。
 */
export async function memoryExtractionNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log(
    `[MemoryExtractionNode] Starting... (autoExtraction=${AUTO_EXTRACTION_ENABLED})`
  );

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

  // === 更新工作记忆（始终执行，不消耗 LLM Token） ===
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

  // === 行为模式检测（解耦：基于对话轮数阈值独立触发） ===
  // 记忆优化迭代：行为检测从自动提取流程中解耦，独立运行
  // 基于对话轮数计数，达到阈值时触发一次行为检测，然后重置计数器
  const currentCount = (userDialogueCounters.get(userId) || 0) + 1;
  userDialogueCounters.set(userId, currentCount);

  if (currentCount >= BEHAVIOR_DETECTION_THRESHOLD) {
    console.log(
      `[MemoryExtractionNode] Dialogue count ${currentCount} >= ${BEHAVIOR_DETECTION_THRESHOLD}, ` +
        `triggering behavior detection for user ${userId}`
    );
    userDialogueCounters.set(userId, 0); // 重置计数器

    // 异步触发行为检测（fire-and-forget）
    detectAndPersistPatterns({
      userId,
      conversationHistory,
      extractedMemories: [], // 解耦后不依赖提取结果，行为检测器直接分析对话
      timestamp: new Date().toISOString(),
    }).catch((err) => {
      console.error(
        "[MemoryExtractionNode] Behavior detection failed:",
        (err as Error).message
      );
    });
  } else {
    console.log(
      `[MemoryExtractionNode] Dialogue count ${currentCount}/${BEHAVIOR_DETECTION_THRESHOLD} ` +
        `for user ${userId}, behavior detection not yet triggered`
    );
  }

  // === 自动提取记忆（受开关控制） ===
  if (!AUTO_EXTRACTION_ENABLED) {
    console.log(
      "[MemoryExtractionNode] Auto extraction disabled (skills-based memory mode). " +
        "Working memory updated. Behavior detection triggered. Skipping LLM extraction pipeline."
    );
    return {};
  }

  // === 以下为旧模式：异步提取记忆（fire-and-forget） ===
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
