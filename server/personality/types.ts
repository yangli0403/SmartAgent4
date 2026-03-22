/**
 * Personality Types — 人格系统类型定义
 *
 * 定义 AgentCharacter（兼容 ElizaOS Characterfile）、
 * 用户画像快照和个性引擎相关的数据结构。
 */

// ==================== 对话示例 ====================

/** 对话示例中的单条消息 */
export interface MessageExample {
  role: "user" | "assistant";
  content: string;
}

// ==================== 语音与模型配置 ====================

/** 语音配置 */
export interface VoiceConfig {
  /** TTS 模型名称 */
  model: string;
  /** 语速倍率 0.5-2.0 */
  speed: number;
  /** 音调倍率 0.5-2.0 */
  pitch: number;
  /** 音色 ID（可选） */
  voiceId?: string;
}

/** 模型配置 */
export interface ModelSettings {
  /** LLM 模型名称 */
  model: string;
  /** 嵌入模型名称 */
  embeddingModel: string;
  /** 语音配置 */
  voice?: VoiceConfig;
  /** 生成温度 0.0-2.0 */
  temperature: number;
  /** 最大 token 数 */
  maxTokens: number;
  /** Top-p 采样 0.0-1.0 */
  topP: number;
}

// ==================== 对话风格 ====================

/** 对话风格（兼容 ElizaOS style 三维度） */
export interface DialogueStyle {
  /** 通用风格指令 */
  all: string[];
  /** 文字聊天风格 */
  chat: string[];
  /** 语音交互风格 */
  voice: string[];
  /** 社交媒体风格 (ElizaOS 兼容) */
  post: string[];
}

// ==================== 知识条目 ====================

/** 知识条目 */
export interface KnowledgeItem {
  id: string;
  content: string;
  category: string;
}

// ==================== 车载扩展 ====================

/** 主动服务规则 */
export interface ProactiveRule {
  trigger: string;
  condition?: string;
  action: string;
  memoryQuery?: string;
  priority: number;
}

/** 车载扩展配置 */
export interface VehicleConfig {
  greetingTemplates: string[];
  proactiveServiceRules: ProactiveRule[];
  scenarioHandlers: string[];
}

// ==================== 核心：AgentCharacter ====================

/**
 * AI 代理人格配置
 *
 * 兼容 ElizaOS Characterfile 规范，同时扩展车载场景和情感表达能力。
 * 来源：SmartAgent2 的 characters.ts 数据结构。
 */
export interface AgentCharacter {
  /** 人格唯一 ID */
  id: string;
  /** 人格名称 */
  name: string;
  /** 人格简介（多段） */
  bio: string[];
  /** 背景故事（多段） */
  lore: string[];
  /** ElizaOS 兼容系统提示词 */
  system?: string;
  /** 对话风格 */
  style: DialogueStyle;
  /** 对话示例（多组） */
  messageExamples: MessageExample[][];
  /** 社交媒体发帖示例 */
  postExamples: string[];
  /** 性格形容词 */
  adjectives: string[];
  /** 擅长话题 */
  topics: string[];
  /** 知识库 */
  knowledge: KnowledgeItem[];
  /** 支持的客户端 */
  clients: string[];
  /** 模型提供商 */
  modelProvider?: string;
  /** 模型设置 */
  settings: ModelSettings;
  /** 车载扩展配置 */
  vehicleConfig?: VehicleConfig;
  /** System Prompt 模板（支持变量替换） */
  systemPromptTemplate?: string;
  /** 来源格式标记 */
  sourceFormat?: "native" | "elizaos";
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ==================== 用户画像 ====================

/** 用户偏好 */
export interface UserPreferenceItem {
  category: string;
  key: string;
  value: string;
}

/** 用户关系 */
export interface UserRelationship {
  personName: string;
  relationship: string;
}

/**
 * 上下文化的用户画像快照
 *
 * 从记忆系统中提取的用户画像信息，
 * 用于注入到 System Prompt 中实现个性化对话。
 */
export interface ContextualProfileSnapshot {
  /** 用户希望被称呼的名字 */
  displayName?: string;
  /** 活跃的用户偏好 */
  activePreferences: UserPreferenceItem[];
  /** 相关的人际关系 */
  relevantRelationships: UserRelationship[];
}

// ==================== System Prompt 构建选项 ====================

/** 构建 System Prompt 的选项 */
export interface BuildSystemPromptOptions {
  /** 人格 ID */
  characterId: string;
  /** 用户画像快照 */
  userProfile?: ContextualProfileSnapshot;
  /** 记忆上下文（已格式化的记忆文本） */
  memoryContext: string;
  /** 情感标签指令（来自 EmotionsExpressClient） */
  emotionTagInstructions?: string;
}
