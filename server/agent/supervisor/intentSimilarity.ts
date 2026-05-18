/**
 * Intent Similarity — 低延迟意图相似性纠偏模块
 *
 * 基于字符 N-gram + TF-IDF + 余弦相似度的轻量级意图分类，
 * 用于在 LLM 分类之前/之后做"短路决策"或"纠偏覆盖"。
 *
 * 设计参考：项目根目录的 intent_similarity_prototype.py
 *
 * 主要能力：
 * 1. `guardDomain(query)`：高置信度正则前置拦截，命中即返回域名
 * 2. `classifyBySimilarity(query)`：返回各候选域的相似度评分，按分数倒序
 * 3. `correctIntent(query, llmDomain?)`：综合 guard 与相似度，决定是否覆盖 LLM
 *
 * 性能特征：
 * - 文档向量在模块加载时一次性计算并缓存，单次 classify 仅遍历少量候选项
 * - 单次调用约 0.1~0.5 ms（取决于候选库规模）
 *
 * 注意：
 * - 本模块仅做"统计 + 规则"，不依赖任何 LLM 或网络资源
 * - 所有候选语料是静态/可注入的，便于测试与扩展
 */
// ==================== 类型定义 ====================
export interface IntentCandidate {
  /** 任务领域（与 supervisorState 中 TaskDomain 对齐） */
  domain: string;
  /** 推荐的目标 Agent ID */
  agent: string;
  /** 候选标签（仅用于日志/调试） */
  label: string;
  /** 该候选的典型样例语句（用于构建 N-gram 文档向量） */
  examples: string[];
}
export interface SimilarityScore {
  domain: string;
  agent: string;
  label: string;
  score: number;
}
export interface IntentCorrectionResult {
  query: string;
  llmDomain: string | null;
  /** 经过相似度推理后建议的域 */
  suggestedDomain: string;
  /** 综合 guard / similarity / llm 后最终选择的域 */
  chosenDomain: string;
  /** 是否覆盖 LLM 的判断 */
  shouldOverride: boolean;
  /** 决策理由：guard / similarity / llm */
  reason: "guard" | "similarity" | "llm";
  /** 推荐的 Agent ID（与 chosenDomain 对应） */
  suggestedAgent: string | null;
  /** Top 3 相似度评分 */
  topScores: SimilarityScore[];
}
// ==================== 默认候选语料库 ====================
/**
 * 默认候选语料库（覆盖 SmartAgent4 当前 6 个 Agent 域）
 *
 * 注意：general 领域的样例聚焦在"对个人偏好/历史的提问"，
 * 与 navigation 的"显式路径规划"形成对比，便于区分"按我的喜好"类查询。
 */
export const DEFAULT_CANDIDATES: IntentCandidate[] = [
  {
    domain: "general",
    agent: "generalAgent",
    label: "memory_personalized_recommendation_or_query",
    examples: [
      "按我的喜好推荐今晚安排",
      "根据我的偏好适合吃什么听什么",
      "你还记得我喜欢听谁的歌吗",
      "我之前说过我喜欢什么",
      "按照我的习惯给我推荐",
      "我喜欢周杰伦少吃辣更喜欢安静活动",
      "记住我的偏好",
      "更新我的偏好",
      "以后别推荐太吵的活动",
      "昨晚那条路线帮我再说一遍",
      "上次说的路线怎么走",
      "看新闻",
      "最新新闻",
      "今日新闻",
      "科技新闻",
      "新闻资讯",
      "热点头条",
      "今天有什么新闻",
      "给我推送新闻",
      "搜索新闻",
      "查一下新闻",
    ],
  },
  {
    domain: "navigation",
    agent: "navigationAgent",
    label: "navigation_route_or_poi",
    examples: [
      "帮我规划从起点到终点的路线",
      "导航到虹桥机场",
      "怎么去苏州北站",
      "查附近的餐厅和停车场",
      "从太湖软件园到上海虹桥机场途经山姆和苏州北站",
      "开车路线 公交路线 步行路线",
      "查询天气 地图 周边 POI",
    ],
  },
  {
    domain: "multimedia",
    agent: "multimediaAgent",
    label: "music_search_or_playback",
    examples: [
      "播放周杰伦的歌",
      "搜索歌曲和歌手",
      "来一首音乐",
      "打开歌单",
      "播放每日推荐",
      "找专辑歌词",
    ],
  },
  {
    domain: "file_system",
    agent: "fileAgent",
    label: "file_search_or_disk",
    examples: [
      "查找文件",
      "分析磁盘空间",
      "打开文档",
      "扫描目录",
      "C 盘空间不足如何清理",
      "下载目录文件占比分析",
    ],
  },
  {
    domain: "office",
    agent: "officeAgent",
    label: "office_message_calendar",
    examples: [
      "发送飞书消息",
      "创建日程",
      "帮我写邮件",
      "新建会议",
      "建一个群聊",
      "把这条消息发给同事",
    ],
  },
  {
    domain: "service",
    agent: "serviceAgent",
    label: "life_service_or_recommendation",
    examples: [
      "附近有什么好吃的",
      "帮我订外卖",
      "推荐一家川菜馆",
      "查附近的咖啡店",
      "这附近有什么团购",
    ],
  },
];
// ==================== 高置信度正则规则 ====================
/**
 * 记忆/偏好引用类正则：命中后倾向归到 general 域，
 * 避免被 LLM 误判成 navigation/multimedia。
 */
export const MEMORY_GUARD_PATTERNS: RegExp[] = [
  /你还?记得|记不记得|我.*(之前|以前|上次|昨晚|昨天).*(说|提|聊|告诉|路线)/,
  /(昨晚|昨天|上次|之前|以前).{0,12}(路线|怎么走|怎么去)|那条路线/,
  /按我的|根据我的|我的(喜好|偏好|习惯)|适合我的/,
  /以后.*(少|别|不要)|记住|更新.*偏好/,
];
/**
 * 新闻/资讯类正则：命中后倾向 general 域，避免“搜索新闻”等请求被音乐/多媒体短路规则或字符相似度误导。
 */
export const NEWS_GUARD_PATTERNS: RegExp[] = [
  /新闻|资讯|头条|日报|早报|晚报|热点|时事|热搜|热榜/,
  /(?:推送|发送|发送给我|给我发|搜索|搜|查|找).{0,12}(?:新闻|资讯|热点|头条)/,
  /(?:今天|今日|早上|每天).{0,12}(?:新闻|资讯|热点|头条|推送)/,
];
/**
 * 显式导航类正则：命中后允许 navigation 域优先。
 */
export const NAV_EXPLICIT_PATTERNS: RegExp[] = [
  /(导航|路线|怎么去|到.+怎么走|从.+到.+|途经|途径)/,
  /(机场|火车站|高铁站|软件园|山姆|虹桥|苏州北站)/,
];
/**
 * 显式音乐类动作正则：命中后倾向 multimedia 域。
 */
export const MUSIC_ACTION_PATTERNS: RegExp[] = [
  /^(播放|放|来一首|搜索|搜|找).{0,12}(歌|音乐|歌曲|歌手|专辑|歌词)/,
];
// ==================== 字符 N-gram 与 TF-IDF ====================
/**
 * 抽取字符 N-gram。
 *
 * - 中文按字符切分；英文/数字按字符切分（已 lowercase）
 * - 跳过空白
 */
export function charNgrams(
  text: string,
  nMin = 1,
  nMax = 3
): string[] {
  const cleaned = text.replace(/\s+/g, "").toLowerCase();
  const grams: string[] = [];
  // 使用 Array.from 保证多字节字符按字形切分
  const chars = Array.from(cleaned);
  for (let n = nMin; n <= nMax; n++) {
    if (chars.length < n) continue;
    for (let i = 0; i <= chars.length - n; i++) {
      grams.push(chars.slice(i, i + n).join(""));
    }
  }
  return grams;
}
/**
 * 词频统计，返回 Map<term, count>
 */
function countTerms(grams: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of grams) {
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}
// ==================== 构建文档向量（带缓存） ====================
interface CompiledCorpus {
  candidates: IntentCandidate[];
  /** 每个候选的 TF-IDF 向量 */
  docVecs: Array<Map<string, number>>;
  /** 每个候选向量的范数 */
  docNorms: number[];
  /** 全局 IDF 表 */
  idf: Map<string, number>;
}
/**
 * 编译候选语料库为 TF-IDF 向量（一次性计算，可缓存）。
 */
export function compileCorpus(
  candidates: IntentCandidate[]
): CompiledCorpus {
  const docCounters: Array<Map<string, number>> = [];
  const df = new Map<string, number>();
  for (const c of candidates) {
    const merged = [c.label, c.domain, c.agent, ...c.examples].join(" ");
    const cnt = countTerms(charNgrams(merged));
    docCounters.push(cnt);
    for (const term of cnt.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const total = candidates.length;
  const idf = new Map<string, number>();
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log((1 + total) / (1 + freq)) + 1.0);
  }
  const docVecs = docCounters.map((cnt) => {
    const v = new Map<string, number>();
    for (const [term, tf] of cnt.entries()) {
      v.set(term, tf * (idf.get(term) ?? 1.0));
    }
    return v;
  });
  const docNorms = docVecs.map((v) => {
    let s = 0;
    for (const x of v.values()) s += x * x;
    return Math.sqrt(s) || 1.0;
  });
  return { candidates, docVecs, docNorms, idf };
}
let DEFAULT_CORPUS: CompiledCorpus | null = null;
function getDefaultCorpus(): CompiledCorpus {
  if (!DEFAULT_CORPUS) {
    DEFAULT_CORPUS = compileCorpus(DEFAULT_CANDIDATES);
  }
  return DEFAULT_CORPUS;
}
/**
 * 用于测试或运行时切换候选语料的辅助函数。
 */
export function setCorpus(candidates: IntentCandidate[]): void {
  DEFAULT_CORPUS = compileCorpus(candidates);
}
export function resetCorpus(): void {
  DEFAULT_CORPUS = compileCorpus(DEFAULT_CANDIDATES);
}
// ==================== 余弦相似度 ====================
function vectorize(query: string, idf: Map<string, number>): {
  vec: Map<string, number>;
  norm: number;
} {
  const cnt = countTerms(charNgrams(query));
  const vec = new Map<string, number>();
  let s = 0;
  for (const [term, tf] of cnt.entries()) {
    const w = tf * (idf.get(term) ?? 1.0);
    vec.set(term, w);
    s += w * w;
  }
  return { vec, norm: Math.sqrt(s) || 1.0 };
}
function cosine(
  a: Map<string, number>,
  normA: number,
  b: Map<string, number>,
  normB: number
): number {
  // 选择较小的一边作为外层迭代，性能更好
  const [small, large] =
    a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small.entries()) {
    const u = large.get(k);
    if (u !== undefined) dot += v * u;
  }
  return dot / (normA * normB);
}
// ==================== 公共 API ====================
/**
 * 高置信度规则前置拦截：返回锁定的 domain，或 null 表示未命中。
 *
 * 行为约定：
 * - 命中 NEWS_GUARD：一律收敛为 general
 * - 命中 MEMORY_GUARD：除非是显式规划路线（NAV_EXPLICIT 命中且无记忆引用），
 *   一律收敛为 general
 * - 命中 MUSIC_ACTION：收敛为 multimedia
 */
export function guardDomain(query: string): string | null {
  if (NEWS_GUARD_PATTERNS.some((p) => p.test(query))) {
    return "general";
  }
  if (MEMORY_GUARD_PATTERNS.some((p) => p.test(query))) {
    const explicitNav = NAV_EXPLICIT_PATTERNS.some((p) => p.test(query));
    const memoryRef = /(昨晚|上次|之前|记得|说过|那条)/.test(query);
    const prefRef = /按我的|根据我的|偏好|喜好/.test(query);
    if (explicitNav && !memoryRef && !prefRef) {
      return null;
    }
    return "general";
  }
  if (MUSIC_ACTION_PATTERNS.some((p) => p.test(query))) {
    return "multimedia";
  }
  return null;
}
/**
 * 基于相似度对查询进行打分，返回所有候选的得分（按分数倒序）。
 */
export function classifyBySimilarity(
  query: string,
  corpus?: CompiledCorpus
): SimilarityScore[] {
  const c = corpus ?? getDefaultCorpus();
  const { vec, norm } = vectorize(query, c.idf);
  const scores: SimilarityScore[] = c.candidates.map((cand, i) => ({
    domain: cand.domain,
    agent: cand.agent,
    label: cand.label,
    score: cosine(vec, norm, c.docVecs[i], c.docNorms[i]),
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores;
}
/**
 * 综合 Guard + Similarity + LLM 判断，给出最终建议。
 *
 * 决策规则（由保守到激进）：
 * 1. 如果 guard 命中：
 *    - 必定建议覆盖 LLM；reason = "guard"
 * 2. 否则用 similarity 取 top1：
 *    - 与 LLM 一致：直接采用 LLM；reason = "llm"
 *    - 与 LLM 不一致，且 top1 score >= overrideThreshold（默认 0.26），
 *      且 top1 - top2 >= marginThreshold（默认 0.035）：覆盖 LLM；reason = "similarity"
 *    - 否则保留 LLM 结果；reason = "llm"
 * 3. 当 llmDomain 为空时，直接采用 similarity 的 top1。
 */
export function correctIntent(
  query: string,
  llmDomain: string | null = null,
  options: {
    overrideThreshold?: number;
    marginThreshold?: number;
    corpus?: CompiledCorpus;
  } = {}
): IntentCorrectionResult {
  const {
    overrideThreshold = 0.26,
    marginThreshold = 0.035,
    corpus,
  } = options;
  const guarded = guardDomain(query);
  const scores = classifyBySimilarity(query, corpus);
  const top = scores[0];
  const second = scores[1] ?? top;
  const suggestedDomain = guarded ?? top.domain;
  const suggestedAgent = guarded
    ? (corpus ?? getDefaultCorpus()).candidates.find(
        (c) => c.domain === guarded
      )?.agent ?? null
    : top.agent;
  let shouldOverride = false;
  let chosenDomain = llmDomain ?? suggestedDomain;
  let reason: IntentCorrectionResult["reason"] = "llm";
  if (guarded) {
    shouldOverride = llmDomain !== null && llmDomain !== guarded;
    chosenDomain = guarded;
    reason = "guard";
  } else if (!llmDomain) {
    chosenDomain = suggestedDomain;
    reason = "similarity";
  } else if (llmDomain !== top.domain) {
    if (
      top.score >= overrideThreshold &&
      top.score - second.score >= marginThreshold
    ) {
      shouldOverride = true;
      chosenDomain = top.domain;
      reason = "similarity";
    } else {
      chosenDomain = llmDomain;
      reason = "llm";
    }
  } else {
    chosenDomain = llmDomain;
    reason = "llm";
  }
  return {
    query,
    llmDomain,
    suggestedDomain,
    chosenDomain,
    shouldOverride,
    reason,
    suggestedAgent,
    topScores: scores.slice(0, 3),
  };
}
/**
 * 短路判定：在调用 LLM 之前，是否可以直接基于相似度返回分类结果。
 *
 * 用于 classifyNode 性能优化：当 top1 极高且分差明显时，跳过 LLM 调用。
 */
export function canShortCircuit(
  query: string,
  options: {
    minTopScore?: number;
    minMargin?: number;
    corpus?: CompiledCorpus;
  } = {}
): { ok: boolean; domain?: string; agent?: string; topScores: SimilarityScore[] } {
  const { minTopScore = 0.55, minMargin = 0.12, corpus } = options;
  // Guard 命中也算短路
  const guarded = guardDomain(query);
  const scores = classifyBySimilarity(query, corpus);
  if (guarded) {
    const cand = (corpus ?? getDefaultCorpus()).candidates.find(
      (c) => c.domain === guarded
    );
    return {
      ok: true,
      domain: guarded,
      agent: cand?.agent,
      topScores: scores.slice(0, 3),
    };
  }
  const top = scores[0];
  const second = scores[1] ?? top;
  if (top.score >= minTopScore && top.score - second.score >= minMargin) {
    return {
      ok: true,
      domain: top.domain,
      agent: top.agent,
      topScores: scores.slice(0, 3),
    };
  }
  return { ok: false, topScores: scores.slice(0, 3) };
}
