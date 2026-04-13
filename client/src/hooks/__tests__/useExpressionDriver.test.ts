/**
 * useExpressionDriver 单元测试
 *
 * 关联用户测试用例：UTC-007, UTC-008
 * 注意：由于 Hook 依赖 requestAnimationFrame 和 Live2D 模型实例，
 * 这里测试的是驱动器与 StageEventBus 和 StageStore 的交互逻辑。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import { getExpressionParams } from "@/lib/airi-stage/expressionMapping";

describe("ExpressionDriver 逻辑测试", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
    useStageStore.getState().reset();
  });

  it("expression 事件应通过 Store 更新目标表情", () => {
    // 模拟驱动器的事件处理逻辑
    stageEventBus.on("expression", (event) => {
      useStageStore.getState().setTargetExpression(event.expression, event.intensity ?? 1.0);
    });

    stageEventBus.emit("expression", {
      type: "expression",
      expression: "happy",
      intensity: 0.8,
    });

    const state = useStageStore.getState();
    expect(state.expression.targetExpression).toBe("happy");
    expect(state.expression.targetIntensity).toBe(0.8);
    expect(state.expression.isTransitioning).toBe(true);
  });

  it("连续表情事件应更新为最新的目标表情", () => {
    stageEventBus.on("expression", (event) => {
      useStageStore.getState().setTargetExpression(event.expression, event.intensity ?? 1.0);
    });

    stageEventBus.emit("expression", {
      type: "expression",
      expression: "happy",
    });
    stageEventBus.emit("expression", {
      type: "expression",
      expression: "sad",
    });

    const state = useStageStore.getState();
    expect(state.expression.targetExpression).toBe("sad");
  });

  it("getExpressionParams 应返回正确的 Live2D 参数", () => {
    const params = getExpressionParams("happy");
    expect(params.params.ParamMouthForm).toBe(1.0);
    expect(params.params.ParamCheek).toBe(0.3);
  });

  it("finishExpressionTransition 应同步当前表情到目标", () => {
    useStageStore.getState().setTargetExpression("excited", 0.9);
    useStageStore.getState().finishExpressionTransition();

    const state = useStageStore.getState();
    expect(state.expression.currentExpression).toBe("excited");
    expect(state.expression.currentIntensity).toBe(0.9);
    expect(state.expression.isTransitioning).toBe(false);
  });
});
