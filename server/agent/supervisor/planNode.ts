/**
 * Plan Node — 动态规划节点
 *
 * 使用 LLM 将复杂任务分解为有序的执行步骤，
 * 替代原有的硬编码规则规划。
 */

import type { SupervisorStateType, PlanStep, ExecutionPlan } from "./state";
import { callLLMStructured } from "../../llm/langchainAdapter";
import { HumanMessage } from "@langchain/core/messages";

/**
 * planNode 的 LLM 系统提示词
 */
export const PLAN_SYSTEM_PROMPT = `你是一个任务规划专家。根据用户需求和任务分类，将任务分解为有序的执行步骤。

可用的 Agent 及其能力：
- fileAgent: 文件搜索、文件信息查询、打开文件、目录操作、创建文件/文件夹、复制文件
- navigationAgent: POI搜索、周边搜索、路径规划（驾车/步行/骑行/公交）、地理编码、天气查询、IP定位、导航
- multimediaAgent: 音乐搜索、音乐播放、歌单管理、每日推荐、登录状态管理
- generalAgent: 通用对话、知识问答、信息分析、结果汇总（不使用工具）

navigationAgent 可用工具：
maps_search_around, maps_search_keyword, maps_direction_driving, maps_direction_walking,
maps_direction_transit, maps_direction_bicycling, maps_geocode, maps_regeocode,
maps_weather, maps_ip_location, maps_distance, maps_poi_detail, maps_search_detail,
maps_static_map, maps_coordinate_convert, maps_navigation, maps_riding_taxi

multimediaAgent 可用工具：
search, get_song_detail, get_song_url, get_unblocked_url,
get_lyric, get_playlist, get_album, get_artist

fileAgent 可用工具：
search_files, get_file_info, open_file, list_directory, create_folder,
create_file, copy_files, launch_app, browser_control, list_running_apps, close_app

规划原则：
1. 每个步骤应该是一个原子操作，由单个 Agent 完成
2. 步骤之间可以有依赖关系（dependsOn 指定前置步骤 ID）
3. 如果后续步骤需要前置步骤的结果，通过 inputMapping 指定（格式："参数名": "step_N.字段名"）
4. 导航类任务如果需要用户位置，第一步应该是获取位置（如果上下文中没有）
5. 步骤数量应该精简，避免不必要的步骤
6. 最后一步通常是 generalAgent 汇总所有结果

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

  // 3. 调用 LLM 生成计划
  try {
    const plan = await callLLMStructured<ExecutionPlan>(
      PLAN_SYSTEM_PROMPT,
      planRequest,
      { temperature: 0.3 }
    );

    // 4. 验证计划
    if (!plan.steps || plan.steps.length === 0) {
      throw new Error("Plan has no steps");
    }

    // 确保每个步骤都有有效的 targetAgent
    const validAgents = [
      "fileAgent",
      "navigationAgent",
      "multimediaAgent",
      "generalAgent",
    ];

    for (const step of plan.steps) {
      if (!validAgents.includes(step.targetAgent)) {
        console.warn(
          `[PlanNode] Invalid targetAgent "${step.targetAgent}" in step ${step.id}, defaulting to generalAgent`
        );
        step.targetAgent = "generalAgent" as any;
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
        targetAgent: fallbackAgent as any,
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
