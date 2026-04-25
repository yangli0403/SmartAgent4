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
  plan_ready: "生成计划",
  step_running: "步骤执行",
  step_finished: "步骤完成",
  replan: "重新规划",
  completed: "完成",
  error: "异常",
};

export function ThinkingBubble({
  message,
  defaultExpanded = false,
}: ThinkingBubbleProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  const statusClass =
    message.status === "failed"
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

      {expanded && message.details && message.details.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-l border-current/30 pl-3">
          {message.details.map((d, idx) => (
            <li key={`${d.ts}-${idx}`} className="text-[11px] leading-snug">
              <span className="opacity-60 mr-1">
                [{PHASE_LABEL[d.phase] ?? d.phase}]
              </span>
              <span>{d.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
