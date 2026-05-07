import { describe, it, expect } from "vitest";
import { inferStageHeuristic } from "../inferStageHeuristic";

describe("inferStageHeuristic", () => {
  it("感谢类 → smile + nod 倾向", () => {
    const r = inferStageHeuristic("太谢谢你了，帮大忙了！");
    expect(r.expression).toBe("smile");
    expect(r.motion).toBe("nod");
  });

  it("道歉类 → sad + bow", () => {
    const r = inferStageHeuristic("对不起，刚才我理解错了。");
    expect(r.expression).toBe("sad");
    expect(r.motion).toBe("bow");
  });

  it("疑问类 → think + head_tilt", () => {
    const r = inferStageHeuristic("这个功能怎么用？");
    expect(r.expression).toBe("think");
    expect(r.motion).toBe("head_tilt");
  });

  it("平淡陈述 → neutral", () => {
    const r = inferStageHeuristic("今天天气不错。");
    expect(r.expression).toBe("neutral");
    expect(r.motion).toBeUndefined();
  });

  it("空文本 → neutral", () => {
    expect(inferStageHeuristic("   ").expression).toBe("neutral");
  });
});
