/**
 * DynamicPromptAssembler — 动态 Prompt 组装器
 *
 * 运行时遍历 AgentCardRegistry，将所有已注册 Agent 的名称、
 * 描述和工具列表动态拼接为 LLM Prompt 片段。
 *
 * 替代 classifyNode.ts 和 planNode.ts 中硬编码的 Agent 列表和工具列表。
 */

import type { IAgentCardRegistry, IDynamicPromptAssembler, AgentCard } from "./types";

// ==================== DynamicPromptAssembler 实现 ====================

export class DynamicPromptAssembler implements IDynamicPromptAssembler {
  private registry: IAgentCardRegistry;

  constructor(registry: IAgentCardRegistry) {
    this.registry = registry;
  }

  /**
   * 构建分类节点的 System Prompt
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
   * 构建规划节点的 System Prompt
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
