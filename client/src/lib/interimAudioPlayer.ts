/**
 * Interim Audio Player — 预合成过渡音频播放器
 *
 * 在用户发送消息后、Agent 完成执行前，根据意图分类域
 * 播放对应的女声过渡音频（如"好的，让我查查地图"），
 * 实现零延迟的语音反馈，提升用户体验。
 *
 * 特性：
 * - 按分类域随机选择过渡话术
 * - 支持预加载（页面加载时即缓存音频）
 * - 播放时通知 Live2D 口型动画
 * - 主结果返回时自动停止
 */

// ==================== AIRI 出场音效 ====================

/** AIRI 出场音效：首次登场时播放的中文问候语（独立于对话 TTS） */
export async function playAiriAppearance(
  /** 出场文案，可按需替换 */
  greetingText = "你好，有什么可以帮你",
  onStart?: () => void,
  onEnd?: () => void
): Promise<boolean> {
  if (isPlaying) {
    // 正在播放过渡音频，静默跳过
    return false;
  }
  try {
    const res = await fetch("http://127.0.0.1:8001/api/local-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: greetingText }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { audioBase64?: string };
    if (!data.audioBase64) return false;

    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const binary = atob(data.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const isWav =
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;

    let audioBuffer: AudioBuffer;
    if (isWav) {
      const wavBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
      audioBuffer = await ctx.decodeAudioData(wavBuffer.slice(0));
    } else {
      const fallbackSampleRate = 22050;
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
      audioBuffer = ctx.createBuffer(1, f32.length, fallbackSampleRate);
      audioBuffer.copyToChannel(f32, 0);
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    const durationMs = Math.max(0, audioBuffer.duration * 1000);
    onStart?.();

    await new Promise<void>((resolve, reject) => {
      src.onended = () => { onEnd?.(); resolve(); };
      try { src.start(); } catch (e) { reject(e); }
    });
    await ctx.close();
    console.log(`[AiriAppearance] 出场音效播放完成（${greetingText}，${Math.round(durationMs)}ms）`);
    return true;
  } catch (err) {
    console.warn("[AiriAppearance] 出场音效播放失败:", err);
    return false;
  }
}

// ==================== 分类域过渡音频 ====================

// 分类域 → 音频文件路径映射
const INTERIM_AUDIO_MAP: Record<string, string[]> = {
  navigation: [
    "/audio/interim/navigation_1.wav",
    "/audio/interim/navigation_2.wav",
    "/audio/interim/navigation_3.wav",
  ],
  multimedia: [
    "/audio/interim/multimedia_1.wav",
    "/audio/interim/multimedia_2.wav",
    "/audio/interim/multimedia_3.wav",
  ],
  file_system: [
    "/audio/interim/file_system_1.wav",
    "/audio/interim/file_system_2.wav",
    "/audio/interim/file_system_3.wav",
  ],
  office: [
    "/audio/interim/office_1.wav",
    "/audio/interim/office_2.wav",
    "/audio/interim/office_3.wav",
  ],
  service: [
    "/audio/interim/service_1.wav",
    "/audio/interim/service_2.wav",
    "/audio/interim/service_3.wav",
  ],
  general: [
    "/audio/interim/general_1.wav",
    "/audio/interim/general_2.wav",
    "/audio/interim/general_3.wav",
  ],
  cross_domain: [
    "/audio/interim/cross_domain_1.wav",
    "/audio/interim/cross_domain_2.wav",
    "/audio/interim/cross_domain_3.wav",
  ],
};

/**
 * 在真正的音频 buffer 前插入静音 buffer，实现前导静音效果。
 * @param ctx        AudioContext
 * @param audioBuf   原始音频 buffer
 * @param silenceSec 静音秒数
 */
function appendSilence(
  ctx: AudioContext,
  audioBuf: AudioBuffer,
  silenceSec: number
): AudioBuffer {
  const sampleRate = audioBuf.sampleRate;
  const silenceFrames = Math.round(sampleRate * silenceSec);
  const silenceBuf = ctx.createBuffer(
    audioBuf.numberOfChannels,
    audioBuf.length + silenceFrames,
    sampleRate
  );
  for (let c = 0; c < audioBuf.numberOfChannels; c++) {
    silenceBuf.copyToChannel(audioBuf.getChannelData(c), c);
  }
  return silenceBuf;
}

// ==================== 音频缓存 ====================

const audioCache = new Map<string, AudioBuffer>();
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isPlaying = false;

/** 前导静音秒数 */
const LEADING_SILENCE_SEC = 1;

/**
 * 获取或创建 AudioContext
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * 预加载所有过渡音频（建议在页面加载后调用）
 */
export async function preloadInterimAudio(): Promise<void> {
  const ctx = getAudioContext();
  const allPaths = Object.values(INTERIM_AUDIO_MAP).flat();

  const loadPromises = allPaths.map(async (path) => {
    if (audioCache.has(path)) return;
    try {
      const response = await fetch(path);
      if (!response.ok) return;
      const arrayBuffer = await response.arrayBuffer();
      const rawBuf = await ctx.decodeAudioData(arrayBuffer);
      const silentBuf = appendSilence(ctx, rawBuf, LEADING_SILENCE_SEC);
      audioCache.set(path, silentBuf);
    } catch (err) {
      console.warn(`[InterimAudio] Failed to preload: ${path}`, err);
    }
  });

  await Promise.allSettled(loadPromises);
  console.log(`[InterimAudio] Preloaded ${audioCache.size}/${allPaths.length} audio files`);
}

/**
 * 根据分类域播放过渡音频
 *
 * @param domain - 任务分类域（如 "navigation", "multimedia" 等）
 * @param onStart - 音频开始播放时的回调（可用于触发口型动画）
 * @param onEnd - 音频播放结束时的回调
 * @returns 是否成功开始播放
 */
export async function playInterimAudio(
  domain: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<boolean> {
  // 如果已经在播放，不重复触发
  if (isPlaying) return false;

  const files = INTERIM_AUDIO_MAP[domain] || INTERIM_AUDIO_MAP["general"];
  if (!files || files.length === 0) return false;

  // 随机选择一个音频
  const randomIndex = Math.floor(Math.random() * files.length);
  const audioPath = files[randomIndex];

  try {
    const ctx = getAudioContext();

    // 确保 AudioContext 是 running 状态
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    // 如果缓存中已有原始音频，先补上静音再复用；未缓存的走下面的实时加载分支
    let silentBuf = audioCache.get(audioPath);
    if (!silentBuf) {
      const response = await fetch(audioPath);
      if (!response.ok) return false;
      const arrayBuffer = await response.arrayBuffer();
      const rawBuf = await ctx.decodeAudioData(arrayBuffer);
      silentBuf = appendSilence(ctx, rawBuf, LEADING_SILENCE_SEC);
      audioCache.set(audioPath, silentBuf);
    }

    // 创建音频源并播放
    const source = ctx.createBufferSource();
    source.buffer = silentBuf;
    source.connect(ctx.destination);

    source.onended = () => {
      isPlaying = false;
      currentSource = null;
      onEnd?.();
    };

    const now = ctx.currentTime;
    source.start(now);
    currentSource = source;
    isPlaying = true;
    onStart?.();

    return true;
  } catch (err) {
    console.error("[InterimAudio] Play failed:", err);
    return false;
  }
}

/**
 * 停止当前正在播放的过渡音频
 *
 * 当主结果（final 事件）返回时调用，确保过渡音频不会与正式回复重叠。
 */
export function stopInterimAudio(): void {
  if (currentSource && isPlaying) {
    try {
      currentSource.stop();
    } catch {
      // 可能已经结束
    }
    currentSource = null;
    isPlaying = false;
  }
}

/**
 * 当前是否正在播放过渡音频
 */
export function isInterimAudioPlaying(): boolean {
  return isPlaying;
}
