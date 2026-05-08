import { useStageStore } from "@/lib/airi-stage/useStageStore";

interface AiriStatusOverlayProps {
  className?: string;
}

const idleStateLabel: Record<string, string> = {
  idle: "空闲",
  thinking: "思考中",
  listening: "监听中",
};

const idleStateTone: Record<string, string> = {
  idle: "bg-white/10 text-white/70 border-white/15",
  thinking: "bg-amber-400/15 text-amber-100 border-amber-300/25",
  listening: "bg-cyan-400/15 text-cyan-100 border-cyan-300/25",
  speaking: "bg-emerald-400/15 text-emerald-100 border-emerald-300/25",
};

function formatValue(value: string | null | undefined, fallback = "未触发") {
  return value && value.trim().length > 0 ? value : fallback;
}

export function AiriStatusOverlay({ className = "" }: AiriStatusOverlayProps) {
  const isModelLoaded = useStageStore((state) => state.modelLoaded);
  const modelError = useStageStore((state) => state.modelError);
  const currentIdleState = useStageStore((state) => state.idle.currentState);
  const currentExpression = useStageStore((state) => state.expression.currentExpression);
  const currentMotion = useStageStore((state) => state.motion.currentMotion);
  const isSpeaking = useStageStore((state) => state.lipsync.isSpeaking);

  const statusKey = isSpeaking ? "speaking" : currentIdleState;
  const statusLabel = isSpeaking ? "说话中" : idleStateLabel[currentIdleState] ?? "空闲";
  const modelLabel = modelError ? "模型异常" : isModelLoaded ? "模型已加载" : "模型加载中";
  const modelTone = modelError
    ? "bg-rose-400/15 text-rose-100 border-rose-300/25"
    : isModelLoaded
      ? "bg-emerald-400/15 text-emerald-100 border-emerald-300/25"
      : "bg-sky-400/15 text-sky-100 border-sky-300/25";

  return (
    <div
      className={`absolute left-4 right-4 bottom-4 z-10 pointer-events-none ${className}`}
      aria-label="AIRI 状态反馈浮层"
    >
      <div className="rounded-2xl border border-white/15 bg-slate-950/45 px-4 py-3 text-white shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
            AIRI 状态
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${modelTone}`}>
            {modelLabel}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[12px]">
          <div className={`rounded-xl border px-3 py-2 ${idleStateTone[statusKey] ?? idleStateTone.idle}`}>
            <div className="text-[10px] text-white/45">当前状态</div>
            <div className="mt-0.5 font-semibold">{statusLabel}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-white/75">
            <div className="text-[10px] text-white/45">当前表情</div>
            <div className="mt-0.5 truncate font-semibold">{formatValue(currentExpression, "neutral")}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-white/75">
            <div className="text-[10px] text-white/45">当前动作</div>
            <div className="mt-0.5 truncate font-semibold">{formatValue(currentMotion)}</div>
          </div>
        </div>

        {modelError ? (
          <div className="mt-2 truncate rounded-lg border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100/85">
            {modelError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
