/**
 * Plan Node — 动态规划节点
 *
 * 使用 LLM 将复杂任务分解为有序的执行步骤。
 *
 * V2 增强：
 * - System Prompt 从硬编码改为运行时通过 DynamicPromptAssembler 动态生成
 * - validAgents 从硬编码数组改为 AgentCardRegistry.getAllIds() 动态获取
 * - 新增并行执行提示：无依赖步骤的 dependsOn 设为空数组
 */

import type { SupervisorStateType, PlanStep, ExecutionPlan } from "./state";
import { callLLMStructured } from "../../llm/langchainAdapter";
import { HumanMessage } from "@langchain/core/messages";
import {
  getAgentCardRegistry,
  DynamicPromptAssembler,
} from "../discovery";

/**
 * planNode 的 LLM 系统提示词（静态降级版本）
 *
 * 当 AgentCardRegistry 为空时使用此降级 Prompt。
 * 正常情况下使用 DynamicPromptAssembler 动态生成。
 */
export const PLAN_SYSTEM_PROMPT = `你是一个任务规划专家。根据用户需求和任务分类，将任务分解为有序的执行步骤。

可用的 Agent 及其能力：
- fileAgent: 文件搜索、文件信息查询、打开文件、目录操作、创建文件/文件夹、复制文件
- navigationAgent: POI搜索、周边搜索、路径规划（驾车/步行/骑行/公交）、地理编码、天气查询、IP定位、导航
- multimediaAgent: 音乐搜索、音乐播放、歌单管理、每日推荐、登录状态管理
- generalAgent: 通用对话、知识问答、信息分析、结果汇总（不使用工具）

规划原则：
1. 每个步骤应该是一个原子操作，由单个 Agent 完成
2. 步骤之间可以有依赖关系（dependsOn 指定前置步骤 ID）
3. 如果后续步骤需要前置步骤的结果，通过 inputMapping 指定（格式："参数名": "step_N.字段名"）
4. 导航类任务如果需要用户位置，第一步应该是获取位置（如果上下文中没有）
5. 步骤数量应该精简，避免不必要的步骤
6. 最后一步通常是 generalAgent 汇总所有结果
7. 没有数据依赖的步骤应该将 dependsOn 设为空数组，以便并行执行

请以 JSON 格式输出（不要包含其他文字）：
{
  "goal": "任务目标描述",
  "steps": [
    {
      "id": 1,
      "description": "步骤描述",
      "targetAgent": "agentName",
      "expectedTools": ["tool1", "tool2"],
      "dependsOn": [],
      "inputMapping": {}
    }
  ],
  "estimatedComplexity": "simple|moderate|complex"
}`;

/**
 * 获取规划 Prompt
 *
 * 优先使用 DynamicPromptAssembler 动态生成，
 * 注册表为空时降级使用静态 Prompt。
 */
function getPlanPrompt(): string {
  const registry = getAgentCardRegistry();

  if (registry.size() === 0) {
    console.log("[PlanNode] Registry empty, using static prompt");
    return PLAN_SYSTEM_PROMPT;
  }

  const assembler = new DynamicPromptAssembler(registry);
  const dynamicPrompt = assembler.buildPlanPrompt();
  console.log(
    `[PlanNode] Using dynamic prompt with ${registry.size()} agents`
  );
  return dynamicPrompt;
}

/**
 * 动态规划节点
 *
 * 接收任务分类结果和用户消息，调用 LLM 生成执行计划。
 */
export async function planNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[PlanNode] Starting task planning...");

  // 1. 提取用户消息
  const messages = state.messages;
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m instanceof HumanMessage || m._getType() === "human");

  const userText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage?.content || "");

  // 2. 构建规划请求
  let planRequest = `用户请求: ${userText}`;

  // 附加分类信息
  if (state.taskClassification) {
    planRequest += `\n\n任务分类信息:`;
    planRequest += `\n- 领域: ${state.taskClassification.domain}`;
    planRequest += `\n- 复杂度: ${state.taskClassification.complexity}`;
    planRequest += `\n- 推荐Agent: ${state.taskClassification.requiredAgents.join(", ")}`;
    planRequest += `\n- 分类推理: ${state.taskClassification.reasoning}`;
  }

  // 附加上下文
  if (state.context) {
    planRequest += `\n\n用户上下文:`;
    if (state.context.location) {
      planRequest += `\n- 位置: ${state.context.location.city || "未知"} (${state.context.location.latitude}, ${state.context.location.longitude})`;
    } else {
      planRequest += `\n- 位置: 未知（可能需要先通过 IP 定位获取）`;
    }
    planRequest += `\n- 时间: ${state.context.currentTime}`;
    planRequest += `\n- 平台: ${state.context.platform}`;
  }

  // 3. 获取动态 Prompt 并调用 LLM
  const planPrompt = getPlanPrompt();

  try {
    const plan = await callLLMStructured<ExecutionPlan>(
      planPrompt,
      planRequest,
      { temperature: 0.3 }
    );

    // 4. 验证计划
    if (!plan.steps || plan.steps.length === 0) {
      throw new Error("Plan has no steps");
    }

    // 动态获取有效 Agent 列表
    const registry = getAgentCardRegistry();
    const validAgents =
      registry.size() > 0
        ? registry.getAllIds()
        : ["fileAgent", "navigationAgent", "multimediaAgent", "generalAgent"];

    for (const step of plan.steps) {
      if (!validAgents.includes(step.targetAgent)) {
        console.warn(
          `[PlanNode] Invalid targetAgent "${step.targetAgent}" in step ${step.id}, defaulting to generalAgent`
        );
        step.targetAgent = "generalAgent";
      }

      // 确保数组字段存在
      step.expectedTools = step.expectedTools || [];
      step.dependsOn = step.dependsOn || [];
      step.inputMapping = step.inputMapping || {};
    }

    console.log(
      `[PlanNode] Plan generated: ${plan.steps.length} steps for goal "${plan.goal}"`
    );
    plan.steps.forEach((s) => {
      console.log(
        `  Step ${s.id}: [${s.targetAgent}] ${s.description} (depends: ${s.dependsOn.join(",") || "none"})`
      );
    });

    return {
      plan: plan.steps,
      currentStepIndex: 0,
    };
  } catch (error) {
    console.error(
      "[PlanNode] Planning failed:",
      (error as Error).message
    );

    // 降级处理：生成简单的单步计划
    const fallbackAgent =
      state.taskClassification?.requiredAgents[0] || "generalAgent";

    const fallbackPlan: PlanStep[] = [
      {
        id: 1,
        description: userText,
        targetAgent: fallbackAgent,
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    console.log(
      `[PlanNode] Falling back to single-step plan with ${fallbackAgent}`
    );

    return {
      plan: fallbackPlan,
      currentStepIndex: 0,
    };
  }
}
