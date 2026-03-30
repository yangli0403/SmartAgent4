/**
 * Behavior Detector — 行为模式检测器（第四轮迭代新增）
 *
 * 从对话中识别用户的行为模式（时间规律、话题偏好、沟通风格、任务习惯），
 * 并将检测到的模式持久化到 behavior_patterns 表。
 *
 * 设计原则：
 * - 异步 fire-and-forget，不阻塞主对话管线
 * - 仅在有足够证据时才写入模式（confidence >= 0.5）
 * - 已有模式通过 frequency 递增更新，避免重复写入
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  behaviorPatterns,
  type BehaviorPattern,
  type InsertBehaviorPattern,
} from "../../drizzle/schema";
import { callLLMText } from "../llm/langchainAdapter";

// ==================== 类型定义 ====================

/**
 * 提取的记忆项（简化版，用于行为检测输入）
 */
export interface ExtractedMemoryItem {
  kind: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
}

/**
 * 行为模式检测输入
 */
export interface BehaviorPatternInput {
  userId: number;
  conversationHistory: Array<{ role: string; content: string }>;
  extractedMemories?: ExtractedMemoryItem[];
  timestamp: string;
}

/**
 * 检测到的行为模式
 */
export interface DetectedPattern {
  patternType: string;
  description: string;
  confidence: number;
  frequency: number;
}

// ==================== 有效模式类型 ====================

const VALID_PATTERN_TYPES = [
  "schedule",
  "topic_preference",
  "communication_style",
  "task_habit",
];

// ==================== LLM Prompt ====================

const BEHAVIOR_DETECTION_PROMPT = `你是一个用户行为分析专家。请分析以下对话和已提取的记忆，识别出有统计意义的行为模式。

## 输出格式（严格 JSON 数组）
[
  {
    "patternType": "schedule|topic_preference|communication_style|task_habit",
    "description": "清晰简洁的模式描述",
    "confidence": 0.0-1.0
  }
]

## 模式类型说明
- schedule: 时间相关的规律（如"用户通常在晚上讨论技术问题"）
- topic_preference: 话题偏好（如"用户经常讨论 Python 编程和数据分析"）
- communication_style: 沟通风格（如"用户偏好简短直接的回复"）
- task_habit: 任务习惯（如"用户喜欢先列计划再执行"）

## 注意事项
- 只输出有足够证据支撑的模式（confidence >= 0.5）
- 不要从单次对话中过度推断
- description 应该是标准化的陈述，便于后续匹配和聚合
- 如果没有检测到有意义的模式，返回空数组 []
- 请只输出 JSON 数组，不要包含其他文字`;

// ==================== 核心功能 ====================

/**
 * 检测行为模式（LLM 驱动）
 */
export async function detectPatterns(
  input: BehaviorPatternInput
): Promise<DetectedPattern[]> {
  const { conversationHistory, extractedMemories, timestamp } = input;

  // 构建分析输入
  const parts: string[] = [];

  parts.push(`## 对话时间\n${timestamp}\n`);

  parts.push(`## 对话内容`);
  for (const msg of conversationHistory.slice(-20)) {
    parts.push(`${msg.role}: ${msg.content}`);
  }

  if (extractedMemories && extractedMemories.length > 0) {
    parts.push(`\n## 本轮提取的记忆`);
    for (const mem of extractedMemories) {
      parts.push(`- [${mem.type}] ${mem.content} (importance=${mem.importance})`);
    }
  }

  const analysisInput = parts.join("\n");

  try {
    const response = await callLLMText(
      BEHAVIOR_DETECTION_PROMPT,
      analysisInput,
      { temperature: 0.2 }
    );

    // 解析 JSON 响应
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[BehaviorDetector] No patterns detected (empty response)");
      return [];
    }

    const rawPatterns = JSON.parse(jsonMatch[0]);

    // 验证和过滤
    const validPatterns: DetectedPattern[] = [];
    for (const p of rawPatterns) {
      if (
        typeof p.patternType === "string" &&
        typeof p.description === "string" &&
        typeof p.confidence === "number" &&
        VALID_PATTERN_TYPES.includes(p.patternType) &&
        p.confidence >= 0.5 &&
        p.description.trim().length > 0
      ) {
        validPatterns.push({
          patternType: p.patternType,
          description: p.description.trim(),
          confidence: Math.min(1, Math.max(0, p.confidence)),
          frequency: 1,
        });
      }
    }

    console.log(
      `[BehaviorDetector] Detected ${validPatterns.length} valid patterns from ${rawPatterns.length} raw`
    );
    return validPatterns;
  } catch (error) {
    console.error(
      "[BehaviorDetector] Detection failed:",
      (error as Error).message
    );
    return [];
  }
}

/**
 * 将检测到的模式持久化到 behavior_patterns 表
 *
 * 如果已存在相似模式（同 userId + patternType + 相似 description），
 * 则递增 frequency 并更新 confidence 和 lastObserved。
 */
export async function persistPatterns(
  userId: number,
  patterns: DetectedPattern[]
): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[BehaviorDetector] DB not available, skipping persistence");
    return 0;
  }

  let count = 0;

  for (const pattern of patterns) {
    try {
      // 查找同类型的现有模式
      const existing = await db
        .select()
        .from(behaviorPatterns)
        .where(
          and(
            eq(behaviorPatterns.userId, userId),
            eq(behaviorPatterns.patternType, pattern.patternType)
          )
        );

      // 检查是否有相似的描述（简单子串匹配）
      const similar = existing.find(
        (e) =>
          e.description.includes(pattern.description.substring(0, 20)) ||
          pattern.description.includes(e.description.substring(0, 20))
      );

      if (similar) {
        // 更新已有模式：递增 frequency，更新 confidence
        const newConfidence = Math.min(
          1,
          similar.confidence * 0.7 + pattern.confidence * 0.3
        );
        await db
          .update(behaviorPatterns)
          .set({
            confidence: newConfidence,
            frequency: similar.frequency + 1,
            lastObserved: new Date(),
            updatedAt: new Date(),
            description: pattern.description, // 更新为最新描述
          })
          .where(eq(behaviorPatterns.id, similar.id));

        console.log(
          `[BehaviorDetector] Updated pattern #${similar.id}: ` +
            `freq=${similar.frequency + 1}, conf=${newConfidence.toFixed(2)}`
        );
      } else {
        // 插入新模式
        const newPattern: InsertBehaviorPattern = {
          userId,
          patternType: pattern.patternType,
          description: pattern.description,
          confidence: pattern.confidence,
          frequency: 1,
        };

        await db.insert(behaviorPatterns).values(newPattern);
        console.log(
          `[BehaviorDetector] New pattern: [${pattern.patternType}] ${pattern.description.substring(0, 50)}`
        );
      }

      count++;
    } catch (error) {
      console.error(
        `[BehaviorDetector] Failed to persist pattern:`,
        (error as Error).message
      );
    }
  }

  return count;
}

/**
 * 获取用户的历史行为模式
 */
export async function getUserPatterns(
  userId: number,
  limit = 20
): Promise<BehaviorPattern[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const results = await db
      .select()
      .from(behaviorPatterns)
      .where(eq(behaviorPatterns.userId, userId))
      .orderBy(sql`${behaviorPatterns.confidence} DESC`)
      .limit(limit);

    return results;
  } catch (error) {
    console.error(
      "[BehaviorDetector] Failed to get user patterns:",
      (error as Error).message
    );
    return [];
  }
}

/**
 * 检测并持久化行为模式（便捷方法，供 memoryExtractionNode 调用）
 *
 * 这是一个组合方法，先调用 detectPatterns，再调用 persistPatterns。
 */
export async function detectAndPersistPatterns(
  input: BehaviorPatternInput
): Promise<number> {
  const patterns = await detectPatterns(input);

  if (patterns.length === 0) {
    return 0;
  }

  const count = await persistPatterns(input.userId, patterns);
  console.log(
    `[BehaviorDetector] Completed for user ${input.userId}: ${count} patterns persisted`
  );
  return count;
}
