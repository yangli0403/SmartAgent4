/**
 * EmotionsExpressClient 单元测试
 *
 * 测试情感渲染客户端的核心功能：健康检查、渲染、降级和标签解析。
 *
 * 修复说明（2026-03-25）：
 * - 原测试按旧版 API 设计编写（期望 render() 直接转发远程 segments），
 *   但实际实现是：本地解析标签 → 调用 TTS synthesize → 组装结果。
 * - parseOnly() 是纯本地解析，不发 HTTP 请求。
 * - 降级逻辑中 parseEmotionTags 的 cleanText 用空格连接多段文本。
 * - 本次修复将所有断言对齐到当前 emotionsClient.ts 的实际行为。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  EmotionsExpressClient,
  parseEmotionTags,
} from "../../server/emotions/emotionsClient";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("EmotionsExpressClient", () => {
  let client: EmotionsExpressClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new EmotionsExpressClient({
      baseUrl: "http://localhost:8000",
      timeout: 5000,
      enabled: true,
      retryCount: 1,
      retryDelay: 100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== isAvailable ====================

  describe("isAvailable", () => {
    it("应在服务健康时返回 true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const result = await client.isAvailable();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/health",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("应在服务不健康时返回 false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      const result = await client.isAvailable();
      expect(result).toBe(false);
    });

    it("应在网络错误时返回 false", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await client.isAvailable();
      expect(result).toBe(false);
    });

    it("应在禁用时返回 false", async () => {
      const disabledClient = new EmotionsExpressClient({
        enabled: false,
      });

      const result = await disabledClient.isAvailable();
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("应缓存健康检查结果", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await client.isAvailable();
      await client.isAvailable();

      // 只应调用一次 fetch（缓存生效）
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== render ====================

  describe("render", () => {
    it("应在服务可用时返回多模态片段（带情感标签）", async () => {
      // 健康检查
      mockFetch.mockResolvedValueOnce({ ok: true });
      // TTS synthesize 请求 — render() 内部对每个 segment 调用 synthesize()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          audio_base64: "base64data",
          format: "mp3",
        }),
      });

      // 使用带情感标签的文本，这样 normalizeEmotion 能识别出 happy
      const result = await client.render(
        "[emotion:happy]你好！",
        "session-1"
      );

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好！");
      expect(result[0].emotion).toBe("happy");
      expect(result[0].audioBase64).toBe("base64data");
      expect(result[0].audioFormat).toBe("mp3");
      // render() 组装时 actions 始终为空数组
      expect(result[0].actions).toHaveLength(0);
    });

    it("应在服务可用时返回多模态片段（纯文本无标签）", async () => {
      // 健康检查
      mockFetch.mockResolvedValueOnce({ ok: true });
      // TTS synthesize 请求
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          audio_base64: "audiodata",
          format: "wav",
        }),
      });

      const result = await client.render("你好！", "session-1");

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好！");
      // 无标签时 normalizeEmotion(undefined) → "neutral"
      expect(result[0].emotion).toBe("neutral");
      expect(result[0].audioBase64).toBe("audiodata");
    });

    it("应在服务不可用时返回降级结果", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.render(
        "[expression:smile]你好！",
        "session-1"
      );

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好！");
      expect(result[0].emotion).toBe("neutral");
      expect(result[0].audioBase64).toBeUndefined();
    });

    it("应在渲染失败后重试并最终降级", async () => {
      // 健康检查通过
      mockFetch.mockResolvedValueOnce({ ok: true });
      // 第一次 TTS 失败
      mockFetch.mockRejectedValueOnce(new Error("Server error"));
      // 重试也失败（retryCount=1，所以总共 2 次尝试）
      mockFetch.mockRejectedValueOnce(new Error("Server error"));

      const result = await client.render("测试", "session-1");

      // synthesize 返回 null → audioBase64 为 undefined，emotion 为 neutral
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("测试");
      expect(result[0].emotion).toBe("neutral");
      expect(result[0].audioBase64).toBeUndefined();
    });

    it("应正确处理多段情感标签文本", async () => {
      // 健康检查
      mockFetch.mockResolvedValueOnce({ ok: true });
      // 第一段 TTS
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ audio_base64: "audio1", format: "wav" }),
      });
      // 第二段 TTS
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ audio_base64: "audio2", format: "wav" }),
      });

      // 两段标签文本：[emotion:happy]片段1 [emotion:sad]片段2
      const result = await client.render(
        "[emotion:happy]片段1 [emotion:sad]片段2",
        "session-1"
      );

      // parseEmotionTags 会将其拆分为两个 segment
      expect(result.length).toBeGreaterThanOrEqual(1);
      // 第一段应该包含 "片段1"
      expect(result[0].text).toContain("片段1");
    });
  });

  // ==================== parseOnly ====================

  describe("parseOnly", () => {
    it("应在本地解析情感标签（不发 HTTP 请求）", async () => {
      // parseOnly 是纯本地解析，不调用 fetch
      const result = await client.parseOnly(
        "[emotion:happy]你好"
      );

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好");
      expect(result[0].emotion).toBe("happy");
      // parseOnly 不应调用任何 fetch（不做健康检查，不调 TTS）
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("应对纯文本返回 neutral 情感", async () => {
      const result = await client.parseOnly("你好");

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好");
      expect(result[0].emotion).toBe("neutral");
    });

    it("应对无效情感类型标准化为 neutral", async () => {
      const result = await client.parseOnly(
        "[emotion:invalid_type]测试"
      );

      expect(result).toHaveLength(1);
      expect(result[0].emotion).toBe("neutral");
    });
  });

  // ==================== 降级逻辑 ====================

  describe("降级逻辑", () => {
    it("应正确去除 [tag:value] 标签", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.render(
        "[expression:smile]你好[gesture:wave]世界[sound:laugh]",
        "session-1"
      );

      // createFallbackSegments 使用 parseEmotionTags 的 cleanText，
      // cleanText 将各段用空格连接
      const allText = result.map((r) => r.text).join("");
      expect(allText).toContain("你好");
      expect(allText).toContain("世界");
      // 不应包含标签
      expect(allText).not.toContain("[expression:");
      expect(allText).not.toContain("[gesture:");
      expect(allText).not.toContain("[sound:");
    });

    it("应处理没有标签的纯文本", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.render("纯文本消息", "session-1");

      expect(result[0].text).toBe("纯文本消息");
    });

    it("应处理只有标签的文本", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.render(
        "[expression:smile][gesture:wave]",
        "session-1"
      );

      // 去除标签后为空，应回退到原始文本
      expect(result[0].text).toBeTruthy();
    });
  });

  // ==================== 情感类型标准化 ====================

  describe("情感类型标准化", () => {
    it("应将有效的情感类型保持不变", async () => {
      // 健康检查
      mockFetch.mockResolvedValueOnce({ ok: true });
      // TTS synthesize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ audio_base64: "data", format: "wav" }),
      });

      // 使用带 emotion 标签的文本，normalizeEmotion 才能识别
      const result = await client.render("[emotion:happy]test", "s1");
      expect(result[0].emotion).toBe("happy");
    });

    it("应将无效的情感类型标准化为 neutral", async () => {
      // 健康检查
      mockFetch.mockResolvedValueOnce({ ok: true });
      // TTS synthesize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ audio_base64: "data", format: "wav" }),
      });

      // 使用无效 emotion 标签
      const result = await client.render(
        "[emotion:invalid_emotion]test",
        "s1"
      );
      expect(result[0].emotion).toBe("neutral");
    });
  });

  // ==================== parseEmotionTags 单元测试 ====================

  describe("parseEmotionTags", () => {
    it("应解析复合标签 [emotion:happy|instruction:xxx]", () => {
      const result = parseEmotionTags(
        "[emotion:happy|instruction:用欢快的语气]你好世界"
      );
      expect(result.tags.emotion).toBe("happy");
      expect(result.tags.instruction).toBe("用欢快的语气");
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].text).toBe("你好世界");
    });

    it("应处理纯文本（无标签）", () => {
      const result = parseEmotionTags("纯文本消息");
      expect(result.cleanText).toBe("纯文本消息");
      expect(result.segments).toHaveLength(1);
      expect(Object.keys(result.tags)).toHaveLength(0);
    });

    it("应处理多个标签", () => {
      const result = parseEmotionTags(
        "[emotion:happy]你好[emotion:sad]再见"
      );
      expect(result.segments.length).toBeGreaterThanOrEqual(1);
      expect(result.cleanText).toContain("你好");
      expect(result.cleanText).toContain("再见");
    });
  });
});
