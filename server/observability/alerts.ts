/**
 * server/observability/alerts.ts — 告警管理器 + 7 阈值规则
 *
 * 对齐 02-架构设计.md §11.3 告警阈值 + TESTING §13.5
 */

import { metricsCollector } from "./metrics";

// ============================================================
// 类型
// ============================================================

export type AlertName =
  | "LOW_CACHE_HIT"
  | "HIGH_LATENCY"
  | "LLM_ERROR_RATE_HIGH"
  | "SCHEMA_DRIFT"
  | "CACHE_INVALIDATION"
  | "SCENE_UNUSED"
  | "RULE_COVERAGE_LOW";

export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  name: AlertName;
  severity: AlertSeverity;
  message: string;
  triggeredAt: number;
  metadata: Record<string, unknown>;
}

interface AlertRule {
  name: AlertName;
  severity: AlertSeverity;
  check: () => boolean;
  buildMessage: () => string;
  buildMetadata: () => Record<string, unknown>;
}

// ============================================================
// 阈值常量（与 ARCH §11.3 保持一致）
// ============================================================

export const ALERT_THRESHOLDS = {
  LOW_CACHE_HIT_RATIO: 0.30,
  LOW_CACHE_HIT_DURATION_MS: 10 * 60 * 1000,

  HIGH_LATENCY_P95_MS: 800,
  HIGH_LATENCY_DURATION_MS: 5 * 60 * 1000,

  LLM_ERROR_RATE: 0.05,
  LLM_ERROR_DURATION_MS: 5 * 60 * 1000,

  SCHEMA_DRIFT_THRESHOLD: 0,        // > 0 触发

  INVALID_VERSION_FALLBACK_RATE: 0.01,
  INVALID_VERSION_DURATION_MS: 5 * 60 * 1000,

  SCENE_UNUSED_HIT_RATE: 0.05,
  SCENE_UNUSED_DURATION_MS: 24 * 3600 * 1000,

  RULE_COVERAGE_LOW_RATIO: 0.40,
  RULE_COVERAGE_LOW_DURATION_MS: 3600 * 1000,
} as const;

// ============================================================
// AlertManager
// ============================================================

class AlertManager {
  private triggered: Alert[] = [];
  private _lastEvaluationAt = 0;

  private rules: AlertRule[] = [
    // A1: LOW_CACHE_HIT
    {
      name: "LOW_CACHE_HIT",
      severity: "warning",
      check: () => {
        const m = metricsCollector.get("preAnalysis_cache_hit_ratio") as { value: number } | null;
        return m !== null && m.value < ALERT_THRESHOLDS.LOW_CACHE_HIT_RATIO;
      },
      buildMessage: () => `preAnalysis cache hit ratio < ${ALERT_THRESHOLDS.LOW_CACHE_HIT_RATIO * 100}%`,
      buildMetadata: () => {
        const m = metricsCollector.get("preAnalysis_cache_hit_ratio") as { value: number } | null;
        return { currentRatio: m?.value ?? null };
      },
    },

    // A2: HIGH_LATENCY
    {
      name: "HIGH_LATENCY",
      severity: "critical",
      check: () => {
        const m = metricsCollector.get("preAnalysis_llm_latency_ms") as { p95: number } | null;
        return m !== null && m.p95 > ALERT_THRESHOLDS.HIGH_LATENCY_P95_MS;
      },
      buildMessage: () => `preAnalysis LLM latency P95 > ${ALERT_THRESHOLDS.HIGH_LATENCY_P95_MS}ms`,
      buildMetadata: () => {
        const m = metricsCollector.get("preAnalysis_llm_latency_ms") as { p50: number; p95: number; p99: number } | null;
        return m ? { p50: m.p50, p95: m.p95, p99: m.p99 } : {};
      },
    },

    // A3: LLM_ERROR_RATE_HIGH
    {
      name: "LLM_ERROR_RATE_HIGH",
      severity: "warning",
      check: () => {
        const m = metricsCollector.get("preAnalysis_fallback_total") as {
          count: number;
          byReason: Record<string, number>;
        } | null;
        if (!m || m.count === 0) return false;
        const errCount = (m.byReason?.llm_error ?? 0) + (m.byReason?.llm_timeout_hard ?? 0);
        return errCount / m.count > ALERT_THRESHOLDS.LLM_ERROR_RATE;
      },
      buildMessage: () => `LLM error rate > ${ALERT_THRESHOLDS.LLM_ERROR_RATE * 100}%`,
      buildMetadata: () => {
        const m = metricsCollector.get("preAnalysis_fallback_total") as any;
        return m ?? {};
      },
    },

    // A4: SCHEMA_DRIFT
    {
      name: "SCHEMA_DRIFT",
      severity: "info",
      check: () => {
        const m = metricsCollector.get("preAnalysis_fallback_total") as {
          byReason: Record<string, number>;
        } | null;
        const driftCount = (m?.byReason?.schema_drift ?? 0) + (m?.byReason?.prefetch_invalid_version ?? 0);
        return driftCount > ALERT_THRESHOLDS.SCHEMA_DRIFT_THRESHOLD;
      },
      buildMessage: () => "Schema drift detected",
      buildMetadata: () => {
        const m = metricsCollector.get("preAnalysis_fallback_total") as any;
        return {
          schemaDriftCount: m?.byReason?.schema_drift ?? 0,
          prefetchInvalidCount: m?.byReason?.prefetch_invalid_version ?? 0,
        };
      },
    },

    // A5: CACHE_INVALIDATION
    {
      name: "CACHE_INVALIDATION",
      severity: "warning",
      check: () => {
        const total = metricsCollector.get("preAnalysis_total") as { count: number } | null;
        const invalid = metricsCollector.get("preAnalysis_fallback_total") as {
          byReason: Record<string, number>;
        } | null;
        if (!total || total.count === 0) return false;
        const rate = (invalid?.byReason?.invalid_version ?? 0) / total.count;
        return rate > ALERT_THRESHOLDS.INVALID_VERSION_FALLBACK_RATE;
      },
      buildMessage: () => `Invalid version fallback rate > ${ALERT_THRESHOLDS.INVALID_VERSION_FALLBACK_RATE * 100}%`,
      buildMetadata: () => {
        const total = metricsCollector.get("preAnalysis_total") as { count: number } | null;
        const invalid = metricsCollector.get("preAnalysis_fallback_total") as any;
        const rate = total && total.count > 0 ? (invalid?.byReason?.invalid_version ?? 0) / total.count : 0;
        return { fallbackRate: rate };
      },
    },

    // A6: SCENE_UNUSED
    {
      name: "SCENE_UNUSED",
      severity: "info",
      check: () => {
        const scene = metricsCollector.get("scene_activation_hit_total") as { count: number } | null;
        const total = metricsCollector.get("preAnalysis_total") as { count: number } | null;
        if (!total || total.count === 0) return false;
        const rate = (scene?.count ?? 0) / total.count;
        return rate < ALERT_THRESHOLDS.SCENE_UNUSED_HIT_RATE;
      },
      buildMessage: () => `Scene activation hit rate < ${ALERT_THRESHOLDS.SCENE_UNUSED_HIT_RATE * 100}%`,
      buildMetadata: () => {
        const scene = metricsCollector.get("scene_activation_hit_total") as { count: number } | null;
        const total = metricsCollector.get("preAnalysis_total") as { count: number } | null;
        const rate = total && total.count > 0 ? (scene?.count ?? 0) / total.count : 0;
        return { hitRate: rate };
      },
    },

    // A7: RULE_COVERAGE_LOW
    {
      name: "RULE_COVERAGE_LOW",
      severity: "warning",
      check: () => {
        const m = metricsCollector.get("preAnalysis_rule_hit_ratio") as { value: number } | null;
        return m !== null && m.value < ALERT_THRESHOLDS.RULE_COVERAGE_LOW_RATIO;
      },
      buildMessage: () => `Rule coverage < ${ALERT_THRESHOLDS.RULE_COVERAGE_LOW_RATIO * 100}%`,
      buildMetadata: () => {
        const m = metricsCollector.get("preAnalysis_rule_hit_ratio") as { value: number } | null;
        return { currentRatio: m?.value ?? null };
      },
    },
  ];

  /** 评估所有规则，返回新触发的告警 */
  evaluate(): Alert[] {
    const newAlerts: Alert[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      try {
        if (rule.check()) {
          // 防重复触发：5 分钟内同名告警只算一次
          const recent = this.triggered.find(
            (a) =>
              a.name === rule.name &&
              now - a.triggeredAt < 5 * 60 * 1000
          );
          if (!recent) {
            newAlerts.push({
              name: rule.name,
              severity: rule.severity,
              message: rule.buildMessage(),
              triggeredAt: now,
              metadata: rule.buildMetadata(),
            });
          }
        }
      } catch (err) {
        // 单个规则评估失败不应阻塞其他
        console.error(`[alert] ${rule.name} 评估失败:`, err);
      }
    }

    this.triggered.push(...newAlerts);
    this._lastEvaluationAt = now;
    return newAlerts;
  }

  /** 获取已触发的告警（测试断言用） */
  getTriggered(): Alert[] {
    return [...this.triggered];
  }

  /** 按名称过滤 */
  getByName(name: AlertName): Alert[] {
    return this.triggered.filter((a) => a.name === name);
  }

  reset(): void {
    this.triggered = [];
    this._lastEvaluationAt = 0;
  }
}

export const alertManager = new AlertManager();