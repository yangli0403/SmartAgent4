import { describe, it, expect } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import {
  extractDialogueSlotsFromMessages,
  mergeDialogueSlotsWithLocationCity,
} from "../dialogueSlots";

describe("extractDialogueSlotsFromMessages", () => {
  it("应从多轮用户消息中抽取苏州起终点与途经点", () => {
    const messages = [
      new HumanMessage(
        "公司在：太湖软件园；家在：苏州工业园区九龙仓。帮我规划回家路线。"
      ),
      new HumanMessage("途径一下山姆超市"),
    ];
    const slots = extractDialogueSlotsFromMessages(messages);
    expect(slots?.regionHint).toMatch(/苏州/);
    expect(slots?.navOrigin).toBe("太湖软件园");
    expect(slots?.navDestination).toContain("九龙仓");
    expect(slots?.navWaypoints?.some((w) => /山姆/.test(w))).toBe(true);
  });

  it("无地点线索时应返回 undefined", () => {
    const slots = extractDialogueSlotsFromMessages([
      new HumanMessage("今天天气怎么样"),
    ]);
    expect(slots).toBeUndefined();
  });
});

describe("mergeDialogueSlotsWithLocationCity", () => {
  it("无 regionHint 时应用语义层城市兜底", () => {
    const merged = mergeDialogueSlotsWithLocationCity(undefined, "无锡市");
    expect(merged?.regionHint).toBe("无锡市");
  });
});
