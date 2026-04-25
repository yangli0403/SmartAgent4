/**
 * Supervisor 流式包装器（v0.5 引入）
 *
 * 设计意图：
 * - 不修改 LangGraph 节点内部代码（不动 classify / plan / execute / replan）
 * - 仅在外层用 `compiledGraph.stream()` 监听状态更新，并把"关键变化"映射为
 *   SupervisorEventEnvelope 事件发布到 supervisorEventBus。
 * - 测试侧通过 publishEventsFromUpdates() 纯函数即可验证状态机行为，
 *   不需要真实图执行。
 *
 * 监听字段（与 SupervisorState 匹配）：
 * - taskClassification → classified
 * - plan → plan_ready
 * - currentStepId 变化 → step_started（防抖：相同 id 只发一次）
 * - stepResults 长度增加 → step_finished
 * - replanCount 增加 → replan
 * - finalResponse 出现 → final
 *
 * 单一 ctx（每次 streaming 新建）跟踪上述"上次已发布到哪儿"。
 */
import {
  publishSupervisorEvent,
} from "./supervisorEventBus";

export interface StreamingContext {
  requestId: string;
  /** 上一次已发布到的 step_started id 集合 */
  startedStepIds?: Set<number>;
  /** 上一次 stepResults 数组长度 */
  lastStepResultLength?: number;
  /** 上一次 replanCount */
  lastReplanCount?: number;
  /** 是否已发布过 classified */
  classifiedPublished?: boolean;
  /** 是否已发布过 plan_ready */
  planPublished?: boolean;
  /** 是否已发布过 final */
  finalPublished?: boolean;
}

export interface StreamUpdate {
  taskClassification?: {
    domain: string;
    complexity: string;
    reasoning?: string;
  };
  plan?: Array<{
    id: number;
    description: string;
    targetAgent?: string;
    expectedTools?: string[];
  }>;
  currentStepId?: number;
  stepResults?: Array<{
    stepId: number;
    status: string;
    durationMs?: number;
    toolCalls?: Array<{ name?: string; argsPreview?: string }>;
    output?: unknown;
  }>;
  replanCount?: number;
  replanReason?: string;
  finalResponse?: string;
}

/**
 * 把一次 LangGraph stream update 映射为 0~N 条事件并发布。
 *
 * @returns 已发布事件数量（便于测试断言）
 */
export function publishEventsFromUpdates(
  update: StreamUpdate,
  ctx: StreamingContext
): number {
  let published = 0;

  // 1. classified
  if (update.taskClassification && !ctx.classifiedPublished) {
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "classified",
      phase: "classified",
      summary: `任务分类：${update.taskClassification.domain}·${update.taskClassification.complexity}`,
      payload: {
        domain: update.taskClassification.domain,
        complexity: update.taskClassification.complexity,
        reasoning: update.taskClassification.reasoning ?? "",
      },
    });
    ctx.classifiedPublished = true;
    published++;
  }

  // 2. plan_ready
  if (update.plan && update.plan.length > 0 && !ctx.planPublished) {
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "plan_ready",
      phase: "plan_ready",
      summary: `已生成 ${update.plan.length} 步执行计划`,
      payload: {
        steps: update.plan.map((s) => ({
          id: s.id,
          description: s.description,
          targetAgent: s.targetAgent ?? "",
          expectedTools: s.expectedTools ?? [],
        })),
      },
    });
    ctx.planPublished = true;
    published++;
  }

  // 3. step_started（防抖）
  if (typeof update.currentStepId === "number") {
    ctx.startedStepIds ??= new Set();
    if (!ctx.startedStepIds.has(update.currentStepId)) {
      ctx.startedStepIds.add(update.currentStepId);
      publishSupervisorEvent({
        requestId: ctx.requestId,
        type: "step_started",
        phase: "step_running",
        summary: `开始执行步骤 #${update.currentStepId}`,
        payload: { stepId: update.currentStepId },
      });
      published++;
    }
  }

  // 4. step_finished（按数组长度增量）
  if (Array.isArray(update.stepResults)) {
    const lastLen = ctx.lastStepResultLength ?? 0;
    const newLen = update.stepResults.length;
    if (newLen > lastLen) {
      for (let i = lastLen; i < newLen; i++) {
        const r = update.stepResults[i];
        publishSupervisorEvent({
          requestId: ctx.requestId,
          type: "step_finished",
          phase: "step_finished",
          summary: `步骤 #${r.stepId} ${r.status === "success" ? "完成" : r.status}`,
          payload: {
            stepId: r.stepId,
            status: r.status,
            durationMs: r.durationMs ?? 0,
            toolCalls: (r.toolCalls ?? []).map((t) => ({
              name: t.name ?? "",
              argsPreview: t.argsPreview,
            })),
          },
        });
        published++;
      }
      ctx.lastStepResultLength = newLen;
    }
  }

  // 5. replan
  if (typeof update.replanCount === "number") {
    const last = ctx.lastReplanCount ?? 0;
    if (update.replanCount > last) {
      publishSupervisorEvent({
        requestId: ctx.requestId,
        type: "replan",
        phase: "replan",
        summary: `重新规划：${update.replanReason ?? "未知原因"}`,
        payload: { reason: update.replanReason ?? "" },
      });
      ctx.lastReplanCount = update.replanCount;
      published++;
    } else {
      ctx.lastReplanCount = update.replanCount;
    }
  }

  // 6. final
  if (update.finalResponse && !ctx.finalPublished) {
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "final",
      phase: "completed",
      summary: `已生成最终回复：${update.finalResponse.slice(0, 30)}`,
      payload: { response: update.finalResponse },
    });
    ctx.finalPublished = true;
    published++;
  }

  return published;
}
