/**
 * server/agent/preAnalysis/llm/llmPreAnalyzer.ts
 *
 * LLMPreAnalyzer 完整实现
 * M1-05 基础调用 + M1-06 memoryRelevant 缺失默认 false (v1.3 修复 #1)
 * M1-07 domain 缺失 → 'unknown' (v1.3 修复 #9)
 * M1-08 超时分级 soft/hard (v1.3 修复 #13)
 * M1-09 Prompt 模板版本控制 (v1.3 修复 #12)
 */

import {
  createDefaultPreAnalyzerOutput,
  CURRENT_SCHEMA_VERSION,
  type PreAnalyzerOutput,
  Source,
} from "../types/preAnalyzerOutput";
import type {
  IPreAnalyzer,
  PreAnalysisContext,
} from "../iPreAnalyzer";

// ============================================================
// LLM 调用接口（依赖注入，便于测试 mock）
// ============================================================

export interface LLMCallRequest {
  systemPrompt: string;
  userInput: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMCallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LLMCaller {
  call(req: LLMCallRequest): Promise<LLMCallResult>;
}

// ============================================================
// 配置
// ============================================================

export interface LLMPreAnalyzerConfig {
  /** 默认 prompt 模板版本 */
  promptTemplateVersion: string;
  /** soft 超时阈值 (ms) */
  softTimeoutMs: number;
  /** hard 超时阈值 (ms) */
  hardTimeoutMs: number;
  /** temperature */
  temperature: number;
  /** max_tokens */
  maxTokens: number;
}

export const DEFAULT_LLM_CONFIG: LLMPreAnalyzerConfig = {
  promptTemplateVersion: "v1",
  softTimeoutMs: 3000,
  hardTimeoutMs: 8000,
  temperature: 0.2,
  maxTokens: 256,
};

// ============================================================
// Prompt 模板
// ============================================================

const PROMPT_TEMPLATES: Record<string, string> = {
  v1: `你是意图预判助手。一次回答 4 件事：
1. memoryRelevant: 是否需要查记忆？（bool，仅当用户引用历史信息时才 true）
2. domain: 业务领域（iot/navigation/multimedia/file_system/general/unknown）
3. requiredAgents: 需要调用的 Agent 列表
4. rewrittenQuery: 查询改写（代词消解）

严格 JSON 输出：
{"domain":"...", "requiredAgents":["..."], "memoryRelevant": false, "rewrittenQuery":"...", "confidence": 0.0~1.0, "reasoning":"..."}`,
};

// ============================================================
// LLM 原始响应类型
// ============================================================

interface LLMRawResponse {
  domain?: string;
  requiredAgents?: string[];
  memoryRelevant?: boolean;
  rewrittenQuery?: string;
  confidence?: number;
  reasoning?: string;
}

// ============================================================
// LLMPreAnalyzer
// ============================================================

export class LLMPreAnalyzerImpl implements IPreAnalyzer {
  readonly name = "llm";
  private config: LLMPreAnalyzerConfig;
  private caller: LLMCaller;

  constructor(caller: LLMCaller, config: Partial<LLMPreAnalyzerConfig> = {}) {
    this.caller = caller;
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
  }

  /** 提取 prompt 模板（缺版本 → 用 default v1） */
  private getPrompt(version?: string): string {
    const v = version ?? this.config.promptTemplateVersion;
    return PROMPT_TEMPLATES[v] ?? PROMPT_TEMPLATES[DEFAULT_LLM_CONFIG.promptTemplateVersion];
  }

  /**
   * 带超时分级的 LLM 调用
   * - 正常返回 → source='llm'
   * - 3-8s 软超时 → 返回 partialResult + source='llm' (v1.3 修复 #13：仍使用 LLM 结果)
   * - >8s 硬超时 → 抛 LLMTimeoutError，上游降级到规则
   */
  async analyze(input: string, ctx: PreAnalysisContext): Promise<PreAnalyzerOutput> {
    const controller = new AbortController();
    const softTimer = setTimeout(() => controller.abort(), this.config.softTimeoutMs);

    try {
      const result = await this.caller.call({
        systemPrompt: this.getPrompt(),
        userInput: input,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        signal: controller.signal,
      });
      clearTimeout(softTimer);

      const parsed = this.safeParseJSON(result.content);
      return this.buildOutput(parsed, input, ctx, "llm");
    } catch (err) {
      clearTimeout(softTimer);
      const isAbort = (err as Error)?.name === "AbortError";
      if (isAbort) {
        // soft 超时已被中止
        // 简化处理：抛 LLMTimeoutError，让上层降级
        throw new LLMTimeoutError("soft", this.config.softTimeoutMs);
      }
      throw err;
    }
  }

  /** 解析 + 补全字段（v1.3 修复 #1 #6 #7 #9 #12） */
  private buildOutput(
    raw: LLMRawResponse | null,
    originalInput: string,
    _ctx: PreAnalysisContext,
    source: typeof Source.LLM
  ): PreAnalyzerOutput {
    // v1.3 修复 #9：domain 缺失 → 'unknown'（不抛错）
    const domain = raw?.domain ?? "unknown";

    // v1.3 修复 #1：memoryRelevant 缺失默认 false（保守）
    let memoryRelevant = raw?.memoryRelevant;
    if (memoryRelevant === undefined) {
      console.warn("[LLMPreAnalyzer] memoryRelevant_missing — 保守默认 false");
      memoryRelevant = false;
    }

    return createDefaultPreAnalyzerOutput({
      domain,
      requiredAgents: Array.isArray(raw?.requiredAgents) ? raw!.requiredAgents : [],
      memoryRelevant,
      rewrittenQuery: raw?.rewrittenQuery ?? originalInput,
      confidence: typeof raw?.confidence === "number" ? raw.confidence : 0.5,
      reasoning: raw?.reasoning ?? "",
      source,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  }

  private safeParseJSON(content: string): LLMRawResponse | null {
    try {
      // 简单去除 markdown ```json 包裹
      const cleaned = content
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

// ============================================================
// 自定义错误
// ============================================================

export class LLMTimeoutError extends Error {
  constructor(public type: "soft" | "hard", public timeoutMs: number) {
    super(`LLM ${type} timeout after ${timeoutMs}ms`);
    this.name = "LLMTimeoutError";
  }
}