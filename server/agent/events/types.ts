/**
 * Agent 事件系统 — 类型定义
 *
 * 定义多智能体协同中的事件通知机制。
 * 用于 Fork 子代理完成任务后向 Supervisor 发送通知。
 *
 * 第五轮迭代新增：借鉴 Claude Code 的 task-notification 机制
 */

import type { ToolCallRecord } from "../supervisor/state";

// ==================== 事件类型 ====================

/** 所有支持的事件类型 */
export type AgentEventType =
  | "taskCompleted"
  | "taskFailed"
  | "taskProgress";

/**
 * 任务完成事件
 *
 * 子代理执行完毕后触发，向 Supervisor 汇报结果。
 */
export interface TaskCompletedEvent {
  /** 唯一任务 ID */
  taskId: string;
  /** 执行该任务的 Agent ID */
  agentId: string;
  /** 父代理 ID（发起委托的 Agent） */
  parentAgentId: string;
  /** 是否成功 */
  success: boolean;
  /** 执行结果文本 */
  output: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 事件时间戳 */
  timestamp: number;
}

/**
 * 任务进度事件
 *
 * 子代理执行过程中的中间状态汇报。
 */
export interface TaskProgressEvent {
  /** 唯一任务 ID */
  taskId: string;
  /** 执行该任务的 Agent ID */
  agentId: string;
  /** 进度描述 */
  message: string;
  /** 进度百分比（0-100） */
  progress?: number;
  /** 事件时间戳 */
  timestamp: number;
}

// ==================== Fork 上下文 ====================

/**
 * Fork 上下文 — 父子代理间的共享状态
 *
 * 当父代理通过 delegate() 创建子代理时，
 * 通过 ForkContext 传递共享的背景知识，
 * 避免子代理重复读取上下文，减少 Token 消耗。
 */
export interface ForkContext {
  /** 父代理的对话历史摘要（用于共享背景知识） */
  conversationSummary: string;
  /** 父代理的对话历史（完整版，用于深度共享） */
  conversationHistory: Array<{ role: string; content: string }>;
  /** 共享的用户上下文 */
  userContext: Record<string, unknown>;
  /** Fork 创建时间 */
  createdAt: number;
}

// ==================== 事件监听器类型 ====================

export type TaskCompletedListener = (event: TaskCompletedEvent) => void;
export type TaskProgressListener = (event: TaskProgressEvent) => void;
