/**
 * ASR 模型与方言提示（language_hints）配置（v0.5 引入，v0.6 提升）
 *
 * 把模型选型与 run-task 报文构造从 asrStreamSocket.ts 中抽离，
 * 便于：
 * - 单元测试覆盖（不依赖真实 WebSocket）
 * - 后续切换不同模型族（paraformer / fun-asr / qwen-asr）只改一处
 *
 * 默认模型：fun-asr-realtime（v0.6 升级，更快、多方言覆盖更广）
 * - 多方言覆盖：粵语、吴语、闽南语、客家话、赣语、湘语、晋语 + 中原/西南/净鲁/江淮等官话口音
 * - 16kHz 采样，与原 paraformer 接口使用同一个 WebSocket 端点（wss://dashscope.aliyuncs.com/api-ws/v1/inference）
 * - 价格 $0.000047/秒，比 paraformer-realtime-v2 更低
 *
 * 环境变量：
 * - DASHSCOPE_ASR_MODEL: 覆盖默认模型
 *   - 可选值：fun-asr-realtime / paraformer-realtime-v2 / paraformer-realtime-8k-v2 等
 *   - 不可用值：qwen3-asr-flash（使用独立的 Qwen-ASR-Realtime API，需独立适配器）
 * - DASHSCOPE_ASR_LANGUAGE_HINTS: 逗号分隔的语种列表（如 "zh,yue,wuu,minnan,en"）
 *   - 仅 paraformer 系列模型生效，fun-asr 系列自动检测语种，会自动跳过该参数
 */

/** 默认 ASR 模型（v0.6 升级到 fun-asr-realtime） */
export const DEFAULT_ASR_MODEL = "fun-asr-realtime";

/** 检测模型是否为 fun-asr 系列（自动检测语种，不需要 language_hints） */
function isFunAsrModel(model: string): boolean {
  return /^fun-asr/i.test(model);
}

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

/**
 * 构造 DashScope run-task 报文
 * - paraformer 系列：携带 language_hints 参数提高多方言准确率
 * - fun-asr 系列：自动识别语种，不携带 language_hints 避免参数不兼容
 */
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
      language_hints?: string[];
    };
    input: Record<string, never>;
  };
} {
  const parameters: {
    sample_rate: number;
    format: "pcm";
    language_hints?: string[];
  } = {
    sample_rate: 16000,
    format: "pcm",
  };

  // fun-asr 系列自动检测语种，不需要 language_hints
  if (!isFunAsrModel(model) && languageHints.length > 0) {
    parameters.language_hints = languageHints;
  }

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
      parameters,
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
