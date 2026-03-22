/**
 * EmotionsExpressClient 单元测试
 *
 * 测试情感渲染客户端的核心功能：健康检查、渲染、降级和标签解析。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EmotionsExpressClient } from "../../server/emotions/emotionsClient";

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
    it("应在服务可用时返回多模态片段", async () => {
      // 健康检查
      mockFetch.mockResolvedValueOnce({ ok: true });
      // 渲染请求
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          segments: [
            {
              text: "你好！",
              emotion: "happy",
              audio_base64: "base64data",
              audio_format: "mp3",
              actions: [{ type: "expression", value: "smile" }],
            },
          ],
        }),
      });

      const result = await client.render("你好！", "session-1");

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好！");
      expect(result[0].emotion).toBe("happy");
      expect(result[0].audioBase64).toBe("base64data");
      expect(result[0].actions).toHaveLength(1);
      expect(result[0].actions[0].type).toBe("expression");
      expect(result[0].actions[0].value).toBe("smile");
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
      // 第一次渲染失败
      mockFetch.mockRejectedValueOnce(new Error("Server error"));
      // 重试也失败
      mockFetch.mockRejectedValueOnce(new Error("Server error"));

      const result = await client.render("测试", "session-1");

      // 应返回降级结果
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("测试");
      expect(result[0].emotion).toBe("neutral");
    });

    it("应正确处理数组格式的响应", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { text: "片段1", emotion: "happy", actions: [] },
          { text: "片段2", emotion: "sad", actions: [] },
        ],
      });

      const result = await client.render("测试", "session-1");

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("片段1");
      expect(result[1].text).toBe("片段2");
    });
  });

  // ==================== parseOnly ====================

  describe("parseOnly", () => {
    it("应在服务可用时调用 /api/parse 端点", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            text: "你好",
            emotion: "happy",
            actions: [{ type: "expression", value: "smile" }],
          },
        ],
      });

      const result = await client.parseOnly("[expression:smile]你好");

      expect(result).toHaveLength(1);
      expect(result[0].emotion).toBe("happy");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/parse",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "[expression:smile]你好" }),
        })
      );
    });

    it("应在服务不可用时返回降级结果", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.parseOnly("[expression:smile]你好");

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("你好");
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

      expect(result[0].text).toBe("你好世界");
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
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ text: "test", emotion: "happy", actions: [] }],
      });

      const result = await client.render("test", "s1");
      expect(result[0].emotion).toBe("happy");
    });

    it("应将无效的情感类型标准化为 neutral", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { text: "test", emotion: "invalid_emotion", actions: [] },
        ],
      });

      const result = await client.render("test", "s1");
      expect(result[0].emotion).toBe("neutral");
    });
  });
});
