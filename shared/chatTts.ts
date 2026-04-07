/**
 * Chat 语音（Emotions TTS）与前端消息列表共享类型
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

/** 聊天 UI 单条消息（含可选的助手语音元数据） */
export interface ChatUiMessage {
  role: "user" | "assistant";
  content: string;
  /** 仅 assistant 且本轮 sendMessage 成功时可能带有 */
  tts?: ChatTtsPayload;
}
