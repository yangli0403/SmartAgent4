/**
 * StageEventBus 单元测试
 *
 * 关联用户测试用例：UTC-004, UTC-005, UTC-006
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stageEventBus,
  dispatchStageEventsFromTags,
  notifyThinking,
  notifyListening,
  notifyIdle,
  notifyTtsStart,
  notifyTtsStop,
  notifyTtsLevel,
} from "../stageEventBus";

describe("StageEventBus", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
  });

  // ==================== 基础事件分发 ====================

  it("应能发送和接收 expression 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("expression", handler);

    stageEventBus.emit("expression", {
      type: "expression",
      expression: "happy",
      intensity: 0.8,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: "expression",
      expression: "happy",
      intensity: 0.8,
    });
  });

  it("应能发送和接收 motion 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("motion", handler);

    stageEventBus.emit("motion", {
      type: "motion",
      motion: "nod",
      priority: 2,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: "motion",
      motion: "nod",
      priority: 2,
    });
  });

  // ==================== dispatchStageEventsFromTags ====================

  it("应将 expression 标签转换为 expression 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("expression", handler);

    dispatchStageEventsFromTags([{ type: "expression", value: "smile" }]);

    expect(handler).toHaveBeenCalledWith({
      type: "expression",
      expression: "smile",
      intensity: 1.0,
    });
  });

  it("应将 animation 标签转换为 motion 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("motion", handler);

    dispatchStageEventsFromTags([{ type: "animation", value: "nod" }]);

    expect(handler).toHaveBeenCalledWith({
      type: "motion",
      motion: "nod",
      priority: 1,
    });
  });

  it("应将 gesture 标签转换为 motion 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("motion", handler);

    dispatchStageEventsFromTags([{ type: "gesture", value: "thumbs_up" }]);

    expect(handler).toHaveBeenCalledWith({
      type: "motion",
      motion: "thumbs_up",
      priority: 1,
    });
  });

  it("应将 posture 标签转换为低优先级 motion 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("motion", handler);

    dispatchStageEventsFromTags([{ type: "posture", value: "lean_forward" }]);

    expect(handler).toHaveBeenCalledWith({
      type: "motion",
      motion: "lean_forward",
      priority: 0,
    });
  });

  it("应将 locomotion 标签转换为低优先级 motion 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("motion", handler);

    dispatchStageEventsFromTags([{ type: "locomotion", value: "step_forward" }]);

    expect(handler).toHaveBeenCalledWith({
      type: "motion",
      motion: "step_forward",
      priority: 0,
    });
  });

  it("应忽略 pause 和 sound 标签", () => {
    const expressionHandler = vi.fn();
    const motionHandler = vi.fn();
    stageEventBus.on("expression", expressionHandler);
    stageEventBus.on("motion", motionHandler);

    dispatchStageEventsFromTags([
      { type: "pause", value: "1" },
      { type: "sound", value: "laugh" },
    ]);

    expect(expressionHandler).not.toHaveBeenCalled();
    expect(motionHandler).not.toHaveBeenCalled();
  });

  it("应能处理混合标签列表", () => {
    const expressionHandler = vi.fn();
    const motionHandler = vi.fn();
    stageEventBus.on("expression", expressionHandler);
    stageEventBus.on("motion", motionHandler);

    dispatchStageEventsFromTags([
      { type: "expression", value: "happy" },
      { type: "animation", value: "wave" },
      { type: "gesture", value: "clap" },
    ]);

    expect(expressionHandler).toHaveBeenCalledTimes(1);
    expect(motionHandler).toHaveBeenCalledTimes(2);
  });

  // ==================== 便捷通知函数 ====================

  it("notifyThinking 应发送 thinking 状态", () => {
    const handler = vi.fn();
    stageEventBus.on("idle_state", handler);

    notifyThinking();

    expect(handler).toHaveBeenCalledWith({
      type: "idle_state",
      state: "thinking",
    });
  });

  it("notifyListening 应发送 listening 状态", () => {
    const handler = vi.fn();
    stageEventBus.on("idle_state", handler);

    notifyListening();

    expect(handler).toHaveBeenCalledWith({
      type: "idle_state",
      state: "listening",
    });
  });

  it("notifyIdle 应发送 idle 状态", () => {
    const handler = vi.fn();
    stageEventBus.on("idle_state", handler);

    notifyIdle();

    expect(handler).toHaveBeenCalledWith({
      type: "idle_state",
      state: "idle",
    });
  });

  it("notifyTtsStart 应发送 tts_start 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("tts_start", handler);

    notifyTtsStart(5000);

    expect(handler).toHaveBeenCalledWith({
      type: "tts_start",
      durationMs: 5000,
    });
  });

  it("notifyTtsStop 应发送 tts_stop 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("tts_stop", handler);

    notifyTtsStop();

    expect(handler).toHaveBeenCalledWith({
      type: "tts_stop",
    });
  });

  it("notifyTtsLevel 应发送 tts_level 事件并限制范围在 0-1", () => {
    const handler = vi.fn();
    stageEventBus.on("tts_level", handler);

    notifyTtsLevel(0.5);
    expect(handler).toHaveBeenCalledWith({
      type: "tts_level",
      level: 0.5,
    });

    notifyTtsLevel(1.5);
    expect(handler).toHaveBeenCalledWith({
      type: "tts_level",
      level: 1.0,
    });

    notifyTtsLevel(-0.3);
    expect(handler).toHaveBeenCalledWith({
      type: "tts_level",
      level: 0.0,
    });
  });
});
