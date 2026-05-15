/**
 * 浏览器麦克风 → PCM 16k mono → WebSocket /api/asr/stream → 百炼流式识别
 *
 * v0.6 增强：
 * - 内置 VAD（基于 RMS 能量阈值）
 * - 检测到持续静音后自动触发 onSilenceDetected 回调
 * - 上层组件可据此自动停止录音，无需手动点按
 */
export type AsrStreamCallbacks = {
  onPartial: (text: string, sentenceEnd: boolean) => void;
  onError: (message: string) => void;
  onDone: () => void;
  /**
   * VAD 检测到「语音 → 持续静音」转换时触发
   * 上层可据此调用 stop() 自动结束录音
   */
  onSilenceDetected?: () => void;
  /**
   * VAD 状态变化回调（可用于 UI 显示「正在说话/静音中」）
   */
  onSpeechStateChange?: (isSpeaking: boolean) => void;
};

/** VAD 配置 */
export type VadOptions = {
  /** 是否启用 VAD（默认 true） */
  enabled?: boolean;
  /** RMS 能量阈值，超过即视为语音（默认 0.015） */
  energyThreshold?: number;
  /** 触发自动停止所需的持续静音时长，单位 ms（默认 1500） */
  silenceMs?: number;
  /** 至少要先检测到一次语音后再判静音，避免开局误判（默认 true） */
  requireSpeechFirst?: boolean;
  /** 录音最大时长，单位 ms（默认 30000，即 30 秒，超时强制停止） */
  maxRecordingMs?: number;
};

const DEFAULT_VAD: Required<VadOptions> = {
  enabled: true,
  energyThreshold: 0.015,
  silenceMs: 1500,
  requireSpeechFirst: true,
  maxRecordingMs: 30000,
};

function downsampleFloat32(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

function floatTo16BitPCM(float32: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** 计算 PCM 帧的 RMS（均方根能量），返回 0~1 范围 */
function computeRms(input: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < input.length; i++) {
    sumSq += input[i] * input[i];
  }
  return Math.sqrt(sumSq / input.length);
}

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/asr/stream`;
}

export class RealtimeAsrSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly callbacks: AsrStreamCallbacks;
  private readonly vadOptions: Required<VadOptions>;

  // VAD 状态
  private isSpeaking = false;
  private hasDetectedSpeech = false;
  private lastSpeechAt = 0;
  private silenceCheckTimer: number | null = null;
  private maxRecordingTimer: number | null = null;
  private silenceTriggered = false;
  private startedAt = 0;

  constructor(callbacks: AsrStreamCallbacks, vadOptions: VadOptions = {}) {
    this.callbacks = callbacks;
    this.vadOptions = { ...DEFAULT_VAD, ...vadOptions };
  }

  async start(): Promise<void> {
    if (this.ws) {
      await this.stop();
    }

    // 重置 VAD 状态
    this.isSpeaking = false;
    this.hasDetectedSpeech = false;
    this.lastSpeechAt = 0;
    this.silenceTriggered = false;
    this.startedAt = Date.now();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.mediaStream = stream;

    const audioContext = new AudioContext();
    await audioContext.resume();
    this.audioContext = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    this.source = source;
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(audioContext.destination);

    const ws = new WebSocket(getWsUrl());
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => {
        reject(new Error("WebSocket 连接超时"));
      }, 15000);
      ws.onopen = () => {
        window.clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(t);
        reject(new Error("无法连接语音识别服务"));
      };
    });

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          text?: string;
          sentenceEnd?: boolean;
          message?: string;
        };
        if (msg.type === "ready") {
          source.connect(processor);
          return;
        }
        if (msg.type === "asr" && typeof msg.text === "string") {
          this.callbacks.onPartial(msg.text, msg.sentenceEnd === true);
          return;
        }
        if (msg.type === "error") {
          this.callbacks.onError(msg.message || "识别失败");
          return;
        }
        if (msg.type === "done") {
          this.callbacks.onDone();
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      void this.cleanupAudioOnly();
    };

    processor.onaudioprocess = e => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      // ===== VAD 能量检测 =====
      if (this.vadOptions.enabled) {
        this.processVad(input);
      }

      const down = downsampleFloat32(input, audioContext.sampleRate, 16000);
      const pcm = floatTo16BitPCM(down);
      ws.send(pcm.buffer);
    };

    // 启动周期性静音检查（每 200ms 检查一次）
    if (this.vadOptions.enabled) {
      this.silenceCheckTimer = window.setInterval(() => {
        this.checkSilence();
      }, 200);

      // 启动最大录音时长保护
      this.maxRecordingTimer = window.setTimeout(() => {
        if (!this.silenceTriggered && this.callbacks.onSilenceDetected) {
          this.silenceTriggered = true;
          this.callbacks.onSilenceDetected();
        }
      }, this.vadOptions.maxRecordingMs);
    }
  }

  /** 处理一帧音频，更新 VAD 状态 */
  private processVad(input: Float32Array): void {
    const rms = computeRms(input);
    const isSpeechFrame = rms > this.vadOptions.energyThreshold;

    if (isSpeechFrame) {
      this.lastSpeechAt = Date.now();
      if (!this.hasDetectedSpeech) {
        this.hasDetectedSpeech = true;
      }
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.callbacks.onSpeechStateChange?.(true);
      }
    } else {
      if (this.isSpeaking) {
        // 触发静音状态变更（但不立即停止录音，等 silenceMs 后再判定）
        this.isSpeaking = false;
        this.callbacks.onSpeechStateChange?.(false);
      }
    }
  }

  /** 周期性检查是否需要因静音自动停止 */
  private checkSilence(): void {
    if (this.silenceTriggered) return;
    if (!this.callbacks.onSilenceDetected) return;

    // 必须先检测到过语音
    if (this.vadOptions.requireSpeechFirst && !this.hasDetectedSpeech) {
      return;
    }

    // 还没检测到任何语音帧，跳过
    if (this.lastSpeechAt === 0) return;

    const silenceDuration = Date.now() - this.lastSpeechAt;
    if (silenceDuration >= this.vadOptions.silenceMs) {
      this.silenceTriggered = true;
      this.callbacks.onSilenceDetected();
    }
  }

  async stop(): Promise<void> {
    // 清除 VAD 定时器
    if (this.silenceCheckTimer !== null) {
      window.clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
    if (this.maxRecordingTimer !== null) {
      window.clearTimeout(this.maxRecordingTimer);
      this.maxRecordingTimer = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "end" }));
      } catch {
        /* noop */
      }
    }
    await this.cleanupAudioOnly();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async cleanupAudioOnly(): Promise<void> {
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        /* noop */
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* noop */
      }
      this.source = null;
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        /* noop */
      }
      this.audioContext = null;
    }
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) {
        t.stop();
      }
      this.mediaStream = null;
    }
  }
}

// ==================== 导出工具函数（用于测试） ====================

/** 导出供单元测试使用 */
export const __testing = {
  computeRms,
  downsampleFloat32,
  floatTo16BitPCM,
  DEFAULT_VAD,
};
