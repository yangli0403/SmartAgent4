/**
 * server/agent/supervisor/classifyLLMCall.ts
 *
 * 评测注入点：在调用真实 LLM 之前，可被 env var 拦截返回 mock label。
 *
 * 用法（eval 框架）：
 *   EVAL_MOCK_LLM=true   → 解析 userMessage 中的 [GT_JSON]...[/GT_JSON] 块
 *   LLM_MODE=mock         → 同上
 *   LLM_MODE=scripted     → 同上（但 userMessage 必须包含 GT 块）
 *   LLM_MODE=real / unset → 调真实 callLightLLMStructured
 *
 * 该 wrapper 是 project code，但行为完全等价（env var 未设时透传），
 * 不影响现有 unit test。
 */

import { callLightLLMStructured } from "../../llm/langchainAdapter";
import type { TaskClassification } from "./state";

const FALLBACK_LABEL: TaskClassification = {
  domain: "general",
  executionMode: "single",
  complexity: "simple",
  reasoning: "[mock] fallback",
  requiredAgents: ["generalAgent"],
};

let _mockFlagEnsured = false;

function ensureMockEnv(): void {
  if (_mockFlagEnsured) return;
  _mockFlagEnsured = true;
  // Mock 模式：注入假的 API Key，避免 langchainAdapter.ts 顶层 import 抛错
  if (!process.env.ARK_API_KEY && !process.env.OPENAI_API_KEY) {
    process.env.ARK_API_KEY = "eval-mock-fake-key";
  }
  if (!process.env.OPENAI_BASE_URL) {
    process.env.OPENAI_BASE_URL = "https://mock.example.com/v1";
  }
}

function isMockMode(): boolean {
  return (
    process.env.EVAL_MOCK_LLM === "true" ||
    process.env.LLM_MODE === "mock" ||
    process.env.LLM_MODE === "scripted"
  );
}

function parseGroundTruth(message: string): TaskClassification | undefined {
  const match = message.match(/\[GT_JSON\]([\s\S]*?)\[\/GT_JSON\]/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as TaskClassification;
  } catch {
    return undefined;
  }
}

/**
 * 分类 LLM 调用（可注入 mock）
 */
export async function classifyLLMCall<T = TaskClassification>(
  systemPrompt: string,
  userMessage: string,
  options: any = {}
): Promise<T> {
  if (isMockMode()) {
    ensureMockEnv();
    const gt = parseGroundTruth(userMessage);
    if (gt) {
      return { ...gt, reasoning: `[mock] ${gt.reasoning ?? ""}` } as T;
    }
    return FALLBACK_LABEL as T;
  }
  return callLightLLMStructured<T>(systemPrompt, userMessage, options);
}

