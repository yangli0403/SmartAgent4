/**
 * Plan-and-Execute 图状态定义
 * 与 ComplexConditionalResult / CrossDomainResult 对齐，便于 agentEngine 映射
 */

import { Annotation } from "@langchain/langgraph";
import type { TaskStep, TaskDomain } from "../tasks/types";

export interface PlanExecuteOptions {
  defaultSearchDirectory?: string;
  domains?: TaskDomain[];
}

/** 图状态：规划与执行结果 */
export interface PlanExecuteState {
  taskType: "complex_conditional" | "cross_domain";
  userInput: string;
  options?: PlanExecuteOptions;
  plan: TaskStep[];
  outputs: unknown[];
  success: boolean;
  summary?: string;
  error?: string;
  /** 仅 cross_domain 使用，与 CrossDomainResult.stepsByDomain 一致 */
  stepsByDomain?: Partial<Record<TaskDomain, TaskStep[]>>;
}

const PlanExecuteStateAnnotation = Annotation.Root({
  taskType: Annotation<"complex_conditional" | "cross_domain">(),
  userInput: Annotation<string>(),
  options: Annotation<PlanExecuteOptions | undefined>(),
  plan: Annotation<TaskStep[]>({
    reducer: (_left, right) => (right ?? []),
    default: () => [],
  }),
  outputs: Annotation<unknown[]>({
    reducer: (_left, right) => (right ?? []),
    default: () => [],
  }),
  success: Annotation<boolean>(),
  summary: Annotation<string | undefined>(),
  error: Annotation<string | undefined>(),
  stepsByDomain: Annotation<Partial<Record<TaskDomain, TaskStep[]>> | undefined>({
    reducer: (_left, right) => right ?? undefined,
    default: () => undefined,
  }),
});

export const PlanExecuteStateSchema = PlanExecuteStateAnnotation;
export type PlanExecuteStateType = typeof PlanExecuteStateAnnotation.State;
export type PlanExecuteUpdateType = typeof PlanExecuteStateAnnotation.Update;
