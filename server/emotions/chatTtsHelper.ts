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
  // 不再用 EMOTIONS_SYSTEM_ENABLED 短路最终回复 TTS。
  // 该开关只应控制本地 Emotions-System 微服务；云端 DashScope/CosyVoice
  // 只要配置了 DASHSCOPE_API_KEY，就应继续尝试合成，避免最终摘要语音被跳过。
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
