/**
 * 闲置状态管理 Hook — useIdleManager
 *
 * 监控舞台空闲时间，自动切换 idle/thinking/listening 状态。
 * 在闲置时播放呼吸动画和随机眨眼。
 *
 * 关联用户测试用例：UTC-013, UTC-014, UTC-015
 */

import { useEffect, useRef, useCallback } from "react";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import type { IdleStateEvent, IdleManagerState } from "@/lib/airi-stage/types";

/** Live2D 模型实例接口（最小化定义） */
interface Live2DModelLike {
  internalModel?: {
    coreModel?: {
      setParameterValueById(id: string, value: number): void;
      getParameterValueById(id: string): number;
    };
  };
  motion(group: string, index?: number, priority?: number): Promise<boolean> | boolean;
}

/** 呼吸参数 */
const BREATH_PARAM = "ParamBreath";
/** 眨眼参数 */
const EYE_L_PARAM = "ParamEyeLOpen";
const EYE_R_PARAM = "ParamEyeROpen";

/** 眨眼间隔范围（毫秒） */
const BLINK_MIN_INTERVAL = 2000;
const BLINK_MAX_INTERVAL = 6000;
/** 眨眼持续时间（毫秒） */
const BLINK_DURATION = 150;

/**
 * 闲置状态管理 Hook
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前闲置管理器状态
 */
export function useIdleManager(
  modelRef: React.RefObject<Live2DModelLike | null>
): IdleManagerState {
  const rafRef = useRef<number>(0);
  const idleCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breathPhaseRef = useRef<number>(0);

  const { idle, setIdleState } = useStageStore();
  const idleTimeoutMs = useStageStore((s) => s.config.idleTimeoutMs);

  /**
   * 处理闲置状态切换事件
   */
  const handleIdleState = useCallback(
    (event: IdleStateEvent) => {
      setIdleState(event.state);
    },
    [setIdleState]
  );

  /**
   * 呼吸动画（正弦波驱动）
   */
  const animateBreath = useCallback(
    (now: number) => {
      const coreModel = modelRef.current?.internalModel?.coreModel;
      const storeState = useStageStore.getState();

      if (coreModel && storeState.idle.isIdle) {
        // 呼吸：使用正弦波，周期约 4 秒
        breathPhaseRef.current = (now % 4000) / 4000;
        const breathValue = (Math.sin(breathPhaseRef.current * Math.PI * 2) + 1) / 2;
        coreModel.setParameterValueById(BREATH_PARAM, breathValue);
      }

      rafRef.current = requestAnimationFrame(animateBreath);
    },
    [modelRef]
  );

  /**
   * 随机眨眼
   */
  const scheduleBlink = useCallback(() => {
    const interval = BLINK_MIN_INTERVAL + Math.random() * (BLINK_MAX_INTERVAL - BLINK_MIN_INTERVAL);

    blinkTimerRef.current = setTimeout(() => {
      const coreModel = modelRef.current?.internalModel?.coreModel;
      const storeState = useStageStore.getState();

      if (coreModel && storeState.idle.isIdle) {
        // 闭眼
        coreModel.setParameterValueById(EYE_L_PARAM, 0);
        coreModel.setParameterValueById(EYE_R_PARAM, 0);

        // 睁眼
        setTimeout(() => {
          if (coreModel) {
            coreModel.setParameterValueById(EYE_L_PARAM, 1);
            coreModel.setParameterValueById(EYE_R_PARAM, 1);
          }
        }, BLINK_DURATION);
      }

      // 调度下一次眨眼
      scheduleBlink();
    }, interval);
  }, [modelRef]);

  /**
   * 定期检查是否应进入闲置状态
   */
  const startIdleCheck = useCallback(() => {
    idleCheckTimerRef.current = setInterval(() => {
      const storeState = useStageStore.getState();
      const elapsed = Date.now() - storeState.idle.lastActivityTime;

      if (
        elapsed >= idleTimeoutMs &&
        !storeState.idle.isIdle &&
        !storeState.lipsync.isSpeaking &&
        !storeState.motion.isPlaying
      ) {
        setIdleState("idle");
      }
    }, 1000);
  }, [idleTimeoutMs, setIdleState]);

  /**
   * 注册事件监听和启动动画循环
   */
  useEffect(() => {
    stageEventBus.on("idle_state", handleIdleState);
    rafRef.current = requestAnimationFrame(animateBreath);
    scheduleBlink();
    startIdleCheck();

    return () => {
      stageEventBus.off("idle_state", handleIdleState);
      cancelAnimationFrame(rafRef.current);
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (idleCheckTimerRef.current) clearInterval(idleCheckTimerRef.current);
    };
  }, [handleIdleState, animateBreath, scheduleBlink, startIdleCheck]);

  return idle;
}
