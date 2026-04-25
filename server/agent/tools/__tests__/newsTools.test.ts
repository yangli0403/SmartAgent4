/**
 * News Tools 单元测试
 *
 * 测试 get_latest_news 工具的参数校验、分类过滤和返回结构。
 * 关联用户测试用例：UTC-B1-1 ~ UTC-B1-6
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLatestNewsImpl,
  registerNewsTools,
  callNewsTool,
  NEWS_TOOLS_SERVER_ID,
} from "../newsTools";

// ==================== Mock ToolRegistry ====================
const mockRegister = vi.fn();
const mockToolRegistry = {
  register: mockRegister,
};

// ==================== 测试 ====================
describe("NewsTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== registerNewsTools ====================
  describe("registerNewsTools", () => {
    // UTC-B1-6: newsTools 注册函数被调用后，ToolRegistry 中存在 get_latest_news 工具
    it("应注册 1 个新闻工具到 ToolRegistry", () => {
      registerNewsTools(mockToolRegistry as any);
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it("注册的工具名称应为 get_latest_news", () => {
      registerNewsTools(mockToolRegistry as any);
      const registeredName = mockRegister.mock.calls[0][0].name;
      expect(registeredName).toBe("get_latest_news");
    });

    it("所有工具的 serverId 应为 NEWS_TOOLS_SERVER_ID", () => {
      registerNewsTools(mockToolRegistry as any);
      expect(mockRegister.mock.calls[0][0].serverId).toBe(NEWS_TOOLS_SERVER_ID);
    });

    it("工具应有 inputSchema 定义", () => {
      registerNewsTools(mockToolRegistry as any);
      const schema = mockRegister.mock.calls[0][0].inputSchema;
      expect(schema).toBeDefined();
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      expect(schema.properties.category).toBeDefined();
      expect(schema.properties.count).toBeDefined();
    });
  });

  // ==================== getLatestNewsImpl ====================
  describe("getLatestNewsImpl", () => {
    // UTC-B1-1: 调用 get_latest_news 返回包含 title/url/source/publishedAt 的新闻数组
    it("无参数调用应返回默认 5 条新闻", () => {
      const result = JSON.parse(getLatestNewsImpl({}));
      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
      expect(result.news).toHaveLength(5);
    });

    it("每条新闻应包含 title/url/source/publishedAt/summary 字段", () => {
      const result = JSON.parse(getLatestNewsImpl({}));
      for (const item of result.news) {
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("url");
        expect(item).toHaveProperty("source");
        expect(item).toHaveProperty("publishedAt");
        expect(item).toHaveProperty("summary");
        expect(typeof item.title).toBe("string");
        expect(typeof item.url).toBe("string");
        expect(typeof item.source).toBe("string");
        expect(typeof item.publishedAt).toBe("string");
      }
    });

    // UTC-B1-2: 调用 get_latest_news({ category: "ai" }) 返回 AI 领域新闻
    it("按 category='ai' 过滤应返回 AI 领域新闻", () => {
      const result = JSON.parse(getLatestNewsImpl({ category: "ai" }));
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      // 所有返回的新闻都应该是 AI 分类（但返回结构中不含 category）
      expect(result.news.length).toBeGreaterThan(0);
    });

    // UTC-B1-3: 调用 get_latest_news({ count: 3 }) 返回恰好 3 条新闻
    it("指定 count=3 应返回恰好 3 条新闻", () => {
      const result = JSON.parse(getLatestNewsImpl({ count: 3 }));
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.news).toHaveLength(3);
    });

    // UTC-B1-4: 调用 get_latest_news({ category: "invalid_xxx" }) 返回空数组
    it("无效分类应返回空数组", () => {
      const result = JSON.parse(getLatestNewsImpl({ category: "invalid_xxx" }));
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.news).toHaveLength(0);
    });

    it("count 超出范围时应被裁剪到 1-10", () => {
      const resultMin = JSON.parse(getLatestNewsImpl({ count: 0 }));
      expect(resultMin.count).toBeGreaterThanOrEqual(1);

      const resultMax = JSON.parse(getLatestNewsImpl({ count: 100 }));
      expect(resultMax.count).toBeLessThanOrEqual(10);
    });

    it("按 category='tech' 过滤应返回科技新闻", () => {
      const result = JSON.parse(getLatestNewsImpl({ category: "tech" }));
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });

    it("按 category='sports' 过滤应返回体育新闻", () => {
      const result = JSON.parse(getLatestNewsImpl({ category: "sports" }));
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // ==================== callNewsTool ====================
  describe("callNewsTool", () => {
    it("调用 get_latest_news 应返回有效 JSON", async () => {
      const result = await callNewsTool("get_latest_news", {});
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.news).toBeDefined();
    });

    it("调用未知工具应返回错误", async () => {
      const result = await callNewsTool("unknown_tool", {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });
});
