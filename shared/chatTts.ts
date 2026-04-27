/**
 * Chat 语音（Emotions TTS）与前端消息列表共享类型
 *
 * v0.5 更新（2026-04-24）：
 * - ChatUiMessage 升级为 `user | assistant | thinking` 联合类型
 * - 新增 ChatThinkingPhase / ChatThinkingDetail / ChatUiThinkingMessage
 * - 与 shared/supervisorEvents.ts 中的 SupervisorEventEnvelope 配合渲染思考气泡
 */

export type ChatTtsStatus = "ready" | "skipped" | "failed";

export interface ChatTtsSegmentDTO {
  text: string;
  emotion: string;
  audioBase64?: string;
  audioFormat: string;
}

export interface ChatTtsPayload {
  status: ChatTtsStatus;
  /** 跳过合成、失败或无音频时的说明（便于排查） */
  reason?: string;
  segments: ChatTtsSegmentDTO[];
}

// ==================== v0.5：思考气泡相关 ====================

/**
 * 思考阶段（与 SupervisorEventEnvelope.phase 一致）
 */
export type ChatThinkingPhase =
  | "queued"
  | "classified"
  | "memory_recalled"
  | "plan_ready"
  | "step_running"
  | "step_finished"
  | "replan"
  | "reflected"
  | "memory_extracted"
  | "completed"
  | "error";

/** 单条思考事件细节（思考气泡内累积多条） */
export interface ChatThinkingDetail {
  phase: ChatThinkingPhase;
  /** 一句话摘要，用于折叠态展示 */
  summary: string;
  /** 可选结构化负载，用于展开态时序详情 */
  payload?: Record<string, unknown>;
  /** UTC 时间戳（毫秒） */
  ts: number;
}

/** 思考气泡顶层状态 */
export type ChatThinkingStatus = "pending" | "running" | "completed" | "error";

/** 思考气泡消息 */
export interface ChatUiThinkingMessage {
  role: "thinking";
  /** 与 mutation 关联的请求 ID（前端 crypto.randomUUID 生成） */
  requestId: string;
  status: ChatThinkingStatus;
  /** 折叠态摘要（默认以 "Metris Agent ..." 起头） */
  headline: string;
  /** 时间轴细节列表 */
  details: ChatThinkingDetail[];
  /** 起始时间（ms） */
  startedAt: number;
  /** 结束时间（ms），仅 completed/error 时有值 */
  endedAt?: number;
}

// ==================== ChatUiMessage 联合类型 ====================

/** 用户消息 */
export interface ChatUiUserMessage {
  role: "user";
  content: string;
}

/** 助手消息（兼容 v0.4 形态） */
export interface ChatUiAssistantMessage {
  role: "assistant";
  content: string;
  /** 仅 assistant 且本轮 sendMessage 成功时可能带有 */
  tts?: ChatTtsPayload;
}

/** 聊天 UI 单条消息（v0.5 起为联合类型，向后兼容旧调用方） */
export type ChatUiMessage =
  | ChatUiUserMessage
  | ChatUiAssistantMessage
  | ChatUiThinkingMessage;
