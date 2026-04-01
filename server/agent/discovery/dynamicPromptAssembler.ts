/**
 * DynamicPromptAssembler — 动态 Prompt 组装器
 *
 * 运行时遍历 AgentCardRegistry，将所有已注册 Agent 的名称、
 * 描述和工具列表动态拼接为 LLM Prompt 片段。
 *
 * 替代 classifyNode.ts 和 planNode.ts 中硬编码的 Agent 列表和工具列表。
 *
 * V2 增强（第五轮迭代）：
 * - 新增 buildSeparatedClassifyPrompt() 和 buildSeparatedPlanPrompt()
 * - 将动态 Agent/工具信息从 System Prompt 中分离为独立消息
 * - 提高大模型 Prompt Caching 命中率，降低 API 成本
 */

import type { IAgentCardRegistry, IDynamicPromptAssembler, AgentCard } from "./types";

// ==================== Prompt 载荷类型 ====================

/**
 * 分离的 Prompt 载荷
 *
 * 将 System Prompt 拆分为静态部分和动态部分，
 * 使大模型能够缓存不变的静态部分。
 */
export interface DynamicPromptPayload {
  /** 静态的 System Prompt（规则、角色、输出格式等不变内容） */
  staticSystemPrompt: string;
  /** 动态的内容消息（Agent 列表、工具描述等随注册表变化的内容） */
  dynamicContentMessage: string;
}

// ==================== 静态 Prompt 常量 ====================

/**
 * 分类节点的静态 System Prompt
 *
 * 只包含固定的规则指令和输出格式，不包含动态 Agent 列表。
 */
const STATIC_CLASSIFY_PROMPT = `你是一个智能任务分类器。根据用户输入，判断任务所属领域和复杂度。

## 领域分类规则
- navigation: 涉及地图、导航、位置、天气、POI搜索
- multimedia: 涉及音乐、视频、歌曲搜索、播放
- file_system: 涉及文件操作、搜索、创建、复制、打开应用
- general: 通用对话、知识问答、闲聊
- cross_domain: 涉及多个领域的复合任务

## 复杂度判断规则
- simple: 单一领域、单步操作（如"今天天气怎么样"）
- moderate: 单一领域、多步操作（如"搜索附近餐厅并导航到最近的"）
- complex: 跨领域或需要多个 Agent 协作（如"查天气然后创建文件记录"）

## 输出格式（严格 JSON）
{
  "domain": "navigation|multimedia|file_system|general|cross_domain",
  "complexity": "simple|moderate|complex",
  "reasoning": "分类推理过程",
  "requiredAgents": ["需要调用的Agent列表"]
}

请只输出 JSON，不要包含其他文字。`;

/**
 * 规划节点的静态 System Prompt
 *
 * 只包含固定的规划原则和输出格式，不包含动态 Agent 和工具列表。
 */
const STATIC_PLAN_PROMPT = `你是一个任务规划专家。根据用户需求和任务分类，将任务分解为有序的执行步骤。

## 规划原则
1. 每个步骤应该是一个原子操作，由单个 Agent 完成
2. 步骤之间可以有依赖关系（dependsOn 指定前置步骤 ID）
3. 如果后续步骤需要前置步骤的结果，通过 inputMapping 指定（格式："参数名": "step_N.字段名"）
4. 导航类任务如果需要用户位置，第一步应该是获取位置（如果上下文中没有）
5. 步骤数量应该精简，避免不必要的步骤
6. 最后一步通常是 generalAgent 汇总所有结果
7. **没有数据依赖的步骤应该将 dependsOn 设为空数组，以便并行执行**

## 输出格式（严格 JSON）
{
  "goal": "任务目标描述",
  "steps": [
    {
      "id": 1,
      "description": "步骤描述",
      "targetAgent": "agentId",
      "expectedTools": ["tool1", "tool2"],
      "dependsOn": [],
      "inputMapping": {}
    }
  ],
  "estimatedComplexity": "simple|moderate|complex"
}

请只输出 JSON，不要包含其他文字。`;

// ==================== DynamicPromptAssembler 实现 ====================

export class DynamicPromptAssembler implements IDynamicPromptAssembler {
  private registry: IAgentCardRegistry;

  constructor(registry: IAgentCardRegistry) {
    this.registry = registry;
  }

  /**
   * 构建分类节点的 System Prompt（旧版，兼容保留）
   *
   * 动态注入所有已注册 Agent 的名称和描述，
   * 替代 classifyNode.ts 中硬编码的 CLASSIFY_SYSTEM_PROMPT。
   */
  buildClassifyPrompt(): string {
    const agents = this.registry.getAllEnabled();

    const agentDescriptions = agents
      .map((card) => `- ${card.id}: ${card.description}`)
      .join("\n");

    const agentIds = agents.map((card) => card.id);

    return `你是一个智能任务分类器。根据用户输入，判断任务所属领域和复杂度。

## 可用的 Agent
${agentDescriptions}

## 领域分类规则
- navigation: 涉及地图、导航、位置、天气、POI搜索
- multimedia: 涉及音乐、视频、歌曲搜索、播放
- file_system: 涉及文件操作、搜索、创建、复制、打开应用
- general: 通用对话、知识问答、闲聊
- cross_domain: 涉及多个领域的复合任务

## 复杂度判断规则
- simple: 单一领域、单步操作（如"今天天气怎么样"）
- moderate: 单一领域、多步操作（如"搜索附近餐厅并导航到最近的"）
- complex: 跨领域或需要多个 Agent 协作（如"查天气然后创建文件记录"）

## 输出格式（严格 JSON）
{
  "domain": "navigation|multimedia|file_system|general|cross_domain",
  "complexity": "simple|moderate|complex",
  "reasoning": "分类推理过程",
  "requiredAgents": [${agentIds.map((id) => `"${id}"`).join(", ")}]
}

请只输出 JSON，不要包含其他文字。`;
  }

  /**
   * 构建规划节点的 System Prompt（旧版，兼容保留）
   *
   * 动态注入所有已注册 Agent 的名称、描述和工具列表，
   * 替代 planNode.ts 中硬编码的 PLAN_SYSTEM_PROMPT。
   */
  buildPlanPrompt(): string {
    const agents = this.registry.getAllEnabled();

    const agentSections = agents
      .map((card) => this.formatAgentSection(card))
      .join("\n\n");

    return `你是一个任务规划专家。根据用户需求和任务分类，将任务分解为有序的执行步骤。

## 可用的 Agent 及其能力
${agentSections}

## 规划原则
1. 每个步骤应该是一个原子操作，由单个 Agent 完成
2. 步骤之间可以有依赖关系（dependsOn 指定前置步骤 ID）
3. 如果后续步骤需要前置步骤的结果，通过 inputMapping 指定（格式："参数名": "step_N.字段名"）
4. 导航类任务如果需要用户位置，第一步应该是获取位置（如果上下文中没有）
5. 步骤数量应该精简，避免不必要的步骤
6. 最后一步通常是 generalAgent 汇总所有结果
7. **没有数据依赖的步骤应该将 dependsOn 设为空数组，以便并行执行**

## 输出格式（严格 JSON）
{
  "goal": "任务目标描述",
  "steps": [
    {
      "id": 1,
      "description": "步骤描述",
      "targetAgent": "agentId",
      "expectedTools": ["tool1", "tool2"],
      "dependsOn": [],
      "inputMapping": {}
    }
  ],
  "estimatedComplexity": "simple|moderate|complex"
}

请只输出 JSON，不要包含其他文字。`;
  }

  /**
   * 构建分离的分类 Prompt（第五轮迭代新增）
   *
   * 将静态规则与动态 Agent 列表分离，
   * 使大模型能够缓存不变的静态 System Prompt。
   *
   * @returns 分离的 Prompt 载荷
   */
  buildSeparatedClassifyPrompt(): DynamicPromptPayload {
    const agents = this.registry.getAllEnabled();

    const agentDescriptions = agents
      .map((card) => `- ${card.id}: ${card.description}`)
      .join("\n");

    const agentIds = agents.map((card) => card.id);

    const dynamicContent = `## 当前可用的 Agent
${agentDescriptions}

## 可选的 Agent ID 列表
${agentIds.map((id) => `"${id}"`).join(", ")}`;

    return {
      staticSystemPrompt: STATIC_CLASSIFY_PROMPT,
      dynamicContentMessage: dynamicContent,
    };
  }

  /**
   * 构建分离的规划 Prompt（第五轮迭代新增）
   *
   * 将静态规划原则与动态 Agent/工具列表分离。
   *
   * @returns 分离的 Prompt 载荷
   */
  buildSeparatedPlanPrompt(): DynamicPromptPayload {
    const agents = this.registry.getAllEnabled();

    const agentSections = agents
      .map((card) => this.formatAgentSection(card))
      .join("\n\n");

    const dynamicContent = `## 当前可用的 Agent 及其能力
${agentSections}`;

    return {
      staticSystemPrompt: STATIC_PLAN_PROMPT,
      dynamicContentMessage: dynamicContent,
    };
  }

  /**
   * 获取所有已注册 Agent 的能力摘要
   */
  getAgentCapabilitySummary(): string {
    const agents = this.registry.getAllEnabled();

    return agents
      .map(
        (card) =>
          `[${card.id}] ${card.name}: ${card.description} (能力: ${card.capabilities.join(", ")})`
      )
      .join("\n");
  }

  // ==================== 私有方法 ====================

  /**
   * 格式化单个 Agent 的 Prompt 片段
   */
  private formatAgentSection(card: AgentCard): string {
    const toolList =
      card.tools.length > 0
        ? card.tools.join(", ")
        : "无工具（纯 LLM 对话）";

    return `### ${card.id}: ${card.name}
- 描述: ${card.description}
- 能力标签: ${card.capabilities.join(", ") || "通用"}
- 可用工具: ${toolList}`;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建 DynamicPromptAssembler 实例
 */
export function createDynamicPromptAssembler(
  registry: IAgentCardRegistry
): DynamicPromptAssembler {
  return new DynamicPromptAssembler(registry);
}
