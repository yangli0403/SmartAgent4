/**
 * 表情驱动 Hook — useExpressionDriver
 *
 * 监听 StageEventBus 的 expression 事件，
 * 通过 requestAnimationFrame 平滑插值更新 Live2D 模型参数。
 *
 * 关联用户测试用例：UTC-007, UTC-008
 */

import { useEffect, useRef, useCallback } from "react";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { getExpressionParams } from "@/lib/airi-stage/expressionMapping";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import type { ExpressionEvent, ExpressionDriverState, Live2DParamName } from "@/lib/airi-stage/types";

/** Live2D 模型实例接口（最小化定义，避免强依赖 pixi-live2d-display 类型） */
interface Live2DModelLike {
  internalModel?: {
    coreModel?: {
      setParameterValueById(id: string, value: number): void;
      getParameterValueById(id: string): number;
    };
  };
}

/**
 * 线性插值
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * 表情驱动 Hook
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前表情驱动器状态
 */
export function useExpressionDriver(
  modelRef: React.RefObject<Live2DModelLike | null>
): ExpressionDriverState {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  /** 当前各参数的实际值 */
  const currentParamsRef = useRef<Partial<Record<Live2DParamName, number>>>({});
  /** 目标各参数的值 */
  const targetParamsRef = useRef<Partial<Record<Live2DParamName, number>>>({});

  const {
    expression,
    setTargetExpression,
    updateCurrentExpression,
    finishExpressionTransition,
  } = useStageStore();

  const transitionMs = useStageStore((s) => s.config.expressionTransitionMs);

  /**
   * 处理表情事件
   */
  const handleExpression = useCallback(
    (event: ExpressionEvent) => {
      const paramSet = getExpressionParams(event.expression);
      targetParamsRef.current = { ...paramSet.params };
      setTargetExpression(event.expression, event.intensity ?? 1.0);
      lastTimeRef.current = performance.now();
    },
    [setTargetExpression]
  );

  /**
   * 动画帧循环：平滑插值更新 Live2D 参数
   */
  const animate = useCallback(
    (now: number) => {
      const model = modelRef.current;
      const coreModel = model?.internalModel?.coreModel;
      const storeState = useStageStore.getState();

      if (!storeState.expression.isTransitioning || !coreModel) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const elapsed = now - lastTimeRef.current;
      const progress = Math.min(1, elapsed / transitionMs);

      const target = targetParamsRef.current;
      const current = currentParamsRef.current;

      // 对每个目标参数进行插值
      for (const [paramName, targetValue] of Object.entries(target)) {
        if (targetValue === undefined) continue;
        const currentValue = current[paramName as Live2DParamName] ?? coreModel.getParameterValueById(paramName);
        const newValue = lerp(currentValue, targetValue, progress);
        current[paramName as Live2DParamName] = newValue;
        coreModel.setParameterValueById(paramName, newValue);
      }

      // 更新 Store 中的当前表情状态
      updateCurrentExpression(
        storeState.expression.targetExpression,
        progress
      );

      // 过渡完成
      if (progress >= 1) {
        finishExpressionTransition();
      }

      rafRef.current = requestAnimationFrame(animate);
    },
    [modelRef, transitionMs, updateCurrentExpression, finishExpressionTransition]
  );

  /**
   * 注册事件监听和动画循环
   */
  useEffect(() => {
    stageEventBus.on("expression", handleExpression);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      stageEventBus.off("expression", handleExpression);
      cancelAnimationFrame(rafRef.current);
    };
  }, [handleExpression, animate]);

  return expression;
}
