/**
 * OmniRealtimeClient — DashScope Omni 端到端语音 WebSocket 客户端
 *
 * 负责与 DashScope Omni API 建立 WebSocket 连接，
 * 实现端到端的语音输入→语音输出实时交互。
 *
 * 生命周期：
 * 1. fetchToken() → 从后端获取 DashScope API Key
 * 2. connect() → 建立 WebSocket 连接
 * 3. sendAudio() → 持续发送 PCM 音频帧
 * 4. onTranscript / onAudioOutput / onError → 接收回调
 * 5. disconnect() → 断开连接
 *
 * 隔离原则：
 * - Omni 模式完全独立于现有的 Supervisor 文本链路
 * - 不侵入 ASR → LLM → TTS 的已有流程
 */

// ==================== 类型定义 ====================

export interface OmniRealtimeCallbacks {
  /** 收到文本转写结果（用户语音 → 文字） */
  onTranscript?: (text: string, isFinal: boolean) => void;
  /** 收到 AI 回复文本 */
  onReplyText?: (text: string, isFinal: boolean) => void;
  /** 收到 AI 回复音频（PCM 16kHz 16bit mono） */
  onAudioOutput?: (audioData: ArrayBuffer) => void;
  /** 连接状态变化 */
  onStateChange?: (state: OmniConnectionState) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

export type OmniConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface OmniClientConfig {
  /** 后端 Token 端点 URL，默认 /api/omni/token */
  tokenEndpoint?: string;
  /** DashScope WebSocket URL */
  wsUrl?: string;
  /** 模型名称，默认 qwen-omni-turbo */
  model?: string;
  /** 自动重连次数，默认 3 */
  maxReconnectAttempts?: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<OmniClientConfig> = {
  tokenEndpoint: "/api/omni/token",
  wsUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
  model: "qwen-omni-turbo",
  maxReconnectAttempts: 3,
};

// ==================== 实现 ====================

export class OmniRealtimeClient {
  private config: Required<OmniClientConfig>;
  private callbacks: OmniRealtimeCallbacks;
  private ws: WebSocket | null = null;
  private state: OmniConnectionState = "disconnected";
  private token: string | null = null;
  private reconnectAttempts = 0;

  constructor(
    callbacks: OmniRealtimeCallbacks,
    config?: OmniClientConfig
  ) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取当前连接状态 */
  getState(): OmniConnectionState {
    return this.state;
  }

  /** 从后端获取 DashScope Token */
  async fetchToken(): Promise<string> {
    try {
      const res = await fetch(this.config.tokenEndpoint);
      const data = await res.json();

      if (!data.success || !data.token) {
        throw new Error(data.error || "Token 获取失败");
      }

      this.token = data.token;
      return data.token;
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error("Token 获取失败");
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  /** 建立 WebSocket 连接 */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    if (!this.token) {
      await this.fetchToken();
    }

    this.setState("connecting");

    return new Promise<void>((resolve, reject) => {
      try {
        const wsUrl = `${this.config.wsUrl}?token=${this.token}`;
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.setState("connected");

          // 发送初始化消息
          this.sendInitMessage();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onerror = (event) => {
          const err = new Error(
            `WebSocket 连接错误: ${(event as ErrorEvent).message || "unknown"}`
          );
          this.callbacks.onError?.(err);
          this.setState("error");
          reject(err);
        };

        this.ws.onclose = () => {
          if (this.state === "connected") {
            this.handleDisconnect();
          }
        };
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("WebSocket 连接失败");
        this.setState("error");
        reject(err);
      }
    });
  }

  /** 发送音频数据（PCM 16kHz 16bit mono） */
  sendAudio(audioData: ArrayBuffer): void {
    if (this.state !== "connected" || !this.ws) {
      return;
    }

    const message = {
      header: {
        streaming: "duplex",
        task_id: this.generateTaskId(),
        action: "continue",
      },
      payload: {
        input: {
          audio: {
            data: this.arrayBufferToBase64(audioData),
            sample_rate: 16000,
            format: "pcm",
          },
        },
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null; // 防止触发重连
      this.ws.close();
      this.ws = null;
    }
    this.token = null;
    this.reconnectAttempts = 0;
    this.setState("disconnected");
  }

  // ==================== 私有方法 ====================

  private setState(newState: OmniConnectionState): void {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  private sendInitMessage(): void {
    if (!this.ws) return;

    const initMessage = {
      header: {
        streaming: "duplex",
        task_id: this.generateTaskId(),
        action: "run-task",
      },
      payload: {
        model: this.config.model,
        task_group: "aigc",
        task: "realtime-dialog",
        function: "generation",
        input: {},
        parameters: {
          sample_rate: 16000,
          format: "pcm",
        },
      },
    };

    this.ws.send(JSON.stringify(initMessage));
  }

  private handleMessage(event: MessageEvent): void {
    // 二进制音频数据
    if (event.data instanceof ArrayBuffer) {
      this.callbacks.onAudioOutput?.(event.data);
      return;
    }

    // JSON 文本消息
    try {
      const data = JSON.parse(event.data as string);
      const output = data?.payload?.output;

      if (!output) return;

      // 用户语音转写
      if (output.text !== undefined && output.role === "user") {
        this.callbacks.onTranscript?.(
          output.text,
          output.finish_reason === "stop"
        );
      }

      // AI 回复文本
      if (output.text !== undefined && output.role === "assistant") {
        this.callbacks.onReplyText?.(
          output.text,
          output.finish_reason === "stop"
        );
      }

      // AI 回复音频
      if (output.audio?.data) {
        const audioBuffer = this.base64ToArrayBuffer(output.audio.data);
        this.callbacks.onAudioOutput?.(audioBuffer);
      }
    } catch {
      // 非 JSON 消息忽略
    }
  }

  private handleDisconnect(): void {
    this.setState("disconnected");

    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(
        1000 * Math.pow(2, this.reconnectAttempts - 1),
        10000
      );
      console.log(
        `[OmniClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
      );
      setTimeout(() => this.connect(), delay);
    }
  }

  private generateTaskId(): string {
    return `omni_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
