/**
 * useIdleManager 单元测试
 *
 * 关联用户测试用例：UTC-013, UTC-014, UTC-015
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";

describe("IdleManager 逻辑测试", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
    useStageStore.getState().reset();
  });

  it("idle_state 事件应更新闲置子状态", () => {
    stageEventBus.on("idle_state", (event) => {
      useStageStore.getState().setIdleState(event.state);
    });

    stageEventBus.emit("idle_state", { type: "idle_state", state: "thinking" });

    const state = useStageStore.getState();
    expect(state.idle.currentState).toBe("thinking");
    expect(state.idle.isIdle).toBe(false);
  });

  it("从 thinking 切换到 idle 应标记为闲置", () => {
    stageEventBus.on("idle_state", (event) => {
      useStageStore.getState().setIdleState(event.state);
    });

    stageEventBus.emit("idle_state", { type: "idle_state", state: "thinking" });
    stageEventBus.emit("idle_state", { type: "idle_state", state: "idle" });

    const state = useStageStore.getState();
    expect(state.idle.currentState).toBe("idle");
    expect(state.idle.isIdle).toBe(true);
  });

  it("listening 状态应标记为非闲置", () => {
    stageEventBus.on("idle_state", (event) => {
      useStageStore.getState().setIdleState(event.state);
    });

    stageEventBus.emit("idle_state", { type: "idle_state", state: "listening" });

    expect(useStageStore.getState().idle.isIdle).toBe(false);
  });

  it("活动记录应更新时间戳", () => {
    const before = Date.now();
    useStageStore.getState().recordActivity();
    const state = useStageStore.getState();
    expect(state.idle.lastActivityTime).toBeGreaterThanOrEqual(before);
    expect(state.idle.isIdle).toBe(false);
  });

  it("表情事件应自动记录活动（退出闲置）", () => {
    // 先进入闲置
    useStageStore.getState().setIdleState("idle");
    expect(useStageStore.getState().idle.isIdle).toBe(true);

    // 表情事件触发活动记录
    useStageStore.getState().setTargetExpression("happy");
    expect(useStageStore.getState().idle.isIdle).toBe(false);
  });

  it("动作事件应自动记录活动（退出闲置）", () => {
    useStageStore.getState().setIdleState("idle");
    useStageStore.getState().setCurrentMotion("nod");
    expect(useStageStore.getState().idle.isIdle).toBe(false);
  });

  it("说话状态应自动记录活动（退出闲置）", () => {
    useStageStore.getState().setIdleState("idle");
    useStageStore.getState().setSpeaking(true);
    expect(useStageStore.getState().idle.isIdle).toBe(false);
  });
});
