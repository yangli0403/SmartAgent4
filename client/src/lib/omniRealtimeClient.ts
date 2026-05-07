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
  /** 收到文本转写结果（用户语音 → 文字）—— 流式中间结果 */
  onTranscript?: (text: string, isFinal: boolean) => void;
  /** 收到 AI 回复文本 */
  onReplyText?: (text: string, isFinal: boolean) => void;
  /** 收到 AI 回复音频（PCM 16kHz 16bit mono） */
  onAudioOutput?: (audioData: ArrayBuffer) => void;
  /** 连接状态变化 */
  onStateChange?: (state: OmniConnectionState) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /**
   * 用户语音最终转写完成（当 DashScope 标记用户说完一句话时触发）
   * 用于自动触发后续的文本发送流程。
   * 传入的 text 已是最终确认的文本。
   */
  onFinalTranscript?: (text: string) => void;
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
  // 连接后端代理，后端再连接 DashScope（因为浏览器 WebSocket 无法设置 Authorization header）
  wsUrl: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/omni/ws`,
  tokenEndpoint: "/api/omni/token",
  model: "qwen3.5-omni-plus-realtime",
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
  private currentTaskId: string | null = null; // 保存当前的 task_id，用于音频流关联

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

  /** 建立 WebSocket 连接（通过后端代理，无需 Authorization header） */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.setState("connecting");

    return new Promise<void>((resolve, reject) => {
      try {
        // 后端代理地址（直接连接，无需认证）
        const wsUrl = `${this.config.wsUrl}?model=${encodeURIComponent(this.config.model)}`;
        console.log(`[OmniClient] Connecting to: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.setState("connected");
          console.log("[OmniClient] WebSocket connected successfully");
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
            // 通知外部关闭 Omni 模式（用户需要手动重新点击按钮）
            this.callbacks.onError?.(new Error("连接已断开，请重新点击 Omni 按钮"));
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

    // 使用初始化时的 task_id，保持音频流关联
    const taskId = this.currentTaskId || this.generateTaskId();

    const message = {
      header: {
        streaming: "duplex",
        task_id: taskId,
        action: "continue",
      },
      payload: {
        input: {
          audio: {
            data: this.arrayBufferToBase64(audioData),
            sample_rate: 24000,
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
    this.currentTaskId = null;
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

    // 生成并保存 task_id，后续音频流使用同一个 task_id
    this.currentTaskId = this.generateTaskId();

    const initMessage = {
      header: {
        streaming: "duplex",
        task_id: this.currentTaskId,
        action: "run-task",
      },
      payload: {
        model: this.config.model,
        task_group: "aigc",
        task: "realtime-dialog",
        function: "generation",
        input: {},
        parameters: {
          sample_rate: 24000,
          format: "pcm",
        },
      },
    };

    this.ws.send(JSON.stringify(initMessage));
    console.log(`[OmniClient] Init sent, task_id: ${this.currentTaskId}`);
  }

  private handleMessage(event: MessageEvent): void {
    // 二进制音频数据
    if (event.data instanceof ArrayBuffer) {
      console.log(`[OmniClient] Received audio data: ${event.data.byteLength} bytes`);
      this.callbacks.onAudioOutput?.(event.data);
      return;
    }

    // JSON 文本消息
    try {
      const data = JSON.parse(event.data as string);
      const output = data?.payload?.output;
      const custom = data?.payload?.custom;

      // 打印收到的完整消息便于调试
      console.log(`[OmniClient] Received message:`, JSON.stringify(data).substring(0, 500));

      if (!output && !custom) return;

      // 用户语音转写
      if (output?.text !== undefined && output?.role === "user") {
        console.log(`[OmniClient] Transcript: ${output.text}, finish_reason=${output.finish_reason}`);
        this.callbacks.onTranscript?.(
          output.text,
          output.finish_reason === "stop"
        );
        // 最终转写完成（用户说完一段话），通知外部自动发送
        if (output.finish_reason === "stop") {
          console.log(`[OmniClient] Final transcript confirmed: "${output.text}"`);
          this.callbacks.onFinalTranscript?.(output.text);
        }
      }

      // AI 回复文本
      if (output?.text !== undefined && output?.role === "assistant") {
        console.log(`[OmniClient] Reply text: ${output.text}`);
        this.callbacks.onReplyText?.(
          output.text,
          output.finish_reason === "stop"
        );
      }

      // AI 回复音频（从 output.audio 获取）
      if (output?.audio?.data) {
        console.log(`[OmniClient] Received audio from output.audio`);
        const audioBuffer = this.base64ToArrayBuffer(output.audio.data);
        this.callbacks.onAudioOutput?.(audioBuffer);
      }

      // DashScope Omni 可能通过 custom 字段返回音频
      if (custom?.audio_data) {
        console.log(`[OmniClient] Received audio from custom.audio_data`);
        const audioBuffer = this.base64ToArrayBuffer(custom.audio_data);
        this.callbacks.onAudioOutput?.(audioBuffer);
      }
    } catch {
      // 非 JSON 消息忽略
      console.log(`[OmniClient] Non-JSON message:`, event.data);
    }
  }

  private handleDisconnect(): void {
    this.setState("disconnected");
    // Omni 模式：DashScope 在发送欢迎音频后会关闭连接，
    // 这是正常行为，不需要自动重连。
    // 用户可以再次点击 Omni 按钮开始新的对话。
    console.log("[OmniClient] Connection closed (normal - DashScope sent welcome audio)");
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
