/**
 * 动作驱动 Hook — useMotionDriver
 *
 * 监听 StageEventBus 的 motion 事件，
 * 调用 Live2D 模型的 motion() 方法播放预设动作。
 * 支持优先级打断：高优先级动作可以打断低优先级动作。
 *
 * 关联用户测试用例：UTC-009, UTC-010
 */

import { useEffect, useCallback } from "react";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { getMotionDef } from "@/lib/airi-stage/motionMapping";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import type { MotionEvent, MotionDriverState } from "@/lib/airi-stage/types";

/** Live2D 模型实例接口（最小化定义） */
interface Live2DModelLike {
  motion(group: string, index?: number, priority?: number): Promise<boolean> | boolean;
}

/**
 * 动作驱动 Hook
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前动作驱动器状态
 */
export function useMotionDriver(
  modelRef: React.RefObject<Live2DModelLike | null>
): MotionDriverState {
  const { motion, setCurrentMotion, finishMotion } = useStageStore();

  /**
   * 处理动作事件
   */
  const handleMotion = useCallback(
    async (event: MotionEvent) => {
      const model = modelRef.current;
      if (!model) return;

      const motionDef = getMotionDef(event.motion);
      if (!motionDef) return;

      const eventPriority = event.priority ?? motionDef.priority;
      const currentState = useStageStore.getState().motion;

      // 优先级检查：如果当前动作优先级更高或相等，忽略新动作
      if (currentState.isPlaying && currentState.currentPriority > eventPriority) {
        return;
      }

      // 更新状态
      setCurrentMotion(event.motion, eventPriority);

      try {
        // 调用 Live2D 模型播放动作
        await model.motion(motionDef.group, motionDef.index, eventPriority);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(`[MotionDriver] 播放动作 "${event.motion}" 失败:`, error);
        }
      } finally {
        // 动作播放完成，清除状态
        finishMotion();
      }
    },
    [modelRef, setCurrentMotion, finishMotion]
  );

  /**
   * 注册事件监听
   */
  useEffect(() => {
    stageEventBus.on("motion", handleMotion);
    return () => {
      stageEventBus.off("motion", handleMotion);
    };
  }, [handleMotion]);

  return motion;
}
