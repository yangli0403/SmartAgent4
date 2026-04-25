/**
 * runSupervisorStreaming（v0.5 引入）
 *
 * 与 runSupervisor 等价的执行入口，但额外通过 supervisorEventBus 推送中间事件。
 * 不修改 LangGraph 节点内部，仅在外层用 compiledGraph.stream() 监听状态变化。
 *
 * 设计要点：
 * - 输入新增 requestId（必填）：与前端 SSE 订阅通道关联
 * - 输出与 runSupervisor 完全一致（SupervisorOutput）
 * - 异常时也会发布 type: "error" 事件，前端可据此把 thinking 气泡置为 failed
 *
 * 与 runSupervisor 的关系：
 * - 现有调用方（如 supervisorChatRouter.sendMessage）若不需要流式可继续用 runSupervisor
 * - 流式调用方（新版 sendMessage 可选路径、SSE 订阅前的预热）使用本函数
 */
import { traceable } from "langsmith/traceable";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { buildSupervisorGraph } from "./supervisorGraph";
import type {
  SupervisorInput,
  SupervisorOutput,
} from "./supervisorGraph";
import type { UserContext } from "./state";
import type { IAgentCardRegistry } from "../discovery/types";
import type { AgentRegistry } from "./executeNode";
import {
  publishEventsFromUpdates,
  type StreamingContext,
  type StreamUpdate,
} from "./supervisorStreaming";
import { publishSupervisorEvent } from "./supervisorEventBus";

export interface SupervisorStreamingInput extends SupervisorInput {
  /** 与前端 SSE 通道关联的请求 ID（必须在 mutation 调用之前生成） */
  requestId: string;
}

/**
 * 运行 Supervisor 图（流式版本）
 */
export const runSupervisorStreaming = traceable(
  async function runSupervisorStreaming(
    input: SupervisorStreamingInput,
    agentSource: IAgentCardRegistry | AgentRegistry
  ): Promise<SupervisorOutput> {
    const startTime = Date.now();
    const { requestId } = input;

    console.log(
      `[SupervisorStreaming] Starting requestId=${requestId} user=${input.context.userId}`
    );

    // 构建初始状态（与 runSupervisor 保持一致）
    const messages: BaseMessage[] = [];
    if (input.conversationHistory) {
      for (const msg of input.conversationHistory) {
        if (msg.role === "user" || msg.role === "human") {
          messages.push(new HumanMessage(msg.content));
        } else if (msg.role === "assistant" || msg.role === "ai") {
          messages.push(new AIMessage(msg.content));
        }
      }
    }
    messages.push(new HumanMessage(input.userMessage));

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

    const compiledGraph = buildSupervisorGraph(agentSource);
    const characterId = input.context.characterId || "xiaozhi";
    const initialState = { messages, context: userContext, characterId };

    const ctx: StreamingContext = { requestId };
    let finalState: any = null;

    try {
      // LangGraph 1.x: compiledGraph.stream() 返回 AsyncIterable<update>
      // 每个 update 是 { [nodeName]: partialState } 的 record；我们关心字段而非节点名
      const stream = await compiledGraph.stream(initialState);

      for await (const chunk of stream) {
        // 节点 update 形如 { classify: { taskClassification: {...} } }
        // 把所有节点的 partial 合并为一个 StreamUpdate 视图
        const merged: StreamUpdate = {};
        for (const nodeName of Object.keys(chunk)) {
          const partial = (chunk as Record<string, unknown>)[nodeName] as
            | StreamUpdate
            | undefined;
          if (!partial) continue;
          Object.assign(merged, partial);
        }
        publishEventsFromUpdates(merged, ctx);

        // 累计组装最终状态视图（用于最后构造 SupervisorOutput）
        if (finalState === null) finalState = {};
        Object.assign(finalState, merged);
      }

      const totalDurationMs = Date.now() - startTime;
      const stepResults = (finalState?.stepResults || []) as Array<any>;
      const totalToolCalls = stepResults.reduce(
        (sum: number, r: any) => sum + (r.toolCalls?.length || 0),
        0
      );

      const output: SupervisorOutput = {
        response:
          finalState?.finalResponse ||
          "抱歉，我无法处理您的请求。请尝试重新描述。",
        classification: {
          domain: finalState?.taskClassification?.domain || "unknown",
          complexity: finalState?.taskClassification?.complexity || "unknown",
        },
        stepsExecuted: stepResults.length,
        totalToolCalls,
        totalDurationMs,
        characterId: finalState?.characterId || characterId,
      };

      console.log(
        `[SupervisorStreaming] Completed requestId=${requestId}: ${output.stepsExecuted} steps, ` +
          `${output.totalToolCalls} tool calls, ${output.totalDurationMs}ms`
      );

      return output;
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;
      const message = (error as Error).message || "unknown error";
      console.error(
        `[SupervisorStreaming] Graph execution failed requestId=${requestId}:`,
        message
      );

      // 发布错误事件，让前端 ThinkingBubble 能切换为 failed 态
      publishSupervisorEvent({
        requestId,
        type: "error",
        phase: "error",
        summary: `执行失败：${message}`,
        payload: { message },
      });

      return {
        response: `抱歉，处理您的请求时遇到了问题：${message}。请稍后重试。`,
        classification: { domain: "unknown", complexity: "unknown" },
        stepsExecuted: 0,
        totalToolCalls: 0,
        totalDurationMs,
        characterId,
      };
    }
  },
  { name: "Supervisor_Streaming_Run", run_type: "chain" }
);
