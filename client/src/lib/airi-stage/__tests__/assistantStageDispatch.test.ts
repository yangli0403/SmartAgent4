import { describe, it, expect, beforeEach, vi } from "vitest";
import { stageEventBus } from "../stageEventBus";
import { dispatchAssistantStageReply } from "../assistantStageDispatch";

describe("dispatchAssistantStageReply", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
  });

  it("无标签时触发 expression（启发式）", () => {
    const spy = vi.spyOn(stageEventBus, "emit");
    dispatchAssistantStageReply("非常感谢你的耐心帮助！");
    expect(spy).toHaveBeenCalledWith(
      "expression",
      expect.objectContaining({
        type: "expression",
        expression: "smile",
      })
    );
    expect(spy).toHaveBeenCalledWith("tts_start", expect.any(Object));
    spy.mockRestore();
  });

  it("有显式 expression 标签时走标签分支", () => {
    const spy = vi.spyOn(stageEventBus, "emit");
    dispatchAssistantStageReply("你好 [expression:angry] 注意语气");
    expect(spy).toHaveBeenCalledWith(
      "expression",
      expect.objectContaining({ expression: "angry" })
    );
    spy.mockRestore();
  });
});
