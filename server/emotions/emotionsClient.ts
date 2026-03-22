/**
 * Emotions System Client — 情感语音合成客户端 (SmartAgent4)
 *
 * 重写自 SmartAgent3 的 EmotionsExpressClient，对接新的 Emotions-System 微服务。
 * 新微服务基于 Python，提供 /api/tts/synthesize 端点进行带情感的语音合成。
 *
 * 核心变更：
 * - 解析 LLM 输出中的复合情感标签 [emotion:happy|instruction:用欢快的语气]
 * - 通过 HTTP POST 调用 Emotions-System 的 TTS 接口
 * - 组装多模态响应（文本 + 音频 Base64）
 *
 * 来源：Emotions-System/services/tts_service.py, Emotions-System/main.py
 */

import type {
  MultimodalSegment,
  EmotionsClientConfig,
  EmotionType,
  EmotionAction,
} from "./types";

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: EmotionsClientConfig = {
  baseUrl: process.env.EMOTIONS_SYSTEM_URL || "http://localhost:8000",
  timeout: 30000,
  enabled: process.env.EMOTIONS_SYSTEM_ENABLED !== "false",
  retryCount: 2,
  retryDelay: 1000,
};

// ==================== 复合标签解析 ====================

/**
 * 复合情感标签的解析结果
 */
export interface ParsedEmotionTag {
  emotion?: string;
  instruction?: string;
  [key: string]: string | undefined;
}

/**
 * 解析文本中的复合情感标签
 *
 * 支持格式：
 * - [emotion:happy|instruction:用欢快的语气] 文本内容
 * - [emotion:sad] 文本内容
 * - 纯文本（无标签）
 *
 * @returns 解析后的纯文本和标签键值对
 */
export function parseEmotionTags(text: string): {
  cleanText: string;
  tags: ParsedEmotionTag;
  segments: Array<{ text: string; tags: ParsedEmotionTag }>;
} {
  const segments: Array<{ text: string; tags: ParsedEmotionTag }> = [];

  // 匹配 [key:value|key:value] 格式的标签
  const tagPattern = /\[([^\]]+)\]\s*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let firstTags: ParsedEmotionTag = {};

  while ((match = tagPattern.exec(text)) !== null) {
    // 标签前的纯文本
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index).trim();
      if (beforeText) {
        segments.push({ text: beforeText, tags: { ...firstTags } });
      }
    }

    // 解析标签内容
    const tagContent = match[1];
    const tags: ParsedEmotionTag = {};

    // 支持 key:value 和 key:value|key:value 格式
    const pairs = tagContent.split("|");
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(":");
      if (colonIdx > 0) {
        const key = pair.slice(0, colonIdx).trim().toLowerCase();
        const value = pair.slice(colonIdx + 1).trim();
        tags[key] = value;
      }
    }

    if (Object.keys(firstTags).length === 0) {
      firstTags = { ...tags };
    }

    // 找到标签后面的文本（直到下一个标签或文本结尾）
    lastIndex = tagPattern.lastIndex;
    const nextMatch = tagPattern.exec(text);
    const endIdx = nextMatch ? nextMatch.index : text.length;
    tagPattern.lastIndex = lastIndex; // 恢复位置

    const afterText = text.slice(lastIndex, endIdx).trim();
    if (afterText) {
      segments.push({ text: afterText, tags });
    }
  }

  // 没有匹配到任何标签
  if (segments.length === 0) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      segments.push({ text: remaining, tags: {} });
    }
  } else {
    // 处理最后一段无标签文本
    const remaining = text.slice(lastIndex).trim();
    if (remaining && !segments.some((s) => s.text === remaining)) {
      segments.push({ text: remaining, tags: firstTags });
    }
  }

  const cleanText = segments.map((s) => s.text).join(" ");

  return { cleanText, tags: firstTags, segments };
}

// ==================== TTS 请求/响应 ====================

export interface TTSRequest {
  text: string;
  emotion?: string;
  instruction?: string;
  voiceId?: string;
}

export interface TTSResponse {
  audioBase64: string;
  format: string;
}

// ==================== 客户端实现 ====================

export class EmotionsSystemClient {
  private config: EmotionsClientConfig;
  private _available: boolean | null = null;
  private _lastHealthCheck: number = 0;
  private readonly HEALTH_CHECK_INTERVAL = 60000;

  constructor(config?: Partial<EmotionsClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(
      `[EmotionsSystemClient] Initialized: ${this.config.enabled ? "enabled" : "disabled"}, url=${this.config.baseUrl}`
    );
  }

  /**
   * 检查 Emotions-System 服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false;

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
        `[EmotionsSystemClient] Health check: ${this._available ? "OK" : "FAILED"}`
      );
      return this._available;
    } catch (error) {
      this._available = false;
      this._lastHealthCheck = now;
      console.warn(
        `[EmotionsSystemClient] Health check failed: ${(error as Error).message}`
      );
      return false;
    }
  }

  /**
   * 调用 Emotions-System 的 TTS 接口合成语音
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse | null> {
    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(
          `${this.config.baseUrl}/api/tts/synthesize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: request.text,
              emotion: request.emotion || "neutral",
              instruction: request.instruction || "",
              voice_id: request.voiceId || "default",
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return {
          audioBase64: data.audio_base64 || data.audioBase64 || "",
          format: data.format || "wav",
        };
      } catch (error) {
        console.warn(
          `[EmotionsSystemClient] Synthesize attempt ${attempt + 1} failed: ${(error as Error).message}`
        );
        if (attempt < this.config.retryCount) {
          await this.sleep(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    return null;
  }

  /**
   * 渲染带情感标签的文本为多模态片段
   *
   * 主入口：解析标签 → 调用 TTS → 组装多模态响应
   */
  async render(
    text: string,
    _sessionId: string
  ): Promise<MultimodalSegment[]> {
    const available = await this.isAvailable();
    if (!available) {
      return this.createFallbackSegments(text);
    }

    const { segments } = parseEmotionTags(text);
    const results: MultimodalSegment[] = [];

    for (const segment of segments) {
      const emotion = this.normalizeEmotion(segment.tags.emotion);

      // 调用 TTS
      const ttsResult = await this.synthesize({
        text: segment.text,
        emotion: segment.tags.emotion,
        instruction: segment.tags.instruction,
      });

      results.push({
        text: segment.text,
        audioBase64: ttsResult?.audioBase64 || undefined,
        audioFormat: ttsResult?.format || "wav",
        emotion,
        actions: [],
      });
    }

    return results.length > 0 ? results : this.createFallbackSegments(text);
  }

  /**
   * 解析文本中的情感标签（不调用 TTS）
   */
  async parseOnly(text: string): Promise<MultimodalSegment[]> {
    const { segments } = parseEmotionTags(text);

    return segments.map((segment) => ({
      text: segment.text,
      audioFormat: "wav",
      emotion: this.normalizeEmotion(segment.tags.emotion),
      actions: [],
    }));
  }

  // ==================== 私有方法 ====================

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
    if (
      typeof emotion === "string" &&
      validEmotions.includes(emotion as EmotionType)
    ) {
      return emotion as EmotionType;
    }
    return "neutral";
  }

  private createFallbackSegments(text: string): MultimodalSegment[] {
    const { cleanText } = parseEmotionTags(text);
    return [
      {
        text: cleanText || text,
        audioFormat: "wav",
        emotion: "neutral" as EmotionType,
        actions: [],
      },
    ];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ==================== 单例工厂 ====================

let _instance: EmotionsSystemClient | null = null;

/**
 * 获取 EmotionsSystemClient 单例
 */
export function getEmotionsClient(): EmotionsSystemClient {
  if (!_instance) {
    _instance = new EmotionsSystemClient();
  }
  return _instance;
}
