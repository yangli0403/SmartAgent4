/**
 * ASR 模型与方言提示（language_hints）配置（v0.5 引入）
 *
 * 把模型选型与 run-task 报文构造从 asrStreamSocket.ts 中抽离，
 * 便于：
 * - 单元测试覆盖（不依赖真实 WebSocket）
 * - 后续切换到 qwen3-asr-flash 或其它多方言模型时只改一处
 *
 * 默认模型：paraformer-realtime-v2
 * - 阿里百炼实时识别"多方言版"，原生支持 16+ 种中文方言/口音
 * - 支持流式输入与 language_hints 参数
 *
 * 环境变量：
 * - DASHSCOPE_ASR_MODEL: 覆盖默认模型（如 qwen3-asr-flash / paraformer-realtime-8k-v2）
 * - DASHSCOPE_ASR_LANGUAGE_HINTS: 逗号分隔的语种列表（如 "zh,yue,wuu,minnan,en"）
 */

/** 默认 ASR 模型（多方言版） */
export const DEFAULT_ASR_MODEL = "paraformer-realtime-v2";

/** 默认方言/语种提示
 * - zh: 普通话（含主要北方口音）
 * - yue: 粤语
 * - wuu: 吴语（上海/苏州/杭州）
 * - minnan: 闽南语
 * - en: 英语（混说场景）
 */
export const DEFAULT_LANGUAGE_HINTS: ReadonlyArray<string> = [
  "zh",
  "yue",
  "wuu",
  "minnan",
  "en",
];

/** 解析当前生效的 ASR 模型名（env > 默认） */
export function resolveAsrModel(): string {
  const fromEnv = process.env.DASHSCOPE_ASR_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_ASR_MODEL;
}

/** 解析方言/语种提示（env 逗号分隔覆盖默认） */
export function resolveLanguageHints(): string[] {
  const raw = process.env.DASHSCOPE_ASR_LANGUAGE_HINTS;
  if (!raw) return [...DEFAULT_LANGUAGE_HINTS];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 构造 DashScope run-task 报文（含 language_hints 参数） */
export function buildAsrRunTaskPayload(
  taskId: string,
  model: string,
  languageHints: string[]
): {
  header: { action: "run-task"; task_id: string; streaming: "duplex" };
  payload: {
    task_group: "audio";
    task: "asr";
    function: "recognition";
    model: string;
    parameters: {
      sample_rate: number;
      format: "pcm";
      language_hints: string[];
    };
    input: Record<string, never>;
  };
} {
  return {
    header: {
      action: "run-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model,
      parameters: {
        sample_rate: 16000,
        format: "pcm",
        language_hints: languageHints,
      },
      input: {},
    },
  };
}

/** 构造 DashScope finish-task 报文（与 v0.4 行为一致） */
export function buildAsrFinishTaskPayload(taskId: string): {
  header: { action: "finish-task"; task_id: string; streaming: "duplex" };
  payload: { input: Record<string, never> };
} {
  return {
    header: {
      action: "finish-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      input: {},
    },
  };
}
