/**
 * tests/eval/harness/metrics.ts
 *
 * 评测指标计算 + 报告生成。
 *
 * 主指标（4 个）：
 * - domain 准确率
 * - complexity 准确率
 * - requiredAgents 精确匹配率
 * - 端到端全对率
 *
 * 辅指标（≥ 3 个）：
 * - 每域的 P/R/F1（macro / micro）
 * - 误判矩阵（confusion matrix）
 * - query 长度分段准确率
 * - edge case 子集准确率
 * - 延迟 p50/p95
 *
 * 鲁棒性：
 * - refine 触发占比
 * - 短路命中率
 */

import type { TestCase } from "../generate_testset";
import type { ClassifyResult } from "./runSmartAgentClassify";
import type { Domain, TaskClassification } from "../../../server/agent/supervisor/state";

// ===================================================================
// 类型定义
// ===================================================================

export interface EvalReport {
  runId: string;
  config: {
    disableShortcuts: boolean;
    llmMode: "mock" | "real" | "scripted";
    seed: number;
    totalCases: number;
    mockSubMode?: string;
  };
  summary: {
    domainAcc: number;
    complexityAcc: number;
    agentsExactAcc: number;
    fullAcc: number;
    correctCount: number;
  };
  perDomain: Record<
    string,
    { precision: number; recall: number; f1: number; support: number }
  >;
  perDomainMacro: { precision: number; recall: number; f1: number };
  perDomainMicro: { precision: number; recall: number; f1: number };
  confusionMatrix: {
    labels: string[];
    matrix: number[][];
  };
  byQueryLength: {
    short: number;
    medium: number;
    long: number;
  };
  byEdgeCase: Record<string, { acc: number; total: number }>;
  refineHitRate: Record<string, number>;
  shortCircuit: {
    count: number;
    sceneActivation: number;
  };
  latencyMs: { p50: number; p95: number; min: number; max: number };
  errors: Array<{
    id: string;
    query: string;
    expected: TaskClassification;
    got: TaskClassification;
    tags: string[];
  }>;
}

// ===================================================================
// 工具函数
// ===================================================================

function isEqualSet<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function getLengthBucket(query: string): "short" | "medium" | "long" {
  if (query.length <= 15) return "short";
  if (query.length <= 40) return "medium";
  return "long";
}

function getEdgeCaseKey(tags: string[]): string | null {
  for (const t of tags) {
    if (t.startsWith("refine:") || t.startsWith("follow_up:")) return t;
    if (t === "music" || t === "disk" || t === "dir_inventory" || t === "news" || t === "weather" || t === "vehicle" || t === "similarity" || t === "follow_up") {
      return t;
    }
    if (t.startsWith("adv:")) return t;
  }
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length))
  );
  return sorted[idx];
}

// ===================================================================
// 主指标
// ===================================================================

function computeSummary(results: ClassifyResult[]): {
  domainAcc: number;
  complexityAcc: number;
  agentsExactAcc: number;
  fullAcc: number;
  correctCount: number;
} {
  let domainOk = 0;
  let complexityOk = 0;
  let agentsOk = 0;
  let fullOk = 0;
  for (const r of results) {
    if (r.got.domain === r.expected.domain) domainOk++;
    if (r.got.complexity === r.expected.complexity) complexityOk++;
    if (isEqualSet(r.got.requiredAgents ?? [], r.expected.requiredAgents ?? [])) {
      agentsOk++;
    }
    if (
      r.got.domain === r.expected.domain &&
      r.got.complexity === r.expected.complexity &&
      isEqualSet(r.got.requiredAgents ?? [], r.expected.requiredAgents ?? [])
    ) {
      fullOk++;
    }
  }
  const n = results.length || 1;
  return {
    domainAcc: domainOk / n,
    complexityAcc: complexityOk / n,
    agentsExactAcc: agentsOk / n,
    fullAcc: fullOk / n,
    correctCount: fullOk,
  };
}

// ===================================================================
// 每域 P/R/F1
// ===================================================================

const ALL_DOMAINS_FOR_METRICS: Domain[] = [
  "navigation",
  "multimedia",
  "file_system",
  "office",
  "service",
  "general",
  "cross_domain",
];

function computePerDomain(results: ClassifyResult[]): {
  perDomain: EvalReport["perDomain"];
  macro: { precision: number; recall: number; f1: number };
  micro: { precision: number; recall: number; f1: number };
} {
  const perDomain: EvalReport["perDomain"] = {};
  let microTP = 0,
    microFP = 0,
    microFN = 0;
  for (const dom of ALL_DOMAINS_FOR_METRICS) {
    let tp = 0,
      fp = 0,
      fn = 0;
    for (const r of results) {
      const gotDom = r.got.domain;
      const expDom = r.expected.domain;
      if (expDom === dom && gotDom === dom) tp++;
      else if (expDom === dom && gotDom !== dom) fn++;
      else if (expDom !== dom && gotDom === dom) fp++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;
    const support = results.filter((r) => r.expected.domain === dom).length;
    perDomain[dom] = { precision, recall, f1, support };
    microTP += tp;
    microFP += fp;
    microFN += fn;
  }
  const macro = {
    precision: mean(Object.values(perDomain).map((d) => d.precision)),
    recall: mean(Object.values(perDomain).map((d) => d.recall)),
    f1: mean(Object.values(perDomain).map((d) => d.f1)),
  };
  const micro = {
    precision: microTP + microFP > 0 ? microTP / (microTP + microFP) : 0,
    recall: microTP + microFN > 0 ? microTP / (microTP + microFN) : 0,
    f1: 0,
  };
  micro.f1 =
    micro.precision + micro.recall > 0
      ? (2 * micro.precision * micro.recall) / (micro.precision + micro.recall)
      : 0;
  return { perDomain, macro, micro };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ===================================================================
// 误判矩阵
// ===================================================================

function computeConfusionMatrix(
  results: ClassifyResult[]
): EvalReport["confusionMatrix"] {
  const labels = ALL_DOMAINS_FOR_METRICS;
  const matrix: number[][] = labels.map(() => labels.map(() => 0));
  for (const r of results) {
    const i = labels.indexOf(r.expected.domain as Domain);
    const j = labels.indexOf(r.got.domain as Domain);
    if (i >= 0 && j >= 0) matrix[i][j]++;
  }
  return { labels: [...labels], matrix };
}

// ===================================================================
// 长度分段准确率
// ===================================================================

function computeByQueryLength(
  results: ClassifyResult[],
  testCases: TestCase[]
): EvalReport["byQueryLength"] {
  const tcMap = new Map(testCases.map((tc) => [tc.id, tc]));
  const buckets: Record<"short" | "medium" | "long", { ok: number; n: number }> = {
    short: { ok: 0, n: 0 },
    medium: { ok: 0, n: 0 },
    long: { ok: 0, n: 0 },
  };
  for (const r of results) {
    const tc = tcMap.get(r.id);
    if (!tc) continue;
    const bucket = getLengthBucket(tc.query);
    buckets[bucket].n++;
    if (r.got.domain === r.expected.domain) buckets[bucket].ok++;
  }
  return {
    short: buckets.short.n > 0 ? buckets.short.ok / buckets.short.n : 0,
    medium: buckets.medium.n > 0 ? buckets.medium.ok / buckets.medium.n : 0,
    long: buckets.long.n > 0 ? buckets.long.ok / buckets.long.n : 0,
  };
}

// ===================================================================
// edge case 子集
// ===================================================================

function computeByEdgeCase(
  results: ClassifyResult[],
  testCases: TestCase[]
): EvalReport["byEdgeCase"] {
  const tcMap = new Map(testCases.map((tc) => [tc.id, tc]));
  const buckets: Record<string, { ok: number; n: number }> = {};
  for (const r of results) {
    const tc = tcMap.get(r.id);
    if (!tc) continue;
    const key = getEdgeCaseKey(tc.tags);
    if (!key) continue;
    buckets[key] = buckets[key] ?? { ok: 0, n: 0 };
    buckets[key].n++;
    if (r.got.domain === r.expected.domain) buckets[key].ok++;
  }
  const out: EvalReport["byEdgeCase"] = {};
  for (const k of Object.keys(buckets).sort()) {
    out[k] = {
      acc: buckets[k].n > 0 ? buckets[k].ok / buckets[k].n : 0,
      total: buckets[k].n,
    };
  }
  return out;
}

// ===================================================================
// refine 触发占比
// ===================================================================

function computeRefineHitRate(
  results: ClassifyResult[]
): EvalReport["refineHitRate"] {
  const counts: Record<string, number> = {};
  for (const r of results) {
    for (const rule of r.triggeredRules) {
      counts[rule] = (counts[rule] ?? 0) + 1;
    }
  }
  const out: EvalReport["refineHitRate"] = {};
  for (const k of Object.keys(counts).sort()) {
    out[k] = counts[k] / results.length;
  }
  return out;
}

// ===================================================================
// 短路 / 场景激活
// ===================================================================

function computeShortCircuit(
  results: ClassifyResult[]
): EvalReport["shortCircuit"] {
  let count = 0;
  let sceneActivation = 0;
  for (const r of results) {
    if (r.triggeredShortCircuit) count++;
    if (r.triggeredSceneActivation) sceneActivation++;
  }
  return { count, sceneActivation };
}

// ===================================================================
// 延迟
// ===================================================================

function computeLatency(
  results: ClassifyResult[]
): EvalReport["latencyMs"] {
  const sorted = results.map((r) => r.durationMs).sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// ===================================================================
// 错误明细（Top N 误判）
// ===================================================================

function computeErrors(
  results: ClassifyResult[],
  testCases: TestCase[],
  topN = 10
): EvalReport["errors"] {
  const tcMap = new Map(testCases.map((tc) => [tc.id, tc]));
  const wrong = results
    .filter((r) => r.got.domain !== r.expected.domain)
    .map((r) => {
      const tc = tcMap.get(r.id);
      return {
        id: r.id,
        query: tc?.query ?? "",
        expected: r.expected,
        got: r.got,
        tags: tc?.tags ?? [],
      };
    });
  return wrong.slice(0, topN);
}

// ===================================================================
// 主入口
// ===================================================================

export function computeMetrics(
  results: ClassifyResult[],
  testCases: TestCase[],
  config: EvalReport["config"]
): EvalReport {
  return {
    runId: `baseline_${new Date().toISOString().replace(/[:.]/g, "-")}`,
    config,
    summary: computeSummary(results),
    perDomain: computePerDomain(results).perDomain,
    perDomainMacro: computePerDomain(results).macro,
    perDomainMicro: computePerDomain(results).micro,
    confusionMatrix: computeConfusionMatrix(results),
    byQueryLength: computeByQueryLength(results, testCases),
    byEdgeCase: computeByEdgeCase(results, testCases),
    refineHitRate: computeRefineHitRate(results),
    shortCircuit: computeShortCircuit(results),
    latencyMs: computeLatency(results),
    errors: computeErrors(results, testCases),
  };
}

// ===================================================================
// Markdown 报告生成
// ===================================================================

export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.runId}`);
  lines.push("");
  lines.push(`## 配置`);
  lines.push(`- llmMode: \`${report.config.llmMode}\``);
  if (report.config.mockSubMode) {
    lines.push(`- mockSubMode: \`${report.config.mockSubMode}\``);
  }
  lines.push(`- disableShortcuts: \`${report.config.disableShortcuts}\``);
  lines.push(`- seed: \`${report.config.seed}\``);
  lines.push(`- totalCases: **${report.config.totalCases}**`);
  lines.push("");

  lines.push(`## 主指标`);
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|----|`);
  lines.push(`| domain 准确率 | ${(report.summary.domainAcc * 100).toFixed(2)}% |`);
  lines.push(`| complexity 准确率 | ${(report.summary.complexityAcc * 100).toFixed(2)}% |`);
  lines.push(`| requiredAgents 精确匹配率 | ${(report.summary.agentsExactAcc * 100).toFixed(2)}% |`);
  lines.push(`| 端到端全对率 | ${(report.summary.fullAcc * 100).toFixed(2)}% |`);
  lines.push(`| 正确条数 | ${report.summary.correctCount} / ${report.config.totalCases} |`);
  lines.push("");

  lines.push(`## 每域 P/R/F1`);
  lines.push(`| 域 | precision | recall | f1 | support |`);
  lines.push(`|----|-----------|--------|----|---------|`);
  for (const dom of Object.keys(report.perDomain)) {
    const d = report.perDomain[dom];
    lines.push(
      `| ${dom} | ${(d.precision * 100).toFixed(1)}% | ${(d.recall * 100).toFixed(1)}% | ${(d.f1 * 100).toFixed(1)}% | ${d.support} |`
    );
  }
  lines.push(
    `| **macro avg** | ${(report.perDomainMacro.precision * 100).toFixed(1)}% | ${(report.perDomainMacro.recall * 100).toFixed(1)}% | ${(report.perDomainMacro.f1 * 100).toFixed(1)}% | - |`
  );
  lines.push(
    `| **micro avg** | ${(report.perDomainMicro.precision * 100).toFixed(1)}% | ${(report.perDomainMicro.recall * 100).toFixed(1)}% | ${(report.perDomainMicro.f1 * 100).toFixed(1)}% | - |`
  );
  lines.push("");

  lines.push(`## query 长度分段准确率`);
  lines.push(`| 长度 | domain 准确率 |`);
  lines.push(`|------|--------------|`);
  lines.push(`| short (≤15) | ${(report.byQueryLength.short * 100).toFixed(1)}% |`);
  lines.push(`| medium (16-40) | ${(report.byQueryLength.medium * 100).toFixed(1)}% |`);
  lines.push(`| long (41+) | ${(report.byQueryLength.long * 100).toFixed(1)}% |`);
  lines.push("");

  lines.push(`## edge case 子集准确率`);
  lines.push(`| 子集 | 准确率 | 总数 |`);
  lines.push(`|------|--------|------|`);
  for (const k of Object.keys(report.byEdgeCase)) {
    const e = report.byEdgeCase[k];
    lines.push(`| ${k} | ${(e.acc * 100).toFixed(1)}% | ${e.total} |`);
  }
  lines.push("");

  lines.push(`## refine 函数触发占比`);
  lines.push(`| 规则 | 触发率 |`);
  lines.push(`|------|--------|`);
  for (const k of Object.keys(report.refineHitRate)) {
    lines.push(`| ${k} | ${(report.refineHitRate[k] * 100).toFixed(1)}% |`);
  }
  lines.push("");

  lines.push(`## 短路 / 场景激活`);
  lines.push(`- 短路命中: ${report.shortCircuit.count} / ${report.config.totalCases} (${((report.shortCircuit.count / report.config.totalCases) * 100).toFixed(1)}%)`);
  lines.push(`- 场景激活: ${report.shortCircuit.sceneActivation} / ${report.config.totalCases} (${((report.shortCircuit.sceneActivation / report.config.totalCases) * 100).toFixed(1)}%)`);
  lines.push("");

  lines.push(`## 延迟 (毫秒)`);
  lines.push(`| p50 | p95 | min | max |`);
  lines.push(`|-----|-----|-----|-----|`);
  lines.push(
    `| ${report.latencyMs.p50} | ${report.latencyMs.p95} | ${report.latencyMs.min} | ${report.latencyMs.max} |`
  );
  lines.push("");

  lines.push(`## 误判矩阵`);
  lines.push(`行 = 真实域, 列 = 预测域`);
  lines.push("");
  lines.push(`| real \\ pred | ${report.confusionMatrix.labels.join(" | ")} |`);
  lines.push(`|${"-".repeat(15)}|${report.confusionMatrix.labels.map(() => "---").join("|")}|`);
  for (let i = 0; i < report.confusionMatrix.labels.length; i++) {
    const row = report.confusionMatrix.matrix[i];
    lines.push(
      `| ${report.confusionMatrix.labels[i]} | ${row.join(" | ")} |`
    );
  }
  lines.push("");

  lines.push(`## Top 误判 case`);
  if (report.errors.length === 0) {
    lines.push(`无误判 case。`);
  } else {
    lines.push(`| id | query | expected | got |`);
    lines.push(`|----|-------|----------|-----|`);
    for (const e of report.errors) {
      const q = e.query.length > 30 ? e.query.slice(0, 30) + "..." : e.query;
      lines.push(
        `| ${e.id} | ${q} | ${e.expected.domain} | ${e.got.domain} |`
      );
    }
  }
  lines.push("");

  lines.push(`## 下一步建议`);
  lines.push(`- 查看 edge case 子集准确率，定位**最弱**的 refine 函数`);
  lines.push(`- 查看误判矩阵，找出**最高频**的误判路径（如 office → service）`);
  lines.push(`- 切到 \`LLM_MODE=real\` 跑真实 baseline，对比 mock 数字`);
  lines.push(`- 优化后跑 \`compare_runs.ts\` 看 delta`);
  lines.push("");

  return lines.join("\n");
}
