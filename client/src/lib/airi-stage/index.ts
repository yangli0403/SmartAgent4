/**
 * AIRI 前端舞台 — 模块入口
 *
 * 导出所有舞台相关的类型、配置、事件总线和状态管理。
 */

// 类型定义
export type {
  StageEventType,
  StageEvent,
  StageEventMap,
  ExpressionEvent,
  MotionEvent,
  TtsStartEvent,
  TtsStopEvent,
  TtsLevelEvent,
  IdleStateEvent,
  ModelLoadedEvent,
  ModelErrorEvent,
  IdleState,
  Live2DParamName,
  ExpressionParamSet,
  ExpressionMappingConfig,
  MotionGroupDef,
  MotionMappingConfig,
  ExpressionDriverState,
  MotionDriverState,
  LipsyncDriverState,
  IdleManagerState,
  AiriStageConfig,
} from "./types";

export { DEFAULT_STAGE_CONFIG } from "./types";

// 事件总线
export {
  stageEventBus,
  dispatchStageEventsFromTags,
  notifyThinking,
  notifyListening,
  notifyIdle,
  notifyTtsStart,
  notifyTtsStop,
  notifyTtsLevel,
} from "./stageEventBus";

// 映射配置
export { EXPRESSION_MAPPING, getExpressionParams } from "./expressionMapping";
export { MOTION_MAPPING, getMotionDef } from "./motionMapping";

// 状态管理
export { useStageStore } from "./useStageStore";
export type { StageStore, StageStoreState, StageStoreActions } from "./useStageStore";
