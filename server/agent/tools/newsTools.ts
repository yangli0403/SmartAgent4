/**
 * News Tools — 新闻资讯工具集
 *
 * 提供 get_latest_news 内置工具，支持按分类获取最新新闻。
 * 当前为 Mock 实现，返回预设的新闻数据，确保 Demo 演示稳定性。
 * 后续可平滑迁移为真实的新闻 API 调用。
 *
 * 注册方式：内置工具（builtin），与 freeWeatherTools / memoryTools 模式一致。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";

// ==================== 常量 ====================

/** 内置新闻工具的 serverId */
export const NEWS_TOOLS_SERVER_ID = "builtin-news-tools";

// ==================== 数据类型 ====================

/** 新闻条目 */
export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
  category: string;
}

// ==================== Mock 数据 ====================

const MOCK_NEWS_DATABASE: NewsItem[] = [
  // AI 类
  {
    title: "通义千问发布全新多模态大模型 Qwen3",
    url: "https://example.com/news/qwen3",
    source: "科技日报",
    publishedAt: new Date().toISOString(),
    summary: "阿里云发布通义千问 Qwen3 系列模型，在多模态理解和推理能力上取得重大突破。",
    category: "ai",
  },
  {
    title: "OpenAI 推出 GPT-5 模型，推理能力大幅提升",
    url: "https://example.com/news/gpt5",
    source: "36氪",
    publishedAt: new Date().toISOString(),
    summary: "OpenAI 正式发布 GPT-5，在数学推理、代码生成等任务上表现优异。",
    category: "ai",
  },
  {
    title: "国内首个车载大模型标准发布",
    url: "https://example.com/news/car-llm-standard",
    source: "汽车之家",
    publishedAt: new Date().toISOString(),
    summary: "中国汽车工程学会发布车载大模型技术标准，规范智能座舱 AI 应用。",
    category: "ai",
  },
  // 科技类
  {
    title: "华为发布新一代智能驾驶芯片",
    url: "https://example.com/news/huawei-chip",
    source: "新浪科技",
    publishedAt: new Date().toISOString(),
    summary: "华为在春季发布会上推出新一代智能驾驶芯片，算力提升 3 倍。",
    category: "tech",
  },
  {
    title: "SpaceX 星舰第七次试飞成功回收",
    url: "https://example.com/news/spacex",
    source: "环球科技",
    publishedAt: new Date().toISOString(),
    summary: "SpaceX 星舰完成第七次试飞，成功实现助推器和飞船双回收。",
    category: "tech",
  },
  {
    title: "量子计算突破：1000 量子比特处理器问世",
    url: "https://example.com/news/quantum",
    source: "科学网",
    publishedAt: new Date().toISOString(),
    summary: "IBM 发布 1000 量子比特处理器，量子计算进入实用化新阶段。",
    category: "tech",
  },
  // 商业类
  {
    title: "新能源汽车出口量创历史新高",
    url: "https://example.com/news/ev-export",
    source: "经济观察报",
    publishedAt: new Date().toISOString(),
    summary: "2026 年第一季度中国新能源汽车出口量同比增长 45%，创历史新高。",
    category: "business",
  },
  {
    title: "比亚迪发布全新智能座舱平台",
    url: "https://example.com/news/byd-cockpit",
    source: "第一财经",
    publishedAt: new Date().toISOString(),
    summary: "比亚迪发布全新一代智能座舱平台，搭载自研大模型和多模态交互系统。",
    category: "business",
  },
  // 体育类
  {
    title: "中国女足亚洲杯小组赛三连胜",
    url: "https://example.com/news/football",
    source: "新华社",
    publishedAt: new Date().toISOString(),
    summary: "中国女足在亚洲杯小组赛中取得三连胜，以小组第一出线。",
    category: "sports",
  },
  // 娱乐类
  {
    title: "国产科幻电影《流浪地球3》定档暑期",
    url: "https://example.com/news/movie",
    source: "猫眼电影",
    publishedAt: new Date().toISOString(),
    summary: "《流浪地球3》正式定档 2026 年暑期档，预告片首日播放量破亿。",
    category: "entertainment",
  },
  // 综合类
  {
    title: "全国高温预警：多地气温突破 40 度",
    url: "https://example.com/news/weather-hot",
    source: "中国天气网",
    publishedAt: new Date().toISOString(),
    summary: "中央气象台发布高温橙色预警，全国多地气温将突破 40 度。",
    category: "general",
  },
  {
    title: "五一假期旅游市场火爆，出行人数预计超 3 亿",
    url: "https://example.com/news/travel",
    source: "人民日报",
    publishedAt: new Date().toISOString(),
    summary: "文旅部预计五一假期全国出行人数将超过 3 亿人次，旅游收入有望创新高。",
    category: "general",
  },
];

// ==================== 工具实现 ====================

/**
 * get_latest_news — 获取最新新闻
 *
 * @param args 工具参数
 * @returns 新闻列表的 JSON 字符串
 */
export function getLatestNewsImpl(args: Record<string, unknown>): string {
  const category = args.category as string | undefined;
  const count = Math.min(Math.max(Number(args.count) || 5, 1), 10);

  let filtered = MOCK_NEWS_DATABASE;

  // 按分类过滤
  if (category && category !== "general") {
    filtered = MOCK_NEWS_DATABASE.filter((n) => n.category === category);
  }

  // 截取指定数量
  const result = filtered.slice(0, count);

  if (result.length === 0) {
    return JSON.stringify({
      success: true,
      count: 0,
      news: [],
      message: `未找到分类为 "${category}" 的新闻`,
    });
  }

  return JSON.stringify({
    success: true,
    count: result.length,
    news: result.map((n) => ({
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: n.publishedAt,
      summary: n.summary,
    })),
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
      "获取最新新闻资讯。支持按分类筛选（ai/tech/business/sports/entertainment/general），可指定返回条数（1-10）。",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "新闻分类：ai（人工智能）、tech（科技）、business（商业）、sports（体育）、entertainment（娱乐）、general（综合）。默认返回所有分类。",
          enum: ["ai", "tech", "business", "sports", "entertainment", "general"],
        },
        count: {
          type: "number",
          description: "返回的新闻条数，范围 1-10，默认为 5",
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
    return getLatestNewsImpl(args);
  }
  return JSON.stringify({ error: `未知的新闻工具: ${toolName}` });
}
