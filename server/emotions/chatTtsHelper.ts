/**
 * 在 chat.sendMessage 完成后为助手回复生成 TTS，供前端播放与 AIRI Bridge 使用。
 */

import type { ChatTtsPayload } from "@shared/chatTts";
import type { MultimodalSegment } from "./types";
import { getEmotionsClient } from "./emotionsClient";

export async function synthesizeReplyTts(
  responseText: string,
  sessionKey: string
): Promise<{
  payload: ChatTtsPayload;
  /** 供 AIRI 映射；无合成时可为 undefined */
  multimodal?: MultimodalSegment[];
}> {
  if (process.env.EMOTIONS_SYSTEM_ENABLED === "false") {
    return {
      payload: { status: "skipped", reason: "disabled", segments: [] },
    };
  }

  try {
    const client = getEmotionsClient();
    const segments = await client.render(responseText, sessionKey);
    const hasAudio = segments.some((s) => s.audioBase64);
    const upstreamErr = client.getLastSynthesizeError();
    const payload: ChatTtsPayload = {
      status: hasAudio ? "ready" : "failed",
      reason: hasAudio
        ? undefined
        : upstreamErr
          ? `tts_synthesis_failed: ${upstreamErr.slice(0, 400)}`
          : (await client.isAvailable())
            ? "unavailable_or_no_audio"
            : "emotions_service_unreachable",
      segments: segments.map((s) => ({
        text: s.text,
        emotion: s.emotion,
        audioBase64: s.audioBase64,
        audioFormat: s.audioFormat,
      })),
    };
    return { payload, multimodal: segments };
  } catch (e) {
    return {
      payload: {
        status: "failed",
        reason: (e as Error).message,
        segments: [],
      },
    };
  }
}
