/**
 * 助手回复下方的语音：懒加载「生成语音」或 Emotions TTS 播放条（base64 + <audio controls>）
 */

import type { ChatTtsPayload } from "@shared/chatTts";
import { AlertCircle, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function mimeForSegment(format: string): string {
  const f = format.toLowerCase();
  if (f === "mp3" || f === "mpeg") return "audio/mpeg";
  return "audio/wav";
}

export type TtsPlaybackProps = {
  tts?: ChatTtsPayload;
  /** 为 true 且无 tts 时展示「生成语音」按钮，不阻塞首包文字 */
  lazy?: boolean;
  onSynthesize?: () => void;
  isSynthesizing?: boolean;
};

function TtsPayloadView({ tts }: { tts: ChatTtsPayload }) {
  if (tts.status === "skipped") {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
        <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span>语音合成未开启</span>
      </div>
    );
  }

  if (tts.status === "failed") {
    return (
      <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-800/90">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span className="break-words">
          语音暂不可用
          {tts.reason ? ` · ${tts.reason.slice(0, 400)}` : ""}
        </span>
      </div>
    );
  }

  const withAudio = tts.segments.filter(
    (s) => s.audioBase64 && s.audioBase64.length >= 90
  );
  const dropped =
    tts.status === "ready" ? tts.segments.length - withAudio.length : 0;
  if (withAudio.length === 0) {
    return (
      <div className="mt-2 text-xs text-gray-400">本回复无可播放音频</div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
        <Volume2 className="h-3.5 w-3.5 shrink-0" />
        <span>语音就绪 · 点击下方播放</span>
      </div>
      {dropped > 0 && (
        <p className="text-[10px] text-muted-foreground">
          有 {dropped} 段合成结果异常或过短，已隐藏无效播放器
        </p>
      )}
      {withAudio.map((seg, i) => {
        const mime = mimeForSegment(seg.audioFormat || "wav");
        return (
          <div key={i} className="flex flex-col gap-0.5">
            {withAudio.length > 1 && (
              <span className="text-[10px] text-muted-foreground">
                段 {i + 1} · {seg.emotion}
              </span>
            )}
            <audio
              controls
              className="h-9 w-full max-w-full"
              preload="metadata"
              src={`data:${mime};base64,${seg.audioBase64}`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function TtsPlayback({
  tts,
  lazy,
  onSynthesize,
  isSynthesizing,
}: TtsPlaybackProps) {
  if (lazy && !tts) {
    return (
      <div className="mt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={onSynthesize}
          disabled={isSynthesizing || !onSynthesize}
        >
          {isSynthesizing ? "正在合成语音…" : "生成语音"}
        </Button>
      </div>
    );
  }

  if (!tts) return null;

  return <TtsPayloadView tts={tts} />;
}
