export type VoiceMode = "cloud" | "local";

let voiceMode: VoiceMode =
  process.env.VOICE_MODE === "local" ? "local" : "cloud";

// 独立 TTS 模式（由 voiceMode 演化而来，支持前端独立控制）
let ttsMode: VoiceMode =
  process.env.TTS_MODE === "local" ? "local" :
  process.env.VOICE_MODE === "local" ? "local" : "cloud";

export function getVoiceMode(): VoiceMode {
  return voiceMode;
}

export function setVoiceMode(mode: VoiceMode): VoiceMode {
  voiceMode = mode;
  // 同步 TTS 模式（向后兼容：旧前端只传单一 mode 时同步更新）
  ttsMode = mode;
  return voiceMode;
}

export function getTtsMode(): VoiceMode {
  return ttsMode;
}

export function setTtsMode(mode: VoiceMode): VoiceMode {
  ttsMode = mode;
  return ttsMode;
}
