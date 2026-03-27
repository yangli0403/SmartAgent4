/**
 * Agent Card 动态发现层 — 模块入口
 *
 * 导出 Agent Card 注册表、动态 Prompt 组装器、并行执行引擎
 * 和所有相关类型。
 */

// 类型定义
export type {
  AgentCard,
  AgentDomain,
  AgentLLMConfig,
  IAgentCardRegistry,
  IDynamicPromptAssembler,
  DelegateRequest,
  DelegateResult,
  IDelegatableAgent,
  ExecutionBatch,
  IParallelExecuteEngine,
} from "./types";

// Agent Card 注册表
export {
  AgentCardRegistry,
  AgentCardSchema,
  getAgentCardRegistry,
  resetAgentCardRegistry,
} from "./agentCardRegistry";

// 动态 Prompt 组装器
export {
  DynamicPromptAssembler,
  createDynamicPromptAssembler,
} from "./dynamicPromptAssembler";

// 并行执行引擎
export {
  analyzeDependencies,
  createParallelExecuteNode,
  resolveInputMapping,
} from "./parallelExecuteEngine";
