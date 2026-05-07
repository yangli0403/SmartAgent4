/**
 * 新闻多轮情景记忆（STORE-004）
 *
 * 当用户请求新闻资讯（查询、推送、修改）时，
 * 在 generalAgent 执行完 get_latest_news 后追加一步 memory_store，
 * 将新闻偏好/设置写入 episodic 记忆。
 *
 * 这确保下次用户再请求新闻时，可以从记忆中推断偏好（类别、数量、推送时间等）。
 */

import type { SupervisorStateType, PlanStep } from "./state";

function planHasNewsMemoryStep(steps: PlanStep[]): boolean {
  return steps.some(
    (s) =>
      s.targetAgent === "generalAgent" &&
      (s.expectedTools?.includes("memory_store") ||
        /memory_store|情景记忆|episodic/i.test(s.description))
  );
}

/**
 * 判断是否是新闻相关任务
 */
function isNewsRelatedTask(state: SupervisorStateType): boolean {
  // 从消息中提取用户消息
  const messages = state.messages;
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => {
      const type = typeof (m as { _getType?: () => string })._getType === "function"
        ? (m as { _getType: () => string })._getType()
        : "";
      return type === "human" || type === "";
    });
  
  const userText = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content
    : "";

  const newsKeywords = /新闻|资讯|头条|日报|早报|晚报|热点|时事|今日新闻|今日资讯|今日头条|热搜|热榜|今日热搜|推送.*新闻/i;

  return newsKeywords.test(userText);
}

/**
 * 若满足条件，在计划末尾追加「用 memory_store 记录本次新闻偏好」的 generalAgent 步骤。
 */
export function appendNewsMemoryStepIfNeeded(
  state: SupervisorStateType,
  steps: PlanStep[]
): PlanStep[] {
  if (!state || steps.length === 0) return steps;

  // 检查是否是新闻相关任务
  if (!isNewsRelatedTask(state)) return steps;

  const generalSteps = steps.filter((s) => s.targetAgent === "generalAgent");
  if (generalSteps.length === 0) return steps;

  if (planHasNewsMemoryStep(steps)) return steps;

  // 找到最后一个 generalAgent 步骤
  const lastGeneral = generalSteps[generalSteps.length - 1];

  // 检查是否有新闻工具调用
  const hasNewsTool =
    lastGeneral.expectedTools?.includes("get_latest_news") ||
    /get_latest_news|新闻/.test(lastGeneral.description);

  if (!hasNewsTool) {
    // 检查整个计划
    const newsStep = steps.find(
      (s) =>
        s.targetAgent === "generalAgent" &&
        (s.expectedTools?.includes("get_latest_news") ||
          /get_latest_news|新闻/.test(s.description))
    );
    if (!newsStep) return steps;
  }

  const maxId = Math.max(...steps.map((s) => s.id));

  const memoryStep: PlanStep = {
    id: maxId + 1,
    description:
      "根据新闻查询结果，调用 memory_store 写入一条 episodic 情景记忆。" +
      "内容应概括：用户查询的新闻类别（如科技、财经、体育等）、数量、时间（今天）。" +
      "tags 可含：新闻、资讯。",
    targetAgent: "generalAgent",
    expectedTools: ["memory_store"],
    dependsOn: [lastGeneral.id],
    inputMapping: {
      newsResult: `step_${lastGeneral.id}.output`,
    },
  };

  console.log(
    `[NewsMemoryPlan] Appended memory_store step ${memoryStep.id} after generalAgent news step ${lastGeneral.id}`
  );

  return [...steps, memoryStep];
}
