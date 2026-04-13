/**
 * AIRI 前端舞台 — 类型定义
 *
 * 定义角色舞台系统的所有核心类型，包括：
 * - 舞台事件协议（StageEvent）
 * - Live2D 参数映射
 * - 驱动器状态
 * - 配置项
 */

// ==================== 舞台事件协议 ====================

/** 舞台事件类型枚举 */
export type StageEventType =
  | "expression"
  | "motion"
  | "tts_start"
  | "tts_stop"
  | "tts_level"
  | "idle_state"
  | "model_loaded"
  | "model_error";

/** 表情事件 */
export interface ExpressionEvent {
  type: "expression";
  /** 表情名称（如 happy, sad, smile 等） */
  expression: string;
  /** 表情强度 0.0 - 1.0，默认 1.0 */
  intensity?: number;
}

/** 动作事件 */
export interface MotionEvent {
  type: "motion";
  /** 动作名称（如 nod, wave, bow 等） */
  motion: string;
  /** 动作优先级，数值越大优先级越高，默认 1 */
  priority?: number;
}

/** TTS 开始播放事件 */
export interface TtsStartEvent {
  type: "tts_start";
  /** 音频时长（毫秒），可选 */
  durationMs?: number;
}

/** TTS 停止播放事件 */
export interface TtsStopEvent {
  type: "tts_stop";
}

/** TTS 音量电平事件（每帧触发） */
export interface TtsLevelEvent {
  type: "tts_level";
  /** 音量电平 0.0 - 1.0 */
  level: number;
}

/** 闲置状态切换事件 */
export interface IdleStateEvent {
  type: "idle_state";
  /** 闲置子状态 */
  state: IdleState;
}

/** 模型加载完成事件 */
export interface ModelLoadedEvent {
  type: "model_loaded";
  /** 模型 ID */
  modelId: string;
}

/** 模型加载失败事件 */
export interface ModelErrorEvent {
  type: "model_error";
  /** 错误信息 */
  error: string;
}

/** 舞台事件联合类型 */
export type StageEvent =
  | ExpressionEvent
  | MotionEvent
  | TtsStartEvent
  | TtsStopEvent
  | TtsLevelEvent
  | IdleStateEvent
  | ModelLoadedEvent
  | ModelErrorEvent;

/** 事件总线的事件映射表（用于 mitt 类型推断） */
export type StageEventMap = {
  expression: ExpressionEvent;
  motion: MotionEvent;
  tts_start: TtsStartEvent;
  tts_stop: TtsStopEvent;
  tts_level: TtsLevelEvent;
  idle_state: IdleStateEvent;
  model_loaded: ModelLoadedEvent;
  model_error: ModelErrorEvent;
};

// ==================== 闲置状态 ====================

/** 闲置子状态 */
export type IdleState =
  | "idle"       // 默认闲置（呼吸 + 眨眼）
  | "thinking"   // AI 正在处理（歪头 / 手托下巴）
  | "listening"; // 用户正在语音输入（微微前倾）

// ==================== Live2D 参数映射 ====================

/** Live2D 模型参数名称 */
export type Live2DParamName =
  | "ParamAngleX"
  | "ParamAngleY"
  | "ParamAngleZ"
  | "ParamBodyAngleX"
  | "ParamBodyAngleY"
  | "ParamEyeLOpen"
  | "ParamEyeROpen"
  | "ParamEyeBallX"
  | "ParamEyeBallY"
  | "ParamBrowLY"
  | "ParamBrowRY"
  | "ParamMouthForm"
  | "ParamMouthOpenY"
  | "ParamCheek"
  | "ParamBreath";

/** 表情参数配置 — 定义每种表情对应的 Live2D 参数目标值 */
export interface ExpressionParamSet {
  /** 表情名称 */
  name: string;
  /** 参数目标值映射 */
  params: Partial<Record<Live2DParamName, number>>;
}

/** 表情映射配置表 */
export type ExpressionMappingConfig = Record<string, ExpressionParamSet>;

// ==================== 动作定义 ====================

/** 动作组定义 */
export interface MotionGroupDef {
  /** 动作名称 */
  name: string;
  /** Live2D Motion Group 名称 */
  group: string;
  /** Motion Group 中的索引 */
  index: number;
  /** 默认优先级 */
  priority: number;
}

/** 动作映射配置表 */
export type MotionMappingConfig = Record<string, MotionGroupDef>;

// ==================== 驱动器状态 ====================

/** 表情驱动器状态 */
export interface ExpressionDriverState {
  /** 当前表情 */
  currentExpression: string;
  /** 当前强度 */
  currentIntensity: number;
  /** 目标表情 */
  targetExpression: string;
  /** 目标强度 */
  targetIntensity: number;
  /** 是否正在过渡中 */
  isTransitioning: boolean;
}

/** 动作驱动器状态 */
export interface MotionDriverState {
  /** 当前正在播放的动作 */
  currentMotion: string | null;
  /** 当前动作的优先级 */
  currentPriority: number;
  /** 是否正在播放 */
  isPlaying: boolean;
}

/** 口型驱动器状态 */
export interface LipsyncDriverState {
  /** 是否正在说话 */
  isSpeaking: boolean;
  /** 当前音量电平 0.0 - 1.0 */
  currentLevel: number;
}

/** 闲置状态管理器状态 */
export interface IdleManagerState {
  /** 当前闲置子状态 */
  currentState: IdleState;
  /** 上次活动时间戳 */
  lastActivityTime: number;
  /** 是否处于闲置模式 */
  isIdle: boolean;
}

// ==================== 舞台容器配置 ====================

/** AIRI 舞台容器配置 */
export interface AiriStageConfig {
  /** 是否启用角色舞台 */
  enabled: boolean;
  /** Live2D 模型 URL（model3.json 路径） */
  modelUrl: string;
  /** 渲染画布宽度（像素） */
  canvasWidth: number;
  /** 渲染画布高度（像素） */
  canvasHeight: number;
  /** 模型缩放比例 */
  modelScale: number;
  /** 模型 X 偏移 */
  modelOffsetX: number;
  /** 模型 Y 偏移 */
  modelOffsetY: number;
  /** 表情过渡时间（毫秒） */
  expressionTransitionMs: number;
  /** 闲置超时时间（毫秒） */
  idleTimeoutMs: number;
  /** 目标帧率 */
  targetFps: number;
  /** 是否启用调试模式 */
  debug: boolean;
}

/** 默认舞台配置 */
export const DEFAULT_STAGE_CONFIG: AiriStageConfig = {
  enabled: true,
  modelUrl: "/live2d/hiyori/hiyori_pro_t10.model3.json",
  canvasWidth: 800,
  canvasHeight: 600,
  modelScale: 0.3,
  modelOffsetX: 0,
  modelOffsetY: 0,
  expressionTransitionMs: 300,
  idleTimeoutMs: 3000,
  targetFps: 30,
  debug: false,
};
