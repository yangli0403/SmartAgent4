/**
 * Emotions Types — 情感表达系统类型定义 (SmartAgent4)
 *
 * 定义与 Emotions-System 微服务交互所需的数据结构。
 * SmartAgent4 更新：适配新的 Emotions-System（Python）微服务。
 *
 * 来源：Emotions-System/core/models.py
 */

// ==================== 情感与动作枚举 ====================

/** 情感类型 */
export type EmotionType =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "fearful"
  | "disgusted";

/** 多模态动作类型 */
export type ActionType =
  | "expression"   // 面部表情
  | "animation"    // 身体动画
  | "gesture"      // 手势
  | "posture"      // 身体姿态
  | "locomotion"   // 移动
  | "sound"        // 音效
  | "pause";       // 停顿

// ==================== 核心数据结构 ====================

/** 多模态动作指令 */
export interface EmotionAction {
  /** 动作类型 */
  type: ActionType;
  /** 动作值（如 "smile", "nod", "step_forward"） */
  value: string;
  /** 持续时间（毫秒，仅 pause 类型使用） */
  duration?: number;
}

/**
 * 多模态片段
 *
 * 一段完整的多模态输出，包含文本、音频和动作指令。
 * 兼容旧版 Emotions-Express 和新版 Emotions-System。
 */
export interface MultimodalSegment {
  /** 纯文本内容（已去除标签） */
  text: string;
  /** Base64 编码的音频数据 */
  audioBase64?: string;
  /** 音频格式（如 "mp3", "wav"） */
  audioFormat: string;
  /** 当前情感状态 */
  emotion: EmotionType;
  /** 动作指令列表 */
  actions: EmotionAction[];
}

// ==================== API 请求/响应 ====================

/** Emotions-System TTS 合成请求 */
export interface EmotionsTTSRequest {
  /** 待合成的文本 */
  text: string;
  /** 情感类型 */
  emotion?: string;
  /** 语音指令（如"用欢快的语气"） */
  instruction?: string;
  /** 音色 ID */
  voice_id?: string;
}

/** Emotions-System TTS 合成响应 */
export interface EmotionsTTSResponse {
  /** Base64 编码的音频数据 */
  audio_base64: string;
  /** 音频格式 */
  format: string;
}

/**
 * Emotions-System 渲染请求（兼容旧版）
 */
export interface EmotionsRenderRequest {
  /** 待渲染的文本（可含 [emotion:value|instruction:text] 标签） */
  text: string;
  /** 会话 ID */
  sessionId: string;
  /** 系统提示词（可选，覆盖默认） */
  systemPrompt?: string;
}

/** Emotions-System 流式响应事件 */
export interface EmotionsRenderResponse {
  /** 事件类型 */
  type: "segment" | "end" | "error" | "transcript" | "info";
  /** 多模态片段（type=segment 时） */
  segment?: MultimodalSegment;
  /** 消息文本（type=error/info 时） */
  message?: string;
}

// ==================== 客户端配置 ====================

/** Emotions-System 客户端配置 */
export interface EmotionsClientConfig {
  /** 服务基础 URL（如 http://localhost:8000） */
  baseUrl: string;
  /** 请求超时（毫秒） */
  timeout: number;
  /** 是否启用（false 时跳过情感渲染） */
  enabled: boolean;
  /** 重试次数 */
  retryCount: number;
  /** 重试间隔（毫秒） */
  retryDelay: number;
}
