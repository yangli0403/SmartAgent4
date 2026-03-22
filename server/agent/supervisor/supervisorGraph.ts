/**
 * Supervisor Graph — 增强版顶层编排图
 *
 * 使用 LangGraph StateGraph 构建 Supervisor 编排流程。
 *
 * SmartAgent3 增强流程：
 * START → contextEnrich → classify → [plan | execute] → execute → replan → [execute | respond] → memoryExtract → END
 *
 * 新增节点：
 * - contextEnrich: 上下文增强（记忆检索+画像构建+动态 Prompt）
 * - memoryExtract: 记忆提取（从对话中异步提取新记忆）
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { SupervisorState, type UserContext } from "./state";
import { classifyNode, routeByComplexity } from "./classifyNode";
import { planNode } from "./planNode";
import { createExecuteNode, type AgentRegistry } from "./executeNode";
import { replanNode, shouldContinueAfterReplan } from "./replanNode";
import { respondNode } from "./respondNode";
import { contextEnrichNode } from "./contextEnrichNode";
import { memoryExtractionNode } from "./memoryExtractionNode";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * 构建 Supervisor 图
 *
 * @param agentRegistry - Domain Agent 注册表
 * @returns 编译后的 LangGraph 图
 */
export function buildSupervisorGraph(agentRegistry: AgentRegistry) {
  const executeNode = createExecuteNode(agentRegistry);

  const graph = new StateGraph(SupervisorState)
    // 添加节点
    .addNode("contextEnrich", contextEnrichNode)  // SmartAgent3 新增
    .addNode("classify", classifyNode)
    .addNode("planStep", planNode)
    .addNode("execute", executeNode)
    .addNode("replan", replanNode)
    .addNode("respond", respondNode)
    .addNode("memoryExtract", memoryExtractionNode)  // SmartAgent3 新增

    // 定义边
    // START → contextEnrich → classify
    .addEdge(START, "contextEnrich")
    .addEdge("contextEnrich", "classify")

    // classify → 根据复杂度路由
    .addConditionalEdges("classify", routeByComplexity, {
      execute: "execute",
      plan: "planStep",
    })

    // planStep → execute
    .addEdge("planStep", "execute")

    // execute → replan
    .addEdge("execute", "replan")

    // replan → 根据评估结果路由
    .addConditionalEdges("replan", shouldContinueAfterReplan, {
      execute: "execute",
      respond: "respond",
    })

    // respond → memoryExtract → END
    .addEdge("respond", "memoryExtract")
    .addEdge("memoryExtract", END);

  return graph.compile();
}

/**
 * Supervisor 图的输入类型（增强版）
 */
export interface SupervisorInput {
  /** 用户消息（将转换为 HumanMessage） */
  userMessage: string;
  /** 对话历史 */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** 用户上下文 */
  context: {
    userId: string;
    sessionId: string;
    location?: { latitude: number; longitude: number; city?: string };
    platform?: "windows" | "mac" | "linux";
    personality?: string;
    responseStyle?: string;
    /** SmartAgent3 新增：人格 ID */
    characterId?: string;
  };
}

/**
 * Supervisor 图的输出类型（增强版）
 */
export interface SupervisorOutput {
  /** 最终回复文本（可能包含 [tag:value] 情感标签） */
  response: string;
  /** 任务分类结果 */
  classification: {
    domain: string;
    complexity: string;
  };
  /** 执行的步骤数 */
  stepsExecuted: number;
  /** 工具调用总数 */
  totalToolCalls: number;
  /** 总耗时（毫秒） */
  totalDurationMs: number;
  /** SmartAgent3 新增：使用的人格 ID */
  characterId: string;
}

/**
 * 运行 Supervisor 图
 *
 * 将外部输入转换为 LangGraph 状态，执行图，提取输出。
 *
 * @param input - 外部输入
 * @param agentRegistry - Domain Agent 注册表
 * @returns Supervisor 输出
 */
export async function runSupervisor(
  input: SupervisorInput,
  agentRegistry: AgentRegistry
): Promise<SupervisorOutput> {
  const startTime = Date.now();

  console.log(
    `[Supervisor] Starting for user ${input.context.userId}, session ${input.context.sessionId}`
  );
  console.log(`[Supervisor] User message: "${input.userMessage}"`);
  console.log(
    `[Supervisor] Character: ${input.context.characterId || "xiaozhi"}`
  );

  // 1. 构建初始消息列表
  const messages: BaseMessage[] = [];

  // 添加对话历史
  if (input.conversationHistory) {
    for (const msg of input.conversationHistory) {
      if (msg.role === "user" || msg.role === "human") {
        messages.push(new HumanMessage(msg.content));
      } else if (msg.role === "assistant" || msg.role === "ai") {
        messages.push(new AIMessage(msg.content));
      }
    }
  }

  // 添加当前用户消息
  messages.push(new HumanMessage(input.userMessage));

  // 2. 构建用户上下文
  const userContext: UserContext = {
    userId: input.context.userId,
    sessionId: input.context.sessionId,
    location: input.context.location
      ? {
          latitude: input.context.location.latitude,
          longitude: input.context.location.longitude,
          city: input.context.location.city,
        }
      : undefined,
    currentTime: new Date().toISOString(),
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    platform: input.context.platform || "linux",
    personality: input.context.personality || "default",
    responseStyle: input.context.responseStyle || "balanced",
  };

  // 3. 构建图并执行
  const compiledGraph = buildSupervisorGraph(agentRegistry);

  const characterId = input.context.characterId || "xiaozhi";

  const initialState = {
    messages,
    context: userContext,
    characterId,
  };

  try {
    const finalState = await compiledGraph.invoke(initialState);

    // 4. 提取输出
    const totalDurationMs = Date.now() - startTime;
    const totalToolCalls = (finalState.stepResults || []).reduce(
      (sum: number, r: any) => sum + (r.toolCalls?.length || 0),
      0
    );

    const output: SupervisorOutput = {
      response:
        finalState.finalResponse ||
        "抱歉，我无法处理您的请求。请尝试重新描述。",
      classification: {
        domain: finalState.taskClassification?.domain || "unknown",
        complexity: finalState.taskClassification?.complexity || "unknown",
      },
      stepsExecuted: (finalState.stepResults || []).length,
      totalToolCalls,
      totalDurationMs,
      characterId: finalState.characterId || characterId,
    };

    console.log(
      `[Supervisor] Completed: ${output.stepsExecuted} steps, ` +
        `${output.totalToolCalls} tool calls, ${output.totalDurationMs}ms, ` +
        `character=${output.characterId}`
    );

    return output;
  } catch (error) {
    const totalDurationMs = Date.now() - startTime;
    console.error(
      `[Supervisor] Graph execution failed:`,
      (error as Error).message
    );

    return {
      response: `抱歉，处理您的请求时遇到了问题：${(error as Error).message}。请稍后重试。`,
      classification: { domain: "unknown", complexity: "unknown" },
      stepsExecuted: 0,
      totalToolCalls: 0,
      totalDurationMs,
      characterId,
    };
  }
}
