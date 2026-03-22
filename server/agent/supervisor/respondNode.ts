/**
 * Respond Node — 增强版回复生成节点
 *
 * 汇总所有步骤的执行结果，通过 LLM 生成面向用户的自然语言回复。
 *
 * SmartAgent3 增强：
 * 1. 使用 PersonalityEngine 构建的动态 System Prompt（含人格+记忆+画像）
 * 2. 注入情感标签指令，引导 LLM 输出 [tag:value] 格式标签
 * 3. 在回复中自然融入记忆上下文
 * 4. 强化用户偏好注入：确保记忆中的偏好（颜色、风格等）被明确传递
 */

import type { SupervisorStateType } from "./state";
import { callLLMText } from "../../llm/langchainAdapter";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getUserProfileSnapshot } from "../../memory/memorySystem";

/**
 * respondNode 的基础 LLM 系统提示词
 *
 * 当 dynamicSystemPrompt 不可用时使用此降级提示词。
 */
export const RESPOND_SYSTEM_PROMPT = `你是 SmartAgent，一个智能、有记忆的AI助手。
根据任务执行结果，生成面向用户的自然语言回复。

回复要求：
1. 简洁明了，直接回答用户的问题
2. 【必须结构化输出】内容超过 2 个要点时，必须换行分段，使用编号或分点呈现，禁止将多条信息堆砌成一整段
3. 列举类内容（如专辑、歌曲、景点、路线等）每项单独一行，格式：「编号. 标题 — 简要说明」
4. 如果涉及推荐，说明推荐理由
5. 如果执行失败，诚实告知并提供替代建议
6. 根据用户的性格偏好调整回复风格
7. 不要暴露内部的步骤编号、Agent名称等技术细节
8. 使用用户的语言（中文）回复`;

/**
 * 回复生成节点（增强版）
 *
 * 使用动态 System Prompt 和情感标签指令生成最终回复。
 */
export async function respondNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[RespondNode] Generating final response...");

  const {
    stepResults,
    plan,
    messages,
    context,
    finalResponse,
    dynamicSystemPrompt,
    retrievedMemories,
    characterId,
    taskClassification,
  } = state;

  // 如果 replanNode 已经生成了 finalResponse（complete/abort），直接使用
  if (finalResponse && finalResponse.length > 0) {
    console.log("[RespondNode] Using pre-generated finalResponse");
    const aiMsg = new AIMessage(finalResponse);
    return {
      messages: [aiMsg],
      finalResponse,
    };
  }

  // 提取用户原始消息
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m instanceof HumanMessage || m._getType() === "human");

  const userText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage?.content || "");

  // === 对于 general + simple 且无工具调用的任务，直接使用 Agent 输出 ===
  // 这类任务（如写诗、写故事、知识问答等）的 Agent 输出就是最终回复，
  // 不需要二次“汇总”，否则会导致创意内容丢失。
  const isGeneralSimple = taskClassification?.domain === "general" && taskClassification?.complexity === "simple";
  const hasNoToolCalls = stepResults.every(r => !r.toolCalls || r.toolCalls.length === 0);
  const agentOutput = stepResults.length > 0 && stepResults[stepResults.length - 1].output;

  if (isGeneralSimple && hasNoToolCalls && agentOutput && agentOutput.length > 20) {
    console.log(`[RespondNode] General+Simple task with no tool calls, using agent output directly (${agentOutput.length} chars)`);
    const aiMsg = new AIMessage(agentOutput);
    return {
      messages: [aiMsg],
      finalResponse: agentOutput,
    };
  }

  // === 构建增强的 System Prompt ===
  // 优先使用 PersonalityEngine 构建的动态 Prompt，降级到基础 Prompt
  const systemPrompt = dynamicSystemPrompt || RESPOND_SYSTEM_PROMPT;

  // === 检测是否为闲聊/打招呼场景，避免主动推荐 ===
  const isChitchat = (() => {
    const domain = taskClassification?.domain;
    // domain 为 general 且没有工具调用，认为是闲聊
    if (domain && domain !== "general") return false;
    // 检测用户消息是否是闲聊/打招呼模式
    const greetingPattern = /^([你您]好|hi|hello|hey|喔|哈哈|哈哈哈|小智|你好啊|打招呼|开心|不错|还行|我叫|我是|我住在|我在|我来自)/i;
    const isShortGreeting = userText.length < 30 && greetingPattern.test(userText.trim());
    // 如果没有任何工具调用且消息很短，也认为是闲聊
    const hasNoToolCalls = stepResults.every(r => !r.toolCalls || r.toolCalls.length === 0);
    return isShortGreeting || (hasNoToolCalls && userText.length < 20);
  })();

  // === 获取用户画像（含偏好）用于强化注入 ===
  // 闲聊/打招呼场景不注入偏好，避免主动推荐
  let userProfileSection = "";
  if (context?.userId && !isChitchat) {
    try {
      const userId = parseInt(context.userId, 10);
      if (!isNaN(userId) && userId > 0) {
        const profile = await getUserProfileSnapshot(userId);
        if (profile.activePreferences.length > 0) {
          const prefsText = profile.activePreferences
            .map((p) => `  - ${p.category}/${p.key}: ${p.value}`)
            .join("\n");
          userProfileSection = `\n\n【重要】用户已知偏好（仅当用户请求推荐或建议时才融入，不要主动提及）：\n${prefsText}`;
          console.log(
            `[RespondNode] Injecting ${profile.activePreferences.length} user preferences into response`
          );
        }
        if (profile.displayName) {
          userProfileSection = `\n用户称呼: ${profile.displayName}` + userProfileSection;
        }
      }
    } catch (e) {
      console.warn("[RespondNode] Failed to load user profile:", (e as Error).message);
    }
  } else if (context?.userId && isChitchat) {
    // 闲聊场景下，只注入用户称呼，不注入偏好
    try {
      const userId = parseInt(context.userId, 10);
      if (!isNaN(userId) && userId > 0) {
        const profile = await getUserProfileSnapshot(userId);
        if (profile.displayName) {
          userProfileSection = `\n用户称呼: ${profile.displayName}`;
        }
      }
    } catch (e) { /* ignore */ }
  }

  // === 构建汇总请求 ===
  let summaryRequest = `用户原始请求: ${userText}\n\n`;

  // 注入记忆上下文
  if (retrievedMemories && retrievedMemories.length > 0) {
    summaryRequest += `相关记忆（请在回复中参考）:\n${retrievedMemories.join("\n")}\n\n`;
  }

  // 注入用户画像偏好（强化）
  if (userProfileSection) {
    summaryRequest += userProfileSection + "\n\n";
  }

  summaryRequest += `执行结果汇总:\n`;

  for (const result of stepResults) {
    const step = plan.find((s) => s.id === result.stepId);
    summaryRequest += `\n--- 步骤 ${result.stepId}: ${step?.description || "未知"} ---\n`;
    summaryRequest += `状态: ${result.status}\n`;

    if (result.output) {
      summaryRequest += `结果: ${result.output}\n`;
    }
    if (result.error) {
      summaryRequest += `错误: ${result.error}\n`;
    }
    if (result.toolCalls && result.toolCalls.length > 0) {
      summaryRequest += `工具调用: ${result.toolCalls.map((tc) => tc.toolName).join(", ")}\n`;
    }
  }

  // 附加用户偏好（来自 context）
  if (context) {
    summaryRequest += `\n用户设置:`;
    if (context.personality) {
      summaryRequest += `\n- 性格模式: ${context.personality}`;
    }
    if (context.responseStyle) {
      summaryRequest += `\n- 回复风格: ${context.responseStyle}`;
    }
    if (context.location?.city) {
      summaryRequest += `\n- 当前城市: ${context.location.city}`;
    }
  }

  // 附加回复指令
  summaryRequest += `\n\n请根据以上信息生成回复。`;
  if (userProfileSection && !isChitchat) {
    summaryRequest += `\n重要提醒：用户已知偏好仅供参考。只有当用户明确请求推荐或建议时，才将偏好融入回复。不要在闲聊、打招呼、介绍自己等场景主动提及偏好推荐。`;
  }
  summaryRequest += `\n注意：请在回复中自然地使用情感和动作标签（如 [expression:smile]、[animation:nod] 等），让回复更加生动。`;
  summaryRequest += `\n不要暴露内部的步骤编号、Agent名称等技术细节。`;

  // === 调用 LLM 生成回复 ===
  try {
    const response = await callLLMText(
      systemPrompt,
      summaryRequest,
      { temperature: 0.7 }
    );

    console.log(
      `[RespondNode] Final response generated (${response.length} chars, character=${characterId})`
    );

    const aiMsg = new AIMessage(response);

    return {
      messages: [aiMsg],
      finalResponse: response,
    };
  } catch (error) {
    console.error(
      "[RespondNode] Response generation failed:",
      (error as Error).message
    );

    // 降级处理：直接拼接步骤结果
    const fallbackResponse = buildFallbackResponse(stepResults, plan);
    const aiMsg = new AIMessage(fallbackResponse);

    return {
      messages: [aiMsg],
      finalResponse: fallbackResponse,
    };
  }
}

/**
 * 构建降级回复（LLM 调用失败时）
 */
function buildFallbackResponse(
  stepResults: SupervisorStateType["stepResults"],
  plan: SupervisorStateType["plan"]
): string {
  const successResults = stepResults.filter((r) => r.status === "success");
  const failedResults = stepResults.filter((r) => r.status !== "success");

  let response = "";

  if (successResults.length > 0) {
    response += "以下是执行结果：\n\n";
    for (const result of successResults) {
      if (result.output) {
        response += `${result.output}\n\n`;
      }
    }
  }

  if (failedResults.length > 0) {
    response += "\n部分操作未能成功完成：\n";
    for (const result of failedResults) {
      const step = plan.find((s) => s.id === result.stepId);
      response += `- ${step?.description || "未知步骤"}: ${result.error || "未知错误"}\n`;
    }
  }

  if (response.length === 0) {
    response =
      "抱歉，任务执行过程中没有获得有效结果。请尝试重新描述您的需求。";
  }

  return response;
}
