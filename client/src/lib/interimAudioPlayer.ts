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

// 音频缓存
const audioCache = new Map<string, AudioBuffer>();
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isPlaying = false;

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
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      audioCache.set(path, audioBuffer);
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

    // 尝试从缓存获取，否则实时加载
    let audioBuffer = audioCache.get(audioPath);
    if (!audioBuffer) {
      const response = await fetch(audioPath);
      if (!response.ok) return false;
      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      audioCache.set(audioPath, audioBuffer);
    }

    // 创建音频源并播放
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    source.onended = () => {
      isPlaying = false;
      currentSource = null;
      onEnd?.();
    };

    source.start(0);
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
