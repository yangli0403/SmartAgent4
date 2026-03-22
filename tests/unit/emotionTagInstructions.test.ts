/**
 * Emotion Tag Instructions 单元测试
 *
 * 测试情感标签指令模板的完整性和格式正确性。
 */

import { describe, it, expect } from "vitest";
import {
  getEmotionTagInstructions,
  getCompactEmotionTagInstructions,
} from "../../server/emotions/emotionTagInstructions";

describe("getEmotionTagInstructions", () => {
  it("应返回非空字符串", () => {
    const instructions = getEmotionTagInstructions();
    expect(instructions).toBeTruthy();
    expect(instructions.length).toBeGreaterThan(100);
  });

  it("应包含所有面部表情标签", () => {
    const instructions = getEmotionTagInstructions();
    const expressions = ["smile", "sad", "surprised", "angry", "fearful", "disgusted"];
    for (const expr of expressions) {
      expect(instructions).toContain(`[expression:${expr}]`);
    }
  });

  it("应包含所有动画标签", () => {
    const instructions = getEmotionTagInstructions();
    const animations = ["wave", "nod", "head_tilt", "bow"];
    for (const anim of animations) {
      expect(instructions).toContain(`[animation:${anim}]`);
    }
  });

  it("应包含所有手势标签", () => {
    const instructions = getEmotionTagInstructions();
    const gestures = ["thumbs_up", "clap", "shrug", "facepalm", "open_palms", "finger_wag"];
    for (const gesture of gestures) {
      expect(instructions).toContain(`[gesture:${gesture}]`);
    }
  });

  it("应包含所有姿态标签", () => {
    const instructions = getEmotionTagInstructions();
    const postures = ["lean_forward", "lean_back", "stand_tall", "slouch", "arms_crossed", "hands_on_hips", "head_down"];
    for (const posture of postures) {
      expect(instructions).toContain(`[posture:${posture}]`);
    }
  });

  it("应包含移动标签", () => {
    const instructions = getEmotionTagInstructions();
    expect(instructions).toContain("[locomotion:step_forward]");
    expect(instructions).toContain("[locomotion:step_back]");
    expect(instructions).toContain("[locomotion:jump]");
    expect(instructions).toContain("[locomotion:spin]");
  });

  it("应包含音效标签", () => {
    const instructions = getEmotionTagInstructions();
    expect(instructions).toContain("[sound:laugh]");
    expect(instructions).toContain("[sound:sigh]");
    expect(instructions).toContain("[sound:gasp]");
    expect(instructions).toContain("[sound:applause]");
  });

  it("应包含暂停标签", () => {
    const instructions = getEmotionTagInstructions();
    expect(instructions).toContain("[pause:1.0]");
  });

  it("应包含使用示例", () => {
    const instructions = getEmotionTagInstructions();
    expect(instructions).toContain("使用示例");
  });
});

describe("getCompactEmotionTagInstructions", () => {
  it("应返回比完整版更短的字符串", () => {
    const full = getEmotionTagInstructions();
    const compact = getCompactEmotionTagInstructions();
    expect(compact.length).toBeLessThan(full.length);
  });

  it("应包含所有标签类型的简写", () => {
    const compact = getCompactEmotionTagInstructions();
    expect(compact).toContain("expression:");
    expect(compact).toContain("animation:");
    expect(compact).toContain("gesture:");
    expect(compact).toContain("posture:");
    expect(compact).toContain("locomotion:");
    expect(compact).toContain("sound:");
    expect(compact).toContain("pause:");
  });
});
