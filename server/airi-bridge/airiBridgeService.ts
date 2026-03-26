/**
 * AIRI Bridge Service — 核心桥接服务
 *
 * 管理 SmartAgent4 与 AIRI Server Runtime 之间的 WebSocket 连接。
 *
 * 职责：
 * 1. 作为 AIRI Plugin Module 连接 AIRI Server Runtime
 * 2. 监听 AIRI 的 input:text 和 input:text:voice 事件
 * 3. 将输入转发到 SmartAgent4 的 chat() 接口
 * 4. 将 SmartAgent4 的输出转换为 AIRI 的 output 事件
 * 5. 管理 Bridge 连接的生命周期
 */

import type {
  AiriBridgeConfig,
  AiriBridgeStatus,
  AiriBridgeStatusInfo,
  AiriBridgeInput,
  AiriBridgeInputCallback,
  AiriOutputMessage,
} from "./types";
import type { MultimodalSegment } from "../emotions/types";
import { loadAiriBridgeConfig } from "./config";
import { EmotionMapper } from "./emotionMapper";
import { AudioConverter } from "./audioConverter";

// ==================== WebSocket 事件类型（简化版 AIRI Plugin Protocol） ====================

/**
 * AIRI Plugin Protocol 事件结构（简化）
 *
 * 完整协议定义在 @proj-airi/plugin-protocol 中，
 * 此处仅定义 Bridge 需要的子集。
 */
interface AiriWebSocketEvent {
  type: string;
  data?: any;
  source?: {
    kind: string;
    plugin?: { id: string };
    id?: string;
  };
  id?: string;
}

// ==================== AiriBridgeService 类 ====================

/**
 * AIRI Bridge 服务
 *
 * 单例模式，管理与 AIRI Server Runtime 的 WebSocket 连接。
 */
export class AiriBridgeService {
  private config: AiriBridgeConfig;
  private emotionMapper: EmotionMapper;
  private status: AiriBridgeStatus = "disconnected";
  private ws: WebSocket | null = null;
  private lastConnectedAt?: string;
  private lastError?: string;
  private messageCount: number = 0;
  private inputCallbacks: Set<AiriBridgeInputCallback> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shouldClose: boolean = false;

  /** 模块标识（AIRI Plugin Protocol 要求） */
  private readonly moduleIdentity = {
    kind: "plugin" as const,
    plugin: { id: "smartagent4-bridge" },
    id: `sa4-${Date.now().toString(36)}`,
  };

  constructor(config?: Partial<AiriBridgeConfig>) {
    this.config = loadAiriBridgeConfig(config);
    this.emotionMapper = new EmotionMapper();
    console.log("[AiriBridge] Service created");
  }

  // ==================== 生命周期 ====================

  /**
   * 初始化 Bridge 服务
   *
   * 如果 autoConnect 为 true，自动建立连接。
   */
  async initialize(): Promise<void> {
    console.log("[AiriBridge] Initializing...");

    if (this.config.autoConnect) {
      try {
        await this.connect();
      } catch (error) {
        console.warn(
          `[AiriBridge] Auto-connect failed: ${(error as Error).message}`
        );
        // 自动连接失败不阻塞初始化
      }
    }

    console.log("[AiriBridge] Initialization complete");
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): AiriBridgeStatusInfo {
    return {
      status: this.status,
      serverUrl: this.config.airiServerUrl,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      messageCount: this.messageCount,
      activeCharacterId: this.config.defaultCharacterId,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): AiriBridgeConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<AiriBridgeConfig>): AiriBridgeConfig {
    this.config = { ...this.config, ...updates };
    console.log("[AiriBridge] Config updated");
    return { ...this.config };
  }

  // ==================== 连接管理 ====================

  /**
   * 连接到 AIRI Server Runtime
   */
  async connect(): Promise<void> {
    if (this.status === "ready") {
      console.log("[AiriBridge] Already connected");
      return;
    }

    this.shouldClose = false;
    this.setStatus("connecting");

    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(this.config.airiServerUrl);
        this.ws = ws;

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout (10s)"));
        }, 10000);

        ws.onopen = () => {
          clearTimeout(timeout);
          console.log("[AiriBridge] WebSocket connected");
          this.reconnectAttempts = 0;

          // 发送认证（如果有 Token）
          if (this.config.airiToken) {
            this.setStatus("authenticating");
            this.sendEvent({
              type: "auth:authenticate",
              data: { token: this.config.airiToken },
            });
          }

          // 发送模块注册
          this.setStatus("announcing");
          this.sendEvent({
            type: "module:announce",
            data: {
              name: "SmartAgent4 Bridge",
              possibleEvents: [
                "output:gen-ai:chat:message",
                "output:gen-ai:chat:complete",
              ],
              identity: this.moduleIdentity,
            },
          });

          // 标记就绪
          this.setStatus("ready");
          this.lastConnectedAt = new Date().toISOString();
          this.startHeartbeat();
          resolve();
        };

        ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event);
        };

        ws.onerror = (event: Event) => {
          clearTimeout(timeout);
          const errorMsg = "WebSocket error";
          this.lastError = errorMsg;
          console.error(`[AiriBridge] ${errorMsg}`);
          reject(new Error(errorMsg));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          this.stopHeartbeat();

          if (!this.shouldClose && this.config.autoReconnect) {
            this.scheduleReconnect();
          } else {
            this.setStatus("disconnected");
          }
        };
      } catch (error) {
        this.lastError = (error as Error).message;
        this.setStatus("failed");
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log("[AiriBridge] Disconnecting...");
    this.shouldClose = true;
    this.stopHeartbeat();
    this.cancelReconnect();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus("disconnected");
  }

  // ==================== 消息发送 ====================

  /**
   * 发送 AI 回复到 AIRI
   *
   * @param response - SmartAgent4 的回复文本
   * @param segments - 多模态片段（可选）
   * @param sessionId - 会话 ID
   */
  async sendResponse(
    response: string,
    segments?: MultimodalSegment[],
    sessionId?: string
  ): Promise<void> {
    if (this.status !== "ready" || !this.ws) {
      console.warn("[AiriBridge] Cannot send: not connected");
      return;
    }

    let airiMessage: AiriOutputMessage;

    if (segments && segments.length > 0) {
      // 有多模态数据，使用完整映射
      airiMessage = this.emotionMapper.mapSegmentsToAiriMessage(segments);
    } else {
      // 降级模式：从文本中解析情感标签
      airiMessage = this.emotionMapper.mapTextToAiriMessage(response);
    }

    // 发送 output:gen-ai:chat:message 事件
    this.sendEvent({
      type: "output:gen-ai:chat:message",
      data: airiMessage,
    });

    // 发送 output:gen-ai:chat:complete 事件
    this.sendEvent({
      type: "output:gen-ai:chat:complete",
      data: {
        ...airiMessage,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    });

    this.messageCount++;
    console.log(
      `[AiriBridge] Sent response #${this.messageCount} (${segments?.length || 0} segments)`
    );
  }

  // ==================== 事件监听 ====================

  /**
   * 注册输入事件回调
   *
   * @param callback - 当 AIRI 前端发送输入时调用
   * @returns 取消注册的函数
   */
  onInput(callback: AiriBridgeInputCallback): () => void {
    this.inputCallbacks.add(callback);
    return () => {
      this.inputCallbacks.delete(callback);
    };
  }

  // ==================== 关闭 ====================

  /**
   * 关闭 Bridge 服务
   */
  async shutdown(): Promise<void> {
    console.log("[AiriBridge] Shutting down...");
    this.disconnect();
    this.inputCallbacks.clear();
    console.log("[AiriBridge] Shutdown complete");
  }

  // ==================== 内部方法 ====================

  /**
   * 处理收到的 WebSocket 消息
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;

      const eventType = data?.type;
      if (!eventType) return;

      switch (eventType) {
        case "input:text":
          this.handleTextInput(data);
          break;

        case "input:text:voice":
          this.handleVoiceTextInput(data);
          break;

        case "input:voice":
          // 原始语音输入暂不处理（需要 ASR）
          console.log("[AiriBridge] Raw voice input received, skipping");
          break;

        case "auth:authenticated":
          console.log("[AiriBridge] Authentication successful");
          break;

        case "module:announced":
          console.log("[AiriBridge] Module announced successfully");
          break;

        case "heartbeat:pong":
          // 心跳响应
          break;

        default:
          // 忽略其他事件
          break;
      }
    } catch (error) {
      console.error(
        `[AiriBridge] Failed to parse message: ${(error as Error).message}`
      );
    }
  }

  /**
   * 处理文本输入事件
   */
  private handleTextInput(data: AiriWebSocketEvent): void {
    const text = data.data?.text;
    if (!text) return;

    const input: AiriBridgeInput = {
      type: "text",
      text,
      source: data.source?.kind,
    };

    console.log(`[AiriBridge] Text input: "${text.substring(0, 50)}..."`);
    this.notifyInputCallbacks(input);
  }

  /**
   * 处理语音转文本输入事件
   */
  private handleVoiceTextInput(data: AiriWebSocketEvent): void {
    const transcription = data.data?.transcription;
    if (!transcription) return;

    const input: AiriBridgeInput = {
      type: "text_voice",
      text: transcription,
      textRaw: data.data?.textRaw,
      source: data.source?.kind,
    };

    console.log(
      `[AiriBridge] Voice text input: "${transcription.substring(0, 50)}..."`
    );
    this.notifyInputCallbacks(input);
  }

  /**
   * 通知所有输入回调
   */
  private async notifyInputCallbacks(input: AiriBridgeInput): Promise<void> {
    for (const callback of this.inputCallbacks) {
      try {
        await callback(input);
      } catch (error) {
        console.error(
          `[AiriBridge] Input callback error: ${(error as Error).message}`
        );
      }
    }
  }

  /**
   * 发送 WebSocket 事件
   */
  private sendEvent(event: AiriWebSocketEvent): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const payload = {
      ...event,
      source: this.moduleIdentity,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };

    this.ws.send(JSON.stringify(payload));
    return true;
  }

  /**
   * 设置连接状态
   */
  private setStatus(status: AiriBridgeStatus): void {
    const previous = this.status;
    this.status = status;
    if (previous !== status) {
      console.log(`[AiriBridge] Status: ${previous} → ${status}`);
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendEvent({ type: "heartbeat:ping" });
    }, 15000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.shouldClose) return;

    const maxAttempts = this.config.maxReconnectAttempts;
    if (maxAttempts !== -1 && this.reconnectAttempts >= maxAttempts) {
      console.log("[AiriBridge] Max reconnect attempts reached");
      this.setStatus("failed");
      return;
    }

    this.setStatus("reconnecting");
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(
      `[AiriBridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() 内部会处理重连
      }
    }, delay);
  }

  /**
   * 取消重连
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
