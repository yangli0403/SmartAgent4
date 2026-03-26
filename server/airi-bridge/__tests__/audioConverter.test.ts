/**
 * AudioConverter 单元测试
 *
 * 测试音频格式转换器的核心功能：
 * 1. Base64 音频验证
 * 2. WAV 头部解析
 * 3. 音频时长估算
 * 4. AudioPacket 转换
 */

import { AudioConverter } from "../audioConverter";

// ==================== 测试用 WAV 数据 ====================

/**
 * 最小有效 WAV 文件（44 字节头部 + 4 字节数据）
 * 格式：16-bit, 8000Hz, mono, 2 samples
 */
function createMinimalWavBase64(): string {
  const buffer = Buffer.alloc(48);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(40, 4); // file size - 8
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(8000, 24); // sample rate
  buffer.writeUInt32LE(16000, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(4, 40); // data size
  buffer.writeInt16LE(0, 44); // sample 1
  buffer.writeInt16LE(1000, 46); // sample 2

  return buffer.toString("base64");
}

describe("AudioConverter", () => {
  // ==================== validate 测试 ====================

  describe("validate", () => {
    test("有效的 WAV Base64 应返回 true", () => {
      const wavBase64 = createMinimalWavBase64();
      expect(AudioConverter.validate(wavBase64)).toBe(true);
    });

    test("空字符串应返回 false", () => {
      expect(AudioConverter.validate("")).toBe(false);
    });

    test("过短的数据应返回 false", () => {
      const shortData = Buffer.alloc(10).toString("base64");
      expect(AudioConverter.validate(shortData)).toBe(false);
    });

    test("null/undefined 应返回 false", () => {
      expect(AudioConverter.validate(null as any)).toBe(false);
      expect(AudioConverter.validate(undefined as any)).toBe(false);
    });
  });

  // ==================== parseWavHeader 测试 ====================

  describe("parseWavHeader", () => {
    test("应正确解析最小 WAV 头部", () => {
      const wavBase64 = createMinimalWavBase64();
      const metadata = AudioConverter.parseWavHeader(wavBase64);

      expect(metadata.sampleRate).toBe(8000);
      expect(metadata.channels).toBe(1);
      expect(metadata.bitsPerSample).toBe(16);
      // 4 bytes / (1 channel * 2 bytes per sample) = 2 samples
      // 2 samples / 8000 Hz = 0.00025s = 0ms (floored)
      expect(metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("过短数据应抛出错误", () => {
      const shortData = Buffer.alloc(10).toString("base64");
      expect(() => AudioConverter.parseWavHeader(shortData)).toThrow(
        "Audio data too short"
      );
    });

    test("非 WAV 数据应抛出错误", () => {
      const notWav = Buffer.alloc(48);
      notWav.write("NOT_", 0);
      expect(() =>
        AudioConverter.parseWavHeader(notWav.toString("base64"))
      ).toThrow("Invalid WAV");
    });
  });

  // ==================== estimateDuration 测试 ====================

  describe("estimateDuration", () => {
    test("WAV 格式应基于 24kHz mono 16-bit 估算", () => {
      // 创建 1 秒的 WAV 数据（24000 * 2 = 48000 bytes + 44 header）
      const dataSize = 48000 + 44;
      const base64 = Buffer.alloc(dataSize).toString("base64");
      const duration = AudioConverter.estimateDuration(base64, "wav");

      // 应约为 1000ms
      expect(duration).toBeGreaterThan(900);
      expect(duration).toBeLessThan(1100);
    });

    test("MP3 格式应基于 128kbps 估算", () => {
      // 创建约 1 秒的 MP3 数据（128000/8 = 16000 bytes）
      const dataSize = 16000;
      const base64 = Buffer.alloc(dataSize).toString("base64");
      const duration = AudioConverter.estimateDuration(base64, "mp3");

      expect(duration).toBeGreaterThan(900);
      expect(duration).toBeLessThan(1100);
    });

    test("应支持格式别名", () => {
      const base64 = Buffer.alloc(1000).toString("base64");

      const wavDuration = AudioConverter.estimateDuration(base64, "wave");
      const wavDuration2 = AudioConverter.estimateDuration(base64, "audio/wav");
      expect(wavDuration).toBe(wavDuration2);

      const mp3Duration = AudioConverter.estimateDuration(base64, "audio/mpeg");
      const mp3Duration2 = AudioConverter.estimateDuration(base64, "mp3");
      expect(mp3Duration).toBe(mp3Duration2);
    });
  });

  // ==================== toAudioPacket 测试 ====================

  describe("toAudioPacket", () => {
    test("WAV 数据应返回完整的 AudioPacket", () => {
      const wavBase64 = createMinimalWavBase64();
      const packet = AudioConverter.toAudioPacket(wavBase64, "wav");

      expect(packet.audioBase64).toBe(wavBase64);
      expect(packet.format).toBe("wav");
      expect(packet.sampleRate).toBe(8000);
      expect(packet.channels).toBe(1);
      expect(packet.durationMs).toBeDefined();
    });

    test("MP3 数据应返回估算的 AudioPacket", () => {
      const mp3Base64 = Buffer.alloc(16000).toString("base64");
      const packet = AudioConverter.toAudioPacket(mp3Base64, "mp3");

      expect(packet.format).toBe("mp3");
      expect(packet.durationMs).toBeDefined();
      // MP3 不解析头部，所以没有 sampleRate 和 channels
      expect(packet.sampleRate).toBeUndefined();
    });

    test("未知格式应默认为 wav", () => {
      const base64 = Buffer.alloc(100).toString("base64");
      const packet = AudioConverter.toAudioPacket(base64, "unknown_format");

      expect(packet.format).toBe("wav");
    });
  });
});
