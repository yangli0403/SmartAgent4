/**
 * News Tools 单元测试
 *
 * 测试 get_latest_news 工具的注册、参数校验，以及在主源(NewsData.io)
 * 与备源(百度 RSS)之间的容灾切换。fetch 通过 vi.spyOn 全局 mock，
 * 避免对外部网络的真实依赖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getLatestNewsImpl,
  registerNewsTools,
  callNewsTool,
  NEWS_TOOLS_SERVER_ID,
} from "../newsTools";

// ==================== Mock ToolRegistry ====================
const mockRegister = vi.fn();
const mockToolRegistry = { register: mockRegister };

// 用于在每个测试里覆盖 fetch 行为
let fetchSpy: ReturnType<typeof vi.spyOn>;

function mockNewsDataResp(items: number): Response {
  const results = Array.from({ length: items }).map((_, i) => ({
    title: `测试标题-${i + 1}`,
    link: `https://example.com/n/${i + 1}`,
    source_name: "测试源",
    pubDate: "2026-04-26 10:00:00",
    description: `这是第${i + 1}条测试新闻摘要。`,
  }));
  return new Response(JSON.stringify({ status: "success", results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockBaiduRssResp(items: number): Response {
  const inner = Array.from({ length: items })
    .map(
      (_, i) =>
        `<item><title><![CDATA[百度新闻-${i + 1}]]></title><link>https://baidu.com/n/${
          i + 1
        }</link><pubDate>Sat, 26 Apr 2026 10:00:00 GMT</pubDate><description><![CDATA[百度摘要-${
          i + 1
        }]]></description></item>`
    )
    .join("");
  const xml = `<?xml version="1.0"?><rss><channel>${inner}</channel></rss>`;
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/xml" },
  });
}

describe("NewsTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEWSDATA_API_KEY = "test-key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.NEWSDATA_API_KEY;
  });

  // ==================== registerNewsTools ====================
  describe("registerNewsTools", () => {
    it("应注册 1 个新闻工具到 ToolRegistry", () => {
      registerNewsTools(mockToolRegistry as any);
      expect(mockRegister).toHaveBeenCalledTimes(1);
      expect(mockRegister.mock.calls[0][0].name).toBe("get_latest_news");
      expect(mockRegister.mock.calls[0][0].serverId).toBe(NEWS_TOOLS_SERVER_ID);
    });

    it("inputSchema 应包含 category / q / count 三个字段", () => {
      registerNewsTools(mockToolRegistry as any);
      const schema = mockRegister.mock.calls[0][0].inputSchema;
      expect(schema.properties.category).toBeDefined();
      expect(schema.properties.q).toBeDefined();
      expect(schema.properties.count).toBeDefined();
    });
  });

  // ==================== 主源命中 ====================
  describe("getLatestNewsImpl - NewsData.io 主源", () => {
    it("无参数：使用 general 类目调用主源并返回 5 条", async () => {
      fetchSpy.mockResolvedValueOnce(mockNewsDataResp(5));
      const result = JSON.parse(await getLatestNewsImpl({}));
      expect(result.success).toBe(true);
      expect(result.provider).toContain("newsdata.io");
      expect(result.news).toHaveLength(5);
      expect(result.news[0]).toMatchObject({
        title: expect.any(String),
        url: expect.any(String),
        source: expect.any(String),
        publishedAt: expect.any(String),
        summary: expect.any(String),
      });
    });

    it("category='ai' 时主源会带上 AI 关键字检索", async () => {
      fetchSpy.mockResolvedValueOnce(mockNewsDataResp(2));
      const result = JSON.parse(
        await getLatestNewsImpl({ category: "ai", count: 2 })
      );
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("category=technology");
      expect(decodeURIComponent(calledUrl)).toMatch(/q=人工智能|AI|大模型/);
      expect(result.count).toBe(2);
    });

    it("count 超界时被裁剪到 1-10", async () => {
      fetchSpy.mockResolvedValue(mockNewsDataResp(10));
      const big = JSON.parse(await getLatestNewsImpl({ count: 100, q: "k1" }));
      expect(big.count).toBeLessThanOrEqual(10);
    });
  });

  // ==================== 主源失败回退备源 ====================
  describe("getLatestNewsImpl - 备源回退", () => {
    it("主源 502 → 自动回退到百度 RSS", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response("oops", { status: 502 }))
        .mockResolvedValueOnce(mockBaiduRssResp(3));
      const result = JSON.parse(
        await getLatestNewsImpl({ category: "tech", count: 3, q: "rss-test" })
      );
      expect(result.success).toBe(true);
      expect(result.provider).toBe("baidu-rss");
      expect(result.news).toHaveLength(3);
      expect(result.news[0].source).toBe("百度新闻");
    });

    it("主备都失败时返回 success=false 友好错误", async () => {
      fetchSpy.mockRejectedValue(new Error("network down"));
      const result = JSON.parse(
        await getLatestNewsImpl({ category: "sports", q: "fail-test" })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("不可用");
    });
  });

  // ==================== callNewsTool ====================
  describe("callNewsTool", () => {
    it("调用 get_latest_news 透传到 Impl", async () => {
      fetchSpy.mockResolvedValueOnce(mockNewsDataResp(1));
      const result = await callNewsTool("get_latest_news", { count: 1, q: "passthrough" });
      expect(JSON.parse(result).success).toBe(true);
    });

    it("调用未知工具应返回错误", async () => {
      const result = await callNewsTool("unknown_tool", {});
      expect(JSON.parse(result).error).toBeDefined();
    });
  });
});
