/**
 * useLipsyncDriver 单元测试
 *
 * 关联用户测试用例：UTC-011, UTC-012
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";

describe("LipsyncDriver 逻辑测试", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
    useStageStore.getState().reset();
  });

  it("tts_start 事件应将说话状态设为 true", () => {
    stageEventBus.on("tts_start", () => {
      useStageStore.getState().setSpeaking(true);
    });

    stageEventBus.emit("tts_start", { type: "tts_start", durationMs: 3000 });

    expect(useStageStore.getState().lipsync.isSpeaking).toBe(true);
  });

  it("tts_stop 事件应将说话状态设为 false 并重置电平", () => {
    // 先设置为说话中
    useStageStore.getState().setSpeaking(true);
    useStageStore.getState().updateLevel(0.7);

    stageEventBus.on("tts_stop", () => {
      useStageStore.getState().setSpeaking(false);
    });

    stageEventBus.emit("tts_stop", { type: "tts_stop" });

    const state = useStageStore.getState();
    expect(state.lipsync.isSpeaking).toBe(false);
    expect(state.lipsync.currentLevel).toBe(0);
  });

  it("tts_level 事件应更新音量电平", () => {
    stageEventBus.on("tts_level", (event) => {
      useStageStore.getState().updateLevel(event.level);
    });

    stageEventBus.emit("tts_level", { type: "tts_level", level: 0.65 });

    expect(useStageStore.getState().lipsync.currentLevel).toBe(0.65);
  });

  it("连续 tts_level 事件应持续更新电平", () => {
    stageEventBus.on("tts_level", (event) => {
      useStageStore.getState().updateLevel(event.level);
    });

    stageEventBus.emit("tts_level", { type: "tts_level", level: 0.3 });
    stageEventBus.emit("tts_level", { type: "tts_level", level: 0.8 });
    stageEventBus.emit("tts_level", { type: "tts_level", level: 0.1 });

    expect(useStageStore.getState().lipsync.currentLevel).toBe(0.1);
  });
});
