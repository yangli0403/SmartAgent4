/**
 * Domain Agent 统一接口定义
 *
 * 所有领域专员 Agent 必须实现此接口，
 * 以便 Supervisor 的 executeNode 统一调度。
 */

import type { BaseMessage } from "@langchain/core/messages";
import type {
  PlanStep,
  ToolCallRecord,
  DialogueSlots,
} from "../supervisor/state";

// ==================== Agent 执行输入 ====================

/** Domain Agent 的执行输入 */
export interface AgentExecutionInput {
  /** 当前执行的步骤 */
  step: PlanStep;
  /** 用户原始消息 */
  userMessage: string;
  /** 从前置步骤解析的输入参数 */
  resolvedInputs: Record<string, unknown>;
  /** 对话历史（用于上下文理解） */
  conversationHistory: BaseMessage[];
  /** 用户上下文（可与会话槽位并存；槽位由 Supervisor 启发式抽取） */
  context?: {
    userId?: string;
    location?: { latitude: number; longitude: number; city?: string };
    currentTime?: string;
    dialogueSlots?: DialogueSlots;
  };
}

// ==================== Agent 执行输出 ====================

/** Domain Agent 的执行输出 */
export interface AgentExecutionOutput {
  /** 执行是否成功 */
  success: boolean;
  /** 执行结果（自然语言描述） */
  output: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 结构化数据（可选，用于前端富媒体展示） */
  structuredData?: AgentStructuredData;
}

// ==================== 结构化数据（前端展示用） ====================

/** Agent 返回的结构化数据，用于前端富媒体渲染 */
export type AgentStructuredData =
  | NavigationData
  | MusicData
  | FileData
  | GeneralData;

/** 导航类结构化数据 */
export interface NavigationData {
  type: "navigation";
  /** POI 搜索结果列表 */
  pois?: POIItem[];
  /** 路径规划结果 */
  route?: RouteInfo;
  /** 地图中心点 */
  center?: { latitude: number; longitude: number };
}

/** POI 项目 */
export interface POIItem {
  name: string;
  address: string;
  distance: number;       // 距离（米）
  latitude: number;
  longitude: number;
  category: string;
  tel?: string;
  rating?: number;
  price?: string;         // 价格信息
  businessInfo?: string;  // 营业信息
}

/** 路径信息 */
export interface RouteInfo {
  distance: number;       // 总距离（米）
  duration: number;       // 预计时间（秒）
  strategy: string;       // 路径策略
  steps: string[];        // 导航步骤
}

/** 音乐类结构化数据 */
export interface MusicData {
  type: "music";
  /** 搜索结果歌曲列表 */
  songs?: SongItem[];
  /** 当前推荐/播放的歌曲 */
  currentSong?: SongItem;
  /** 歌单信息 */
  playlist?: PlaylistInfo;
}

/** 歌曲项目 */
export interface SongItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;       // 时长（秒）
  coverUrl?: string;      // 封面图片
  playUrl?: string;       // 播放链接
}

/** 歌单信息 */
export interface PlaylistInfo {
  id: string;
  name: string;
  songCount: number;
  coverUrl?: string;
}

/** 文件类结构化数据 */
export interface FileData {
  type: "file";
  /** 文件搜索结果 */
  files?: FileItem[];
  /** 操作的目标文件 */
  targetFile?: FileItem;
}

/** 文件项目 */
export interface FileItem {
  name: string;
  path: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
}

/** 通用数据 */
export interface GeneralData {
  type: "general";
  [key: string]: unknown;
}

// ==================== Domain Agent 接口 ====================

/**
 * Domain Agent 统一接口
 *
 * 所有领域专员必须实现此接口。
 */
export interface DomainAgentInterface {
  /** Agent 名称 */
  readonly name: string;

  /** Agent 描述 */
  readonly description: string;

  /** Agent 可用的工具名称列表 */
  readonly availableTools: string[];

  /**
   * 执行任务步骤
   *
   * 内部运行 ReACT 循环（LLM → tool_calls → execute → LLM → ...）
   *
   * @param input - 执行输入
   * @returns 执行输出
   */
  execute(input: AgentExecutionInput): Promise<AgentExecutionOutput>;

  /**
   * 获取 Agent 的系统提示词
   *
   * @param context - 可选的上下文信息
   * @returns 系统提示词字符串
   */
  getSystemPrompt(context?: Record<string, unknown>): string;
}

// ==================== Agent 配置 ====================

/** Domain Agent 的配置 */
export interface DomainAgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 绑定的工具名称列表（从 Tool Registry 获取） */
  toolNames: string[];
  /** ReACT 循环最大迭代次数 */
  maxIterations: number;
  /** LLM 温度参数 */
  temperature: number;
  /** LLM 最大 Token 数 */
  maxTokens: number;
}
