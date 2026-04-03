/**
 * Classify Node — 任务分类节点
 *
 * 使用 LLM 结构化输出对用户输入进行领域分类和复杂度判断。
 *
 * V2 增强：
 * - System Prompt 从硬编码改为运行时通过 DynamicPromptAssembler 动态生成
 * - Agent 列表从 AgentCardRegistry 动态获取，支持热插拔
 */

import type {
  SupervisorStateType,
  TaskClassification,
  TaskDomain,
  TaskComplexity,
  PlanStep,
} from "./state";
import { callLLMStructured } from "../../llm/langchainAdapter";
import { HumanMessage } from "@langchain/core/messages";
import {
  getAgentCardRegistry,
  DynamicPromptAssembler,
} from "../discovery";
import type { IAgentCardRegistry } from "../discovery/types";

/**
 * classifyNode 的 LLM 系统提示词（静态降级版本）
 *
 * 当 AgentCardRegistry 为空时使用此降级 Prompt。
 * 正常情况下使用 DynamicPromptAssembler 动态生成。
 */
export const CLASSIFY_SYSTEM_PROMPT = `你是一个任务分类专家。根据用户输入，判断任务所属领域和复杂度。

可用领域：
- navigation: 用户**明确要求**导航、路径规划、地图查询、天气、POI 搜索等（如「怎么去」「规划路线」「导航到」）；**不要**把「仅陈述家住哪、公司在哪」判成导航
- multimedia: 音乐搜索/播放、视频搜索、歌曲推荐、歌单管理等（**含「搜索/找 XX 的歌」「推荐歌手」等，勿判成 general**）
- file_system: 文件搜索、文件打开、目录操作、文件复制/创建等
- general: 闲聊、知识问答、建议咨询、**仅同步住址/上班地等个人信息**（无导航意图）
- cross_domain: 涉及多个领域的复合任务

复杂度判断：
- simple: 单步操作或简单问答，只需一个 Agent 即可完成
- moderate: 需要多步操作但在单一领域内，需要规划
- complex: 跨领域协作或多步条件判断，需要详细规划和协调

可用 Agent：
- fileAgent: 文件系统操作
- navigationAgent: 导航和地图操作
- multimediaAgent: 音乐和多媒体操作
- generalAgent: 通用对话和知识问答

请以 JSON 格式输出（不要包含其他文字）：
{
  "domain": "navigation|multimedia|file_system|general|cross_domain",
  "complexity": "simple|moderate|complex",
  "reasoning": "分类推理过程",
  "requiredAgents": ["需要调用的Agent列表"]
}`;

/**
 * 获取分类 Prompt
 *
 * 优先使用 DynamicPromptAssembler 动态生成，
 * 注册表为空时降级使用静态 Prompt。
 */
/**
 * 明显的音乐类请求若被 LLM 判成 general，会导致走 generalAgent（无网易云 search 工具），
 * 模型只能编造「搜索功能用不了」。在出结果前用规则纠偏。
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
      "[ClassifyNode] Rule override: music-like utterance was general → multimedia"
    );
    classification.domain = "multimedia";
    classification.requiredAgents = ["multimediaAgent"];
    classification.reasoning =
      `[rule:music_intent] ${classification.reasoning || ""}`.trim();
  }

  /**
   * 复合音乐任务（搜歌 + 歌词/专辑/「最新」等）：**simple** + 单步 multimediaAgent。
   * moderate/complex 会走 plan 多步，步骤间难传歌曲 ID，末步常被 generalAgent 总结 → 易变「无法获取」。
   * cross_domain 若实为纯音乐链路，也收敛到 multimedia。
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
      "[ClassifyNode] Rule override: compound music → simple (single multimediaAgent tool chain)"
    );
    classification.domain = "multimedia";
    classification.complexity = "simple";
    classification.requiredAgents = ["multimediaAgent"];
    classification.reasoning =
      `[rule:music_tool_chain] ${classification.reasoning || ""}`.trim();
  }
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
 * 接收用户消息，调用 LLM 进行结构化分类，
 * 将分类结果写入 state.taskClassification。
 */
export async function classifyNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[ClassifyNode] Starting task classification...");

  // 1. 提取最新用户消息
  const messages = state.messages;
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m instanceof HumanMessage || m._getType() === "human");

  const userText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage?.content || "");

  // 2. 附加上下文信息
  let contextInfo = "";
  if (state.context) {
    if (state.context.location) {
      contextInfo += `\n用户位置: ${state.context.location.city || "未知城市"}`;
    }
    contextInfo += `\n当前时间: ${state.context.currentTime}`;
  }

  const fullMessage = contextInfo
    ? `${userText}\n\n[上下文信息]${contextInfo}`
    : userText;

  // 3. 获取动态 Prompt 并调用 LLM
  const classifyPrompt = getClassifyPrompt();

  try {
    const classification = await callLLMStructured<TaskClassification>(
      classifyPrompt,
      fullMessage,
      { temperature: 0.2 }
    );

    const registry = getAgentCardRegistry();

    // 4. 验证分类结果（内置领域 + 已启用 Agent Card 的 domain）
    const validDomains = collectValidClassificationDomains(registry);
    const validComplexities: TaskComplexity[] = [
      "simple",
      "moderate",
      "complex",
    ];

    if (!validDomains.has(classification.domain)) {
      classification.domain = "general";
    }
    if (!validComplexities.includes(classification.complexity)) {
      classification.complexity = "simple";
    }

    refineClassificationForMusicIntent(userText, classification);

    // 验证 requiredAgents：确保引用的 Agent 在注册表中存在
    if (
      !classification.requiredAgents ||
      classification.requiredAgents.length === 0
    ) {
      classification.requiredAgents = resolveAgentsForDomain(
        classification.domain,
        registry
      );
    } else if (registry.size() > 0) {
      // 过滤掉注册表中不存在的 Agent
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

    console.log(
      `[ClassifyNode] Classification: domain=${classification.domain}, complexity=${classification.complexity}, agents=${classification.requiredAgents.join(",")}`
    );

    // 5. 对于 simple 任务，生成默认的单步计划
    if (classification.complexity === "simple") {
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
        plan: defaultPlan,
      };
    }

    return {
      taskClassification: classification,
    };
  } catch (error) {
    console.error(
      "[ClassifyNode] Classification failed, falling back to general:",
      (error as Error).message
    );

    // 降级处理：分类失败时默认为 general + simple
    const fallback: TaskClassification = {
      domain: "general",
      complexity: "simple",
      reasoning: `Classification failed: ${(error as Error).message}. Falling back to general agent.`,
      requiredAgents: ["generalAgent"],
    };

    const defaultPlan: PlanStep[] = [
      {
        id: 1,
        description: userText,
        targetAgent: "generalAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    return {
      taskClassification: fallback,
      plan: defaultPlan,
    };
  }
}

/**
 * 路由函数：根据分类结果决定执行路径
 *
 * - simple → 直接进入 execute 节点（已有默认单步计划）
 * - moderate / complex → 进入 plan 节点
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

/** 内置分类领域 + 各 Agent Card 声明的 domain，供 LLM 输出校验 */
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
 * 根据领域解析默认 Agent 列表：优先 AgentCardRegistry.findByDomain，再回退硬编码。
 */
export function resolveAgentsForDomain(
  domain: TaskDomain,
  registry: IAgentCardRegistry
): string[] {
  if (domain === "cross_domain") {
    const wanted = ["navigationAgent", "multimediaAgent", "fileAgent"];
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
    case "general":
      return ["generalAgent"];
    default:
      return ["generalAgent"];
  }
}
