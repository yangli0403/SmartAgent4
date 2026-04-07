/**
 * Emotions System Client — 单元测试
 *
 * 测试复合情感标签解析和客户端行为。
 */

import { describe, it, expect } from "vitest";
import {
  parseEmotionTags,
  EmotionsSystemClient,
  dedupeConsecutiveParsedSegments,
} from "../emotionsClient";

// ==================== 标签解析测试 ====================

describe("parseEmotionTags", () => {
  it("应该正确解析单个情感标签", () => {
    const input = "[emotion:happy] 今天天气真好！";
    const result = parseEmotionTags(input);

    expect(result.tags.emotion).toBe("happy");
    expect(result.cleanText).toContain("今天天气真好");
  });

  it("应该正确解析复合标签（emotion + instruction）", () => {
    const input = "[emotion:sad|instruction:用低沉的语气] 我今天有点难过。";
    const result = parseEmotionTags(input);

    expect(result.tags.emotion).toBe("sad");
    expect(result.tags.instruction).toBe("用低沉的语气");
    expect(result.cleanText).toContain("我今天有点难过");
  });

  it("应该处理没有标签的纯文本", () => {
    const input = "这是一段没有标签的普通文本。";
    const result = parseEmotionTags(input);

    expect(result.cleanText).toBe("这是一段没有标签的普通文本。");
    expect(Object.keys(result.tags).length).toBe(0);
  });

  it("应该处理多个标签段落", () => {
    const input =
      "[emotion:happy] 你好！[emotion:neutral] 让我来帮你处理这个问题。";
    const result = parseEmotionTags(input);

    expect(result.segments.length).toBeGreaterThanOrEqual(2);
  });

  it("应该处理空字符串", () => {
    const result = parseEmotionTags("");
    expect(result.cleanText).toBe("");
    expect(result.segments.length).toBe(0);
  });

  it("应该正确处理标签中的中文冒号", () => {
    const input = "[emotion:angry|instruction:用愤怒的语气说话] 这太过分了！";
    const result = parseEmotionTags(input);

    expect(result.tags.emotion).toBe("angry");
    expect(result.tags.instruction).toBe("用愤怒的语气说话");
  });

  it("多标签相邻重复段应去重，避免同句两次 TTS", () => {
    const result = parseEmotionTags(
      "[emotion:happy]片段1 [emotion:sad]片段2"
    );
    expect(result.segments.length).toBe(2);
    const texts = result.segments.map((s) => s.text);
    expect(texts.filter((t) => t === "片段1").length).toBe(1);
  });
});

describe("dedupeConsecutiveParsedSegments", () => {
  it("合并相邻完全相同的段", () => {
    const raw = [
      { text: "同句", tags: { emotion: "neutral" } },
      { text: "同句", tags: { emotion: "neutral" } },
      { text: "下一句", tags: { emotion: "happy" } },
    ];
    const d = dedupeConsecutiveParsedSegments(raw);
    expect(d).toHaveLength(2);
    expect(d[0].text).toBe("同句");
    expect(d[1].text).toBe("下一句");
  });
});

// ==================== 客户端测试 ====================

describe("EmotionsSystemClient", () => {
  it("应该在 disabled 状态下返回 false", async () => {
    const client = new EmotionsSystemClient({ enabled: false });
    const available = await client.isAvailable();
    expect(available).toBe(false);
  });

  it("应该在服务不可用时返回降级结果", async () => {
    const client = new EmotionsSystemClient({
      enabled: true,
      baseUrl: "http://localhost:99999", // 不存在的端口
      timeout: 1000,
      retryCount: 0,
      retryDelay: 100,
    });

    const segments = await client.render(
      "[emotion:happy] 你好！",
      "test-session"
    );

    // 应该返回降级结果（纯文本，无音频）
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].text).toContain("你好");
    expect(segments[0].emotion).toBe("neutral"); // 降级时为 neutral
  });

  it("parseOnly 应该正确解析标签但不调用 TTS", async () => {
    const client = new EmotionsSystemClient({ enabled: false });

    const segments = await client.parseOnly(
      "[emotion:surprised] 哇，太棒了！"
    );

    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].emotion).toBe("surprised");
    expect(segments[0].text).toContain("太棒了");
    expect(segments[0].audioBase64).toBeUndefined();
  });
});
