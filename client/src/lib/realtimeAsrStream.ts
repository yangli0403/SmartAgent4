/**
 * 浏览器麦克风 → PCM 16k mono → WebSocket /api/asr/stream → 百炼流式识别
 */
export type AsrStreamCallbacks = {
  onPartial: (text: string, sentenceEnd: boolean) => void;
  onError: (message: string) => void;
  onDone: () => void;
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

  constructor(callbacks: AsrStreamCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.ws) {
      await this.stop();
    }

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
      const down = downsampleFloat32(
        input,
        audioContext.sampleRate,
        16000
      );
      const pcm = floatTo16BitPCM(down);
      ws.send(pcm.buffer);
    };
  }

  async stop(): Promise<void> {
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
