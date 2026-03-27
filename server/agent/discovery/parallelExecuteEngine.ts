/**
 * ParallelExecuteEngine — 并行执行引擎
 *
 * 基于 PlanStep.dependsOn 构建 DAG（有向无环图），
 * 将无依赖的步骤并行分发（Promise.all），
 * 有依赖的步骤等待前置完成后再执行。
 *
 * 替代原有 executeNode.ts 中的串行遍历逻辑。
 */

import type {
  ExecutionBatch,
  IParallelExecuteEngine,
  IAgentCardRegistry,
} from "./types";
import type { PlanStep, StepResult, ToolCallRecord, SupervisorStateType } from "../supervisor/state";
import type { DomainAgentInterface, AgentExecutionInput } from "../domains/types";
import { HumanMessage } from "@langchain/core/messages";

// ==================== DAG 分析器 ====================

/**
 * 分析步骤依赖关系，生成按拓扑序排列的执行批次
 *
 * 使用 Kahn 算法进行拓扑排序，将步骤分组为可并行执行的批次。
 * 同一批次内的步骤互不依赖，可以通过 Promise.all 并行执行。
 */
export function analyzeDependencies(
  steps: Array<{ id: number; dependsOn: number[] }>
): ExecutionBatch[] {
  if (steps.length === 0) return [];

  // 构建入度表和邻接表
  const inDegree = new Map<number, number>();
  const adjacency = new Map<number, number[]>();
  const stepIds = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (stepIds.has(dep)) {
        inDegree.set(step.id, (inDegree.get(step.id) || 0) + 1);
        adjacency.get(dep)?.push(step.id);
      }
    }
  }

  // Kahn 算法：按层级分批
  const batches: ExecutionBatch[] = [];
  let batchIndex = 0;

  // 初始队列：入度为 0 的节点
  let queue = steps
    .filter((s) => (inDegree.get(s.id) || 0) === 0)
    .map((s) => s.id);

  while (queue.length > 0) {
    batches.push({
      batchIndex,
      stepIds: [...queue],
    });

    const nextQueue: number[] = [];
    for (const nodeId of queue) {
      for (const neighbor of adjacency.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }

    queue = nextQueue;
    batchIndex++;
  }

  // 检测循环依赖
  const processedCount = batches.reduce((sum, b) => sum + b.stepIds.length, 0);
  if (processedCount < steps.length) {
    console.warn(
      `[ParallelExecuteEngine] Circular dependency detected! Processed ${processedCount}/${steps.length} steps`
    );
    // 将未处理的步骤作为最后一个批次（降级为串行）
    const processedIds = new Set(batches.flatMap((b) => b.stepIds));
    const remaining = steps
      .filter((s) => !processedIds.has(s.id))
      .map((s) => s.id);
    if (remaining.length > 0) {
      batches.push({ batchIndex, stepIds: remaining });
    }
  }

  return batches;
}

// ==================== 并行执行引擎 ====================

/**
 * 创建并行执行节点
 *
 * 返回一个 LangGraph 兼容的节点函数，替代原有的串行 executeNode。
 *
 * @param registry - Agent Card 注册表
 * @returns LangGraph 节点函数
 */
export function createParallelExecuteNode(registry: IAgentCardRegistry) {
  return async function parallelExecuteNode(
    state: SupervisorStateType
  ): Promise<Partial<SupervisorStateType>> {
    const { plan, currentStepIndex, stepResults, messages, context } = state;

    if (!plan || plan.length === 0) {
      console.warn("[ParallelExecuteEngine] No plan to execute");
      return {};
    }

    // 获取尚未执行的步骤
    const completedStepIds = new Set(
      (stepResults || []).map((r: StepResult) => r.stepId)
    );
    const remainingSteps = plan.filter(
      (step: PlanStep) => !completedStepIds.has(step.id)
    );

    if (remainingSteps.length === 0) {
      console.log("[ParallelExecuteEngine] All steps completed");
      return { currentStepIndex: plan.length };
    }

    // 分析依赖关系，获取当前可执行的批次
    const batches = analyzeDependencies(remainingSteps);
    if (batches.length === 0) {
      return { currentStepIndex: plan.length };
    }

    // 只执行第一个批次（当前可并行的步骤）
    const currentBatch = batches[0];
    const batchSteps = currentBatch.stepIds
      .map((id) => plan.find((s: PlanStep) => s.id === id))
      .filter((s): s is PlanStep => s !== undefined);

    console.log(
      `[ParallelExecuteEngine] Executing batch ${currentBatch.batchIndex}: ` +
        `${batchSteps.map((s) => `Step ${s.id} [${s.targetAgent}]`).join(", ")}`
    );

    // 提取用户消息
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m instanceof HumanMessage || m._getType() === "human");
    const userText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content || "");

    // 并行执行本批次所有步骤
    const batchResults = await Promise.all(
      batchSteps.map((step) =>
        executeStep(step, registry, userText, stepResults || [], messages, context)
      )
    );

    // 计算新的 currentStepIndex
    const maxCompletedId = Math.max(
      ...batchResults.map((r) => r.stepId),
      currentStepIndex
    );
    const newIndex = plan.findIndex((s: PlanStep) => s.id > maxCompletedId);

    return {
      stepResults: batchResults,
      currentStepIndex: newIndex === -1 ? plan.length : newIndex,
    };
  };
}

// ==================== 单步执行辅助函数 ====================

/**
 * 执行单个步骤
 *
 * 从 AgentCardRegistry 获取 Agent 实例，构建输入，调用 execute()。
 */
async function executeStep(
  step: PlanStep,
  registry: IAgentCardRegistry,
  userMessage: string,
  previousResults: StepResult[],
  messages: any[],
  context: any
): Promise<StepResult> {
  const startTime = Date.now();

  try {
    // 1. 从注册表获取 Agent 实例
    const agent = registry.getAgent(step.targetAgent);
    if (!agent) {
      console.error(
        `[ParallelExecuteEngine] Agent not found: ${step.targetAgent}`
      );
      return {
        stepId: step.id,
        status: "error",
        error: `Agent "${step.targetAgent}" not found in registry`,
        durationMs: Date.now() - startTime,
        toolCalls: [],
      };
    }

    // 2. 解析 inputMapping（从前置步骤结果中提取数据）
    const resolvedInputs = resolveInputMapping(
      step.inputMapping,
      previousResults
    );

    // 3. 构建执行输入
    const input: AgentExecutionInput = {
      step,
      userMessage,
      resolvedInputs,
      conversationHistory: messages,
      context: context
        ? {
            userId: context.userId,
            location: context.location,
            currentTime: context.currentTime,
          }
        : undefined,
    };

    // 4. 执行
    console.log(
      `[ParallelExecuteEngine] Step ${step.id}: executing with ${step.targetAgent}`
    );
    const output = await agent.execute(input);

    return {
      stepId: step.id,
      status: output.success ? "success" : "error",
      output: output.output,
      error: output.error,
      durationMs: Date.now() - startTime,
      toolCalls: output.toolCalls,
    };
  } catch (error) {
    return {
      stepId: step.id,
      status: "error",
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
      toolCalls: [],
    };
  }
}

/**
 * 解析 inputMapping
 *
 * 将 "step_N.field" 格式的引用解析为实际值。
 */
export function resolveInputMapping(
  mapping: Record<string, string>,
  previousResults: StepResult[]
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [paramName, reference] of Object.entries(mapping)) {
    // 格式: "step_1.output" 或 "step_2.structuredData.pois"
    const match = reference.match(/^step_(\d+)\.(.+)$/);
    if (!match) {
      resolved[paramName] = reference;
      continue;
    }

    const stepId = parseInt(match[1], 10);
    const fieldPath = match[2];

    const stepResult = previousResults.find((r) => r.stepId === stepId);
    if (!stepResult) {
      console.warn(
        `[ParallelExecuteEngine] Step ${stepId} result not found for mapping "${paramName}"`
      );
      resolved[paramName] = undefined;
      continue;
    }

    // 简单字段访问
    if (fieldPath === "output") {
      resolved[paramName] = stepResult.output;
    } else {
      // 尝试从 output JSON 中提取嵌套字段
      try {
        const outputObj = JSON.parse(stepResult.output || "{}");
        const parts = fieldPath.split(".");
        let value: any = outputObj;
        for (const part of parts) {
          value = value?.[part];
        }
        resolved[paramName] = value;
      } catch {
        resolved[paramName] = stepResult.output;
      }
    }
  }

  return resolved;
}
