/**
 * useStageStore 单元测试
 *
 * 关联用户测试用例：UTC-007, UTC-008, UTC-009, UTC-013
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useStageStore } from "../useStageStore";

describe("useStageStore", () => {
  beforeEach(() => {
    useStageStore.getState().reset();
  });

  // ==================== 初始状态 ====================

  it("初始状态应为 neutral 表情", () => {
    const state = useStageStore.getState();
    expect(state.expression.currentExpression).toBe("neutral");
    expect(state.expression.targetExpression).toBe("neutral");
    expect(state.expression.isTransitioning).toBe(false);
  });

  it("初始状态应无动作播放", () => {
    const state = useStageStore.getState();
    expect(state.motion.currentMotion).toBeNull();
    expect(state.motion.isPlaying).toBe(false);
  });

  it("初始状态应不在说话", () => {
    const state = useStageStore.getState();
    expect(state.lipsync.isSpeaking).toBe(false);
    expect(state.lipsync.currentLevel).toBe(0);
  });

  it("初始状态应为 idle", () => {
    const state = useStageStore.getState();
    expect(state.idle.currentState).toBe("idle");
    expect(state.idle.isIdle).toBe(true);
  });

  // ==================== 表情驱动 ====================

  it("setTargetExpression 应更新目标表情并标记过渡中", () => {
    useStageStore.getState().setTargetExpression("happy", 0.8);
    const state = useStageStore.getState();
    expect(state.expression.targetExpression).toBe("happy");
    expect(state.expression.targetIntensity).toBe(0.8);
    expect(state.expression.isTransitioning).toBe(true);
  });

  it("setTargetExpression 应记录活动时间", () => {
    const before = Date.now();
    useStageStore.getState().setTargetExpression("happy");
    const state = useStageStore.getState();
    expect(state.idle.lastActivityTime).toBeGreaterThanOrEqual(before);
    expect(state.idle.isIdle).toBe(false);
  });

  it("finishExpressionTransition 应同步当前表情到目标表情", () => {
    useStageStore.getState().setTargetExpression("sad", 0.6);
    useStageStore.getState().finishExpressionTransition();
    const state = useStageStore.getState();
    expect(state.expression.currentExpression).toBe("sad");
    expect(state.expression.currentIntensity).toBe(0.6);
    expect(state.expression.isTransitioning).toBe(false);
  });

  // ==================== 动作驱动 ====================

  it("setCurrentMotion 应更新当前动作", () => {
    useStageStore.getState().setCurrentMotion("nod", 2);
    const state = useStageStore.getState();
    expect(state.motion.currentMotion).toBe("nod");
    expect(state.motion.currentPriority).toBe(2);
    expect(state.motion.isPlaying).toBe(true);
  });

  it("finishMotion 应清除当前动作", () => {
    useStageStore.getState().setCurrentMotion("wave");
    useStageStore.getState().finishMotion();
    const state = useStageStore.getState();
    expect(state.motion.currentMotion).toBeNull();
    expect(state.motion.isPlaying).toBe(false);
  });

  // ==================== 口型驱动 ====================

  it("setSpeaking 应更新说话状态", () => {
    useStageStore.getState().setSpeaking(true);
    expect(useStageStore.getState().lipsync.isSpeaking).toBe(true);
  });

  it("setSpeaking(false) 应重置音量电平", () => {
    useStageStore.getState().setSpeaking(true);
    useStageStore.getState().updateLevel(0.7);
    useStageStore.getState().setSpeaking(false);
    const state = useStageStore.getState();
    expect(state.lipsync.isSpeaking).toBe(false);
    expect(state.lipsync.currentLevel).toBe(0);
  });

  it("updateLevel 应更新音量电平", () => {
    useStageStore.getState().updateLevel(0.5);
    expect(useStageStore.getState().lipsync.currentLevel).toBe(0.5);
  });

  // ==================== 闲置管理 ====================

  it("setIdleState 应更新闲置子状态", () => {
    useStageStore.getState().setIdleState("thinking");
    const state = useStageStore.getState();
    expect(state.idle.currentState).toBe("thinking");
    expect(state.idle.isIdle).toBe(false);
  });

  it("setIdleState('idle') 应标记为闲置", () => {
    useStageStore.getState().setIdleState("thinking");
    useStageStore.getState().setIdleState("idle");
    expect(useStageStore.getState().idle.isIdle).toBe(true);
  });

  it("recordActivity 应更新活动时间", () => {
    const before = Date.now();
    useStageStore.getState().recordActivity();
    const state = useStageStore.getState();
    expect(state.idle.lastActivityTime).toBeGreaterThanOrEqual(before);
    expect(state.idle.isIdle).toBe(false);
  });

  // ==================== 全局 ====================

  it("reset 应恢复所有初始状态", () => {
    useStageStore.getState().setTargetExpression("happy");
    useStageStore.getState().setCurrentMotion("nod");
    useStageStore.getState().setSpeaking(true);
    useStageStore.getState().setIdleState("thinking");

    useStageStore.getState().reset();
    const state = useStageStore.getState();

    expect(state.expression.currentExpression).toBe("neutral");
    expect(state.motion.currentMotion).toBeNull();
    expect(state.lipsync.isSpeaking).toBe(false);
    expect(state.idle.currentState).toBe("idle");
  });
});
