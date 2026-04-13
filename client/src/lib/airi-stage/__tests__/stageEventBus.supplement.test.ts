/**
 * StageEventBus 补充测试 — 覆盖 Phase 6 中发现的未覆盖分支
 *
 * 补充 sound 标签忽略、未知标签类型警告、notifyThinking/notifyIdle 等
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageEventBus, dispatchStageEventsFromTags, notifyThinking, notifyIdle } from "../stageEventBus";
import type { EmotionTag } from "@/lib/emotionParser";

describe("StageEventBus 补充测试", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
  });

  it("sound 标签应被静默忽略，不分发任何事件", () => {
    const expressionHandler = vi.fn();
    const motionHandler = vi.fn();
    stageEventBus.on("expression", expressionHandler);
    stageEventBus.on("motion", motionHandler);

    const tags: EmotionTag[] = [
      { type: "sound", value: "beep", label: "提示音", emoji: "🔔" },
    ];

    dispatchStageEventsFromTags(tags);

    expect(expressionHandler).not.toHaveBeenCalled();
    expect(motionHandler).not.toHaveBeenCalled();
  });

  it("未知标签类型应被忽略（不抛出异常）", () => {
    const expressionHandler = vi.fn();
    stageEventBus.on("expression", expressionHandler);

    // 模拟一个未知类型的标签
    const tags = [
      { type: "unknown_type", value: "test", label: "测试", emoji: "❓" },
    ] as any;

    // 不应抛出异常
    expect(() => dispatchStageEventsFromTags(tags)).not.toThrow();
    expect(expressionHandler).not.toHaveBeenCalled();
  });

  it("notifyThinking 应分发 idle_state:thinking 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("idle_state", handler);

    notifyThinking();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "idle_state",
        state: "thinking",
      })
    );
  });

  it("notifyIdle 应分发 idle_state:idle 事件", () => {
    const handler = vi.fn();
    stageEventBus.on("idle_state", handler);

    notifyIdle();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "idle_state",
        state: "idle",
      })
    );
  });

  it("混合标签中 sound 标签应被跳过，其余正常分发", () => {
    const expressionHandler = vi.fn();
    const motionHandler = vi.fn();
    stageEventBus.on("expression", expressionHandler);
    stageEventBus.on("motion", motionHandler);

    const tags: EmotionTag[] = [
      { type: "expression", value: "happy", label: "开心", emoji: "😊" },
      { type: "sound", value: "ding", label: "提示", emoji: "🔔" },
      { type: "animation", value: "nod", label: "点头", emoji: "👍" },
    ];

    dispatchStageEventsFromTags(tags);

    expect(expressionHandler).toHaveBeenCalledTimes(1);
    expect(motionHandler).toHaveBeenCalledTimes(1);
  });
});
