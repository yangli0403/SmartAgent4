/**
 * 舞台状态管理 — useStageStore (Zustand)
 *
 * 集中管理角色舞台的所有状态，包括：
 * - 模型加载状态
 * - 表情驱动器状态
 * - 动作驱动器状态
 * - 口型驱动器状态
 * - 闲置状态管理器状态
 * - 全局配置
 */

import { create } from "zustand";
import type {
  ExpressionDriverState,
  MotionDriverState,
  LipsyncDriverState,
  IdleManagerState,
  AiriStageConfig,
  IdleState,
} from "./types";
import { DEFAULT_STAGE_CONFIG } from "./types";

// ==================== Store 类型定义 ====================

export interface StageStoreState {
  /** 全局配置 */
  config: AiriStageConfig;

  /** 模型是否已加载 */
  modelLoaded: boolean;
  /** 模型加载错误信息 */
  modelError: string | null;

  /** 表情驱动器状态 */
  expression: ExpressionDriverState;
  /** 动作驱动器状态 */
  motion: MotionDriverState;
  /** 口型驱动器状态 */
  lipsync: LipsyncDriverState;
  /** 闲置状态管理器状态 */
  idle: IdleManagerState;
}

export interface StageStoreActions {
  /** 更新配置 */
  setConfig: (config: Partial<AiriStageConfig>) => void;

  /** 设置模型加载状态 */
  setModelLoaded: (loaded: boolean) => void;
  /** 设置模型加载错误 */
  setModelError: (error: string | null) => void;

  /** 设置目标表情 */
  setTargetExpression: (expression: string, intensity?: number) => void;
  /** 更新当前表情（插值过程中调用） */
  updateCurrentExpression: (expression: string, intensity: number) => void;
  /** 标记表情过渡完成 */
  finishExpressionTransition: () => void;

  /** 设置当前动作 */
  setCurrentMotion: (motion: string | null, priority?: number) => void;
  /** 标记动作播放完成 */
  finishMotion: () => void;

  /** 设置说话状态 */
  setSpeaking: (speaking: boolean) => void;
  /** 更新音量电平 */
  updateLevel: (level: number) => void;

  /** 设置闲置子状态 */
  setIdleState: (state: IdleState) => void;
  /** 记录活动时间 */
  recordActivity: () => void;

  /** 重置所有状态 */
  reset: () => void;
}

export type StageStore = StageStoreState & StageStoreActions;

// ==================== 初始状态 ====================

const initialState: StageStoreState = {
  config: DEFAULT_STAGE_CONFIG,
  modelLoaded: false,
  modelError: null,
  expression: {
    currentExpression: "neutral",
    currentIntensity: 1.0,
    targetExpression: "neutral",
    targetIntensity: 1.0,
    isTransitioning: false,
  },
  motion: {
    currentMotion: null,
    currentPriority: 0,
    isPlaying: false,
  },
  lipsync: {
    isSpeaking: false,
    currentLevel: 0,
  },
  idle: {
    currentState: "idle",
    lastActivityTime: Date.now(),
    isIdle: true,
  },
};

// ==================== Store 创建 ====================

export const useStageStore = create<StageStore>((set) => ({
  ...initialState,

  setConfig: (config) =>
    set((state) => ({
      config: { ...state.config, ...config },
    })),

  setModelLoaded: (loaded) =>
    set({ modelLoaded: loaded, modelError: loaded ? null : undefined }),

  setModelError: (error) =>
    set({ modelError: error, modelLoaded: false }),

  setTargetExpression: (expression, intensity = 1.0) =>
    set((state) => ({
      expression: {
        ...state.expression,
        targetExpression: expression,
        targetIntensity: intensity,
        isTransitioning: true,
      },
      idle: {
        ...state.idle,
        lastActivityTime: Date.now(),
        isIdle: false,
      },
    })),

  updateCurrentExpression: (expression, intensity) =>
    set((state) => ({
      expression: {
        ...state.expression,
        currentExpression: expression,
        currentIntensity: intensity,
      },
    })),

  finishExpressionTransition: () =>
    set((state) => ({
      expression: {
        ...state.expression,
        currentExpression: state.expression.targetExpression,
        currentIntensity: state.expression.targetIntensity,
        isTransitioning: false,
      },
    })),

  setCurrentMotion: (motion, priority = 1) =>
    set((state) => ({
      motion: {
        currentMotion: motion,
        currentPriority: priority,
        isPlaying: motion !== null,
      },
      idle: {
        ...state.idle,
        lastActivityTime: Date.now(),
        isIdle: false,
      },
    })),

  finishMotion: () =>
    set({
      motion: {
        currentMotion: null,
        currentPriority: 0,
        isPlaying: false,
      },
    }),

  setSpeaking: (speaking) =>
    set((state) => ({
      lipsync: {
        ...state.lipsync,
        isSpeaking: speaking,
        currentLevel: speaking ? state.lipsync.currentLevel : 0,
      },
      idle: {
        ...state.idle,
        lastActivityTime: Date.now(),
        isIdle: !speaking,
      },
    })),

  updateLevel: (level) =>
    set((state) => ({
      lipsync: {
        ...state.lipsync,
        currentLevel: level,
      },
    })),

  setIdleState: (idleState) =>
    set((state) => ({
      idle: {
        ...state.idle,
        currentState: idleState,
        lastActivityTime: Date.now(),
        isIdle: idleState === "idle",
      },
    })),

  recordActivity: () =>
    set((state) => ({
      idle: {
        ...state.idle,
        lastActivityTime: Date.now(),
        isIdle: false,
      },
    })),

  reset: () => set(initialState),
}));
