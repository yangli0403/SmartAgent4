/**
 * realtimeAsrStream 工具函数单元测试
 * 重点：VAD 能量计算、PCM 转换、降采样
 */
import { describe, it, expect } from "vitest";
import { __testing } from "../realtimeAsrStream";

const { computeRms, downsampleFloat32, floatTo16BitPCM, DEFAULT_VAD } = __testing;

describe("computeRms - VAD 能量计算", () => {
  it("纯静音帧应返回 0", () => {
    const silence = new Float32Array(1024);
    expect(computeRms(silence)).toBe(0);
  });

  it("满幅正弦应返回约 0.707（sqrt(0.5)）", () => {
    const N = 1024;
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      buf[i] = Math.sin((2 * Math.PI * i) / 64);
    }
    const rms = computeRms(buf);
    expect(rms).toBeGreaterThan(0.7);
    expect(rms).toBeLessThan(0.72);
  });

  it("低音量噪声应返回较小值", () => {
    const N = 1024;
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      buf[i] = (Math.random() - 0.5) * 0.005; // 极弱噪声
    }
    expect(computeRms(buf)).toBeLessThan(DEFAULT_VAD.energyThreshold);
  });

  it("正常说话音量应超过 VAD 阈值", () => {
    const N = 1024;
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      buf[i] = Math.sin((2 * Math.PI * i) / 32) * 0.1;
    }
    expect(computeRms(buf)).toBeGreaterThan(DEFAULT_VAD.energyThreshold);
  });
});

describe("downsampleFloat32 - 音频降采样", () => {
  it("相同采样率应原样返回", () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const out = downsampleFloat32(input, 16000, 16000);
    expect(out).toEqual(input);
  });

  it("48kHz 降到 16kHz 应得到约 1/3 长度", () => {
    const input = new Float32Array(4800);
    const out = downsampleFloat32(input, 48000, 16000);
    expect(out.length).toBe(1600);
  });

  it("44.1kHz 降到 16kHz 长度比例正确", () => {
    const input = new Float32Array(44100); // 1 秒
    const out = downsampleFloat32(input, 44100, 16000);
    expect(out.length).toBe(16000); // 1 秒 16k
  });
});

describe("floatTo16BitPCM - PCM 编码", () => {
  it("零向量应得到全 0 字节", () => {
    const input = new Float32Array([0, 0, 0]);
    const out = floatTo16BitPCM(input);
    expect(out).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0]));
  });

  it("正向满幅 1.0 应得到 0x7fff（小端）", () => {
    const input = new Float32Array([1.0]);
    const out = floatTo16BitPCM(input);
    // 小端：低字节在前
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0x7f);
  });

  it("负向满幅 -1.0 应得到 0x8000（小端）", () => {
    const input = new Float32Array([-1.0]);
    const out = floatTo16BitPCM(input);
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x80);
  });

  it("超出范围应被截断到 [-1, 1]", () => {
    const input = new Float32Array([2.5, -3.0]);
    const out = floatTo16BitPCM(input);
    // 2.5 截断为 1.0 → 0x7fff
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0x7f);
    // -3.0 截断为 -1.0 → 0x8000
    expect(out[2]).toBe(0x00);
    expect(out[3]).toBe(0x80);
  });
});

describe("DEFAULT_VAD 默认配置", () => {
  it("应启用 VAD", () => {
    expect(DEFAULT_VAD.enabled).toBe(true);
  });

  it("能量阈值在合理范围", () => {
    expect(DEFAULT_VAD.energyThreshold).toBeGreaterThan(0);
    expect(DEFAULT_VAD.energyThreshold).toBeLessThan(0.1);
  });

  it("静音判定时长在合理范围（500ms~3s）", () => {
    expect(DEFAULT_VAD.silenceMs).toBeGreaterThanOrEqual(500);
    expect(DEFAULT_VAD.silenceMs).toBeLessThanOrEqual(3000);
  });

  it("最大录音时长不少于 10 秒", () => {
    expect(DEFAULT_VAD.maxRecordingMs).toBeGreaterThanOrEqual(10000);
  });

  it("默认要求先检测到语音才判静音", () => {
    expect(DEFAULT_VAD.requireSpeechFirst).toBe(true);
  });
});
