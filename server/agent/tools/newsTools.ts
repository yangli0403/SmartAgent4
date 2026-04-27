/**
 * News Tools — 实时新闻资讯工具集
 *
 * 提供 get_latest_news 内置工具，支持按分类与关键词获取实时新闻。
 *
 * 数据源策略（双链路 + 内存缓存）：
 *   1) 主：NewsData.io（需 NEWSDATA_API_KEY 环境变量），免费档 200 次/天，
 *      返回中文新闻 JSON，字段稳定，含 description/source/pubDate。
 *   2) 备：百度新闻 RSS（无需 Key），保证 Demo 永远不空。
 *   3) 缓存：同一 (category,q) 在 5 分钟内复用上次成功结果，节省额度。
 *
 * 注册方式：内置工具（builtin），与 freeWeatherTools / memoryTools 一致。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";

// ==================== 常量 ====================

/** 内置新闻工具的 serverId */
export const NEWS_TOOLS_SERVER_ID = "builtin-news-tools";

/** 缓存有效期 5 分钟，足够应对一次 Demo 多轮提问 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 单次请求最大返回条数 */
const MAX_COUNT = 10;

/** NewsData.io 接口地址 */
const NEWSDATA_ENDPOINT = "https://newsdata.io/api/1/latest";

/** 百度新闻 RSS（按分类）映射 */
const BAIDU_RSS_BY_CATEGORY: Record<string, string> = {
  ai: "http://news.baidu.com/n?cmd=1&class=internet&tn=rss",
  tech: "http://news.baidu.com/n?cmd=1&class=internet&tn=rss",
  business: "http://news.baidu.com/n?cmd=1&class=finannews&tn=rss",
  sports: "http://news.baidu.com/n?cmd=1&class=sportnews&tn=rss",
  entertainment: "http://news.baidu.com/n?cmd=1&class=enternews&tn=rss",
  general: "http://news.baidu.com/n?cmd=1&class=civilnews&tn=rss",
};

/** 业务分类 → NewsData.io category 映射 */
const NEWSDATA_CATEGORY_MAP: Record<string, string> = {
  ai: "technology",
  tech: "technology",
  business: "business",
  sports: "sports",
  entertainment: "entertainment",
  general: "top",
};

// ==================== 数据类型 ====================

/** 标准化新闻条目 */
export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
}

interface CacheEntry {
  expireAt: number;
  payload: { items: NewsItem[]; provider: string };
}

const cache = new Map<string, CacheEntry>();

// ==================== NewsData.io 主源 ====================

/** 调用 NewsData.io 拉取实时新闻 */
async function fetchFromNewsDataIo(
  category: string,
  q: string | undefined,
  count: number
): Promise<NewsItem[] | null> {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return null; // 未配置 Key，跳过主源
  }

  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("language", "zh");
  params.set("size", String(Math.min(count, MAX_COUNT)));

  const ndCategory = NEWSDATA_CATEGORY_MAP[category];
  if (ndCategory) params.set("category", ndCategory);

  if (q && q.trim().length > 0) params.set("q", q.trim());

  // ai 分类：通过关键字增强（NewsData 没有 AI 子类，借助关键字过滤）
  if (category === "ai" && (!q || q.trim().length === 0)) {
    params.set("q", "人工智能 OR AI OR 大模型");
  }

  const url = `${NEWSDATA_ENDPOINT}?${params.toString()}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      status?: string;
      results?: Array<{
        title?: string;
        link?: string;
        source_name?: string;
        source_id?: string;
        pubDate?: string;
        description?: string;
      }>;
    };
    if (data.status !== "success" || !Array.isArray(data.results)) return null;

    return data.results.slice(0, count).map((r) => ({
      title: (r.title || "").trim(),
      url: r.link || "",
      source: r.source_name || r.source_id || "未知来源",
      publishedAt: r.pubDate || new Date().toISOString(),
      summary: (r.description || "").trim().slice(0, 200),
    }));
  } catch {
    return null; // 网络/超时/解析失败，统一回退备源
  }
}

// ==================== 百度 RSS 备源 ====================

/** 极简 RSS 解析（仅取 item.title / link / pubDate / description），避免引入新依赖 */
function parseRssItems(xml: string, count: number): NewsItem[] {
  const items: NewsItem[] = [];
  const itemBlocks = xml.split(/<item>|<item\s/i).slice(1);
  for (const block of itemBlocks) {
    if (items.length >= count) break;
    const close = block.indexOf("</item>");
    const seg = close >= 0 ? block.slice(0, close) : block;

    const pickCData = (tag: string): string => {
      const re = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, "i");
      const m = seg.match(re);
      return m ? m[1].trim() : "";
    };

    const title = pickCData("title");
    if (!title) continue;
    items.push({
      title,
      url: pickCData("link"),
      source: "百度新闻",
      publishedAt: pickCData("pubDate") || new Date().toISOString(),
      summary: pickCData("description").replace(/<[^>]+>/g, "").slice(0, 200),
    });
  }
  return items;
}

/** 调用百度新闻 RSS 拉取（无需 Key） */
async function fetchFromBaiduRss(category: string, count: number): Promise<NewsItem[] | null> {
  const rssUrl = BAIDU_RSS_BY_CATEGORY[category] || BAIDU_RSS_BY_CATEGORY.general;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(rssUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 SmartAgent4-NewsBot" },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const xml = await resp.text();
    const items = parseRssItems(xml, count);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

// ==================== 工具实现 ====================

/**
 * get_latest_news — 获取实时新闻
 */
export async function getLatestNewsImpl(args: Record<string, unknown>): Promise<string> {
  const rawCategory = (args.category as string | undefined)?.toLowerCase().trim();
  const category =
    rawCategory && NEWSDATA_CATEGORY_MAP[rawCategory] ? rawCategory : "general";
  const q = (args.q as string | undefined) ?? (args.query as string | undefined);
  const count = Math.min(Math.max(Number(args.count) || 5, 1), MAX_COUNT);

  // 命中缓存
  const cacheKey = `${category}::${(q || "").trim()}::${count}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expireAt > Date.now()) {
    return JSON.stringify({
      success: true,
      provider: hit.payload.provider + "+cache",
      count: hit.payload.items.length,
      news: hit.payload.items,
    });
  }

  // 主源
  let items = await fetchFromNewsDataIo(category, q, count);
  let provider = "newsdata.io";

  // 备源
  if (!items || items.length === 0) {
    items = await fetchFromBaiduRss(category, count);
    provider = "baidu-rss";
  }

  if (!items || items.length === 0) {
    return JSON.stringify({
      success: false,
      provider,
      error: "实时新闻源暂时不可用，请稍后再试。",
    });
  }

  cache.set(cacheKey, { expireAt: Date.now() + CACHE_TTL_MS, payload: { items, provider } });

  return JSON.stringify({
    success: true,
    provider,
    count: items.length,
    news: items,
  });
}

// ==================== 注册函数 ====================

/**
 * 将新闻工具注册到 ToolRegistry
 */
export function registerNewsTools(registry: ToolRegistry): void {
  registry.register({
    name: "get_latest_news",
    description:
      "获取实时新闻资讯。可指定分类（ai/tech/business/sports/entertainment/general）与可选的关键词 q（用于精确搜索如\"特斯拉\"、\"OpenAI\"等），返回 1-10 条最新中文新闻。",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "新闻分类：ai（人工智能）、tech（科技）、business（商业财经）、sports（体育）、entertainment（娱乐）、general（综合头条）。默认 general。",
          enum: ["ai", "tech", "business", "sports", "entertainment", "general"],
        },
        q: {
          type: "string",
          description:
            "可选搜索关键词，例如\"特斯拉\"、\"OpenAI\"、\"新能源\"，留空表示按分类拉取最新。",
        },
        count: {
          type: "number",
          description: "返回新闻条数，范围 1-10，默认 5。",
        },
      },
      required: [],
    },
    serverId: NEWS_TOOLS_SERVER_ID,
    category: "general",
    registeredAt: new Date(),
  });
}

/**
 * 调用新闻工具（供 ToolRegistry 的 callTool 使用）
 */
export async function callNewsTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  if (toolName === "get_latest_news") {
    return await getLatestNewsImpl(args);
  }
  return JSON.stringify({ error: `未知的新闻工具: ${toolName}` });
}
