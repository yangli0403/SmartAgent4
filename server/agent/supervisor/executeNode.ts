/**
 * Execute Node — 执行分发节点
 *
 * 根据当前步骤的 targetAgent 将任务分发到对应的 Domain Agent，
 * 收集执行结果并写入 state.stepResults。
 */

import type { SupervisorStateType, StepResult, PlanStep } from "./state";
import type {
  DomainAgentInterface,
  AgentExecutionInput,
} from "../domains/types";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

/**
 * Domain Agent 注册表类型
 */
export type AgentRegistry = Record<string, DomainAgentInterface>;

/**
 * 创建执行分发节点
 *
 * 使用工厂函数模式，注入 Agent 注册表。
 */
export function createExecuteNode(agentRegistry: AgentRegistry) {
  return async function executeNode(
    state: SupervisorStateType
  ): Promise<Partial<SupervisorStateType>> {
    const { plan, currentStepIndex, stepResults, messages, context } = state;

    // 1. 获取当前步骤
    if (currentStepIndex >= plan.length) {
      console.warn(
        "[ExecuteNode] No more steps to execute (index out of range)"
      );
      return {};
    }

    const currentStep = plan[currentStepIndex];
    console.log(
      `[ExecuteNode] Executing step ${currentStep.id}/${plan.length}: [${currentStep.targetAgent}] ${currentStep.description}`
    );

    // 2. 查找 Domain Agent
    const agent = agentRegistry[currentStep.targetAgent];
    if (!agent) {
      console.error(
        `[ExecuteNode] Agent not found: ${currentStep.targetAgent}`
      );

      const errorResult: StepResult = {
        stepId: currentStep.id,
        status: "error",
        error: `Agent not found: ${currentStep.targetAgent}`,
        durationMs: 0,
        toolCalls: [],
      };

      return {
        stepResults: [errorResult],
        currentStepIndex: currentStepIndex + 1,
      };
    }

    // 3. 解析 inputMapping
    const resolvedInputs = resolveInputMapping(currentStep, stepResults);

    // 4. 提取用户原始消息
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m instanceof HumanMessage || m._getType() === "human");

    const userText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content || "");

    // 5. 构建 Agent 执行输入
    const executionInput: AgentExecutionInput = {
      step: currentStep,
      userMessage: userText,
      resolvedInputs,
      conversationHistory: messages,
      context: context
        ? {
            userId: context.userId,
            location: context.location
              ? {
                  latitude: context.location.latitude,
                  longitude: context.location.longitude,
                  city: context.location.city,
                }
              : undefined,
            currentTime: context.currentTime,
          }
        : undefined,
    };

    // 6. 执行 Domain Agent
    try {
      const agentOutput = await agent.execute(executionInput);

      const result: StepResult = {
        stepId: currentStep.id,
        status: agentOutput.success ? "success" : "error",
        output: agentOutput.output,
        error: agentOutput.error,
        durationMs: agentOutput.durationMs,
        toolCalls: agentOutput.toolCalls,
      };

      console.log(
        `[ExecuteNode] Step ${currentStep.id} completed: ${result.status} (${result.durationMs}ms, ${result.toolCalls?.length || 0} tool calls)`
      );

      // 7. 将 Agent 输出作为 AI 消息追加到消息流
      const aiMessage = new AIMessage(
        `[${currentStep.targetAgent} - Step ${currentStep.id}] ${agentOutput.output}`
      );

      return {
        messages: [aiMessage],
        stepResults: [result],
        currentStepIndex: currentStepIndex + 1,
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error(
        `[ExecuteNode] Step ${currentStep.id} failed with exception: ${errorMsg}`
      );

      const errorResult: StepResult = {
        stepId: currentStep.id,
        status: "error",
        error: errorMsg,
        durationMs: 0,
        toolCalls: [],
      };

      return {
        stepResults: [errorResult],
        currentStepIndex: currentStepIndex + 1,
      };
    }
  };
}

/**
 * 解析步骤的输入映射
 *
 * 从已完成步骤的结果中提取指定字段，作为当前步骤的输入。
 */
export function resolveInputMapping(
  step: PlanStep,
  completedResults: StepResult[]
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, mapping] of Object.entries(step.inputMapping)) {
    // mapping 格式: "step_{id}.{field}" 例如 "step_1.output"
    const match = mapping.match(/^step_(\d+)\.(.+)$/);
    if (match) {
      const stepId = parseInt(match[1], 10);
      const field = match[2];
      const result = completedResults.find((r) => r.stepId === stepId);

      if (result) {
        if (field === "output") {
          resolved[key] = result.output;
        } else if (field === "status") {
          resolved[key] = result.status;
        } else if (field === "error") {
          resolved[key] = result.error;
        } else {
          // 尝试从 output 中解析 JSON 并提取字段
          try {
            if (result.output) {
              const parsed = JSON.parse(result.output);
              resolved[key] = parsed[field];
            }
          } catch {
            // output 不是 JSON，使用原始值
            resolved[key] = result.output;
          }
        }
      } else {
        console.warn(
          `[ExecuteNode] Input mapping: step_${stepId} result not found for key "${key}"`
        );
      }
    } else {
      // 非 step 引用，直接使用值
      resolved[key] = mapping;
    }
  }

  if (Object.keys(resolved).length > 0) {
    console.log(
      `[ExecuteNode] Resolved inputs for step ${step.id}:`,
      JSON.stringify(resolved).substring(0, 200)
    );
  }

  return resolved;
}
