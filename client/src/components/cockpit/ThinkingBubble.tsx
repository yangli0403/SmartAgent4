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
  reflected: "反思入库",
  memory_extracted: "记忆提取",
  completed: "完成",
  error: "异常",
};

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
        <ul className="mt-2 space-y-1.5 border-l border-current/30 pl-3">
          {message.details.map((d, idx) => {
            const hints = expanded ? renderPayloadHints(d.phase, d.payload) : null;
            return (
              <li key={`${d.ts}-${idx}`} className="text-[11px] leading-snug">
                <span className="opacity-60 mr-1">
                  [{PHASE_LABEL[d.phase] ?? d.phase}]
                </span>
                <span>{d.summary}</span>
                {hints && (
                  <pre className="mt-0.5 ml-2 whitespace-pre-wrap font-sans text-[10px] opacity-75">
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
