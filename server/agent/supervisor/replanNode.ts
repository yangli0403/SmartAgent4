/**
 * Replan Node — 重规划节点
 *
 * 在每步执行完成后评估结果，决定是继续执行下一步、
 * 重新规划、标记完成还是中止任务。
 */

import type {
  SupervisorStateType,
  ReplanDecision,
  PlanStep,
} from "./state";
import { callLLMStructured } from "../../llm/langchainAdapter";

/**
 * replanNode 的 LLM 系统提示词
 */
export const REPLAN_SYSTEM_PROMPT = `你是一个任务执行评估专家。根据当前执行进度和结果，决定下一步行动。

你需要评估：
1. 当前步骤是否成功完成
2. 是否还有剩余步骤需要执行
3. 是否需要根据执行结果调整后续计划
4. 是否已经可以生成最终回复

请以 JSON 格式输出（不要包含其他文字）：
{
  "action": "continue|replan|complete|abort",
  "reasoning": "决策推理过程",
  "updatedPlan": [],
  "finalResponse": "",
  "abortReason": ""
}

决策规则：
- continue: 当前步骤成功且还有后续步骤需要执行
- replan: 当前步骤失败或结果不符合预期，需要调整后续计划
- complete: 所有步骤已完成或已获得足够信息可以回复用户
- abort: 遇到无法恢复的错误（如关键工具不可用）`;

/**
 * 重规划节点
 *
 * 评估执行进度，决定下一步行动。
 * 对于简单的"继续/完成"决策使用规则判断，
 * 对于需要重规划的情况调用 LLM。
 */
export async function replanNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  const { plan, currentStepIndex, stepResults } = state;

  console.log(
    `[ReplanNode] Evaluating: ${stepResults.length} steps completed, ${plan.length - currentStepIndex} remaining`
  );

  // 获取最新的步骤结果
  const lastResult = stepResults[stepResults.length - 1];

  // 快速路径1：所有步骤已完成
  if (currentStepIndex >= plan.length) {
    console.log("[ReplanNode] All steps completed → respond");
    return {};
  }

  // 快速路径2：最新步骤成功且还有后续步骤
  if (lastResult && lastResult.status === "success") {
    console.log(
      `[ReplanNode] Step ${lastResult.stepId} succeeded → continue to step ${currentStepIndex + 1}`
    );
    return {};
  }

  // 需要 LLM 评估的情况：步骤失败或状态异常
  if (lastResult && lastResult.status !== "success") {
    console.log(
      `[ReplanNode] Step ${lastResult.stepId} failed (${lastResult.status}), consulting LLM for replan decision...`
    );

    try {
      // 构建评估请求
      const evalRequest = buildEvalRequest(state);
      const decision = await callLLMStructured<ReplanDecision>(
        REPLAN_SYSTEM_PROMPT,
        evalRequest,
        { temperature: 0.2 }
      );

      console.log(
        `[ReplanNode] LLM decision: ${decision.action} — ${decision.reasoning}`
      );

      // 根据决策更新状态
      switch (decision.action) {
        case "replan":
          if (decision.updatedPlan && decision.updatedPlan.length > 0) {
            return {
              plan: decision.updatedPlan,
              currentStepIndex: 0,
            };
          }
          // 如果没有提供新计划，继续执行
          return {};

        case "complete":
          if (decision.finalResponse) {
            return {
              finalResponse: decision.finalResponse,
              currentStepIndex: plan.length, // 标记完成
            };
          }
          return {};

        case "abort":
          return {
            finalResponse:
              decision.abortReason ||
              "抱歉，任务执行遇到了无法恢复的错误。",
            currentStepIndex: plan.length, // 标记完成
          };

        case "continue":
        default:
          return {};
      }
    } catch (error) {
      console.error(
        "[ReplanNode] LLM evaluation failed:",
        (error as Error).message
      );
      // LLM 评估失败，尝试继续执行
      return {};
    }
  }

  return {};
}

/**
 * 路由函数：根据当前状态路由到下一个节点
 */
export function shouldContinueAfterReplan(
  state: SupervisorStateType
): "execute" | "respond" {
  const { plan, currentStepIndex, finalResponse } = state;

  // 如果已有最终回复（complete 或 abort）
  if (finalResponse && finalResponse.length > 0) {
    return "respond";
  }

  // 如果还有剩余步骤
  if (currentStepIndex < plan.length) {
    return "execute";
  }

  // 所有步骤完成
  return "respond";
}

/**
 * 构建评估请求文本
 */
function buildEvalRequest(state: SupervisorStateType): string {
  const { plan, currentStepIndex, stepResults } = state;

  let request = "当前执行状态：\n";

  // 已完成步骤
  request += "\n已完成步骤：\n";
  for (const result of stepResults) {
    const step = plan.find((s) => s.id === result.stepId);
    request += `- Step ${result.stepId} [${step?.targetAgent || "unknown"}]: ${result.status}`;
    if (result.output) {
      request += ` — ${result.output.substring(0, 200)}`;
    }
    if (result.error) {
      request += ` — ERROR: ${result.error}`;
    }
    request += "\n";
  }

  // 剩余步骤
  const remaining = plan.slice(currentStepIndex);
  if (remaining.length > 0) {
    request += "\n剩余步骤：\n";
    for (const step of remaining) {
      request += `- Step ${step.id} [${step.targetAgent}]: ${step.description}\n`;
    }
  } else {
    request += "\n没有剩余步骤。\n";
  }

  return request;
}
