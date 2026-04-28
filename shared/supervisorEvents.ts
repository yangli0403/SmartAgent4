/**
 * Supervisor 流式事件共享类型（v0.5 引入）
 *
 * 这些类型同时被以下场景使用：
 * - 后端 supervisorEventBus.publish / subscribe（进程内 EventEmitter）
 * - SSE 端点 /api/supervisor/stream（HTTP 序列化）
 * - 前端 useSupervisorStream Hook（EventSource 反序列化）
 *
 * 类型源单一原则：禁止前后端各自重定义形状不同的 SupervisorEvent。
 */

import type { ChatThinkingPhase } from "./chatTts";

/** Supervisor 事件类型枚举 */
export type SupervisorEventType =
  | "classified"
  | "memory_recalled"
  | "plan_ready"
  | "step_started"
  | "step_finished"
  | "replan"
  | "responding"
  | "reflecting"
  | "reflected"
  | "memory_extracted"
  | "final"
  | "error";

/** 标准事件信封（SSE / 进程内 EventBus 共用） */
export interface SupervisorEventEnvelope<P = unknown> {
  /** 关联请求 ID（前端生成、mutation 与 SSE 共用） */
  requestId: string;
  /** 事件类型，前端用以路由 */
  type: SupervisorEventType;
  /** 与 ChatThinkingDetail.phase 一致，便于直接落入 UI */
  phase: ChatThinkingPhase;
  /** UI 友好摘要（一行可显示） */
  summary: string;
  /** 结构化负载（不同 type 形状不同） */
  payload?: P;
  /** UTC 时间戳（毫秒） */
  ts: number;
}

// ==================== 各 type 强类型 payload ====================

export interface ClassifiedPayload {
  domain: string;
  complexity: "simple" | "moderate" | "complex";
  reasoning: string;
}

export interface PlanReadyPayload {
  goal: string;
  steps: Array<{
    id: number;
    description: string;
    targetAgent: string;
    expectedTools: string[];
  }>;
}

export interface StepStartedPayload {
  stepId: number;
  description: string;
  targetAgent: string;
}

export interface StepFinishedPayload {
  stepId: number;
  status: "success" | "error" | "timeout" | "skipped";
  durationMs: number;
  toolCalls: Array<{ name: string; argsPreview?: string }>;
  outputPreview?: string;
}

export interface ReplanPayload {
  reason: string;
  newSteps: PlanReadyPayload["steps"];
}

export interface FinalPayload {
  response: string;
  classification: { domain: string; complexity: string };
  stepsExecuted: number;
  totalToolCalls: number;
  totalDurationMs: number;
}

export interface ErrorPayload {
  message: string;
  stage: ChatThinkingPhase;
}

/** 召回记忆事件载荷 */
export interface MemoryRecalledPayload {
  /** 命中的记忆条数 */
  count: number;
  /** 前几条记忆摘要（截断后用于 UI 展示） */
  previews: string[];
  /** 是否命中预取缓存 */
  prefetchHit: boolean;
}

/** 反思入库事件载荷 */
export interface ReflectedPayload {
  /** 已写入的工具效用日志条数 */
  toolLogsPersisted: number;
  /** 是否触发了 LLM 反思（仅复杂或失败任务触发） */
  llmReflectionTriggered: boolean;
}

/** 记忆提取事件载荷 */
export interface MemoryExtractedPayload {
  /** 工作记忆是否更新 */
  workingMemoryUpdated: boolean;
  /** 行为模式检测是否在本轮触发 */
  behaviorDetectionTriggered: boolean;
  /** 自动提取得到的新记忆条数（自动提取关闭时为 0） */
  extractedCount: number;
}

// ==================== 工具：构造默认信封 ====================

/**
 * 创建一个 envelope，自动填入 ts。
 * 仅作为便捷 helper，前后端均可使用。
 */
export function createEnvelope<P>(args: {
  requestId: string;
  type: SupervisorEventType;
  phase: ChatThinkingPhase;
  summary: string;
  payload?: P;
}): SupervisorEventEnvelope<P> {
  return {
    requestId: args.requestId,
    type: args.type,
    phase: args.phase,
    summary: args.summary,
    payload: args.payload,
    ts: Date.now(),
  };
}
