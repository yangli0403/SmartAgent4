/**
 * server/agent/preAnalysis/rules/ruleLayer.ts
 *
 * RuleLayer 注册表 + 多租户 + isComplete + calculateConfidence
 * v1.3 修复：#2 isComplete 遍历所有规则
 * v1.3 修复：#5/#8 calculateConfidence 统一公式 evidenceScore × agreementFactor
 * v1.3 修复：#10 多租户独立实例
 */

import {
  type PreAnalyzerOutput,
  CURRENT_SCHEMA_VERSION,
  Source,
} from "../types/preAnalyzerOutput";

// ============================================================
// 规则定义
// ============================================================

export type RuleField =
  | "domain"
  | "requiredAgents"
  | "memoryRelevant"
  | "rewrittenQuery"
  | "confidence"
  | "reasoning";

export interface RuleHit {
  field: RuleField;
  value: string | number | boolean | string[];
  evidenceScore: number;                              // [0, 1] 该字段的证据强度
}

export interface PreAnalysisRule {
  id: string;
  priority: number;                                   // 数字越小越先求值
  match: (input: string) => boolean;                  // 是否适用本规则
  produce: (input: string) => RuleHit[];              // 命中后产出的字段贡献
}

export interface RuleResult {
  ruleId: string;
  matched: boolean;
  hits: RuleHit[];
  rawConfidence: number;                              // 原始置信度（向后兼容）
  durationMs: number;
}

export interface AggregatedFields {
  domain?: string;
  requiredAgents?: string[];
  memoryRelevant?: boolean;
  rewrittenQuery?: string;
  confidence?: number;                                // evidenceScore × agreementFactor 后值
  reasoning?: string;
}

export interface RuleLayerEvaluation {
  hits: Array<{ rule: PreAnalysisRule; result: RuleResult }>;
  aggregated: AggregatedFields;
  isComplete: boolean;                                // 6 字段是否全部被某条规则提供
  overallConfidence: number;
}

// ============================================================
// 字段完整性（用于 isComplete）
// ============================================================

const REQUIRED_FIELDS: RuleField[] = [
  "domain",
  "requiredAgents",
  "memoryRelevant",
  "rewrittenQuery",
  "confidence",
  "reasoning",
];

export function isFieldProvided(field: RuleField, agg: AggregatedFields): boolean {
  switch (field) {
    case "domain":
      return typeof agg.domain === "string" && agg.domain.length > 0;
    case "requiredAgents":
      return Array.isArray(agg.requiredAgents) && agg.requiredAgents.length > 0;
    case "memoryRelevant":
      return typeof agg.memoryRelevant === "boolean";
    case "rewrittenQuery":
      return typeof agg.rewrittenQuery === "string" && agg.rewrittenQuery.length > 0;
    case "confidence":
      return typeof agg.confidence === "number" && agg.confidence >= 0 && agg.confidence <= 1;
    case "reasoning":
      return typeof agg.reasoning === "string" && agg.reasoning.length > 0;
    default:
      return false;
  }
}

// ============================================================
// RuleLayer
// ============================================================

export class RuleLayer {
  private rules: PreAnalysisRule[] = [];

  addRule(rule: PreAnalysisRule): this {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
    return this;
  }

  getRules(): readonly PreAnalysisRule[] {
    return this.rules;
  }

  /**
   * 评估所有规则（v1.3 修复 #2：遍历所有规则后判定，不再首个命中即 break）
   */
  evaluate(input: string): RuleLayerEvaluation {
    const hits: Array<{ rule: PreAnalysisRule; result: RuleResult }> = [];
    const aggregated: AggregatedFields = {};

    for (const rule of this.rules) {
      const start = Date.now();
      let matched = false;
      let ruleHits: RuleHit[] = [];

      try {
        matched = rule.match(input);
        if (matched) {
          ruleHits = rule.produce(input);
          // 聚合到 aggregated（保留第一个提供的值）
          for (const hit of ruleHits) {
            if (!isFieldProvided(hit.field as RuleField, aggregated)) {
              (aggregated as any)[hit.field] = hit.value;
            }
          }
        }
      } catch (err) {
        console.error(`[RuleLayer] 规则 ${rule.id} 求值失败:`, err);
      }

      hits.push({
        rule,
        result: {
          ruleId: rule.id,
          matched,
          hits: ruleHits,
          rawConfidence: ruleHits.length > 0 ? ruleHits[0].evidenceScore : 0,
          durationMs: Date.now() - start,
        },
      });
    }

    // v1.3 修复 #2：isComplete 遍历所有 REQUIRED_FIELDS
    const isComplete = REQUIRED_FIELDS.every((f) => isFieldProvided(f, aggregated));

    // v1.3 修复 #5/#8：calculateConfidence 统一公式
    const overallConfidence = calculateConfidence(hits, aggregated);

    return {
      hits,
      aggregated,
      isComplete,
      overallConfidence,
    };
  }

  /** 转 PreAnalyzerOutput 片段（用于上层拼接） */
  toPartialOutput(evalResult: RuleLayerEvaluation): Partial<PreAnalyzerOutput> {
    const { aggregated, isComplete, overallConfidence } = evalResult;
    if (!isComplete) {
      // 完整才返回；不完整时由上游决定补哪些字段
      return {
        confidence: overallConfidence,
        source: Source.RULE,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
    }
    return {
      domain: aggregated.domain!,
      requiredAgents: aggregated.requiredAgents!,
      memoryRelevant: aggregated.memoryRelevant!,
      rewrittenQuery: aggregated.rewrittenQuery!,
      confidence: overallConfidence,
      reasoning: aggregated.reasoning!,
      source: Source.RULE,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }
}

// ============================================================
// calculateConfidence 统一公式（v1.3 修复 #5/#8）
// ============================================================
// 公式：overall = avg(evidenceScores) × agreementFactor
//   - evidenceScores: 所有命中规则的 evidenceScore 平均
//   - agreementFactor: 当多条规则给同一字段时取均值，越多一致 → 越高
//                      （这里简化为：evidenceScores 标准差越小 → 越高）
//
// 返回 [0, 1] 区间值
export function calculateConfidence(
  hits: Array<{ rule: PreAnalysisRule; result: RuleResult }>,
  _aggregated: AggregatedFields
): number {
  const matchedHits = hits.filter((h) => h.result.matched);
  if (matchedHits.length === 0) return 0;

  // 1. evidenceScore 平均
  const allScores = matchedHits.flatMap((h) =>
    h.result.hits.map((r) => r.evidenceScore)
  );
  if (allScores.length === 0) return 0;

  const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;

  // 2. agreementFactor：基于标准差倒数（stddev=0 时 = 1，越分散越小）
  const variance =
    allScores.reduce((s, x) => s + (x - avg) ** 2, 0) / allScores.length;
  const stddev = Math.sqrt(variance);
  const agreementFactor = Math.max(0.5, 1 - stddev);   // 至少 0.5

  const overall = avg * agreementFactor;

  // 钳制到 [0, 1]
  return Math.max(0, Math.min(1, overall));
}

// ============================================================
// 多租户管理（v1.3 修复 #10）
// ============================================================

const tenantRegistry = new Map<string, RuleLayer>();
const defaultLayer = new RuleLayer();

export function getRuleLayer(tenantId?: string): RuleLayer {
  if (!tenantId) return defaultLayer;
  let layer = tenantRegistry.get(tenantId);
  if (!layer) {
    layer = new RuleLayer();
    tenantRegistry.set(tenantId, layer);
  }
  return layer;
}

export function clearTenantRegistry(): void {
  tenantRegistry.clear();
}