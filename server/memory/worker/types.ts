/**
 * Memory Worker 类型定义 — 后台"做梦"机制
 *
 * 定义主进程与 Worker 线程之间的消息协议、
 * 触发门控状态和配置。
 *
 * 第五轮迭代新增：借鉴 Claude Code 的 autoDream 机制
 */

// ==================== Worker 消息协议 ====================

/** Worker 任务类型 */
export type MemoryWorkerTaskType = "consolidate" | "predict" | "forget";

/**
 * 主进程 → Worker 的任务请求
 */
export interface MemoryWorkerRequest {
  /** 唯一任务 ID */
  taskId: string;
  /** 任务类型 */
  type: MemoryWorkerTaskType;
  /** 目标用户 ID */
  userId: number;
  /** 传递给 Worker 的额外上下文 */
  context?: Record<string, unknown>;
}

/**
 * Worker → 主进程的任务响应
 */
export interface MemoryWorkerResponse {
  /** 对应的任务 ID */
  taskId: string;
  /** 是否成功 */
  success: boolean;
  /** 任务结果（类型取决于任务类型） */
  result?: MemoryWorkerResult;
  /** 错误信息 */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/**
 * Worker 任务结果联合类型
 */
export type MemoryWorkerResult =
  | ConsolidationWorkerResult
  | PredictionWorkerResult
  | ForgettingWorkerResult;

export interface ConsolidationWorkerResult {
  type: "consolidate";
  clustersCreated: number;
  memoriesConsolidated: number;
  semanticMemoriesCreated: number;
}

export interface PredictionWorkerResult {
  type: "predict";
  predictedIntent: string;
  confidence: number;
  prefetchedContextLength: number;
}

export interface ForgettingWorkerResult {
  type: "forget";
  memoriesAffected: number;
}

// ==================== 触发门控 ====================

/**
 * 用户会话状态 — 用于复合触发门控
 */
export interface UserSessionState {
  /** 用户 ID */
  userId: number;
  /** 自上次做梦以来的消息数量 */
  messageCountSinceLastDream: number;
  /** 上次做梦的时间戳（毫秒） */
  lastDreamTime: number;
  /** 是否正在做梦 */
  isDreaming: boolean;
}

/**
 * 门控配置
 */
export interface GatekeeperConfig {
  /** 触发做梦的消息数量阈值 */
  messageThreshold: number;
  /** 触发做梦的时间阈值（毫秒） */
  timeThresholdMs: number;
  /** 最大并发 Worker 数量 */
  maxConcurrentWorkers: number;
}

/** 默认门控配置 */
export const DEFAULT_GATEKEEPER_CONFIG: GatekeeperConfig = {
  messageThreshold: 5,
  timeThresholdMs: 6 * 60 * 60 * 1000, // 6 小时
  maxConcurrentWorkers: 2,
};

// ==================== Worker Manager 状态 ====================

/**
 * Worker Manager 的运行状态
 */
export interface WorkerManagerStats {
  /** 活跃的 Worker 数量 */
  activeWorkers: number;
  /** 已完成的任务总数 */
  completedTasks: number;
  /** 失败的任务总数 */
  failedTasks: number;
  /** 被跟踪的用户数量 */
  trackedUsers: number;
}
