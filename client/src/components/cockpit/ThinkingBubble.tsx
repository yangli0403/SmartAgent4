/**
 * ThinkingBubble（v0.5 引入）
 *
 * 在对话流中以"思考气泡"形式渲染 ChatUiThinkingMessage。
 * 三种 status：
 * - running：动画呼吸圆点 + "Metris Agent 思考中..."
 * - completed：勾号 + "Metris Agent 已完成思考"
 * - failed：感叹号 + "Metris Agent 思考失败"，背景偏红
 *
 * 详情默认折叠，点击展开后按时间轴显示 ChatThinkingDetail[]。
 */
import { useState } from "react";
import type { ChatUiThinkingMessage } from "@shared/chatTts";

interface ThinkingBubbleProps {
  message: ChatUiThinkingMessage;
  /** 默认是否展开详情（在 completed 状态下我们让它默认折叠，运行中也折叠避免遮挡） */
  defaultExpanded?: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  classified: "任务分类",
  memory_recalled: "召回记忆",
  plan_ready: "生成计划",
  step_running: "步骤执行",
  step_finished: "步骤完成",
  replan: "重新规划",
  responding: "生成回复",
  reflecting: "反思中",
  reflected: "反思入库",
  memory_extracted: "记忆提取",
  completed: "完成",
  error: "异常",
};

/**
 * 为每个 phase 返回一套醒目的胶囊样式（背景+文字+点的颜色）。
 * 视觉目标：让 [召回记忆] / [任务分类] / [生成计划] / [步骤完成] 等标签
 * 在灰色/浅色详情列表里一眼可辨。
 */
function getPhaseChipStyle(phase: string): {
  container: string;
  dot: string;
} {
  switch (phase) {
    case "memory_recalled":
      return {
        container:
          "bg-purple-100 text-purple-700 ring-1 ring-purple-200",
        dot: "bg-purple-500",
      };
    case "classified":
      return {
        container:
          "bg-sky-100 text-sky-700 ring-1 ring-sky-200",
        dot: "bg-sky-500",
      };
    case "plan_ready":
      return {
        container:
          "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200",
        dot: "bg-indigo-500",
      };
    case "step_running":
      return {
        container:
          "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
        dot: "bg-amber-500",
      };
    case "step_finished":
      return {
        container:
          "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
        dot: "bg-emerald-500",
      };
    case "replan":
      return {
        container:
          "bg-orange-100 text-orange-700 ring-1 ring-orange-200",
        dot: "bg-orange-500",
      };
    case "responding":
      return {
        container:
          "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300",
        // 在“生成回复中”这种过渡态加个脉冲动画，明确告知用户还在工作
        dot: "bg-yellow-500 animate-pulse",
      };
    case "reflecting":
      return {
        container:
          "bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200",
        dot: "bg-cyan-500 animate-pulse",
      };
    case "reflected":
    case "memory_extracted":
      return {
        container:
          "bg-teal-100 text-teal-700 ring-1 ring-teal-200",
        dot: "bg-teal-500",
      };
    case "completed":
      return {
        container:
          "bg-emerald-600 text-white ring-1 ring-emerald-700",
        dot: "bg-white",
      };
    case "error":
      return {
        container:
          "bg-red-100 text-red-700 ring-1 ring-red-200",
        dot: "bg-red-500",
      };
    default:
      return {
        container:
          "bg-slate-200 text-slate-700 ring-1 ring-slate-300",
        dot: "bg-slate-500",
      };
  }
}

/**
 * 以 payload 补充一句话摘要，让用户一眼看到"关键事实"
 * 理论上后端 summary 已经包含关键信息，这里只在某些 phase 需要"多行技术事实"时补充
 */
function renderPayloadHints(
  phase: string,
  payload: Record<string, unknown> | undefined
): string | null {
  if (!payload) return null;
  if (phase === "memory_recalled") {
    const previews = (payload.previews as string[] | undefined) ?? [];
    if (previews.length === 0) return null;
    return previews.map((p) => `・${p}`).join("\n");
  }
  if (phase === "plan_ready") {
    const steps = payload.steps as
      | Array<{ id: number; description: string; targetAgent: string; expectedTools: string[] }>
      | undefined;
    if (!steps || steps.length === 0) return null;
    return steps
      .slice(0, 3)
      .map(
        (s) =>
          `・#${s.id} ${s.description.length > 22 ? s.description.slice(0, 22) + "…" : s.description}` +
          (s.targetAgent ? ` → ${s.targetAgent}` : "") +
          (s.expectedTools && s.expectedTools.length > 0
            ? ` · ${s.expectedTools.slice(0, 2).join(",")}`
            : "")
      )
      .join("\n");
  }
  if (phase === "step_finished") {
    const toolCalls = (payload.toolCalls as Array<{ name?: string; argsPreview?: string }> | undefined) ?? [];
    if (toolCalls.length === 0) return null;
    return toolCalls
      .slice(0, 3)
      .map((t) => {
        const argsHint = t.argsPreview
          ? (t.argsPreview.length > 40 ? t.argsPreview.slice(0, 40) + "…" : t.argsPreview)
          : "";
        return `・${t.name ?? "unknown"}${argsHint ? `：${argsHint}` : ""}`;
      })
      .join("\n");
  }
  if (phase === "classified") {
    const reasoning = payload.reasoning as string | undefined;
    if (!reasoning) return null;
    return reasoning.length > 60 ? reasoning.slice(0, 60) + "…" : reasoning;
  }
  return null;
}

export function ThinkingBubble({
  message,
  defaultExpanded = false,
}: ThinkingBubbleProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  const statusClass =
    message.status === "error"
      ? "bg-red-50 border-red-200 text-red-700"
      : message.status === "completed"
        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
        : "bg-slate-50 border-slate-200 text-slate-700";

  const indicator =
    message.status === "running" ? (
      <span
        aria-label="thinking"
        className="inline-flex h-2 w-2 animate-pulse rounded-full bg-current"
      />
    ) : message.status === "completed" ? (
      <span className="text-emerald-600">✓</span>
    ) : (
      <span className="text-red-600">!</span>
    );

  return (
    <div
      data-thinking-status={message.status}
      className={`rounded-xl border px-3 py-2 text-xs ${statusClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {indicator}
          <span className="font-medium">{message.headline}</span>
        </div>
        {message.details && message.details.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] underline-offset-2 hover:underline"
            aria-label={expanded ? "收起" : "展开"}
          >
            {expanded ? "收起" : "查看详情"}
          </button>
        )}
      </div>

      {message.details && message.details.length > 0 && (
        <ul className="mt-2 space-y-2 border-l border-current/30 pl-3">
          {message.details.map((d, idx) => {
            const hints = expanded ? renderPayloadHints(d.phase, d.payload) : null;
            const chip = getPhaseChipStyle(d.phase);
            const label = PHASE_LABEL[d.phase] ?? d.phase;
            return (
              <li key={`${d.ts}-${idx}`} className="text-[11px] leading-snug">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap ${chip.container}`}
                  >
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${chip.dot}`} />
                    {label}
                  </span>
                  <span className="font-medium text-slate-800">{d.summary}</span>
                </div>
                {hints && (
                  <pre className="mt-1 ml-2 whitespace-pre-wrap font-sans text-[10px] text-slate-600/90 leading-relaxed">
                    {hints}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
