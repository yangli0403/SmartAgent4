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
  /** 是否已发布过 memory_recalled */
  memoryRecalledPublished?: boolean;
  /** 是否已发布过 responding（开始生成最终回复） */
  respondingPublished?: boolean;
  /** responding 事件发出时刻，用于推算 LLM 生成耗时 */
  respondingStartedAt?: number;
  /** 是否已发布过 reflecting（开始反思入库） */
  reflectingPublished?: boolean;
  /** 是否已发布过 reflected */
  reflectedPublished?: boolean;
  /** 是否已发布过 memory_extracted */
  memoryExtractedPublished?: boolean;
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
  /** v0.6 观测字段：召回记忆元信息 */
  memoryRecallMeta?: {
    count: number;
    previews: string[];
    prefetchHit: boolean;
  };
  /** v0.6 观测字段：反思入库元信息 */
  reflectionMeta?: {
    toolLogsPersisted: number;
    llmReflectionTriggered: boolean;
  };
  /** v0.6 观测字段：记忆提取元信息 */
  memoryExtractionMeta?: {
    workingMemoryUpdated: boolean;
    behaviorDetectionTriggered: boolean;
    extractedCount: number;
  };
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
    const cls = update.taskClassification;
    const reasoningSnippet = cls.reasoning
      ? `（${cls.reasoning.length > 28 ? cls.reasoning.slice(0, 28) + "…" : cls.reasoning}）`
      : "";
    const isWeatherIntent = /\[rule:weather_intent\]|天气|气温|温度|预报/.test(
      cls.reasoning ?? ""
    );
    const displayDomain =
      cls.domain === "navigation" && isWeatherIntent ? "天气查询/出行服务" : cls.domain;
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "classified",
      phase: "classified",
      summary: `任务分类：${displayDomain}·${cls.complexity}${reasoningSnippet}`,
      payload: {
        domain: cls.domain,
        displayDomain,
        complexity: cls.complexity,
        reasoning: cls.reasoning ?? "",
      },
    });
    ctx.classifiedPublished = true;
    published++;
  }

  // 1.5 memory_recalled【v0.6 新增】
  if (update.memoryRecallMeta && !ctx.memoryRecalledPublished) {
    const m = update.memoryRecallMeta;
    const summary =
      m.count > 0
        ? `召回 ${m.count} 条相关记忆${m.prefetchHit ? "（预取命中）" : ""}`
        : `本轮未命中长期记忆${m.prefetchHit ? "（预取命中）" : ""}`;
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "memory_recalled",
      phase: "memory_recalled",
      summary,
      payload: {
        count: m.count,
        previews: m.previews,
        prefetchHit: m.prefetchHit,
      },
    });
    ctx.memoryRecalledPublished = true;
    published++;
  }

  // 2. plan_ready
  if (update.plan && update.plan.length > 0 && !ctx.planPublished) {
    const firstAgent = update.plan[0]?.targetAgent;
    const firstTools = update.plan[0]?.expectedTools ?? [];
    const agentSuffix = firstAgent
      ? `，首步 → ${firstAgent}${firstTools.length > 0 ? `·${firstTools.slice(0, 2).join(",")}` : ""}`
      : "";
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "plan_ready",
      phase: "plan_ready",
      summary: `已生成 ${update.plan.length} 步执行计划${agentSuffix}`,
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
        const toolNames = (r.toolCalls ?? [])
          .map((t) => t.name)
          .filter((n): n is string => Boolean(n));
        const statusLabel =
          r.status === "success" ? "完成" : `${r.status}`;
        const toolSuffix =
          toolNames.length > 0
            ? ` · 调用 ${toolNames.slice(0, 2).join(", ")}${toolNames.length > 2 ? "等" : ""}`
            : "";
        const durationSuffix =
          typeof r.durationMs === "number" && r.durationMs > 0
            ? ` · ${r.durationMs}ms`
            : "";
        publishSupervisorEvent({
          requestId: ctx.requestId,
          type: "step_finished",
          phase: "step_finished",
          summary: `步骤 #${r.stepId} ${statusLabel}${toolSuffix}${durationSuffix}`,
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

  // 5.2 responding（进入 respondNode：出现 finalResponse 且没有经过 reflection）
  // 实际上 respondNode 是在一次 LangGraph chunk 中返回 finalResponse 的，
  // 那个瞬间 LLM 生成已经完成；但我们在发布 final 之前仍可以先打一条
  // "responding"，让前端 “step_finished → 生成回复中 → 反思中 → 完成” 连贯不中断。
  if (
    update.finalResponse &&
    !ctx.respondingPublished &&
    !ctx.finalPublished
  ) {
    ctx.respondingStartedAt = Date.now();
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "responding",
      phase: "responding",
      summary: `正在生成回复·汇总所有步骤结果`,
      payload: { length: update.finalResponse.length },
    });
    ctx.respondingPublished = true;
    published++;
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

  // 5.4 reflecting（进入 reflectionNode、memoryExtractionNode 之前，但所有 step 已完）
  // LangGraph 节点为序列执行：respond → memoryExtract → reflection，
  // 在 finalResponse 出现后、reflectionMeta 未出现之前这段时间，正是“反思中”。
  if (
    update.finalResponse &&
    !ctx.reflectingPublished &&
    !update.reflectionMeta
  ) {
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "reflecting",
      phase: "reflecting",
      summary: `正在反思入库·记录工具效用与记忆`,
      payload: {},
    });
    ctx.reflectingPublished = true;
    published++;
  }

  // 5.5 reflected【v0.6 新增】
  if (update.reflectionMeta && !ctx.reflectedPublished) {
    const r = update.reflectionMeta;
    const summary =
      r.toolLogsPersisted > 0
        ? `反思入库：${r.toolLogsPersisted} 条工具效用日志${r.llmReflectionTriggered ? "，已触发 LLM 复盘" : ""}`
        : `无工具调用，跳过反思`;
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "reflected",
      phase: "reflected",
      summary,
      payload: {
        toolLogsPersisted: r.toolLogsPersisted,
        llmReflectionTriggered: r.llmReflectionTriggered,
      },
    });
    ctx.reflectedPublished = true;
    published++;
  }

  // 5.7 memory_extracted【v0.6 新增】
  if (update.memoryExtractionMeta && !ctx.memoryExtractedPublished) {
    const m = update.memoryExtractionMeta;
    const parts: string[] = [];
    if (m.workingMemoryUpdated) parts.push("工作记忆已更新");
    if (m.behaviorDetectionTriggered) parts.push("触发行为检测");
    if (m.extractedCount > 0) parts.push(`提取 ${m.extractedCount} 条新记忆`);
    publishSupervisorEvent({
      requestId: ctx.requestId,
      type: "memory_extracted",
      phase: "memory_extracted",
      summary: parts.length > 0 ? parts.join("、") : "记忆提取已调度",
      payload: {
        workingMemoryUpdated: m.workingMemoryUpdated,
        behaviorDetectionTriggered: m.behaviorDetectionTriggered,
        extractedCount: m.extractedCount,
      },
    });
    ctx.memoryExtractedPublished = true;
    published++;
  }

  // 6. final（优化：不再等待 reflection 完成，一旦拿到 finalResponse 立即发布，
  //    减少 1.5-3s 延迟。反思/记忆提取在后台异步完成，不阻塞用户感知。）
  if (
    update.finalResponse &&
    !ctx.finalPublished &&
    ctx.respondingPublished
  ) {
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
