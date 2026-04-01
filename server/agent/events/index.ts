/**
 * Agent 事件系统 — 模块入口
 *
 * 第五轮迭代新增：多智能体协同事件通知机制
 */

// 类型定义
export type {
  AgentEventType,
  TaskCompletedEvent,
  TaskProgressEvent,
  ForkContext,
  TaskCompletedListener,
  TaskProgressListener,
} from "./types";

// 事件总线
export {
  AgentEventBus,
  getAgentEventBus,
  resetAgentEventBus,
} from "./agentEventBus";
