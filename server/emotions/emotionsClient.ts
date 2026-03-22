/**
 * Emotions Express Client — 情感渲染客户端
 *
 * 与 Emotions-Express Python 微服务通信的 HTTP 客户端。
 * 支持同步渲染和流式渲染两种模式。
 *
 * 微服务端点（来源：Emotions-Express/main.py）：
 * - POST /api/parse  — 纯文本标签解析（不调用 LLM）
 * - POST /api/chat   — 单次对话渲染
 * - WS   /ws/chat    — 流式对话渲染
 */

import type {
  MultimodalSegment,
  EmotionsRenderRequest,
  EmotionsRenderResponse,
  EmotionsClientConfig,
  EmotionType,
  EmotionAction,
} from "./types";

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: EmotionsClientConfig = {
  baseUrl: process.env.EMOTIONS_EXPRESS_URL || "http://localhost:8000",
  timeout: 30000,
  enabled: process.env.EMOTIONS_EXPRESS_ENABLED !== "false",
  retryCount: 2,
  retryDelay: 1000,
};

// ==================== 接口定义 ====================

export interface IEmotionsExpressClient {
  /** 检查服务是否可用 */
  isAvailable(): Promise<boolean>;

  /** 渲染文本为多模态数据 */
  render(text: string, sessionId: string): Promise<MultimodalSegment[]>;

  /** 流式渲染文本为多模态数据 */
  renderStream(
    text: string,
    sessionId: string
  ): AsyncGenerator<MultimodalSegment, void, unknown>;

  /** 解析文本中的情感标签（不调用 LLM） */
  parseOnly(text: string): Promise<MultimodalSegment[]>;
}

// ==================== 实现 ====================

export class EmotionsExpressClient implements IEmotionsExpressClient {
  private config: EmotionsClientConfig;
  private _available: boolean | null = null;
  private _lastHealthCheck: number = 0;
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 分钟

  constructor(config?: Partial<EmotionsClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(
      `[EmotionsClient] Initialized: ${this.config.enabled ? "enabled" : "disabled"}, url=${this.config.baseUrl}`
    );
  }

  /**
   * 检查 Emotions-Express 服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    // 使用缓存的健康检查结果
    const now = Date.now();
    if (
      this._available !== null &&
      now - this._lastHealthCheck < this.HEALTH_CHECK_INTERVAL
    ) {
      return this._available;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this._available = response.ok;
      this._lastHealthCheck = now;

      console.log(
        `[EmotionsClient] Health check: ${this._available ? "OK" : "FAILED"}`
      );
      return this._available;
    } catch (error) {
      this._available = false;
      this._lastHealthCheck = now;
      console.warn(
        `[EmotionsClient] Health check failed: ${(error as Error).message}`
      );
      return false;
    }
  }

  /**
   * 渲染文本为多模态数据
   *
   * 调用 Emotions-Express 的 /api/chat 端点。
   * 如果服务不可用，返回仅包含纯文本的降级结果。
   */
  async render(
    text: string,
    sessionId: string
  ): Promise<MultimodalSegment[]> {
    // 检查服务可用性
    const available = await this.isAvailable();
    if (!available) {
      console.log(
        "[EmotionsClient] Service unavailable, returning text-only fallback"
      );
      return this.createFallbackSegments(text);
    }

    const request: EmotionsRenderRequest = { text, sessionId };

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(`${this.config.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return this.parseRenderResponse(data);
      } catch (error) {
        console.warn(
          `[EmotionsClient] Render attempt ${attempt + 1} failed: ${(error as Error).message}`
        );

        if (attempt < this.config.retryCount) {
          await this.sleep(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    // 所有重试失败，返回降级结果
    console.error("[EmotionsClient] All render attempts failed, using fallback");
    return this.createFallbackSegments(text);
  }

  /**
   * 流式渲染文本为多模态数据
   *
   * 通过 HTTP SSE 或轮询方式获取流式结果。
   * 如果服务不可用，yield 降级结果。
   */
  async *renderStream(
    text: string,
    sessionId: string
  ): AsyncGenerator<MultimodalSegment, void, unknown> {
    const available = await this.isAvailable();
    if (!available) {
      for (const segment of this.createFallbackSegments(text)) {
        yield segment;
      }
      return;
    }

    try {
      const request: EmotionsRenderRequest = { text, sessionId };

      const response = await fetch(
        `${this.config.baseUrl}/api/chat/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") return;

            try {
              const event: EmotionsRenderResponse = JSON.parse(jsonStr);
              if (event.type === "segment" && event.segment) {
                yield event.segment;
              } else if (event.type === "end") {
                return;
              } else if (event.type === "error") {
                console.error(
                  `[EmotionsClient] Stream error: ${event.message}`
                );
                return;
              }
            } catch {
              // 跳过无法解析的行
            }
          }
        }
      }
    } catch (error) {
      console.warn(
        `[EmotionsClient] Stream failed, using fallback: ${(error as Error).message}`
      );
      for (const segment of this.createFallbackSegments(text)) {
        yield segment;
      }
    }
  }

  /**
   * 解析文本中的情感标签（不调用 LLM）
   *
   * 调用 Emotions-Express 的 /api/parse 端点。
   */
  async parseOnly(text: string): Promise<MultimodalSegment[]> {
    const available = await this.isAvailable();
    if (!available) {
      return this.createFallbackSegments(text);
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.parseRenderResponse(data);
    } catch (error) {
      console.warn(
        `[EmotionsClient] Parse failed: ${(error as Error).message}`
      );
      return this.createFallbackSegments(text);
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 解析渲染响应数据
   */
  private parseRenderResponse(data: unknown): MultimodalSegment[] {
    if (Array.isArray(data)) {
      return data.map((item: any) => this.normalizeSegment(item));
    }

    if (data && typeof data === "object" && "segments" in data) {
      return ((data as any).segments || []).map((item: any) =>
        this.normalizeSegment(item)
      );
    }

    // 单个片段
    if (data && typeof data === "object" && "text" in data) {
      return [this.normalizeSegment(data as any)];
    }

    console.warn("[EmotionsClient] Unexpected response format:", data);
    return [];
  }

  /**
   * 标准化多模态片段
   */
  private normalizeSegment(raw: any): MultimodalSegment {
    return {
      text: raw.text || "",
      audioBase64: raw.audio_base64 || raw.audioBase64 || undefined,
      audioFormat: raw.audio_format || raw.audioFormat || "mp3",
      emotion: this.normalizeEmotion(raw.emotion),
      actions: this.normalizeActions(raw.actions || []),
    };
  }

  /**
   * 标准化情感类型
   */
  private normalizeEmotion(emotion: unknown): EmotionType {
    const validEmotions: EmotionType[] = [
      "neutral",
      "happy",
      "sad",
      "angry",
      "surprised",
      "fearful",
      "disgusted",
    ];
    if (typeof emotion === "string" && validEmotions.includes(emotion as EmotionType)) {
      return emotion as EmotionType;
    }
    return "neutral";
  }

  /**
   * 标准化动作列表
   */
  private normalizeActions(actions: unknown[]): EmotionAction[] {
    if (!Array.isArray(actions)) return [];

    return actions
      .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
      .map((a) => ({
        type: (a.type as EmotionAction["type"]) || "expression",
        value: String(a.value || ""),
        duration: typeof a.duration === "number" ? a.duration : undefined,
      }));
  }

  /**
   * 创建降级的纯文本片段
   *
   * 当 Emotions-Express 不可用时，去除标签并返回纯文本。
   */
  private createFallbackSegments(text: string): MultimodalSegment[] {
    // 去除 [tag:value] 标签
    const cleanText = text.replace(/\[(\w+):([^\]]+)\]/g, "").trim();

    return [
      {
        text: cleanText || text,
        audioFormat: "mp3",
        emotion: "neutral" as EmotionType,
        actions: [],
      },
    ];
  }

  /**
   * 延时工具
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ==================== 单例工厂 ====================

let _instance: EmotionsExpressClient | null = null;

/**
 * 获取 EmotionsExpressClient 单例
 */
export function getEmotionsClient(): EmotionsExpressClient {
  if (!_instance) {
    _instance = new EmotionsExpressClient();
  }
  return _instance;
}
