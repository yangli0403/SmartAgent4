/**
 * AIRI Bridge Types — 类型定义
 *
 * 定义 AIRI Bridge 服务所需的所有类型，包括：
 * - Bridge 连接状态与配置
 * - 情感映射规则
 * - 音频数据包
 * - AIRI Plugin Protocol 兼容的消息格式
 */

import type { EmotionType, EmotionAction } from "../emotions/types";

// ==================== Bridge 状态 ====================

/** AIRI Bridge 连接状态 */
export type AiriBridgeStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "announcing"
  | "ready"
  | "reconnecting"
  | "failed";

// ==================== Bridge 配置 ====================

/** AIRI Bridge 配置 */
export interface AiriBridgeConfig {
  /** AIRI Server Runtime WebSocket URL */
  airiServerUrl: string;
  /** 认证 Token（可选） */
  airiToken?: string;
  /** 是否自动连接 */
  autoConnect: boolean;
  /** 是否自动重连 */
  autoReconnect: boolean;
  /** 最大重连次数（-1 为无限） */
  maxReconnectAttempts: number;
  /** 是否启用情感渲染 */
  enableEmotionRendering: boolean;
  /** 是否启用 TTS 音频合成 */
  enableTTS: boolean;
  /** 默认角色 ID */
  defaultCharacterId: string;
}

/** Bridge 状态信息（用于 tRPC 查询） */
export interface AiriBridgeStatusInfo {
  /** 当前连接状态 */
  status: AiriBridgeStatus;
  /** 连接的 AIRI Server URL */
  serverUrl: string;
  /** 最后一次成功连接时间 */
  lastConnectedAt?: string;
  /** 最后一次错误信息 */
  lastError?: string;
  /** 已处理的消息计数 */
  messageCount: number;
  /** 当前使用的角色 ID */
  activeCharacterId: string;
}

// ==================== 情感映射 ====================

/** AIRI 表情指令 */
export interface AiriExpressionCommand {
  /** 表情名称 */
  expression: string;
  /** 表情强度 0.0 - 1.0 */
  intensity: number;
}

/** AIRI 动作指令 */
export interface AiriMotionCommand {
  /** 动作名称 */
  motion: string;
  /** 动作组索引 */
  index?: number;
}

/** 情感映射规则 */
export interface EmotionMappingRule {
  /** SmartAgent4 情感类型 */
  emotion: EmotionType;
  /** 对应的 AIRI 表情指令 */
  expressions: AiriExpressionCommand[];
  /** 对应的 AIRI 动作指令 */
  motions: AiriMotionCommand[];
  /** 口型参数偏移 */
  mouthFormOffset?: number;
}

/** 完整的情感映射配置 */
export type EmotionMappingConfig = EmotionMappingRule[];

// ==================== 音频数据 ====================

/** 音频数据包 */
export interface AudioPacket {
  /** Base64 编码的音频数据 */
  audioBase64: string;
  /** 音频格式 */
  format: "wav" | "mp3" | "pcm";
  /** 采样率 */
  sampleRate?: number;
  /** 声道数 */
  channels?: number;
  /** 音频时长（毫秒） */
  durationMs?: number;
}

// ==================== Bridge 输入/输出 ====================

/** Bridge 接收的输入事件 */
export interface AiriBridgeInput {
  /** 输入类型 */
  type: "text" | "text_voice" | "voice";
  /** 文本内容 */
  text: string;
  /** 原始文本（语音识别前） */
  textRaw?: string;
  /** 来源标识 */
  source?: string;
}

/** Bridge 发送的输出消息内容块 */
export type AiriMessageContentPart =
  | { type: "text"; text: string }
  | { type: "audio"; audioBase64: string; format: string }
  | { type: "expression"; expression: string; intensity: number }
  | { type: "motion"; motion: string; index?: number };

/** Bridge 发送的输出消息 */
export interface AiriOutputMessage {
  message: {
    role: "assistant";
    content: AiriMessageContentPart[];
  };
}

/** Bridge 输入事件回调类型 */
export type AiriBridgeInputCallback = (input: AiriBridgeInput) => Promise<void>;
