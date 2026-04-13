/**
 * 口型驱动 Hook — useLipsyncDriver
 *
 * 监听 StageEventBus 的 tts_start/tts_stop/tts_level 事件，
 * 将音量电平映射为 Live2D 的 ParamMouthOpenY 参数。
 *
 * 支持两种模式：
 * 1. 外部电平模式：由 TtsPlayback 组件通过 notifyTtsLevel 传入实时电平
 * 2. 自动分析模式：如果提供了 audioElementRef，自动通过 Web Audio API 分析
 *
 * 关联用户测试用例：UTC-011, UTC-012
 */

import { useEffect, useRef, useCallback } from "react";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import type {
  TtsStartEvent,
  TtsStopEvent,
  TtsLevelEvent,
  LipsyncDriverState,
} from "@/lib/airi-stage/types";

/** Live2D 模型实例接口（最小化定义） */
interface Live2DModelLike {
  internalModel?: {
    coreModel?: {
      setParameterValueById(id: string, value: number): void;
    };
  };
}

/** 口型参数名 */
const MOUTH_PARAM = "ParamMouthOpenY";

/** 平滑因子（0-1，越小越平滑） */
const SMOOTH_FACTOR = 0.3;

/**
 * 口型驱动 Hook
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前口型驱动器状态
 */
export function useLipsyncDriver(
  modelRef: React.RefObject<Live2DModelLike | null>
): LipsyncDriverState {
  const rafRef = useRef<number>(0);
  const smoothedLevelRef = useRef<number>(0);

  const { lipsync, setSpeaking, updateLevel } = useStageStore();

  /**
   * 处理 TTS 开始播放
   */
  const handleTtsStart = useCallback(
    (_event: TtsStartEvent) => {
      setSpeaking(true);
      smoothedLevelRef.current = 0;
    },
    [setSpeaking]
  );

  /**
   * 处理 TTS 停止播放
   */
  const handleTtsStop = useCallback(
    (_event: TtsStopEvent) => {
      setSpeaking(false);
      smoothedLevelRef.current = 0;

      // 重置嘴巴参数
      const coreModel = modelRef.current?.internalModel?.coreModel;
      if (coreModel) {
        coreModel.setParameterValueById(MOUTH_PARAM, 0);
      }
    },
    [setSpeaking, modelRef]
  );

  /**
   * 处理 TTS 音量电平更新
   */
  const handleTtsLevel = useCallback(
    (event: TtsLevelEvent) => {
      const coreModel = modelRef.current?.internalModel?.coreModel;
      if (!coreModel) return;

      // 平滑处理，避免嘴巴抖动
      smoothedLevelRef.current = smoothedLevelRef.current * (1 - SMOOTH_FACTOR) + event.level * SMOOTH_FACTOR;

      // 更新 Store 状态
      updateLevel(smoothedLevelRef.current);

      // 直接设置 Live2D 参数
      coreModel.setParameterValueById(MOUTH_PARAM, smoothedLevelRef.current);
    },
    [modelRef, updateLevel]
  );

  /**
   * 注册事件监听
   */
  useEffect(() => {
    stageEventBus.on("tts_start", handleTtsStart);
    stageEventBus.on("tts_stop", handleTtsStop);
    stageEventBus.on("tts_level", handleTtsLevel);

    return () => {
      stageEventBus.off("tts_start", handleTtsStart);
      stageEventBus.off("tts_stop", handleTtsStop);
      stageEventBus.off("tts_level", handleTtsLevel);
      cancelAnimationFrame(rafRef.current);

      // 清理：重置嘴巴参数
      const coreModel = modelRef.current?.internalModel?.coreModel;
      if (coreModel) {
        coreModel.setParameterValueById(MOUTH_PARAM, 0);
      }
    };
  }, [handleTtsStart, handleTtsStop, handleTtsLevel, modelRef]);

  return lipsync;
}
