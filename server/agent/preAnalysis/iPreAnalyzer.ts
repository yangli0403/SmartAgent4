/**
 * server/agent/preAnalysis/iPreAnalyzer.ts
 *
 * IPreAnalyzer 接口 + 上下文 + 4 种实现注册表
 * 对齐 02-架构设计.md §3.1
 */

import type { PreAnalyzerOutput } from "./types/preAnalyzerOutput";

// ============================================================
// 上下文
// ============================================================

export interface PreAnalysisContext {
  userId: string;
  sessionId: string;
  traceId: string;                                    // 32 hex
  tenantId?: string;                                  // 多租户
  history?: Array<{ role: string; content: string }>; // 最近 N 轮
  locale?: string;
  location?: { city?: string; lat?: number; lng?: number };
}

// ============================================================
// 接口
// ============================================================

export interface IPreAnalyzer {
  readonly name: string;                              // "llm" / "finetuned" / "rule_only" / "ab_test"
  analyze(input: string, ctx: PreAnalysisContext): Promise<PreAnalyzerOutput>;
}

// ============================================================
// 注册表
// ============================================================

type ImplName = "llm" | "finetuned" | "rule_only" | "ab_test";

const registry = new Map<ImplName, IPreAnalyzer>();

export function registerPreAnalyzer(name: ImplName, impl: IPreAnalyzer): void {
  registry.set(name, impl);
}

export function getPreAnalyzer(name?: ImplName): IPreAnalyzer {
  const resolved = name ?? (process.env.IPreAnalyzerImpl as ImplName) ?? "llm";
  const impl = registry.get(resolved);
  if (!impl) {
    throw new Error(`[iPreAnalyzer] 未注册实现: ${resolved}`);
  }
  return impl;
}

export function clearRegistry(): void {
  registry.clear();
}

export function listImplementations(): ImplName[] {
  return Array.from(registry.keys());
}