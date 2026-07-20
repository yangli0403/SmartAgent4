/**
 * Supervisor Graph — 增强版顶层编排图（v3 — 多智能体协同）
 *
 * 使用 LangGraph StateGraph 构建 Supervisor 编排流程。
 *
 * SmartAgent4 V2 增强流程：
 * START → contextEnrich → classify → [plan | execute] → execute → replan → [execute | respond] → memoryExtract → reflection → END
 *
 * v1.3 改造（M4 阶段）：
 * - 在最前面加 preAnalysis 节点（preAnalysisNode → 4 路流水线）
 * - 流程变更为：START → preAnalysis → contextEnrich → classify → [plan | execute] → ...
 * - routeByComplexity → routeByExecutionMode（基于 preAnalysis 输出 + TaskClassification.executionMode）
 *
 * V2 改造：
 * - execute 节点从串行 createExecuteNode 替换为并行 createParallelExecuteNode
 * - 图构建参数从旧 AgentRegistry (Record<string, Agent>) 改为 IAgentCardRegistry
 * - 保留旧 AgentRegistry 兼容路径，当 IAgentCardRegistry 不可用时降级
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { traceable } from "langsmith/traceable";
import { SupervisorState, type UserContext } from "./state";
import { classifyNode } from "./classifyNode";
import { planNode } from "./planNode";
import { createExecuteNode, type AgentRegistry } from "./executeNode";
import { replanNode, shouldContinueAfterReplan } from "./replanNode";
import { respondNode } from "./respondNode";
import { contextEnrichNode } from "./contextEnrichNode";
import { memoryExtractionNode } from "./memoryExtractionNode";
import { reflectionNode } from "./reflectionNode";
import { createPreAnalysisNode } from "../preAnalysis/node/preAnalysisNode";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { MultimodalSegment } from "../../emotions/types";
import type { IAgentCardRegistry } from "../discovery/types";
import { createParallelExecuteNode } from "../discovery/parallelExecuteEngine";

/**
 * 构建 Supervisor 图（V2 — 支持并行执行 + v1.3 preAnalysis）
 *
 * @param agentSource - Agent 来源，支持新旧两种注册表
 * @returns 编译后的 LangGraph 图
 */
export function buildSupervisorGraph(
  agentSource: IAgentCardRegistry | AgentRegistry
) {
  // 判断是新注册表还是旧注册表
  const isNewRegistry =
    agentSource &&
    typeof (agentSource as IAgentCardRegistry).getAgent === "function" &&
    typeof (agentSource as IAgentCardRegistry).getAllEnabled === "function";

  let executeNode: (state: any) => Promise<any>;

  if (isNewRegistry) {
    // 使用并行执行引擎
    console.log("[SupervisorGraph] Using ParallelExecuteEngine with AgentCardRegistry");
    executeNode = createParallelExecuteNode(agentSource as IAgentCardRegistry);
  } else {
    // 降级使用旧串行执行节点
    console.log("[SupervisorGraph] Falling back to serial ExecuteNode with legacy AgentRegistry");
    executeNode = createExecuteNode(agentSource as AgentRegistry);
  }

  // v1.3 改造：在最前面加 preAnalysis 节点（4 路流水线：Prefetch → Rule → Similarity → LLM）
  const preAnalysis = createPreAnalysisNode({
    mode: "llm",
    enableMetrics: true,
  });

  const preAnalysisNodeFn = async (state: any) => {
    // 提取最新用户消息文本
    const messages = (state.messages || []) as BaseMessage[];
    const lastUserMessage = [...messages]
      .reverse()
      .find((m: any) => m._getType?.() === "human" || m.constructor?.name === "HumanMessage");
    const userText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content || "");

    const userId = state.context?.userId ? Number(state.context.userId) : undefined;

    const result = await preAnalysis.analyze({
      userText,
      userId,
      tenantId: state.context?.tenantId,
      conversationSummary: state.context?.conversationSummary,
      dialogueHistory: messages.slice(-6).map((m: any) => ({
        role: m._getType?.() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : "",
      })),
    });

    // M2-02：等待 scene activation 异步查询（设上限 200ms 避免阻塞 classifyNode）
    let sceneActivationResult: any = null;
    if (result.sceneActivationPromise) {
      try {
        sceneActivationResult = await Promise.race([
          result.sceneActivationPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), 200)),
        ]);
      } catch {
        sceneActivationResult = null;
      }
    }

    return {
      preAnalysisResult: result.output,
      sceneActivationResult,
    };
  };

  const graph = new StateGraph(SupervisorState)
    // 添加节点
    .addNode("preAnalysis", preAnalysisNodeFn)
    .addNode("contextEnrich", contextEnrichNode)
    .addNode("classify", classifyNode)
    .addNode("planStep", planNode)
    .addNode("execute", executeNode)
    .addNode("replan", replanNode)
    .addNode("respond", respondNode)
    .addNode("memoryExtract", memoryExtractionNode)
    .addNode("reflection", reflectionNode)

    // 定义边
    // v1.3：START → preAnalysis → contextEnrich → classify
    .addEdge(START, "preAnalysis")
    .addEdge("preAnalysis", "contextEnrich")
    .addEdge("contextEnrich", "classify")

    // classify → 根据 executionMode 路由（v1.3 替代 routeByComplexity）
    .addConditionalEdges("classify", routeByExecutionMode, {
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

    // respond → memoryExtract → reflection → END
    .addEdge("respond", "memoryExtract")
    .addEdge("memoryExtract", "reflection")
    .addEdge("reflection", END);

  return graph.compile();
}

/**
 * 路由：基于 TaskClassification.executionMode 决定走向（v1.3 替代 routeByComplexity）
 *
 * - "single" / "parallel" → execute（直接调度 Agent，无需 plan）
 * - "plan" → planStep（多步骤计划）
 * - 缺失/未知 → execute（安全降级）
 */
export function routeByExecutionMode(
  state: any
): "execute" | "plan" {
  const tc = state?.taskClassification;
  if (!tc) return "execute";
  if (tc.executionMode === "plan") return "plan";
  return "execute";
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
  /** 任务分类结果（v1.3 引入 executionMode） */
  classification: {
    domain: string;
    executionMode: string;
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
  /**
   * SmartAgent4 新增：多模态输出片段
   *
   * 当 AIRI Bridge 启用且 Emotions-System 可用时填充。
   * 包含文本、音频、情感和动作指令。
   */
  multimodalSegments?: MultimodalSegment[];
}

/**
 * 运行 Supervisor 图（带 LangSmith 追踪）
 *
 * 将外部输入转换为 LangGraph 状态，执行图，提取输出。
 * traceable 包装会在 LangSmith 中生成 "Supervisor_Run" Span，
 * 包含整个 Supervisor 图的执行过程、节点流转和最终结果。
 *
 * V2 增强：支持 IAgentCardRegistry 和旧 AgentRegistry 两种注册表。
 *
 * @param input - 外部输入
 * @param agentSource - Agent 来源（新注册表或旧注册表）
 * @returns Supervisor 输出
 */
export const runSupervisor = traceable(
  async function runSupervisor(
  input: SupervisorInput,
  agentSource: IAgentCardRegistry | AgentRegistry
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
  const compiledGraph = buildSupervisorGraph(agentSource);

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
        executionMode: finalState.taskClassification?.executionMode || "single",
        complexity: finalState.taskClassification?.complexity || "simple",
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
      classification: { domain: "unknown", executionMode: "single", complexity: "simple" },
      stepsExecuted: 0,
      totalToolCalls: 0,
      totalDurationMs,
      characterId,
    };
  }
},
  { name: "Supervisor_Run", run_type: "chain" }
);
