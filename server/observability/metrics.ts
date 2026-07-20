/**
 * server/observability/metrics.ts — 指标采集器
 *
 * 对齐 02-架构设计.md §11 Observability
 * 10 核心指标 + bySource / byReason 维度
 */

import { randomUUID } from "crypto";

// ============================================================
// 类型定义
// ============================================================

export interface MetricDimension {
  source?: string;
  reason?: string;
  eventType?: string;
}

export interface HistogramSnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  sum: number;
}

export interface CounterSnapshot {
  count: number;
  bySource?: Record<string, number>;
  byReason?: Record<string, number>;
  byType?: Record<string, number>;
}

export interface GaugeSnapshot {
  value: number;
  bySource?: Record<string, number>;
}

export type MetricSnapshot = HistogramSnapshot | CounterSnapshot | GaugeSnapshot;

export interface MetricRecord {
  name: string;
  type: "counter" | "histogram" | "gauge";
  dimensions?: MetricDimension;
  ts: number;
}

// ============================================================
// 内部状态
// ============================================================

interface CounterState {
  count: number;
  bySource: Map<string, number>;
  byReason: Map<string, number>;
  byType: Map<string, number>;
}

interface HistogramState {
  samples: number[];
}

interface GaugeState {
  sum: number;
  count: number;
  bySource: Map<string, number>;
}

// ============================================================
// MetricsCollector
// ============================================================

const COUNTER_NAMES = [
  "preAnalysis_total",
  "memory_retrieval_called_total",
  "scene_activation_hit_total",
  "preAnalysis_fallback_total",
  "sse_event_emitted_total",
] as const;

const HISTOGRAM_NAMES = [
  "preAnalysis_llm_latency_ms",
  "context_enrich_duration_ms",
] as const;

const GAUGE_NAMES = [
  "preAnalysis_cache_hit_ratio",
  "preAnalysis_rule_hit_ratio",
  "preAnalysis_confidence_avg",
] as const;

type CounterName = (typeof COUNTER_NAMES)[number];
type HistogramName = (typeof HISTOGRAM_NAMES)[number];
type GaugeName = (typeof GAUGE_NAMES)[number];

class MetricsCollector {
  private counters = new Map<string, CounterState>();
  private histograms = new Map<string, HistogramState>();
  private gauges = new Map<string, GaugeState>();

  // ---------- record ----------

  record(
    name: string,
    value: number,
    dimensions?: MetricDimension
  ): void {
    if ((COUNTER_NAMES as readonly string[]).includes(name)) {
      this.recordCounter(name, value, dimensions);
    } else if ((HISTOGRAM_NAMES as readonly string[]).includes(name)) {
      this.recordHistogram(name, value);
    } else if ((GAUGE_NAMES as readonly string[]).includes(name)) {
      this.recordGauge(name, value, dimensions);
    } else {
      // 未知指标：lazy register
      this.recordHistogram(name, value);
    }
  }

  private recordCounter(
    name: string,
    _value: number,
    dimensions?: MetricDimension
  ): void {
    let state = this.counters.get(name);
    if (!state) {
      state = {
        count: 0,
        bySource: new Map(),
        byReason: new Map(),
        byType: new Map(),
      };
      this.counters.set(name, state);
    }
    state.count++;
    if (dimensions?.source) {
      state.bySource.set(
        dimensions.source,
        (state.bySource.get(dimensions.source) ?? 0) + 1
      );
    }
    if (dimensions?.reason) {
      state.byReason.set(
        dimensions.reason,
        (state.byReason.get(dimensions.reason) ?? 0) + 1
      );
    }
    if (dimensions?.eventType) {
      state.byType.set(
        dimensions.eventType,
        (state.byType.get(dimensions.eventType) ?? 0) + 1
      );
    }
  }

  private recordHistogram(name: string, value: number): void {
    let state = this.histograms.get(name);
    if (!state) {
      state = { samples: [] };
      this.histograms.set(name, state);
    }
    state.samples.push(value);
  }

  private recordGauge(
    name: string,
    value: number,
    dimensions?: MetricDimension
  ): void {
    let state = this.gauges.get(name);
    if (!state) {
      state = { sum: 0, count: 0, bySource: new Map() };
      this.gauges.set(name, state);
    }
    state.sum += value;
    state.count++;
    if (dimensions?.source) {
      const prev = state.bySource.get(dimensions.source) ?? { sum: 0, count: 0 };
      state.bySource.set(dimensions.source, {
        sum: prev.sum + value,
        count: prev.count + 1,
      });
    }
  }

  // ---------- get ----------

  get(name: string): MetricSnapshot | null {
    const counter = this.counters.get(name);
    if (counter) {
      return {
        count: counter.count,
        bySource: Object.fromEntries(counter.bySource),
        byReason: Object.fromEntries(counter.byReason),
        byType: Object.fromEntries(counter.byType),
      } satisfies CounterSnapshot;
    }
    const histogram = this.histograms.get(name);
    if (histogram) {
      return this.computeHistogram(histogram.samples);
    }
    const gauge = this.gauges.get(name);
    if (gauge) {
      const value = gauge.count > 0 ? gauge.sum / gauge.count : 0;
      const bySource: Record<string, number> = {};
      for (const [k, v] of gauge.bySource) {
        bySource[k] = v.count > 0 ? v.sum / v.count : 0;
      }
      return { value, bySource } satisfies GaugeSnapshot;
    }
    return null;
  }

  private computeHistogram(samples: number[]): HistogramSnapshot {
    if (samples.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, sum: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const pick = (q: number) => {
      const idx = Math.min(
        sorted.length - 1,
        Math.floor(q * sorted.length)
      );
      return sorted[idx];
    };
    const sum = samples.reduce((a, b) => a + b, 0);
    return {
      count: samples.length,
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      sum,
    };
  }

  // ---------- maintenance ----------

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }

  /** 调试用：列出所有已注册指标名 */
  list(): string[] {
    return [
      ...Array.from(this.counters.keys()),
      ...Array.from(this.histograms.keys()),
      ...Array.from(this.gauges.keys()),
    ];
  }
}

// ============================================================
// 导出单例
// ============================================================

export const metricsCollector = new MetricsCollector();

// ============================================================
// 便捷埋点函数
// ============================================================

export function emitMetric(
  name: CounterName | HistogramName | GaugeName,
  value: number,
  dimensions?: MetricDimension
): void {
  metricsCollector.record(name, value, dimensions);
}

/** 生成 traceId（32 hex，W3C trace context） */
export function generateTraceId(): string {
  return randomUUID().replace(/-/g, "");
}