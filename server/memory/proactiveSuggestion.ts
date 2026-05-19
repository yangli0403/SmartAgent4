/**
 * Proactive Suggestion — 主动场景规划建议
 *
 * 当用户某个行为模式的 frequency >= 3 时，通过 SSE 主动推送场景命名建议，
 * 引导用户将高频操作固化为命名场景（如"午睡模式"）。
 *
 * 触发时机：每次 runSupervisorStreaming 完成后异步检查。
 * 推送方式：publishSupervisorEvent → SSE → 前端 proactive_suggest 事件。
 *
 * v0.5.1 修复：
 * - 原逻辑在 SSE 推送前就标记 confidence=0.99（"已推送"），如果前端未建立 SSE 连接
 *   （如认证失败、网络断开），该模式就永远不会再推送了。
 * - 修改为：先检查 SSE 是否有活跃订阅者，推送成功后才标记为"已推送"。
 * - 如果没有活跃订阅者，不标记，下次请求时会重新尝试推送。
 */

import { eq, gte, and, lt } from "drizzle-orm";
import { getDb } from "../db";
import { behaviorPatterns } from "../../drizzle/schema";
import { callLLMText } from "../llm/langchainAdapter";
import { publishSupervisorEvent } from "../agent/supervisor/supervisorEventBus";
import { supervisorEventBus } from "../agent/supervisor/supervisorEventBus";

/** 已推送标记的 confidence 阈值（写入 DB，跨重启持久化） */
const SUGGESTED_CONFIDENCE_MARKER = 0.99;

/**
 * 检查用户是否有高频行为模式（frequency >= 3），若有则生成并推送场景命名建议。
 *
 * @param userId - 用户 ID（number 类型）
 * @param requestId - 当前请求 ID，用于 SSE 推送
 */
export async function checkAndPublishProactiveSuggestion(
  userId: number,
  requestId: string
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    console.log(
      `[ProactiveSuggestion] 检查用户 ${userId} 的高频行为模式 (requestId=${requestId})`
    );

    // 前置检查：当前 requestId 是否有活跃的 SSE 订阅者
    // 如果没有（前端未连接 SSE），推送也没有意义，跳过本次检查（不标记，下次重试）
    if (!supervisorEventBus.hasSubscribers(requestId)) {
      console.log(
        `[ProactiveSuggestion] requestId=${requestId} 无活跃 SSE 订阅者，跳过（下次重试）`
      );
      return;
    }

    // 查找 frequency >= 3 且尚未推送过建议的行为模式
    // "尚未推送"的判断：confidence < SUGGESTED_CONFIDENCE_MARKER（DB 持久化标记）
    const highFreqPatterns = await db
      .select()
      .from(behaviorPatterns)
      .where(
        and(
          eq(behaviorPatterns.userId, userId),
          gte(behaviorPatterns.frequency, 3),
          lt(behaviorPatterns.confidence, SUGGESTED_CONFIDENCE_MARKER)
        )
      )
      .limit(5);

    console.log(
      `[ProactiveSuggestion] 找到 ${highFreqPatterns.length} 条未推送的高频模式`
    );

    if (highFreqPatterns.length === 0) return;

    // 取频率最高的那条
    const topPattern = highFreqPatterns.sort((a, b) => b.frequency - a.frequency)[0];

    console.log(
      `[ProactiveSuggestion] 检测到高频行为模式 #${topPattern.id}: ` +
        `[${topPattern.patternType}] freq=${topPattern.frequency} "${topPattern.description.substring(0, 50)}"`
    );

    // 用 LLM 生成场景命名建议
    const suggestionPrompt = `你是一个智能助手，负责帮用户将高频操作固化为命名场景。

用户有一个高频行为模式（已重复 ${topPattern.frequency} 次）：
- 类型：${topPattern.patternType}
- 描述：${topPattern.description}

请为这个行为模式：
1. 起一个简洁的场景名称（2-6个字，如"午睡模式"、"早晨例程"、"专注工作"）
2. 列出3-5个具体操作步骤

请严格按以下 JSON 格式返回，不要有其他内容：
{
  "sceneName": "场景名称",
  "steps": ["步骤1", "步骤2", "步骤3"]
}`;

    const llmResponse = await callLLMText(
      "你是一个智能场景规划助手，只返回 JSON 格式。",
      suggestionPrompt,
      { temperature: 0.3 }
    );

    let sceneName = "自定义场景";
    let suggestedSteps: string[] = ["根据您的习惯自动执行相关操作"];

    try {
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.sceneName) sceneName = parsed.sceneName;
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          suggestedSteps = parsed.steps;
        }
      }
    } catch (e) {
      console.warn("[ProactiveSuggestion] LLM JSON 解析失败，使用默认值");
    }

    // 推送前再次检查 SSE 订阅者是否仍然存在（LLM 调用期间前端可能已断开）
    if (!supervisorEventBus.hasSubscribers(requestId)) {
      console.log(
        `[ProactiveSuggestion] LLM 生成完成但 SSE 已断开，不标记已推送（下次重试）`
      );
      return;
    }

    // 通过 SSE 推送主动建议事件
    publishSupervisorEvent({
      requestId,
      type: "proactive_suggest",
      phase: "proactive_suggest",
      summary: `发现高频操作，建议创建「${sceneName}」场景`,
      payload: {
        patternDescription: topPattern.description,
        patternType: topPattern.patternType,
        frequency: topPattern.frequency,
        suggestedSceneName: sceneName,
        suggestedSteps,
      },
    });

    // 推送成功后才标记为"已推送"（避免前端未收到但 DB 已标记的问题）
    await db
      .update(behaviorPatterns)
      .set({ confidence: SUGGESTED_CONFIDENCE_MARKER })
      .where(eq(behaviorPatterns.id, topPattern.id));

    console.log(
      `[ProactiveSuggestion] 已推送建议: 「${sceneName}」(${suggestedSteps.length} 步骤) → 已标记 confidence=${SUGGESTED_CONFIDENCE_MARKER}`
    );
  } catch (error) {
    // 主动建议是非关键路径，失败不影响主流程
    console.warn(
      "[ProactiveSuggestion] 检查失败（非致命）:",
      (error as Error).message
    );
  }
}
