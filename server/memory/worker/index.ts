/**
 * Memory Worker 模块入口 — 后台"做梦"机制
 *
 * 第五轮迭代新增：借鉴 Claude Code 的 autoDream 机制
 */

// 类型定义
export type {
  MemoryWorkerTaskType,
  MemoryWorkerRequest,
  MemoryWorkerResponse,
  MemoryWorkerResult,
  ConsolidationWorkerResult,
  PredictionWorkerResult,
  ForgettingWorkerResult,
  UserSessionState,
  GatekeeperConfig,
  WorkerManagerStats,
} from "./types";
export { DEFAULT_GATEKEEPER_CONFIG } from "./types";

// 触发门控
export {
  DreamGatekeeper,
  getDreamGatekeeper,
  resetDreamGatekeeper,
} from "./dreamGatekeeper";

// Worker 管理器
export {
  MemoryWorkerManager,
  getMemoryWorkerManager,
  initMemoryWorkerManager,
  resetMemoryWorkerManager,
  type TaskExecutor,
} from "./memoryWorkerManager";
