/**
 * US-2：方言 ASR 配置与 run-task 报文构造测试
 *
 * 关联用户测试用例：U-AS-1 / U-AS-2 / U-AS-3 / U-AS-4
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

  it("U-AS-1：默认模型应为 paraformer-realtime-v2（多方言版）", () => {
    expect(DEFAULT_ASR_MODEL).toBe("paraformer-realtime-v2");
    expect(resolveAsrModel()).toBe("paraformer-realtime-v2");
  });

  it("U-AS-2：环境变量可覆盖默认模型", () => {
    process.env.DASHSCOPE_ASR_MODEL = "qwen3-asr-flash";
    expect(resolveAsrModel()).toBe("qwen3-asr-flash");
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

  it("buildAsrRunTaskPayload 应注入模型与 language_hints 参数", () => {
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
});
