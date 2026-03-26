/**
 * Audio Converter — 音频格式转换器
 *
 * 将 SmartAgent4 Emotions-System 输出的 Base64 音频
 * 转换为标准化的 AudioPacket 格式。
 *
 * 支持的输入格式：WAV, MP3
 * 输出格式：AudioPacket（含元数据）
 */

import type { AudioPacket } from "./types";

// ==================== WAV 头部常量 ====================

/** WAV 文件头部大小（字节） */
const WAV_HEADER_SIZE = 44;

/** WAV RIFF 标识 */
const RIFF_MAGIC = "RIFF";

/** WAV 格式标识 */
const WAVE_MAGIC = "WAVE";

// ==================== AudioConverter 类 ====================

/**
 * 音频格式转换器
 *
 * 提供 Base64 音频数据的解析、验证和转换功能。
 */
export class AudioConverter {
  /**
   * 将 Base64 音频数据转换为 AudioPacket
   *
   * @param audioBase64 - Base64 编码的音频
   * @param format - 源音频格式（"wav", "mp3" 等）
   * @returns 标准化的音频数据包
   */
  static toAudioPacket(audioBase64: string, format: string): AudioPacket {
    const normalizedFormat = AudioConverter.normalizeFormat(format);
    const packet: AudioPacket = {
      audioBase64,
      format: normalizedFormat,
    };

    // 尝试从 WAV 头部提取元数据
    if (normalizedFormat === "wav") {
      try {
        const metadata = AudioConverter.parseWavHeader(audioBase64);
        packet.sampleRate = metadata.sampleRate;
        packet.channels = metadata.channels;
        packet.durationMs = metadata.durationMs;
      } catch {
        // WAV 头部解析失败，使用估算值
        packet.durationMs = AudioConverter.estimateDuration(
          audioBase64,
          normalizedFormat
        );
      }
    } else {
      packet.durationMs = AudioConverter.estimateDuration(
        audioBase64,
        normalizedFormat
      );
    }

    return packet;
  }

  /**
   * 估算音频时长
   *
   * @param audioBase64 - Base64 编码的音频
   * @param format - 音频格式
   * @returns 估算时长（毫秒）
   */
  static estimateDuration(audioBase64: string, format: string): number {
    // Base64 编码后大小约为原始数据的 4/3
    const rawBytes = Math.floor((audioBase64.length * 3) / 4);

    switch (AudioConverter.normalizeFormat(format)) {
      case "wav":
        // 假设 16-bit, 24kHz, mono（Emotions-System 默认输出）
        // 每秒字节数 = 24000 * 2 * 1 = 48000
        return Math.floor(((rawBytes - WAV_HEADER_SIZE) / 48000) * 1000);

      case "mp3":
        // 假设 128kbps
        // 每秒字节数 = 128000 / 8 = 16000
        return Math.floor((rawBytes / 16000) * 1000);

      default:
        // PCM: 假设 16-bit, 16kHz, mono
        return Math.floor((rawBytes / 32000) * 1000);
    }
  }

  /**
   * 验证音频数据有效性
   *
   * @param audioBase64 - Base64 编码的音频
   * @returns 是否有效
   */
  static validate(audioBase64: string): boolean {
    if (!audioBase64 || audioBase64.length === 0) {
      return false;
    }

    // 检查 Base64 格式
    try {
      const decoded = Buffer.from(audioBase64, "base64");
      // 至少需要 WAV 头部大小的数据
      return decoded.length >= WAV_HEADER_SIZE;
    } catch {
      return false;
    }
  }

  /**
   * 解析 WAV 文件头部
   *
   * @param audioBase64 - Base64 编码的 WAV 音频
   * @returns WAV 元数据
   */
  static parseWavHeader(audioBase64: string): {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    durationMs: number;
  } {
    const buffer = Buffer.from(audioBase64, "base64");

    if (buffer.length < WAV_HEADER_SIZE) {
      throw new Error("Audio data too short for WAV header");
    }

    // 验证 RIFF 标识
    const riff = buffer.toString("ascii", 0, 4);
    if (riff !== RIFF_MAGIC) {
      throw new Error(`Invalid WAV: expected RIFF, got ${riff}`);
    }

    // 验证 WAVE 标识
    const wave = buffer.toString("ascii", 8, 12);
    if (wave !== WAVE_MAGIC) {
      throw new Error(`Invalid WAV: expected WAVE, got ${wave}`);
    }

    // 解析 fmt 块
    const channels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);

    // 计算时长
    const dataSize = buffer.readUInt32LE(40);
    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = dataSize / (channels * bytesPerSample);
    const durationMs = Math.floor((totalSamples / sampleRate) * 1000);

    return { sampleRate, channels, bitsPerSample, durationMs };
  }

  /**
   * 标准化音频格式名称
   */
  private static normalizeFormat(format: string): "wav" | "mp3" | "pcm" {
    const lower = format.toLowerCase().trim();
    switch (lower) {
      case "wav":
      case "wave":
      case "audio/wav":
        return "wav";
      case "mp3":
      case "audio/mp3":
      case "audio/mpeg":
        return "mp3";
      case "pcm":
      case "raw":
        return "pcm";
      default:
        console.warn(
          `[AudioConverter] Unknown format "${format}", defaulting to wav`
        );
        return "wav";
    }
  }
}
