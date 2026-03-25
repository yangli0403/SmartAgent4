/**
 * Supervisor 模块入口
 *
 * 导出 Supervisor 图构建器、运行函数和所有相关类型。
 */

// 状态和类型
export {
  SupervisorState,
  type SupervisorStateType,
  type TaskClassification,
  type TaskDomain,
  type TaskComplexity,
  type PlanStep,
  type ExecutionPlan,
  type StepResult,
  type StepStatus,
  type ToolCallRecord,
  type ReplanDecision,
  type ReplanAction,
  type UserContext,
  type UserLocation,
} from "./state";

// 节点
export { classifyNode, routeByComplexity, CLASSIFY_SYSTEM_PROMPT } from "./classifyNode";
export { planNode, PLAN_SYSTEM_PROMPT } from "./planNode";
export { createExecuteNode, resolveInputMapping, type AgentRegistry } from "./executeNode";
export { replanNode, shouldContinueAfterReplan, REPLAN_SYSTEM_PROMPT } from "./replanNode";
export { respondNode, RESPOND_SYSTEM_PROMPT } from "./respondNode";
export { contextEnrichNode } from "./contextEnrichNode";
export { memoryExtractionNode } from "./memoryExtractionNode";
export { reflectionNode, type PromptPatch } from "./reflectionNode";

// 图构建和运行
export {
  buildSupervisorGraph,
  runSupervisor,
  type SupervisorInput,
  type SupervisorOutput,
} from "./supervisorGraph";
