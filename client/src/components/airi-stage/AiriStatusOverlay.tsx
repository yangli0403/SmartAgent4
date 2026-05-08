import { getAiriStatusPreset, type AiriStatusKey, type AiriStatusPreset } from "@/lib/airi-stage/statusPresets";
import { useStageStore } from "@/lib/airi-stage/useStageStore";

interface AiriStatusOverlayProps {
  className?: string;
}

const colorTone: Record<AiriStatusPreset["color"], {
  shell: string;
  badge: string;
  glow: string;
  dot: string;
  bar: string;
}> = {
  sky: {
    shell: "border-sky-300/30 bg-sky-400/10 text-sky-50",
    badge: "border-sky-300/35 bg-sky-400/15 text-sky-100",
    glow: "shadow-[0_0_34px_rgba(56,189,248,0.24)]",
    dot: "bg-sky-300",
    bar: "from-sky-300 via-cyan-200 to-sky-300",
  },
  slate: {
    shell: "border-white/15 bg-white/[0.07] text-white/80",
    badge: "border-white/15 bg-white/10 text-white/70",
    glow: "shadow-[0_0_28px_rgba(148,163,184,0.18)]",
    dot: "bg-slate-200",
    bar: "from-slate-300 via-white to-slate-300",
  },
  blue: {
    shell: "border-cyan-300/35 bg-cyan-400/12 text-cyan-50",
    badge: "border-cyan-300/35 bg-cyan-400/16 text-cyan-100",
    glow: "shadow-[0_0_36px_rgba(34,211,238,0.28)]",
    dot: "bg-cyan-300",
    bar: "from-cyan-300 via-blue-200 to-cyan-300",
  },
  purple: {
    shell: "border-violet-300/35 bg-violet-400/12 text-violet-50",
    badge: "border-violet-300/35 bg-violet-400/16 text-violet-100",
    glow: "shadow-[0_0_36px_rgba(167,139,250,0.28)]",
    dot: "bg-violet-300",
    bar: "from-violet-300 via-fuchsia-200 to-violet-300",
  },
  orange: {
    shell: "border-orange-300/40 bg-orange-400/14 text-orange-50",
    badge: "border-orange-300/40 bg-orange-400/18 text-orange-100",
    glow: "shadow-[0_0_38px_rgba(251,146,60,0.3)]",
    dot: "bg-orange-300",
    bar: "from-orange-300 via-amber-200 to-orange-300",
  },
  green: {
    shell: "border-emerald-300/35 bg-emerald-400/12 text-emerald-50",
    badge: "border-emerald-300/35 bg-emerald-400/16 text-emerald-100",
    glow: "shadow-[0_0_36px_rgba(52,211,153,0.28)]",
    dot: "bg-emerald-300",
    bar: "from-emerald-300 via-lime-200 to-emerald-300",
  },
  emerald: {
    shell: "border-emerald-300/45 bg-emerald-400/16 text-emerald-50",
    badge: "border-emerald-300/45 bg-emerald-400/20 text-emerald-100",
    glow: "shadow-[0_0_40px_rgba(16,185,129,0.34)]",
    dot: "bg-emerald-200",
    bar: "from-emerald-200 via-teal-100 to-emerald-200",
  },
  red: {
    shell: "border-rose-300/45 bg-rose-400/16 text-rose-50",
    badge: "border-rose-300/45 bg-rose-400/20 text-rose-100",
    glow: "shadow-[0_0_40px_rgba(251,113,133,0.32)]",
    dot: "bg-rose-300",
    bar: "from-rose-300 via-red-200 to-rose-300",
  },
};

function formatValue(value: string | null | undefined, fallback = "未触发") {
  return value && value.trim().length > 0 ? value : fallback;
}

function resolveStatusKey(options: {
  modelLoaded: boolean;
  modelError: string | null;
  currentIdleState: AiriStatusKey;
  isSpeaking: boolean;
}): AiriStatusKey {
  if (options.modelError) return "error";
  if (!options.modelLoaded) return "loading";
  if (options.isSpeaking) return "speaking";
  return options.currentIdleState;
}

export function AiriStatusOverlay({ className = "" }: AiriStatusOverlayProps) {
  const isModelLoaded = useStageStore((state) => state.modelLoaded);
  const modelError = useStageStore((state) => state.modelError);
  const currentIdleState = useStageStore((state) => state.idle.currentState);
  const currentExpression = useStageStore((state) => state.expression.currentExpression);
  const currentMotion = useStageStore((state) => state.motion.currentMotion);
  const isSpeaking = useStageStore((state) => state.lipsync.isSpeaking);

  const statusKey = resolveStatusKey({
    modelLoaded: isModelLoaded,
    modelError,
    currentIdleState,
    isSpeaking,
  });
  const preset = getAiriStatusPreset(statusKey);
  const tone = colorTone[preset.color];
  const modelLabel = modelError ? "模型异常" : isModelLoaded ? "模型已加载" : "模型加载中";
  const visibleMotion = currentMotion ?? preset.motion;

  return (
    <div
      className={`absolute left-4 right-4 bottom-4 z-10 pointer-events-none ${className}`}
      aria-label="AIRI 状态反馈浮层"
    >
      <div className={`rounded-3xl border bg-slate-950/58 px-4 py-3 text-white backdrop-blur-xl ${tone.shell} ${tone.glow}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
              AIRI 状态
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.badge}`}>
              {modelLabel}
            </span>
          </div>
          <span className="text-[10px] font-medium text-white/45">8 状态强反馈</span>
        </div>

        <div className="flex gap-3">
          <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${tone.badge}`}>
            <span className={`absolute inline-flex h-9 w-9 animate-ping rounded-full opacity-30 ${tone.dot}`} />
            <span className="relative text-xl font-black leading-none">{preset.icon}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-bold leading-6 tracking-wide">{preset.label}</div>
                <div className="mt-0.5 truncate text-[12px] font-medium text-white/68">{preset.headline}</div>
              </div>
              <div className={`hidden rounded-2xl border px-3 py-2 text-right text-[11px] md:block ${tone.badge}`}>
                <div className="text-white/45">明显动作</div>
                <div className="mt-0.5 max-w-[150px] truncate font-semibold">{preset.motionLabel}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <div className={`rounded-xl border px-3 py-2 ${tone.badge}`}>
                <div className="text-white/45">当前表情</div>
                <div className="mt-0.5 truncate font-semibold">{formatValue(currentExpression, preset.expression)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-white/75">
                <div className="text-white/45">当前动作</div>
                <div className="mt-0.5 truncate font-semibold">{formatValue(visibleMotion)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-white/75">
                <div className="text-white/45">提示</div>
                <div className="mt-0.5 truncate font-semibold">{preset.description}</div>
              </div>
            </div>

            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full w-2/3 rounded-full bg-gradient-to-r ${tone.bar} ${statusKey !== "idle" ? "animate-pulse" : ""}`} />
            </div>
          </div>
        </div>

        {modelError ? (
          <div className="mt-3 truncate rounded-xl border border-rose-300/25 bg-rose-400/12 px-3 py-2 text-[11px] text-rose-100/90">
            {modelError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
