/**
 * US-2：方言 ASR 配置与 run-task 报文构造测试（v0.6 升级版）
 *
 * 关联用户测试用例：U-AS-1 / U-AS-2 / U-AS-3 / U-AS-4 / U-AS-5（新增）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveAsrModel,
  resolveLanguageHints,
  buildAsrRunTaskPayload,
  DEFAULT_ASR_MODEL,
  DEFAULT_LANGUAGE_HINTS,
} from "../asrConfig";

describe("US-2 ASR 配置解析", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DASHSCOPE_ASR_MODEL;
    delete process.env.DASHSCOPE_ASR_LANGUAGE_HINTS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("U-AS-1：默认模型应为 fun-asr-realtime（v0.6 升级，更快、多方言）", () => {
    expect(DEFAULT_ASR_MODEL).toBe("fun-asr-realtime");
    expect(resolveAsrModel()).toBe("fun-asr-realtime");
  });

  it("U-AS-2：环境变量可覆盖默认模型（如回退到 paraformer-realtime-v2）", () => {
    process.env.DASHSCOPE_ASR_MODEL = "paraformer-realtime-v2";
    expect(resolveAsrModel()).toBe("paraformer-realtime-v2");
  });

  it("U-AS-3：默认 language_hints 包含 zh / yue（粤语）/ wuu（吴语）/ minnan", () => {
    const hints = resolveLanguageHints();
    expect(hints).toEqual(DEFAULT_LANGUAGE_HINTS);
    expect(hints).toContain("zh");
    expect(hints).toContain("yue");
  });

  it("U-AS-4：env 自定义 hints（逗号分隔）会被解析为去空白的数组", () => {
    process.env.DASHSCOPE_ASR_LANGUAGE_HINTS = " zh , yue,en ";
    expect(resolveLanguageHints()).toEqual(["zh", "yue", "en"]);
  });

  it("paraformer 模型应携带 language_hints 参数", () => {
    const taskId = "task-1234";
    const payload = buildAsrRunTaskPayload(taskId, "paraformer-realtime-v2", [
      "zh",
      "yue",
    ]);
    expect(payload.header.action).toBe("run-task");
    expect(payload.header.task_id).toBe(taskId);
    expect(payload.payload.model).toBe("paraformer-realtime-v2");
    expect(payload.payload.parameters.language_hints).toEqual(["zh", "yue"]);
    expect(payload.payload.parameters.sample_rate).toBe(16000);
    expect(payload.payload.parameters.format).toBe("pcm");
  });

  it("U-AS-5（新增）：fun-asr 系列模型应自动跳过 language_hints 参数", () => {
    const taskId = "task-funasr-001";
    const payload = buildAsrRunTaskPayload(taskId, "fun-asr-realtime", [
      "zh",
      "yue",
      "wuu",
    ]);
    expect(payload.payload.model).toBe("fun-asr-realtime");
    // fun-asr 系列自动检测语种，language_hints 应被自动移除以避免参数不兼容
    expect(payload.payload.parameters.language_hints).toBeUndefined();
    expect(payload.payload.parameters.sample_rate).toBe(16000);
    expect(payload.payload.parameters.format).toBe("pcm");
  });

  it("fun-asr-flash-8k-realtime（8kHz 子型号）也应跳过 language_hints", () => {
    const taskId = "task-funasr-002";
    const payload = buildAsrRunTaskPayload(
      taskId,
      "fun-asr-flash-8k-realtime",
      ["zh", "yue"]
    );
    expect(payload.payload.model).toBe("fun-asr-flash-8k-realtime");
    expect(payload.payload.parameters.language_hints).toBeUndefined();
  });

  it("paraformer-realtime-v1（旧版本）依然携带 language_hints", () => {
    const payload = buildAsrRunTaskPayload(
      "task-001",
      "paraformer-realtime-v1",
      ["zh"]
    );
    expect(payload.payload.parameters.language_hints).toEqual(["zh"]);
  });

  it("空 language_hints 数组不会注入空数组到 paraformer", () => {
    const payload = buildAsrRunTaskPayload(
      "task-001",
      "paraformer-realtime-v2",
      []
    );
    expect(payload.payload.parameters.language_hints).toBeUndefined();
  });
});
