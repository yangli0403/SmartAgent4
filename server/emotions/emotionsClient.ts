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
import { getTtsMode } from "../voice/voiceMode";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_TTS_WS =
  process.env.DASHSCOPE_TTS_WS_URL ||
  "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

// ==================== 默认配置 ====================

const EMOTIONS_BASE_URL =
  process.env.EMOTIONS_SYSTEM_URL ||
  process.env.EMOTIONS_EXPRESS_URL ||
  "http://localhost:8000";

const EMOTIONS_ENABLED =
  (process.env.EMOTIONS_SYSTEM_ENABLED ??
    process.env.EMOTIONS_EXPRESS_ENABLED ??
    "true") !== "false";

const DEFAULT_CONFIG: EmotionsClientConfig = {
  baseUrl: EMOTIONS_BASE_URL,
  timeout: 30000,
  enabled: EMOTIONS_ENABLED,
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

/** 用于去重比较的 tags 稳定序列化 */
function stableTagKey(tags: ParsedEmotionTag): string {
  return Object.keys(tags)
    .sort()
    .map((k) => `${k}=${tags[k] ?? ""}`)
    .join("&");
}

/**
 * 解析器在部分多标签文案下会连续产出「同文案 + 同 tags」的重复段，导致同一段被 TTS 两次、播放器时长一致。
 * 仅合并**相邻且完全相同**的段，保留真实多段不同文案。
 */
export function dedupeConsecutiveParsedSegments(
  segments: Array<{ text: string; tags: ParsedEmotionTag }>
): Array<{ text: string; tags: ParsedEmotionTag }> {
  const out: Array<{ text: string; tags: ParsedEmotionTag }> = [];
  for (const seg of segments) {
    const t = seg.text.trim();
    if (!t) continue;
    const key = `${t}\x00${stableTagKey(seg.tags)}`;
    const prev = out[out.length - 1];
    if (prev) {
      const pk = `${prev.text.trim()}\x00${stableTagKey(prev.tags)}`;
      if (pk === key) continue;
    }
    out.push({ text: t, tags: { ...seg.tags } });
  }
  return out;
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

  const segmentsDeduped = dedupeConsecutiveParsedSegments(segments);
  const cleanText = segmentsDeduped.map((s) => s.text).join(" ");

  return { cleanText, tags: firstTags, segments: segmentsDeduped };
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

async function synthesizeLocalTts(text: string): Promise<TTSResponse | null> {
  const localTtsUrl =
    process.env.LOCAL_TTS_URL || "http://127.0.0.1:8001/api/local-tts";
  const response = await fetch(localTtsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`Local TTS HTTP ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    audioBase64?: string;
    format?: string;
  };
  if (!data.audioBase64) {
    return null;
  }
  return {
    audioBase64: data.audioBase64,
    format: data.format || "wav",
  };
}

// ==================== 客户端实现 ====================

export class EmotionsSystemClient {
  private config: EmotionsClientConfig;
  private _available: boolean | null = null;
  private _lastHealthCheck: number = 0;
  private readonly HEALTH_CHECK_INTERVAL = 60000;
  /** 最近一次 synthesize 全部重试失败时的错误信息（供 chat TTS 展示） */
  private _lastSynthesizeError: string | null = null;

  constructor(config?: Partial<EmotionsClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(
      `[EmotionsSystemClient] Initialized: ${this.config.enabled ? "enabled" : "disabled"}, url=${this.config.baseUrl}`
    );
  }

  /**
   * 检查云端 DashScope CosyVoice 是否可用（通过 API Key 存在性判断）
   */
  async isAvailable(): Promise<boolean> {
    return Boolean(DASHSCOPE_API_KEY.trim());
  }

  /** 供 chat 侧在无音频时展示上游（CosyVoice）错误摘要 */
  getLastSynthesizeError(): string | null {
    return this._lastSynthesizeError;
  }

  /**
   * 调用百炼 DashScope CosyVoice WebSocket TTS 合成语音
   * 文档：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse | null> {
    if (!DASHSCOPE_API_KEY) {
      throw new Error("DASHSCOPE_API_KEY is not configured");
    }

    const model = process.env.DASHSCOPE_TTS_MODEL || "cosyvoice-v3-flash";
    const voice = process.env.TTS_VOICE || process.env.DASHSCOPE_TTS_VOICE || "longanling_v3"; // 女声：龙安灵（思维灵动女）
    const sampleRate = parseInt(process.env.DASHSCOPE_TTS_SAMPLE_RATE || "22050", 10);
    const format = process.env.DASHSCOPE_TTS_FORMAT || "wav";
    const timeout = this.config.timeout;

    return new Promise((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      let finished = false;
      const timers: ReturnType<typeof setTimeout>[] = [];

      const cleanup = () => {
        timers.forEach(clearTimeout);
        timers.length = 0;
      };

      const done = (err?: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (err) {
          this._lastSynthesizeError = err.message;
        }
        if (ws) {
          try { ws.close(); } catch {}
          ws = null as unknown as WebSocket;
        }
        if (err) { reject(err); return; }
        if (audioChunks.length === 0) {
          reject(new Error("CosyVoice returned no audio data"));
          return;
        }
        const wavBuf = mergeMp3Chunks(audioChunks);
        const b64 = Buffer.from(wavBuf).toString("base64");
        resolve({ audioBase64: b64, format: "wav" });
      };

      let ws: WebSocket | null = new WebSocket(DASHSCOPE_TTS_WS, {
        headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
      });

      // 超时保护
      timers.push(setTimeout(() => done(new Error("CosyVoice WebSocket timeout")), timeout));

      ws.on("open", () => {
        const taskId = crypto.randomUUID();
        const runTask = {
          header: {
            action: "run-task",
            task_id: taskId,
            streaming: "duplex",
          },
          payload: {
            task_group: "audio",
            task: "tts",
            function: "SpeechSynthesizer",
            model,
            parameters: {
              text_type: "PlainText",
              voice,
              format,
              sample_rate: sampleRate,
              volume: 50,
              rate: 1,
              pitch: 1,
            },
            input: {},
          },
        };
        ws!.send(JSON.stringify(runTask));
      });

      ws.on("message", (data: unknown, isBinary: boolean) => {
        if (finished) return;
        try {
          if (isBinary) {
            // 跳过 WAV header（44字节），只收集 PCM 数据
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (buf.length > 44) {
              audioChunks.push(buf);
            }
          } else {
            const msg = JSON.parse(String(data));
            const action = msg.header?.action ?? msg.action;
            if (action === "task-started") {
              // 发送待合成文本
              const continueTask = {
                header: { action: "continue-task", task_id: msg.header.task_id },
                payload: { input: { text: request.text } },
              };
              ws!.send(JSON.stringify(continueTask));
              // 立即发送 finish-task
              const finishTask = {
                header: { action: "finish-task", task_id: msg.header.task_id },
                payload: { input: {} },
              };
              ws!.send(JSON.stringify(finishTask));
            } else if (action === "task-finished" || action === "finish-task") {
              done();
            } else if (action === "error" || msg.error) {
              done(new Error(msg.message || msg.error || "CosyVoice unknown error"));
            }
          }
        } catch (e) {
          // 忽略解析错误，继续等待
        }
      });

      ws.on("error", (err) => done(new Error(`CosyVoice WebSocket error: ${err.message}`)));
      ws.on("close", (code) => {
        if (!finished) done(new Error(`CosyVoice connection closed: code=${code}`));
      });
    });
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
    if (getTtsMode() === "local") {
      const { segments } = parseEmotionTags(text);
      const localSegments: MultimodalSegment[] = [];
      for (const segment of segments) {
        try {
          const tts = await synthesizeLocalTts(segment.text);
          if (!tts?.audioBase64) {
            throw new Error("Local TTS empty response");
          }
          localSegments.push({
            text: segment.text,
            audioBase64: tts?.audioBase64,
            audioFormat: tts?.format || "wav",
            emotion: this.normalizeEmotion(segment.tags.emotion),
            actions: [],
          });
        } catch (error) {
          console.warn(
            `[EmotionsSystemClient] Local TTS failed: ${(error as Error).message}. Fallback to cloud TTS.`
          );
          const cloudTts = await this.synthesize({
            text: segment.text,
            emotion: segment.tags.emotion,
            instruction: segment.tags.instruction,
          });
          localSegments.push({
            text: segment.text,
            audioBase64: cloudTts?.audioBase64 || undefined,
            audioFormat: cloudTts?.format || "wav",
            emotion: this.normalizeEmotion(segment.tags.emotion),
            actions: [],
          });
        }
      }
      return localSegments.length > 0
        ? localSegments
        : this.createFallbackSegments(text);
    }

    this._lastSynthesizeError = null;
    const available = await this.isAvailable();
    if (!available) {
      return this.createFallbackSegments(text);
    }

    const { segments } = parseEmotionTags(text);
    const results: MultimodalSegment[] = [];
    const gapMs = Math.max(
      0,
      parseInt(process.env.EMOTIONS_TTS_SEGMENT_GAP_MS || "120", 10) || 0
    );

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const emotion = this.normalizeEmotion(segment.tags.emotion);

      if (i > 0 && gapMs > 0) {
        await this.sleep(gapMs);
      }

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

// ==================== 音频格式转换 ====================

/**
 * CosyVoice WebSocket 返回的二进制帧可能是：
 * - WAV（全帧含 RIFF header）：每帧都是完整音频段，各自带 WAV header
 * - MP3（流式分片）：第一帧是完整 MP3，后续帧是 MP3 分片需拼接
 *
 * 当前使用 WAV 格式，每帧自含 WAV header。
 * 合并策略：第一帧保留完整 WAV，后续帧追加跳过 header 的 PCM 数据。
 */
function mergeMp3Chunks(chunks: Buffer[]): Buffer {
  if (chunks.length === 0) return Buffer.alloc(0);

  const WAV_HEADER_SIZE = 44;

  // 判断第一帧是否带 WAV RIFF header
  const first = chunks[0];
  const isWav = first.length >= 4 &&
    first[0] === 0x52 && first[1] === 0x49 && // "RIFF"
    first[8] === 0x57 && first[9] === 0x41;   // "WAVE"

  if (!isWav) {
    // MP3 或纯 PCM：直接拼接
    return Buffer.concat(chunks);
  }

  // WAV：取第一帧完整内容，后续帧去掉 header 后追加
  const parts: Buffer[] = [first];
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].length > WAV_HEADER_SIZE) {
      parts.push(chunks[i].slice(WAV_HEADER_SIZE));
    }
  }

  return Buffer.concat(parts);
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

// ==================== 兼容导出（旧命名） ====================

/**
 * 兼容 SmartAgent3 旧命名，避免现有调用方和测试中断。
 * 行为与 EmotionsSystemClient 完全一致。
 */
export { EmotionsSystemClient as EmotionsExpressClient };
export type IEmotionsExpressClient = EmotionsSystemClient;
