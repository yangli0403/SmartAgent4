/**
 * Classify Node �?任务分类节点
 *
 * 使用 LLM 结构化输出对用户输入进行领域分类和复杂度判断�?
 *
 * V2 增强�?
 * - System Prompt 从硬编码改为运行时通过 DynamicPromptAssembler 动态生�?
 * - Agent 列表�?AgentCardRegistry 动态获取，支持热插�?
 *
 * V3 增强（follow-up 意图延续）：
 * - 将最近对话摘要注入分类输入，�?LLM 能看到多轮上下文
 * - 新增 refineClassificationForFollowUp 规则纠偏，防止补充信息被误判�?general
 */

import type {
  SupervisorStateType,
  TaskClassification,
  TaskDomain,
  TaskComplexity,
  ExecutionMode,
  PlanStep,
} from "./state";
import {
  COMPLEXITY_TO_EXECUTION_MODE,
  EXECUTION_MODE_TO_COMPLEXITY,
} from "./state";
import { callLLMStructured } from "../../llm/langchainAdapter";
import { classifyLLMCall } from "./classifyLLMCall";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  getAgentCardRegistry,
  DynamicPromptAssembler,
} from "../discovery";
import type { IAgentCardRegistry } from "../discovery/types";
import { appendGeneralAgentMemoryStepIfNeeded } from "./navigationMemoryPlan";
import {
  canShortCircuit,
  correctIntent,
} from "./intentSimilarity";
import { searchSceneEpisodes } from "../../memory/sceneEpisode";

/**
 * classifyNode �?LLM 系统提示词（静态降级版本）
 *
 * �?AgentCardRegistry 为空时使用此降级 Prompt�?
 * 正常情况下使�?DynamicPromptAssembler 动态生成�?
 */
export const CLASSIFY_SYSTEM_PROMPT = `你是一个任务分类专家。根据用户输入，判断任务所属领域和复杂度�?

可用领域�?
- navigation: 用户**明确要求**导航、路径规划、地图查询、天气、POI 搜索等（如「怎么去」「规划路线」「导航到」）�?*不要**把「仅陈述家住哪、公司在哪」判成导�?
- multimedia: 音乐搜索/播放、视频搜索、歌曲推荐、歌单管理等�?*含「搜�?�?XX 的歌」「推荐歌手」等，勿判成 general**�?
- file_system: 文件搜索、打开、目录操作、复�?创建�?*以及 C �?系统�?磁盘空间/垃圾与临时文件体量分�?*（须�?fileAgent 内置工具，勿判为 general�?
- office: 飞书消息发送、日程创建、群组管理、办公协同等（如「发飞书消息」「创建日程」「建个群」）
- service: 餐厅搜索、外卖下单、生活服务推荐等（如「附近有什么好吃的」「帮我订外卖」「找川菜馆」）
- general: 闲聊、知识问答、建议咨询�?*仅同步住址/上班地等个人信息**（无导航意图�?
- cross_domain: 涉及多个领域的复合任务（如「帮我规划上海行程并发到飞书群」「找个餐厅然后帮我建个群约同事」）

## 意图延续规则（多轮对话，必读�?
当提供了 [对话上下文] 时，你必须结合上下文判断用户意图�?
- 如果上一�?Agent 向用户追问了某些信息（如邮箱、手机号、地址、时间、ID 等），而用户本轮消息是�?*回答/补充**这些信息，则�?*沿用上一轮的领域分类**，而不是判�?general�?
- 例：上一�?officeAgent 问「请提供陈威的邮箱」，用户回复「chenwei@example.com」→ 应判�?**office**，不�?general�?
- 例：上一�?navigationAgent 问「请问您的出发地是哪里」，用户回复「我在望京」→ 应判�?**navigation**，不�?general�?
- 判断依据：用户消息是否在回答上一�?AI 的提问，而非发起全新话题�?

复杂度判断：
- simple: 单步操作或简单问答，只需一�?Agent 即可完成
- moderate: 需要多步操作但在单一领域内，需要规�?
- complex: 跨领域协作或多步条件判断，需要详细规划和协调

可用 Agent�?
- fileAgent: 文件系统操作
- navigationAgent: 导航和地图操作、天气查询、行程规�?
- multimediaAgent: 音乐和多媒体操作
- officeAgent: 飞书消息发送、日程创建、群组管�?
- serviceAgent: 餐厅搜索、外卖下单、生活服�?
- generalAgent: 通用对话和知识问�?

请以 JSON 格式输出（不要包含其他文字）�?
{
  "domain": "navigation|multimedia|file_system|office|service|general|cross_domain",
  "complexity": "simple|moderate|complex",
  "reasoning": "分类推理过程",
  "requiredAgents": ["需要调用的Agent列表"]
}`;

/**
 * 获取分类 Prompt
 *
 * 优先使用 DynamicPromptAssembler 动态生成，
 * 注册表为空时降级使用静�?Prompt�?
 */
/**
 * 明显的音乐类请求若被 LLM 判成 general，会导致�?generalAgent（无网易�?search 工具），
 * 模型只能编造「搜索功能用不了」。在出结果前用规则纠偏�?
 */
function refineClassificationForMusicIntent(
  userText: string,
  classification: TaskClassification
): void {
  const t = userText.trim();
  if (!t) return;

  const looksMusic =
    /(?:搜索|搜|找|查找|播放|听|放|来一首|推荐).{0,32}(?:歌|歌曲|歌手|专辑|歌单)/.test(
      t
    ) ||
    /(?:歌|歌曲|歌手).{0,10}(?:推荐|搜索|有哪些)/.test(t) ||
    /网易云|QQ音乐|歌单/.test(t) ||
    /歌词|演唱者|原唱/.test(t);

  if (looksMusic && classification.domain === "general") {
    console.log(
      "[ClassifyNode] Rule override: music-like utterance was general �?multimedia"
    );
    classification.domain = "multimedia";
    classification.requiredAgents = ["multimediaAgent"];
    classification.reasoning =
      `[rule:music_intent] ${classification.reasoning || ""}`.trim();
  }

  /**
   * 复合音乐任务（搜�?+ 歌词/专辑/「最新」等）：**simple** + 单步 multimediaAgent�?
   * moderate/complex 会走 plan 多步，步骤间难传歌曲 ID，末步常�?generalAgent 总结 �?易变「无法获取」�?
   * cross_domain 若实为纯音乐链路，也收敛�?multimedia�?
   */
  const compoundMusicChain =
    /(?:歌词|专辑|新歌|最新)/.test(t) &&
    /(?:歌|歌手|歌曲|演唱)/.test(t) &&
    !/导航|路线|地图|天气|附近/.test(t);

  if (
    compoundMusicChain &&
    classification.complexity !== "simple" &&
    (classification.domain === "multimedia" ||
      classification.domain === "cross_domain")
  ) {
    console.log(
      "[ClassifyNode] Rule override: compound music �?simple (single multimediaAgent tool chain)"
    );
    classification.domain = "multimedia";
    classification.complexity = "simple";
    classification.requiredAgents = ["multimediaAgent"];
    classification.reasoning =
      `[rule:music_tool_chain] ${classification.reasoning || ""}`.trim();
  }
}

/**
 * 用户是否在问 C �?/ 磁盘空间 / 系统垃圾（与 refineClassificationForDiskIntent 规则一致）
 */
export function userMessageLooksLikeDiskIntent(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  return (
    /[cC]\s*盘|[cC]:\\|[cC]:|系统盘|磁盘|硬盘|存储空间|空间不足|空间满了|盘满了|红盘/.test(t) ||
    /系统垃圾|磁盘.{0,8}(?:垃圾|清理)|清理.{0,10}(?:[cC]\s*盘|系统盘|磁盘)/.test(t) ||
    /(?:分析|查看|查|看|帮我|帮忙).{0,16}(?:盘|磁盘|空间)/.test(t)
  );
}

/**
 * 新闻/资讯查询类请求若被误判为 navigation/office 等，会导致走�?Agent（无新闻工具），
 * 模型无法调用 get_latest_news。出结果前强�?general + generalAgent�?
 */
/**
 * 天气查询类请求强制路由到 navigationAgent。
 * 防止 LLM 将「苏州天气」「今天天气怎么样」等误判为 general。
 */
export function refineClassificationForWeatherIntent(
  userText: string,
  classification: TaskClassification
): void {
  const t = userText.trim();
  if (!t) return;
  // 天气类关键词
  const looksWeather =
    /天气|气温|温度|下雨|晴天|阴天|雨天|风速|湿度|预报|几度|冷不冷|热不热/.test(t) ||
    /(?:今天|明天|后天|本周|这周|周末).{0,8}(?:天气|气温|温度|下雨|晴)/.test(t) ||
    /(?:天气|气温).{0,8}(?:怎么样|如何|好不好|咋样)/.test(t);
  if (!looksWeather) return;
  // 如果已经是 navigation，不覆盖
  if (classification.domain === "navigation" &&
      (classification.requiredAgents?.includes("navigationAgent") ?? false)) return;
  console.log(
    `[ClassifyNode] Rule override: weather intent detected (was ${classification.domain}), forcing → navigation + navigationAgent`
  );
  classification.domain = "navigation";
  classification.complexity = "simple";
  classification.requiredAgents = ["navigationAgent"];
  classification.reasoning =
    `[rule:weather_intent] ${classification.reasoning || ""}`.trim();
}
export function refineClassificationForNewsIntent(
  userText: string,
  classification: TaskClassification
): void {
  const t = userText.trim();
  if (!t) return;

  // 新闻类关键词
  const looksNews =
    /新闻|资讯|头条|日报|早报|晚报|热点|时事|今日新闻|今日资讯|今日头条/.test(t) ||
    /(?:推送|发送|发送给我|给我发).{0,10}(?:新闻|资讯|热点|头条)/.test(t) ||
    /(?:今天|今日|早上|每天).{0,10}(?:新闻|资讯|热点|头条|推送)/.test(t) ||
    /(?:再|重新).{0,6}(?:新闻|资讯|推送|执行)/.test(t) ||
    /热搜|热榜|今日热搜/.test(t);

  if (looksNews) {
    const agents = classification.requiredAgents ?? [];
    const wrongAgent =
      classification.domain !== "general" ||
      (agents.length > 0 && !agents.includes("generalAgent"));

    if (wrongAgent) {
      console.log(
        `[ClassifyNode] Rule override: news intent detected (was ${classification.domain}), forcing general + generalAgent`
      );
      classification.domain = "general";
      classification.complexity = "simple";
      classification.requiredAgents = ["generalAgent"];
      classification.reasoning =
        `[rule:news_intent] ${classification.reasoning || ""}`.trim();
    }
  }
}
export function refineClassificationForDiskIntent(
  userText: string,
  classification: TaskClassification
): void {
  const t = userText.trim();
  if (!t) return;

  if (!userMessageLooksLikeDiskIntent(userText)) return;

  const agents = classification.requiredAgents ?? [];
  const wrongAgent =
    classification.domain === "general" ||
    classification.domain === "navigation" ||
    (agents.length > 0 && !agents.includes("fileAgent"));

  if (wrongAgent) {
    console.log(
      "[ClassifyNode] Rule override: disk/C-drive / space intent �?file_system + fileAgent"
    );
    classification.domain = "file_system";
    classification.complexity = "simple";
    classification.requiredAgents = ["fileAgent"];
    classification.reasoning =
      `[rule:disk_intent] ${classification.reasoning || ""}`.trim();
  }
}

/**
 * 用户是否在分析本机某目录的文件分�?占比（与「C 盘」磁盘意图不同，易被 LLM 判成 general�?
 * 例：「帮我分析一下下载目录的文件占比」——须�?fileAgent + analyze_directory
 */
export function userMessageLooksLikeDirectoryInventoryIntent(
  userText: string
): boolean {
  const t = userText.trim();
  if (!t) return false;
  const mentionsUserFolder =
    /(?:下载|桌面|文档|视频|图片|音乐)(?:目录|文件夹)|Downloads|Desktop|Documents/i.test(
      t
    ) || /用户目录|主目录|~\//i.test(t);
  const asksInventory =
    /(?:文件|类型)?(?:占比|分布|统计)|目录.{0,10}(?:占比|分布|分析|统计|情况)|(?:分析|查看|统计|整理|扫描).{0,16}(?:目录|文件夹|下载)/.test(
      t
    );
  return mentionsUserFolder && asksInventory;
}

/**
 * 目录占比/分布类若被判�?general，会�?generalAgent（无 analyze_directory），模型易回答「无法访问」�?
 */
export function refineClassificationForDirectoryInventoryIntent(
  userText: string,
  classification: TaskClassification
): void {
  if (!userMessageLooksLikeDirectoryInventoryIntent(userText)) return;

  const agents = classification.requiredAgents ?? [];
  const wrongAgent =
    classification.domain === "general" ||
    classification.domain === "navigation" ||
    (agents.length > 0 && !agents.includes("fileAgent"));

  if (wrongAgent) {
    console.log(
      "[ClassifyNode] Rule override: directory file inventory �?file_system + fileAgent"
    );
    classification.domain = "file_system";
    classification.complexity = "simple";
    classification.requiredAgents = ["fileAgent"];
    classification.reasoning =
      `[rule:dir_inventory] ${classification.reasoning || ""}`.trim();
  }
}

// ==================== V5 新增：车控/座舱控制意图纠偏 ====================

/**
 * 车控/座舱控制指令强制路由到 multimediaAgent。
 *
 * 设计说明：
 * - 车控指令（空调、大灯、车窗、白噪音等）应路由到 multimediaAgent，它具备车控工具
 * - 当 guardDomain 返回 vehicle_control 时，classifyNode 的短路逻辑会直接命中
 * - 此函数作为 LLM 分类后的兜底纠偏，防止 LLM 将车控误判为其他域
 */
export function refineClassificationForVehicleControl(
  userText: string,
  classification: TaskClassification
): void {
  const t = userText.trim();
  if (!t) return;

  const VEHICLE_PATTERNS = [
    /空调.{0,10}(\d+度|制冷|制热|关|开|调|温度|风速)/,
    /(调|设置|开|关).{0,6}空调/,
    /(开|关|调).{0,6}(大灯|车灯|氛围灯|内饰灯|远光|近光)/,
    /(大灯|车灯).{0,6}(开|关|调)/,
    /(开|关|升|降).{0,6}(车窗|窗户|天窗)/,
    /(调|升|降|前移|后移).{0,6}(座椅|椅背|靠背)/,
    /(放|播放|开).{0,6}(白噪音|雨声|自然音|环境音|睡眠音乐)/,
  ];

  const isVehicleControl = VEHICLE_PATTERNS.some((p) => p.test(t));
  if (!isVehicleControl) return;

  // 已经路由到 multimediaAgent 则无需覆盖
  if (
    classification.domain === "multimedia" &&
    (classification.requiredAgents?.includes("multimediaAgent") ?? false)
  ) {
    return;
  }

  console.log(
    `[ClassifyNode] Rule override: vehicle control intent detected (was ${classification.domain}), forcing multimedia + multimediaAgent`
  );
  classification.domain = "multimedia";
  classification.complexity = "simple";
  classification.requiredAgents = ["multimediaAgent"];
  classification.reasoning =
    `[rule:vehicle_control] ${classification.reasoning || ""}`.trim();
}

// ==================== V3 新增：Follow-up 意图延续 ====================

/**
 * 从对话历史中提取上一轮的任务域信�?
 *
 * 扫描 messages 中倒数第二�?AI 消息之前的上下文�?
 * 推断上一轮任务所属的领域�?
 */
function detectPreviousTurnDomain(
  messages: readonly import("@langchain/core/messages").BaseMessage[]
): string | null {
  // 找到最近的 AI 消息（即上一�?Agent 的回复）
  const reversedMessages = [...messages].reverse();
  const lastAIMessage = reversedMessages.find(
    (m) => m instanceof AIMessage || m._getType() === "ai"
  );

  if (!lastAIMessage) return null;

  const aiText =
    typeof lastAIMessage.content === "string"
      ? lastAIMessage.content
      : JSON.stringify(lastAIMessage.content || "");

  // 通过 AI 回复内容中的关键词推断上一轮域
  // office 域特征：飞书、消息、日程、群、邮箱、open_id、发�?
  if (
    /飞书|消息|日程|群组|建群|邮箱|手机号|open_id|user_id|发送消息|创建日程|创建群/.test(
      aiText
    )
  ) {
    return "office";
  }
  // navigation 域特�?
  if (/导航|路线|出发地|目的地|路径|规划|天气|地图|POI/.test(aiText)) {
    return "navigation";
  }
  // multimedia 域特�?
  if (/歌曲|歌手|专辑|播放|音乐|歌单|歌词/.test(aiText)) {
    return "multimedia";
  }
  // file_system 域特�?
  if (/文件|目录|磁盘|C盘|文件夹|清理/.test(aiText)) {
    return "file_system";
  }
  // service 域特�?
  if (/餐厅|外卖|美食|推荐|附近/.test(aiText)) {
    return "service";
  }

  return null;
}

/**
 * 判断当前用户消息是否看起来像是在补充信息（回答上一轮追问）
 *
 * 泛化检测：包含邮箱、手机号、ID、地址、时间、人�?联系方式等模�?
 */
function looksLikeSupplementaryInfo(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;

  // 包含邮箱地址
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(t)) return true;

  // 包含手机号（中国大陆�?
  if (/1[3-9]\d{9}/.test(t)) return true;

  // 包含各种 ID 格式（open_id, user_id, ou_ 开头等�?
  if (/(?:open_id|user_id|ou_|on_)[a-zA-Z0-9_]+/.test(t)) return true;

  // 短消�?+ 明显是在回答问题�?是xxx"�?xxx的邮�?手机/账号�?�?
  if (t.length < 100 && /(?:邮箱|手机|账号|号码|电话|地址|ID|id)\s*(?:是|为|：|:)/.test(t)) return true;

  // 非常短的消息�?30字），且不包含动�?请求词，很可能是补充回答
  if (
    t.length < 30 &&
    !/(?:帮我|请|查|搜|找|发|建|创建|规划|导航|播放|推荐|分析|打开)/.test(t)
  ) {
    // 排除纯闲聊（你好、谢谢等）
    if (/^(?:你好|谢谢|好的|嗯|哦|再见|拜拜|ok|OK)/.test(t)) {
      return false;
    }
    // 排除偏好/习惯/身份陈述（"我喜欢…""我是…""喜欢听…"等），这类应交给 generalAgent 记忆
    if (/(?:喜欢|不喜欢|偏好|爱好|习惯|我是|我叫|我在|我有|我想|我需要|我希望)/.test(t)) {
      return false;
    }
    // 排除包含"新闻/资讯/内容/信息"的陈述，这类是偏好表达而非补充信息
    if (/(?:新闻|资讯|内容|信息|节目|视频|文章)/.test(t)) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Follow-up 意图延续纠偏
 *
 * �?LLM 将用户的补充信息误判�?general 时，
 * 根据上一轮对话的任务域进行纠偏�?
 *
 * 适用于所有域�?follow-up 场景，不仅限�?office�?
 */
export function refineClassificationForFollowUp(
  userText: string,
  classification: TaskClassification,
  messages: readonly import("@langchain/core/messages").BaseMessage[]
): void {
  // 仅在被判�?general 时触发纠�?
  if (classification.domain !== "general") return;

  // 检测上一轮的任务�?
  const prevDomain = detectPreviousTurnDomain(messages);
  if (!prevDomain || prevDomain === "general") return;

  // 检测当前消息是否像补充信息
  if (!looksLikeSupplementaryInfo(userText)) return;

  // 域名�?Agent 的映�?
  const domainAgentMap: Record<string, string> = {
    office: "officeAgent",
    navigation: "navigationAgent",
    multimedia: "multimediaAgent",
    file_system: "fileAgent",
    service: "serviceAgent",
  };

  const targetAgent = domainAgentMap[prevDomain];
  if (!targetAgent) return;

  console.log(
    `[ClassifyNode] Rule override: follow-up supplementary info detected. ` +
      `general �?${prevDomain} (continuing previous turn intent)`
  );

  classification.domain = prevDomain;
  classification.complexity = "simple";
  classification.requiredAgents = [targetAgent];
  classification.reasoning =
    `[rule:follow_up_intent] 用户正在补充上一�?${prevDomain} 任务所需的信息�?{classification.reasoning || ""}`.trim();
}

// ==================== V4: 相似度纪偏 ====================

/**
 * 基于字符 N-gram + TF-IDF 余弦相似度的二次纪偏。
 *
 * 仅在以下两种场景跳过覆盖：
 * 1. classification.domain === "cross_domain"：跨域任务交由 LLM/规划器决定
 * 2. 其它规则纪偏函数已在 reasoning 中加了 [rule:xxx] 标记（可信度高）
 *
 * 调用点：在 LLM 返回并经过所有规则纪偏后，以“兜底式”身份运行。
 */
export function refineClassificationBySimilarity(
  userText: string,
  classification: TaskClassification
): void {
  const t = (userText || "").trim();
  if (!t) return;

  // 跨域任务不覆盖
  if (classification.domain === "cross_domain") return;

  // 如果规则纪偏已经介入，reasoning 会含 [rule:...]，低优先级于高置信度的规则纪偏
  const ruleMarked = /\[rule:[a-z_]+\]/i.test(
    classification.reasoning || ""
  );
  if (ruleMarked) return;

  const result = correctIntent(t, classification.domain);
  if (!result.shouldOverride) return;

  const targetAgent = result.suggestedAgent;
  if (!targetAgent) return;

  console.log(
    `[ClassifyNode] Similarity override: ${classification.domain} -> ${result.chosenDomain} ` +
      `(reason=${result.reason}, top=${result.topScores
        .map((s) => `${s.domain}:${s.score.toFixed(3)}`)
        .join(",")})`
  );

  classification.domain = result.chosenDomain as TaskDomain;
  classification.requiredAgents = [targetAgent];
  classification.reasoning =
    `[rule:similarity_${result.reason}] ${classification.reasoning || ""}`.trim();
}

// ==================== 对话上下文摘要构�?====================

/**
 * �?messages 中构建最近对话摘要，用于注入分类输入
 *
 * 截取最�?N 条消息（不含当前用户消息），格式化为简洁的对话摘要�?
 * 这让 LLM 在分类时能看到多轮上下文，避免孤立判断�?
 */
function buildRecentConversationSummary(
  messages: readonly import("@langchain/core/messages").BaseMessage[],
  maxTurns: number = 1
): string {
  if (messages.length <= 1) return "";

  // 取除最后一条之外的最近消息（最后一条是当前用户消息�?
  const historyMessages = messages.slice(0, -1);
  const recentMessages = historyMessages.slice(-maxTurns * 2);

  if (recentMessages.length === 0) return "";

  const lines: string[] = [];
  for (const msg of recentMessages) {
    const role =
      msg instanceof HumanMessage || msg._getType() === "human"
        ? "用户"
        : "助手";
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content || "");
    // 截断过长的消�?
    const truncated =
      content.length > 120 ? content.slice(0, 120) + "..." : content;
    lines.push(`${role}: ${truncated}`);
  }

  return lines.join("\n");
}

function getClassifyPrompt(): string {
  const registry = getAgentCardRegistry();

  if (registry.size() === 0) {
    console.log("[ClassifyNode] Registry empty, using static prompt");
    return CLASSIFY_SYSTEM_PROMPT;
  }

  const assembler = new DynamicPromptAssembler(registry);
  const dynamicPrompt = assembler.buildClassifyPrompt();
  console.log(
    `[ClassifyNode] Using dynamic prompt with ${registry.size()} agents`
  );
  return dynamicPrompt;
}

/**
 * 任务分类节点
 *
 * 接收用户消息，调�?LLM 进行结构化分类，
 * 将分类结果写�?state.taskClassification�?
 */
export async function classifyNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[ClassifyNode] Starting task classification (v1.3 preAnalysis-based)...");

  // 1. 提取最新用户消息
  const messages = state.messages;
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m instanceof HumanMessage || m._getType() === "human");

  const userText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage?.content || "");

  // 2. 评测开关：DISABLE_SHORTCUTS=true 时关闭 scene activation + canShortCircuit
  const shortcutsEnabled = process.env.DISABLE_SHORTCUTS !== "true";

  // 3. v1.3 新增：场景激活短路（优先使用 preAnalysisNode 填充的 sceneActivationResult）
  if (shortcutsEnabled && state.sceneActivationResult && state.sceneActivationResult.matches.length > 0) {
    const match = state.sceneActivationResult.matches[0];
    console.log(
      `[ClassifyNode] Scene activation matched (v1.3 preAnalysis): sceneName="${match.sceneName}", memoryId=${match.memoryId}`
    );
    const sceneClassification: TaskClassification = {
      domain: "general",
      executionMode: "plan",
      complexity: "complex",
      reasoning: `[rule:scene_activation] 用户触发已保存场景「${match.sceneName}」`,
      requiredAgents: ["generalAgent"],
    };
    const scenePlan: PlanStep[] = [{
      id: 1,
      description: `执行已保存的场景「${match.sceneName}」：${userText}。请先调用 memory_search 检索该场景的完整步骤（kind=episodic, type=behavior, query="${match.sceneName}"），然后按步骤逐一向用户确认并执行。`,
      targetAgent: "generalAgent",
      expectedTools: ["memory_search"],
      dependsOn: [],
      inputMapping: {},
    }];
    return {
      taskClassification: sceneClassification,
      plan: scenePlan,
    };
  }

  // 4. V4 兼容：相似度短路（仍生效，作为 preAnalysis 未命中时的 fallback）
  if (shortcutsEnabled) {
    const shortCircuit = canShortCircuit(userText);
    if (shortCircuit.ok && shortCircuit.domain && shortCircuit.agent) {
      const resolvedDomain = shortCircuit.domain === "vehicle_control" ? "multimedia" : shortCircuit.domain;
      const resolvedAgent = shortCircuit.domain === "vehicle_control" ? "multimediaAgent" : shortCircuit.agent;
      console.log(
        `[ClassifyNode] Short-circuit: domain=${resolvedDomain}, agent=${resolvedAgent}, top=${shortCircuit.topScores.map((s) => `${s.domain}:${s.score.toFixed(3)}`).join(",")}`
      );
      const shortClassification: TaskClassification = {
        domain: resolvedDomain as TaskDomain,
        executionMode: "single",
        complexity: "simple",
        reasoning: `[rule:similarity_short_circuit] 相似度短路命中 top=${shortCircuit.topScores[0]?.score.toFixed(3)}`,
        requiredAgents: [resolvedAgent],
      };
      let scPlan: PlanStep[] = [
        {
          id: 1,
          description: userText,
          targetAgent: resolvedAgent,
          expectedTools: [],
          dependsOn: [],
          inputMapping: {},
        },
      ];
      scPlan = appendGeneralAgentMemoryStepIfNeeded(state, scPlan);
      return {
        taskClassification: shortClassification,
        plan: scPlan,
      };
    }
  }

  const registry = getAgentCardRegistry();

  // 5. v1.3 核心变更：从 preAnalysisResult 构建初始 classification（不再调 LLM）
  let classification: TaskClassification;
  let preAnalysisSource: string = "unknown";

  if (state.preAnalysisResult) {
    const pa = state.preAnalysisResult;
    preAnalysisSource = pa.source;
    const executionMode: ExecutionMode = inferExecutionMode(pa.requiredAgents);
    const complexity: TaskComplexity = EXECUTION_MODE_TO_COMPLEXITY[executionMode];
    const requiredAgents = pa.requiredAgents.length > 0 ? pa.requiredAgents : ["generalAgent"];
    classification = {
      domain: pa.domain,
      executionMode,
      complexity,
      reasoning: pa.reasoning
        ? `[preAnalysis:${pa.source}] ${pa.reasoning}`
        : `[preAnalysis:${pa.source}] domain=${pa.domain}, agents=${requiredAgents.join(",")}, confidence=${pa.confidence.toFixed(2)}`,
      requiredAgents,
    };
  } else {
    // 兼容降级：preAnalysis 未运行（preAnalysisNode 未接入或失败）时走原 LLM 路径
    console.warn(
      "[ClassifyNode] preAnalysisResult 缺失，降级到 LLM 分类（v1.3 应保证 preAnalysisNode 已执行）"
    );
    try {
      const fullMessage = composeFullMessage(state, userText);
      const classifyPrompt = getClassifyPrompt();
      classification = await classifyLLMCall<TaskClassification>(
        classifyPrompt,
        fullMessage,
        { temperature: 0.1 }
      );
      // v1.3 兼容：填充 executionMode
      if (!classification.executionMode) {
        classification.executionMode = COMPLEXITY_TO_EXECUTION_MODE[classification.complexity || "simple"];
      }
    } catch (error) {
      console.error(
        "[ClassifyNode] LLM fallback classification failed:",
        (error as Error).message
      );
      classification = {
        domain: "general",
        executionMode: "single",
        complexity: "simple",
        reasoning: `Classification failed: ${(error as Error).message}. Falling back to general agent.`,
        requiredAgents: ["generalAgent"],
      };
    }
  }

  // 6. 验证分类 domain（preAnalysis 可能输出未注册 domain）
  const validDomains = collectValidClassificationDomains(registry);
  if (!validDomains.has(classification.domain)) {
    classification.domain = "general";
  }

  // 7. 应用 8 个 refine 函数（与原逻辑一致）
  refineClassificationForMusicIntent(userText, classification);
  refineClassificationForDiskIntent(userText, classification);
  refineClassificationForDirectoryInventoryIntent(userText, classification);
  refineClassificationForNewsIntent(userText, classification);
  refineClassificationForWeatherIntent(userText, classification);
  refineClassificationForVehicleControl(userText, classification);
  refineClassificationForFollowUp(userText, classification, messages);
  refineClassificationBySimilarity(userText, classification);

  // 8. 验证 requiredAgents
  if (
    !classification.requiredAgents ||
    classification.requiredAgents.length === 0
  ) {
    classification.requiredAgents = resolveAgentsForDomain(
      classification.domain,
      registry
    );
  } else if (registry.size() > 0) {
    const validatedAgents = classification.requiredAgents.filter((agentId) =>
      registry.has(agentId)
    );
    if (validatedAgents.length === 0) {
      classification.requiredAgents = resolveAgentsForDomain(
        classification.domain,
        registry
      );
    } else {
      classification.requiredAgents = validatedAgents;
    }
  }

  // 9. 同步 executionMode ↔ complexity（保持双向一致）
  classification.executionMode = inferExecutionMode(classification.requiredAgents);
  classification.complexity = EXECUTION_MODE_TO_COMPLEXITY[classification.executionMode];

  console.log(
    `[ClassifyNode] Classification: domain=${classification.domain}, executionMode=${classification.executionMode}, complexity=${classification.complexity}, agents=${classification.requiredAgents.join(",")}, preAnalysisSource=${preAnalysisSource}`
  );

  // 10. 计划生成（基于 executionMode 而非 complexity）
  if (classification.executionMode === "single") {
    const defaultPlan: PlanStep[] = [
      {
        id: 1,
        description: userText,
        targetAgent: classification.requiredAgents[0] || "generalAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];
    return {
      taskClassification: classification,
      plan: appendGeneralAgentMemoryStepIfNeeded(state, defaultPlan),
    };
  }

  if (classification.executionMode === "parallel") {
    // v1.3 新增：多 Agent 并行执行，每个 Agent 一步
    const parallelPlan: PlanStep[] = classification.requiredAgents.map((agent, idx) => ({
      id: idx + 1,
      description: userText,
      targetAgent: agent,
      expectedTools: [],
      dependsOn: [],
      inputMapping: {},
    }));
    return {
      taskClassification: classification,
      plan: appendGeneralAgentMemoryStepIfNeeded(state, parallelPlan),
    };
  }

  // executionMode === "plan"：交给 planStep 节点生成多步计划
  return {
    taskClassification: classification,
  };
}

/**
 * v1.3 新增：根据 requiredAgents 推断 executionMode
 *
 * - 0 个 Agent → "single"（降级到 generalAgent）
 * - 1 个 Agent → "single"
 * - 2+ 个 Agent → "parallel"
 *
 * 注：plan 模式由 classifyNode 内部显式设置（如 sceneActivation special plan），
 * 不通过 requiredAgents 长度推断。
 */
function inferExecutionMode(requiredAgents: string[]): ExecutionMode {
  if (requiredAgents.length <= 1) return "single";
  return "parallel";
}

/**
 * v1.3 新增：拼装完整消息（LLM fallback 路径用）
 */
function composeFullMessage(state: SupervisorStateType, userText: string): string {
  let contextInfo = "";
  if (state.context) {
    if (state.context.location) {
      contextInfo += `\n用户位置: ${state.context.location.city || "未知城市"}`;
    }
    contextInfo += `\n当前时间: ${state.context.currentTime}`;
  }
  const conversationSummary = buildRecentConversationSummary(state.messages);
  let fullMessage = userText;
  if (conversationSummary) {
    fullMessage = `${userText}\n\n[对话上下文]\n${conversationSummary}`;
  }
  if (contextInfo) {
    fullMessage += `\n\n[上下文信息]${contextInfo}`;
  }
  return fullMessage;
}

/**
 * 路由函数：根据分类结果决定执行路�?
 *
 * - simple �?直接进入 execute 节点（已有默认单步计划）
 * - moderate / complex �?进入 plan 节点
 */
export function routeByComplexity(
  state: SupervisorStateType
): "execute" | "plan" {
  const classification = state.taskClassification;
  if (!classification || classification.complexity === "simple") {
    return "execute";
  }
  return "plan";
}

/**
 * v1.3 新增：基于 executionMode 路由（推荐使用，替代 routeByComplexity）
 *
 * - single/parallel → execute
 * - plan → planStep
 * - 缺失 → execute（安全降级）
 */
export function routeByExecutionMode(
  state: SupervisorStateType
): "execute" | "plan" {
  const tc = state?.taskClassification;
  if (!tc) return "execute";
  if (tc.executionMode === "plan") return "plan";
  return "execute";
}

/** 内置分类领域 + �?Agent Card 声明�?domain，供 LLM 输出校验 */
function collectValidClassificationDomains(
  registry: IAgentCardRegistry
): Set<string> {
  const s = new Set<string>([
    "navigation",
    "multimedia",
    "file_system",
    "general",
    "cross_domain",
  ]);
  for (const card of registry.getAllEnabled()) {
    s.add(card.domain);
  }
  return s;
}

/**
 * 根据领域解析默认 Agent 列表：优�?AgentCardRegistry.findByDomain，再回退硬编码�?
 */
export function resolveAgentsForDomain(
  domain: TaskDomain,
  registry: IAgentCardRegistry
): string[] {
  if (domain === "cross_domain") {
    const wanted = ["navigationAgent", "multimediaAgent", "fileAgent", "officeAgent", "serviceAgent"];
    return wanted.filter((id) => registry.has(id));
  }

  const byCard = registry.findByDomain(domain);
  if (byCard.length > 0) {
    return [byCard[0].id];
  }

  switch (domain) {
    case "navigation":
      return ["navigationAgent"];
    case "multimedia":
      return ["multimediaAgent"];
    case "file_system":
      return ["fileAgent"];
    case "office":
      return ["officeAgent"];
    case "service":
      return ["serviceAgent"];
    case "general":
      return ["generalAgent"];
    default:
      return ["generalAgent"];
  }
}
