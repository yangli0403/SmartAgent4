/**
 * Classify Node — 任务分类节点
 *
 * 使用 LLM 结构化输出对用户输入进行领域分类和复杂度判断，
 * 替代原有的硬编码正则检测（detectTaskType）。
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

/**
 * classifyNode 的 LLM 系统提示词
 */
export const CLASSIFY_SYSTEM_PROMPT = `你是一个任务分类专家。根据用户输入，判断任务所属领域和复杂度。

可用领域：
- navigation: 导航、地图、位置搜索、路径规划、POI查询、充电桩、加油站、天气等
- multimedia: 音乐搜索/播放、视频搜索、歌曲推荐、歌单管理等
- file_system: 文件搜索、文件打开、目录操作、文件复制/创建等
- general: 闲聊、知识问答、建议咨询等不需要工具的任务
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

  // 3. 调用 LLM 获取结构化分类
  try {
    const classification = await callLLMStructured<TaskClassification>(
      CLASSIFY_SYSTEM_PROMPT,
      fullMessage,
      { temperature: 0.2 }
    );

    // 4. 验证分类结果
    const validDomains: TaskDomain[] = [
      "navigation",
      "multimedia",
      "file_system",
      "general",
      "cross_domain",
    ];
    const validComplexities: TaskComplexity[] = [
      "simple",
      "moderate",
      "complex",
    ];

    if (!validDomains.includes(classification.domain)) {
      classification.domain = "general";
    }
    if (!validComplexities.includes(classification.complexity)) {
      classification.complexity = "simple";
    }
    if (
      !classification.requiredAgents ||
      classification.requiredAgents.length === 0
    ) {
      // 根据 domain 推断默认 Agent
      classification.requiredAgents = domainToAgents(classification.domain);
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
          targetAgent: classification.requiredAgents[0] as any || "generalAgent",
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

/**
 * 根据领域推断默认 Agent 列表
 */
function domainToAgents(domain: TaskDomain): string[] {
  switch (domain) {
    case "navigation":
      return ["navigationAgent"];
    case "multimedia":
      return ["multimediaAgent"];
    case "file_system":
      return ["fileAgent"];
    case "general":
      return ["generalAgent"];
    case "cross_domain":
      return ["navigationAgent", "multimediaAgent", "fileAgent"];
    default:
      return ["generalAgent"];
  }
}
