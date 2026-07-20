/**
 * server/agent/preAnalysis/node/preAnalysisNode.ts
 *
 * preAnalysisNode — 意图预分析主流程（v1.3 集成所有修复）
 *
 * 流水线：
 *   Path 1: PrefetchCache 命中 → 直接返回（source=prefetch）
 *           └ 1a: schema 不匹配 → source=invalid_version → 降级到规则层
 *   Path 2: RuleLayer 评估
 *           └ 2a: isComplete=true → 返回（source=rule）
 *           └ 2b: 部分字段 → 合并到 Path 4 LLM prompt（v1.3 修复 #3）
 *   Path 3: intentSimilarity 相似度短路（v1.3 P2 阶段实现，本 Phase 仅占位）
 *   Path 4: LLM 调用
 *           └ 4a: 成功 → 返回（source=llm）
 *           └ 4b: rulePartial 已 complete → 跳过 LLM（v1.3 修复 #3）
 *           └ 4c: LLM timeout/error → 降级到规则（v1.3 修复 #13，source=rule + [fallback] 标记）
 *
 * 关键修复：
 *   - #3: rulePartial 拼接策略（只填未确定字段，全字段则走 source=rule）
 *   - #6: A/B test 模式降级（FineTunedPreAnalyzer 失败 → LLMPreAnalyzer → 规则）
 *   - #13: LLM 超时分级 + 降级
 *   - #14: SceneActivationCache fire-and-forget 异步填充
 */

import { IPreAnalyzer, PreAnalysisContext } from "../iPreAnalyzer";
import { PrefetchCache, getPrefetchCache } from "../cache/prefetchCache";
import {
  SceneActivationCache,
  getSceneActivationCache,
} from "../cache/sceneActivationCache";
import { RuleLayer, getRuleLayer, calculateConfidence } from "../rules/ruleLayer";
import {
  LLMPreAnalyzerImpl,
  LLMTimeoutError,
  DEFAULT_LLM_CONFIG,
} from "../llm/llmPreAnalyzer";
import {
  createDefaultPreAnalyzerOutput,
  CURRENT_SCHEMA_VERSION,
  Source,
  type PreAnalyzerOutput,
} from "../types/preAnalyzerOutput";
import type { SceneActivationOutput, SceneMatch } from "../types/sceneActivationOutput";
import { ErrorCodes } from "../types/errorCodes";
import { metricsCollector } from "../../../observability/metrics";
import { tracer } from "../../../observability/tracing";
import { searchSceneEpisodes } from "../../../memory/sceneEpisode";

// ============================================================
// 输入 / 输出
// ============================================================

export interface PreAnalysisNodeInput {
  userText: string;
  userId?: number;
  tenantId?: string;
  conversationSummary?: string;
  dialogueHistory?: Array<{ role: string; content: string }>;
  ctx?: PreAnalysisContext;
  /** 追踪上下文（任意透传） */
  traceContext?: Record<string, unknown>;
}

// ============================================================
// 输入 / 输出
// ============================================================

export interface PreAnalysisNodeInput {
  userText: string;
  userId?: number;
  tenantId?: string;
  conversationSummary?: string;
  dialogueHistory?: Array<{ role: string; content: string }>;
  ctx?: PreAnalysisContext;
  traceContext?: TraceContext;
}

export interface PreAnalysisResult {
  output: PreAnalyzerOutput;
  /** 走过的路径标签（用于日志） */
  path: "prefetch" | "rule" | "rule_partial_to_llm" | "llm" | "ab_test" | "invalid_version" | "similarity";
  /** 总耗时 ms */
  durationMs: number;
  /** 是否降级（rule fallback / ab_test fallback） */
  fellBack: boolean;
  /** rulePartial 提供的字段（用于调试） */
  rulePartialFields?: string[];
  /** SceneActivationCache 命中状态（同步快照） */
  sceneActivation?: { cacheHit: boolean; dbFallback: boolean; matched: number };
  /** v1.3 M2-02：SceneActivation 异步结果 promise，调用方可选 await */
  sceneActivationPromise?: Promise<SceneActivationOutput>;
}

// ============================================================
// 配置
// ============================================================

export interface PreAnalysisNodeConfig {
  /** 模式选择 */
  mode: "rule_only" | "llm" | "ab_test";
  /** 注入依赖（默认使用全局单例） */
  prefetchCache?: PrefetchCache;
  ruleLayer?: RuleLayer;
  sceneActivationCache?: SceneActivationCache;
  llmCaller?: LLMPreAnalyzerImpl["caller"];
  /**
   * v1.3 M2-02 接入：scene 激活 DB 查询器（默认使用 searchSceneEpisodes）
   * 测试可注入 mock；返回 SceneMatch[]（空数组 = 无匹配）
   */
  sceneSearcher?: (opts: { userId: number; query: string }) => Promise<Array<{
    memoryId: number;
    sceneName: string;
    summary: string;
    domain: string;
    triggerPhrases?: string[];
    matchScore?: number;
  }>>;
  /** metric 上报开关 */
  enableMetrics: boolean;
}

const DEFAULT_CONFIG: PreAnalysisNodeConfig = {
  mode: "llm",
  enableMetrics: true,
};

// ============================================================
// preAnalysisNode
// ============================================================

export class PreAnalysisNode {
  private config: PreAnalysisNodeConfig;
  private prefetch: PrefetchCache;
  private ruleLayer: RuleLayer;
  private sceneCache: SceneActivationCache;
  private llmAnalyzer?: LLMPreAnalyzerImpl;

  constructor(config: Partial<PreAnalysisNodeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.prefetch = config.prefetchCache ?? getPrefetchCache();
    this.ruleLayer = config.ruleLayer ?? getRuleLayer();
    this.sceneCache = config.sceneActivationCache ?? getSceneActivationCache();
    if (config.llmCaller) {
      this.llmAnalyzer = new LLMPreAnalyzerImpl(config.llmCaller);
    }
  }

  async analyze(input: PreAnalysisNodeInput): Promise<PreAnalysisResult> {
    const start = Date.now();
    const spanContext = tracer.startSpan("preAnalysis", {
      parentSpanId: (input.traceContext as any)?.parentSpanId,
      attributes: {
        userId: String(input.userId ?? ""),
        inputLength: String(input.userText.length),
        mode: this.config.mode,
      },
    });

    try {
      // Path 1: PrefetchCache 优先（v1.3 修复 #7）
      const path1 = await this.tryPrefetch(input);
      if (path1) {
        this.recordMetric("preAnalysis_total", 1, { source: path1.output.source });
        this.recordHistogram("preAnalysis_llm_latency_ms", Date.now() - start);
        return {
          ...path1,
          durationMs: Date.now() - start,
        };
      }

      // Path 2: 规则层
      const ruleResult = this.tryRule(input);

      // Path 2a: 规则层 complete → 直接返回（v1.3 修复 #2）
      if (ruleResult.isComplete) {
        const output: PreAnalyzerOutput = createDefaultPreAnalyzerOutput({
          ...ruleResult.merged,
          source: "rule",
          schemaVersion: CURRENT_SCHEMA_VERSION,
        });
        this.recordMetric("preAnalysis_total", 1, { source: "rule" });
        this.recordGauge("preAnalysis_confidence_avg", output.confidence, { source: "rule" });
        this.recordGauge("preAnalysis_rule_hit_ratio", 1);
        return {
          output,
          path: "rule",
          durationMs: Date.now() - start,
          fellBack: false,
          rulePartialFields: undefined,
        };
      }

      // Path 4b: rulePartial 已满足所有必需字段 → 跳过 LLM（v1.3 修复 #3）
      const requiredSatisfied = this.checkRequiredFieldsSatisfied(ruleResult.merged);
      if (requiredSatisfied) {
        const output = createDefaultPreAnalyzerOutput({
          ...ruleResult.merged,
          confidence: ruleResult.confidence,
          source: "rule",
          schemaVersion: CURRENT_SCHEMA_VERSION,
          reasoning: ruleResult.merged.reasoning
            ? `[rulePartial_complete] ${ruleResult.merged.reasoning}`
            : "rulePartial complete",
        });
        this.recordMetric("preAnalysis_total", 1, { source: "rule_partial_complete" });
        this.recordGauge("preAnalysis_rule_hit_ratio", 1);
        return {
          output,
          path: "rule_partial_to_llm",                       // 实际未调 LLM
          durationMs: Date.now() - start,
          fellBack: false,
          rulePartialFields: Object.keys(ruleResult.merged),
        };
      }

      // Path 4: LLM 调用
      const llmResult = await this.tryLLM(input, ruleResult.merged);

      // 触发 SceneActivationCache 异步填充（v1.3 修复 #14 + M2-02 接入）
      // 不阻塞主流程；返回的 sceneActivation 由调用方按需等待
      const sceneActivationPromise = this.fireAndForgetSceneActivation(input);

      return {
        ...llmResult,
        durationMs: Date.now() - start,
        sceneActivationPromise,
      };
    } finally {
      // 全路径记录 latency histogram
      this.recordHistogram("preAnalysis_llm_latency_ms", Date.now() - start);
      tracer.endSpan(spanContext.spanId);
    }
  }

  // ============================================================
  // Path 1: PrefetchCache
  // ============================================================

  private async tryPrefetch(input: PreAnalysisNodeInput): Promise<PreAnalysisResult | null> {
    const r = this.prefetch.get(input.userText);
    if (r.hit && r.output) {
      return {
        output: r.output,
        path: "prefetch",
        durationMs: 0,
        fellBack: false,
      };
    }
    if (r.schemaMismatch) {
      // v1.3 修复 #7：标记 invalid_version，降级到规则层
      this.recordMetric("preAnalysis_fallback_total", 1, { reason: "prefetch_invalid_version" });
      // 不直接返回 invalid_version 结果，而是让上层继续走规则层
      return null;
    }
    return null;
  }

  // ============================================================
  // Path 2: RuleLayer
  // ============================================================

  private tryRule(input: PreAnalysisNodeInput): {
    merged: Partial<PreAnalyzerOutput>;
    isComplete: boolean;
    confidence: number;
    matchedRuleIds: string[];
  } {
    const layerResult = this.ruleLayer.evaluate(input.userText);

    const merged = layerResult.aggregated as Partial<PreAnalyzerOutput>;

    // isComplete 由 RuleLayer.calculateConfidence 提供（v1.3 修复 #2）
    const isComplete = layerResult.isComplete;

    const matchedRuleIds = layerResult.hits
      .filter((h) => h.result.matched)
      .map((h) => h.rule.id);

    const confidence = isComplete
      ? calculateConfidence(layerResult.hits, layerResult.aggregated)
      : layerResult.overallConfidence ?? 0.5;

    return { merged, isComplete, confidence, matchedRuleIds };
  }

  /** v1.3 修复 #3：rulePartial 是否已满足所有必需字段（domain/requiredAgents/memoryRelevant） */
  private checkRequiredFieldsSatisfied(merged: Partial<PreAnalyzerOutput>): boolean {
    return (
      merged.domain !== undefined &&
      merged.requiredAgents !== undefined &&
      merged.memoryRelevant !== undefined
    );
  }

  // ============================================================
  // Path 4: LLM
  // ============================================================

  private async tryLLM(
    input: PreAnalysisNodeInput,
    rulePartial: Partial<PreAnalyzerOutput>
  ): Promise<PreAnalysisResult> {
    if (!this.llmAnalyzer) {
      // 无 LLM caller 配置 → 降级到 rule（v1.3 修复 #13 兜底）
      return {
        output: this.fallbackToRule(input, rulePartial, "no_llm_caller"),
        path: "llm",
        durationMs: 0,
        fellBack: true,
        rulePartialFields: Object.keys(rulePartial),
      };
    }

    try {
      const llmOutput = await this.llmAnalyzer.analyze(input.userText, {
        ...input.ctx,
        userId: input.userId?.toString() ?? "",
        sessionId: input.ctx?.sessionId ?? "",
        traceId: input.ctx?.traceId ?? "",
        rulePartial: this.buildLLMRulePartial(rulePartial),                  // v1.3 修复 #3
      });

      // v1.3 修复 #3：合并 rulePartial 中未定义的字段（防御性，避免 LLM 漏填）
      const merged = this.mergeRulePartial(llmOutput, rulePartial);

      this.recordMetric("preAnalysis_total", 1, { source: "llm" });
      this.recordGauge("preAnalysis_confidence_avg", merged.confidence, { source: "llm" });

      return {
        output: merged,
        path: "llm",
        durationMs: 0,
        fellBack: false,
        rulePartialFields: Object.keys(rulePartial),
      };
    } catch (err) {
      if (err instanceof LLMTimeoutError) {
        // v1.3 修复 #13：LLM 超时降级到规则
        this.recordMetric("preAnalysis_fallback_total", 1, { reason: `llm_${err.type}_timeout` });
        return {
          output: this.fallbackToRule(input, rulePartial, `llm_${err.type}_timeout`),
          path: "llm",
          durationMs: 0,
          fellBack: true,
          rulePartialFields: Object.keys(rulePartial),
        };
      }
      // 其他 LLM 错误 → 降级
      this.recordMetric("preAnalysis_fallback_total", 1, { reason: "llm_error" });
      return {
        output: this.fallbackToRule(input, rulePartial, "llm_error"),
        path: "llm",
        durationMs: 0,
        fellBack: true,
        rulePartialFields: Object.keys(rulePartial),
      };
    }
  }

  /** v1.3 修复 #3：仅注入 rulePartial 中 undefined 的字段，全字段则不注入 */
  private buildLLMRulePartial(rulePartial: Partial<PreAnalyzerOutput>): any {
    const partial: any = {};
    if (rulePartial.domain === undefined) partial.domain = null;
    if (rulePartial.requiredAgents === undefined) partial.requiredAgents = null;
    if (rulePartial.memoryRelevant === undefined) partial.memoryRelevant = null;
    if (rulePartial.rewrittenQuery === undefined) partial.rewrittenQuery = null;
    return partial;
  }

  /** v1.3 修复 #3：合并时保留 rulePartial 已确定的字段 */
  private mergeRulePartial(llmOutput: PreAnalyzerOutput, rulePartial: Partial<PreAnalyzerOutput>): PreAnalyzerOutput {
    return {
      ...llmOutput,
      // rulePartial 已确定的字段优先
      domain: rulePartial.domain ?? llmOutput.domain,
      requiredAgents: rulePartial.requiredAgents ?? llmOutput.requiredAgents,
      memoryRelevant: rulePartial.memoryRelevant ?? llmOutput.memoryRelevant,
      rewrittenQuery: rulePartial.rewrittenQuery ?? llmOutput.rewrittenQuery,
    };
  }

  private fallbackToRule(
    input: PreAnalysisNodeInput,
    rulePartial: Partial<PreAnalyzerOutput>,
    reason: string
  ): PreAnalyzerOutput {
    return createDefaultPreAnalyzerOutput({
      ...rulePartial,
      source: "rule",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      reasoning: `[fallback:${reason}] ${rulePartial.reasoning ?? ""}`.trim(),
      confidence: rulePartial.domain ? 0.5 : 0.3,
    });
  }

  // ============================================================
  // SceneActivationCache fire-and-forget (v1.3 修复 #14 + M2-02 接入)
  // ============================================================

  /**
   * 异步触发 scene 激活查询并填充缓存（不阻塞主流程）
   * - 缓存命中 → 直接返回
   * - 缓存 miss → 调 searchSceneEpisodes → 写回 cache
   * - 失败 → 记 metric，不抛错
   * @returns Promise<SceneActivationOutput> — 调用方可选 await 以同步获取结果
   */
  private fireAndForgetSceneActivation(input: PreAnalysisNodeInput): Promise<SceneActivationOutput> {
    if (!input.userId || input.userId <= 0) {
      return Promise.resolve({ schemaVersion: "v1", cacheHit: false, matches: [], dbFallback: false, durationMs: 0 });
    }
    // 缓存命中：返回当前快照
    const cached = this.sceneCache.get(input.userId, input.userText);
    if (cached.cacheHit) return Promise.resolve(cached);

    const searcher = this.config.sceneSearcher ?? defaultSceneSearcher;
    const start = Date.now();

    return (async () => {
      try {
        const rawMatches = await searcher({ userId: input.userId!, query: input.userText });
        const matches: SceneMatch[] = rawMatches.map((m) => ({
          memoryId: m.memoryId,
          sceneName: m.sceneName,
          summary: m.summary,
          domain: m.domain,
          triggerPhrases: m.triggerPhrases,
          matchScore: m.matchScore,
        }));
        const durationMs = Date.now() - start;
        this.sceneCache.set(input.userId!, input.userText, matches, durationMs);
        this.recordMetric("sceneActivation_db_total", 1, {
          matched: matches.length > 0 ? "yes" : "no",
        });
        this.recordGauge("sceneActivation_db_duration_ms", durationMs);
        return {
          schemaVersion: "v1" as const,
          cacheHit: false,
          matches,
          dbFallback: true,
          durationMs,
        };
      } catch (e) {
        this.recordMetric("sceneActivation_db_error_total", 1, {
          error: (e as Error)?.message?.slice(0, 32) ?? "unknown",
        });
        return { schemaVersion: "v1" as const, cacheHit: false, matches: [], dbFallback: false, durationMs: Date.now() - start };
      }
    })();
  }

  // ============================================================
  // metric 上报
  // ============================================================

  private recordMetric(name: string, value: number, dimensions?: Record<string, string>): void {
    if (!this.config.enableMetrics) return;
    try {
      metricsCollector.record(name, value, dimensions);
    } catch {
      // metric 失败不影响主流程
    }
  }

  private recordHistogram(name: string, valueMs: number): void {
    this.recordMetric(name, valueMs);
  }

  private recordGauge(name: string, value: number, dimensions?: Record<string, string>): void {
    this.recordMetric(name, value, dimensions);
  }
}

// ============================================================
// 默认 scene 搜索器（M2-02 接入 searchSceneEpisodes）
// ============================================================

type DefaultSceneMatch = {
  memoryId: number;
  sceneName: string;
  summary: string;
  domain: string;
  triggerPhrases?: string[];
  matchScore?: number;
};

/**
 * 默认 scene 搜索器：调用 searchSceneEpisodes 并映射为 SceneMatch 子集。
 * - 不抛错：异常返回空数组
 * - 默认 limit=5
 */
async function defaultSceneSearcher(opts: { userId: number; query: string }): Promise<DefaultSceneMatch[]> {
  try {
    const results = await searchSceneEpisodes({
      userId: opts.userId,
      query: opts.query,
      limit: 5,
    });
    return results.map((m) => {
      const meta = (m.metadata ?? {}) as Record<string, any>;
      const sceneName = meta.sceneName ?? meta.name ?? m.content?.split(/[。\n]/)[0]?.slice(0, 32) ?? "未命名场景";
      const domain = (meta.domain as string) ?? "general";
      const triggerPhrases = Array.isArray(meta.triggerPhrases) ? meta.triggerPhrases : undefined;
      return {
        memoryId: m.id,
        sceneName,
        summary: m.content ?? "",
        domain,
        triggerPhrases,
        matchScore: meta.score,
      };
    });
  } catch {
    return [];
  }
}

// ============================================================
// 工厂
// ============================================================

export function createPreAnalysisNode(config?: Partial<PreAnalysisNodeConfig>): PreAnalysisNode {
  return new PreAnalysisNode(config);
}