/**
 * LangChain Adapter — LLM 适配器
 *
 * 优先使用 Manus 内置 LLM API（OpenAI 兼容协议），
 * 若未配置则回退到 Volcengine ARK API。
 */

import { ChatOpenAI } from "@langchain/openai";

// ==================== Manus 内置 LLM 配置（优先） ====================

const MANUS_API_KEY = process.env.OPENAI_API_KEY ?? "";
const MANUS_BASE_URL =
  process.env.OPENAI_BASE_URL ??
  process.env.OPENAI_API_BASE ??
  "https://api.manus.im/api/llm-proxy/v1";

// ==================== Volcengine ARK 回退配置 ====================

const ARK_API_KEY =
  process.env.ARK_API_KEY || "7c4d52bf-e540-4337-a9ab-1a5228acedaa";
const ARK_BASE_URL =
  process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_DEFAULT_MODEL =
  process.env.ARK_DEFAULT_MODEL || "ep-20250811200411-zctsd";

// ==================== 统一配置选择 ====================

/** 是否使用 Manus 内置 LLM */
const USE_MANUS_LLM = Boolean(MANUS_API_KEY);

/** 当前激活的 API Key */
const ACTIVE_API_KEY = USE_MANUS_LLM ? MANUS_API_KEY : ARK_API_KEY;
/** 当前激活的 Base URL */
const ACTIVE_BASE_URL = USE_MANUS_LLM ? MANUS_BASE_URL : ARK_BASE_URL;
/** 默认模型：Manus 使用 gpt-4.1-mini，ARK 使用 DeepSeek 端点 */
const DEFAULT_MODEL = USE_MANUS_LLM ? "gpt-4.1-mini" : ARK_DEFAULT_MODEL;

console.log(
  `[LangChainAdapter] Using ${
    USE_MANUS_LLM ? "Manus built-in" : "Volcengine ARK"
  } LLM, model: ${DEFAULT_MODEL}`
);

// ==================== LLM 创建 ====================

export interface LLMAdapterOptions {
  /** 模型名称/端点 ID */
  model?: string;
  /** 温度参数 */
  temperature?: number;
  /** 最大 Token 数 */
  maxTokens?: number;
}

/**
 * 创建 LangGraph 兼容的 LLM 实例
 *
 * 使用 @langchain/openai 的 ChatOpenAI，配置 ARK API 的 baseURL。
 * 返回的实例支持 .bindTools()、.invoke()、.stream() 等 LangGraph 标准方法。
 *
 * @param options - 配置选项
 * @returns ChatOpenAI 实例
 */
export function createLLM(options: LLMAdapterOptions = {}): ChatOpenAI {
  return new ChatOpenAI({
    model: options.model || DEFAULT_MODEL,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 2000,
    configuration: {
      baseURL: ACTIVE_BASE_URL,
      apiKey: ACTIVE_API_KEY,
    },
  });
}

/**
 * 创建支持 function calling 的 LLM 实例
 *
 * 与 createLLM 相同，但预设较低温度以提高工具调用准确性。
 *
 * @param options - 配置选项
 * @returns ChatOpenAI 实例
 */
export function createToolCallingLLM(
  options: LLMAdapterOptions = {}
): ChatOpenAI {
  return createLLM({
    temperature: 0.3,
    ...options,
  });
}

// ==================== 结构化输出 ====================

/**
 * 使用 LLM 生成结构化 JSON 输出
 *
 * 通过在 system prompt 中嵌入 JSON Schema 说明，
 * 引导 LLM 输出符合预期格式的 JSON。
 *
 * @param systemPrompt - 系统提示词（应包含 JSON 格式要求）
 * @param userMessage - 用户消息
 * @param options - LLM 配置选项
 * @returns 解析后的 JSON 对象
 */
export async function callLLMStructured<T>(
  systemPrompt: string,
  userMessage: string,
  options: LLMAdapterOptions = {}
): Promise<T> {
  const llm = createLLM({ temperature: 0.2, ...options });

  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);

  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  // 提取 JSON（支持 ```json ... ``` 包裹格式）
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
    content.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error(
      `[LangChainAdapter] Failed to extract JSON from LLM response: ${content.substring(0, 200)}`
    );
  }

  const jsonStr = jsonMatch[1] || jsonMatch[0];

  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    throw new Error(
      `[LangChainAdapter] Failed to parse JSON: ${(e as Error).message}\nRaw: ${jsonStr.substring(0, 200)}`
    );
  }
}

// ==================== 纯文本调用 ====================

/**
 * 使用 LLM 生成纯文本回复
 *
 * @param systemPrompt - 系统提示词
 * @param userMessage - 用户消息
 * @param options - LLM 配置选项
 * @returns 纯文本回复
 */
export async function callLLMText(
  systemPrompt: string,
  userMessage: string,
  options: LLMAdapterOptions = {}
): Promise<string> {
  const llm = createLLM(options);

  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

// ==================== 直接调用（兼容旧接口） ====================

/**
 * 直接调用 LLM（支持 function calling）
 *
 * 在现有 bytedance.ts 的 callLLM 基础上扩展，
 * 新增 tools 和 tool_choice 参数支持。
 * 使用原生 fetch 调用，保持与现有代码的兼容性。
 */
export interface LLMRequestWithTools {
  systemPrompt: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: "auto" | "none" | "required";
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponseWithTools {
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 带 function calling 支持的 LLM 调用
 *
 * @param request - 请求参数
 * @returns LLM 响应（含 tool_calls）
 */
export async function callLLMWithTools(
  request: LLMRequestWithTools
): Promise<LLMResponseWithTools> {
  const allMessages = [
    { role: "system" as const, content: request.systemPrompt },
    ...request.messages,
  ];

  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    messages: allMessages,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? 2000,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = request.tool_choice ?? "auto";
  }

  try {
    const response = await fetch(`${ACTIVE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACTIVE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[LangChainAdapter] LLM API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message;

    return {
      content: choice?.content || null,
      tool_calls: choice?.tool_calls || undefined,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens || 0,
            completion_tokens: data.usage.completion_tokens || 0,
            total_tokens: data.usage.total_tokens || 0,
          }
        : undefined,
    };
  } catch (error) {
    console.error("[LangChainAdapter] Error calling LLM with tools:", error);
    throw error;
  }
}
