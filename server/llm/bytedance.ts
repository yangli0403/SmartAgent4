/**
 * LLM Integration
 *
 * 优先使用 Manus 内置 LLM API（OpenAI 兼容协议），
 * 若未配置则回退到 Volcengine ARK API。
 */

import { ENV } from "../_core/env";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// OpenAI 兼容 LLM 配置（优先）
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_URL =
  process.env.OPENAI_BASE_URL ??
  process.env.OPENAI_API_BASE ??
  ""; // Windows-compat: 不再默认指向 Manus 内部网关

// Volcengine ARK 回退配置
const ARK_API_KEY = process.env.ARK_API_KEY || "7c4d52bf-e540-4337-a9ab-1a5228acedaa";
const ARK_BASE_URL = process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_DEFAULT_MODEL = process.env.ARK_DEFAULT_MODEL || "ep-20250811200411-zctsd";

// 统一选择
const USE_OPENAI = Boolean(OPENAI_KEY) && Boolean(OPENAI_URL);
const ACTIVE_API_KEY = USE_OPENAI ? OPENAI_KEY : ARK_API_KEY;
const ACTIVE_BASE_URL = USE_OPENAI ? OPENAI_URL : ARK_BASE_URL;
const DEFAULT_MODEL = USE_OPENAI
  ? (process.env.OPENAI_DEFAULT_MODEL || "gpt-4.1-mini")
  : ARK_DEFAULT_MODEL;

/**
 * Call LLM (Manus built-in or Volcengine ARK fallback)
 */
export async function callLLM(
  messages: Message[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens = 2000,
  } = options;

  try {
    const response = await fetch(`${ACTIVE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACTIVE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Handle ARK API response format
    // ARK API typically returns: { choices: [{ message: { content: string } }], usage: {...} }
    const content = data.choices?.[0]?.message?.content || 
                    data.choices?.[0]?.delta?.content || 
                    data.content || 
                    "";

    return {
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || data.usage.promptTokens || 0,
            completionTokens: data.usage.completion_tokens || data.usage.completionTokens || 0,
            totalTokens: data.usage.total_tokens || data.usage.totalTokens || 0,
          }
        : undefined,
    };
  } catch (error) {
    console.error("[LLM] Error calling LLM:", error);
    throw error;
  }
}

/**
 * Stream LLM response (for future implementation)
 */
export async function* streamLLM(
  messages: Message[],
  options: LLMOptions = {}
): AsyncGenerator<string, void, unknown> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens = 2000,
  } = options;

  try {
    const response = await fetch(`${ACTIVE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACTIVE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } catch (error) {
    console.error("[LLM] Error streaming from LLM:", error);
    throw error;
  }
}
