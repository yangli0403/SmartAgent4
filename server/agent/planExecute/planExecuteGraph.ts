/**
 * Plan-and-Execute 图：先规划再执行，状态显式流转
 * 复杂条件约束搜索、跨域任务共用此图
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { PlanExecuteStateSchema, type PlanExecuteStateType, type PlanExecuteUpdateType } from "./graphState";
import { planComplexConditional } from "../tasks/complexConditionalTask";
import { planCrossDomainOnly, groupStepsByDomain, DEFAULT_DOMAINS } from "../tasks/crossDomainTask";
import {
  resolveStepParameters,
  updateContextAfterStep,
  getFirstPathFromOutputs,
} from "../tasks/placeholderResolution";
import type { ToolExecutor, TaskStep } from "../tasks/types";

function planNode(state: PlanExecuteStateType): PlanExecuteUpdateType {
  const { taskType, userInput, options } = state;
  console.log("[Task] 链路-Plan-Execute plan 节点: taskType=", taskType, "plan 步骤数即将生成");

  if (taskType === "complex_conditional") {
    const steps = planComplexConditional({
      userInput,
      defaultSearchDirectory: options?.defaultSearchDirectory,
    });
    console.log("[Task] 链路-Plan-Execute plan 输出步骤:", steps.length, steps.map((s: TaskStep) => s.tool).join(", "));
    return { plan: steps };
  }

  const steps = planCrossDomainOnly({
    userInput,
    domains: options?.domains ?? DEFAULT_DOMAINS,
  });
  const domains = options?.domains ?? DEFAULT_DOMAINS;
  const stepsByDomain = groupStepsByDomain(steps, domains);
  console.log("[Task] 链路-Plan-Execute plan 输出步骤:", steps.length, steps.map((s: TaskStep) => s.tool).join(", "));
  return { plan: steps, stepsByDomain };
}

function createExecuteNode(executor: ToolExecutor) {
  return async (state: PlanExecuteStateType): Promise<PlanExecuteUpdateType> => {
    const { plan } = state;
    const outputs: unknown[] = [];
    const ctx = { outputs, firstPath: undefined as string | undefined, lastCreateFolderPath: undefined as string | undefined };

    console.log("[Task] 链路-Plan-Execute execute 节点: 开始，步骤数:", plan.length);
    if (plan.length === 0) {
      const isComplex = state.taskType === "complex_conditional";
      return {
        outputs: [],
        success: false,
        error: isComplex
          ? "无法从输入中解析出可执行的搜索条件（需包含文件类型如 pdf/ppt）"
          : "规划步骤为空",
      };
    }

    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const params = resolveStepParameters(step, ctx);
      console.log("[Task] 链路-Plan-Execute 执行步骤", i + 1, "/", plan.length, ":", step.tool, JSON.stringify(params));

      try {
        const out = await executor.executeTool(step.tool, params);
        outputs.push(out);
        updateContextAfterStep(ctx, step.tool, out);
        console.log("[Task] 链路-Plan-Execute 步骤", i + 1, "结果: 成功");
      } catch (e: any) {
        const errMsg = e?.message ?? String(e);
        console.log("[Task] 链路-Plan-Execute 步骤", i + 1, "结果: 失败", errMsg);
        return {
          outputs,
          success: false,
          error: errMsg,
        } as PlanExecuteUpdateType;
      }
    }

    const firstPath = ctx.firstPath ?? getFirstPathFromOutputs(outputs);
    const summary =
      state.taskType === "complex_conditional"
        ? firstPath ? `已打开：${firstPath}` : "已按条件执行搜索与打开"
        : "跨域任务已按顺序执行";

    return { outputs, success: true, summary } as PlanExecuteUpdateType;
  };
}

/**
 * 创建已绑定 executor 的 Plan-Execute 编译图
 * 每次调用时用当前 executor 创建图并 invoke，避免依赖 configurable 传递
 */
export function createPlanExecuteGraph(executor: ToolExecutor) {
  const executeNode = createExecuteNode(executor);
  const graph = new StateGraph(PlanExecuteStateSchema)
    .addNode("planning", planNode)
    .addNode("execution", executeNode)
    .addEdge(START, "planning")
    .addEdge("planning", "execution")
    .addEdge("execution", END);

  return graph.compile();
}

export type { PlanExecuteStateType, PlanExecuteUpdateType };
