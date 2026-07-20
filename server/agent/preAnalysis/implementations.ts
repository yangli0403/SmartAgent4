/**
 * server/agent/preAnalysis/implementations.ts
 *
 * 4 种 IPreAnalyzer 实现（骨架 + 自动注册）
 */

import {
  registerPreAnalyzer,
  type IPreAnalyzer,
  type PreAnalysisContext,
} from "./iPreAnalyzer";
import {
  createDefaultPreAnalyzerOutput,
  CURRENT_SCHEMA_VERSION,
  type PreAnalyzerOutput,
  type Source,
} from "./types/preAnalyzerOutput";

// ============================================================
// RuleOnlyPreAnalyzer — 纯规则实现（无 LLM 调用，最快）
// ============================================================

export class RuleOnlyPreAnalyzer implements IPreAnalyzer {
  readonly name = "rule_only";

  async analyze(input: string, ctx: PreAnalysisContext): Promise<PreAnalyzerOutput> {
    // 骨架：实际逻辑由 RuleLayer 注入
    // 这里返回 default + source='rule'
    return createDefaultPreAnalyzerOutput({
      domain: this.detectDomainFromKeywords(input),
      requiredAgents: this.detectAgentsFromKeywords(input),
      memoryRelevant: this.detectMemoryNeed(input),
      rewrittenQuery: input,
      confidence: 0.85,
      reasoning: "rule_only path: keyword matching",
      source: "rule",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  }

  private detectDomainFromKeywords(input: string): string {
    const lower = input.toLowerCase();
    if (/(打开|关闭|启动)/.test(input) && /(灯|模式|空调|午睡)/.test(input)) return "iot";
    if (/(导航|去|到|路线)/.test(input)) return "navigation";
    if (/(播放|音乐|歌)/.test(input)) return "multimedia";
    if (/(文件|文档|表格)/.test(input)) return "file_system";
    return "general";
  }

  private detectAgentsFromKeywords(input: string): string[] {
    const domain = this.detectDomainFromKeywords(input);
    return [`${domain}Agent`];
  }

  private detectMemoryNeed(input: string): boolean {
    // 默认 false（v1.3 修复 #1 保守默认）
    return /(之前|上次|上一次|记得)/.test(input);
  }
}

// ============================================================
// LLMPreAnalyzer — 调 LLM 的标准实现（占位，由 M1-05 充实）
// ============================================================

export class LLMPreAnalyzer implements IPreAnalyzer {
  readonly name = "llm";

  async analyze(input: string, ctx: PreAnalysisContext): Promise<PreAnalyzerOutput> {
    // 骨架：实际 LLM 调用由 M1-05 注入
    return createDefaultPreAnalyzerOutput({
      domain: "unknown",
      requiredAgents: [],
      memoryRelevant: false,
      rewrittenQuery: input,
      confidence: 0.5,
      reasoning: "llm path: stub (real impl in M1-05)",
      source: "llm",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  }
}

// ============================================================
// FineTunedPreAnalyzer — 微调小模型（占位）
// ============================================================

export class FineTunedPreAnalyzer implements IPreAnalyzer {
  readonly name = "finetuned";

  async analyze(input: string, ctx: PreAnalysisContext): Promise<PreAnalyzerOutput> {
    // 骨架：实际推理由 M1-05 同期实现（可选 Phase 2）
    return createDefaultPreAnalyzerOutput({
      source: "llm",
      reasoning: "finetuned stub",
    });
  }
}

// ============================================================
// ABTestPreAnalyzer — A/B 测试包装器
// ============================================================

export class ABTestPreAnalyzer implements IPreAnalyzer {
  readonly name = "ab_test";
  private variantA: IPreAnalyzer;
  private variantB: IPreAnalyzer;
  private trafficSplit: number;                       // 0.0 - 1.0

  constructor(variantA: IPreAnalyzer, variantB: IPreAnalyzer, trafficSplit = 0.5) {
    this.variantA = variantA;
    this.variantB = variantB;
    this.trafficSplit = trafficSplit;
  }

  async analyze(input: string, ctx: PreAnalysisContext): Promise<PreAnalyzerOutput> {
    const useA = Math.random() < this.trafficSplit;
    const primary = useA ? this.variantA : this.variantB;
    const fallback = useA ? this.variantB : this.variantA;

    try {
      return await primary.analyze(input, ctx);
    } catch (err) {
      // v1.3 修复 #6：A 失败 → B → 规则兜底
      try {
        return await fallback.analyze(input, ctx);
      } catch {
        return createDefaultPreAnalyzerOutput({
          source: "rule",
          reasoning: "ab_test fallback to default rule",
        });
      }
    }
  }
}

// ============================================================
// 默认注册（启动时调用，可重复调用实现幂等覆盖）
// ============================================================

export function registerDefaultPreAnalyzers(): void {
  registerPreAnalyzer("llm", new LLMPreAnalyzer());
  registerPreAnalyzer("finetuned", new FineTunedPreAnalyzer());
  registerPreAnalyzer("rule_only", new RuleOnlyPreAnalyzer());
  registerPreAnalyzer("ab_test", new ABTestPreAnalyzer(new LLMPreAnalyzer(), new RuleOnlyPreAnalyzer()));
}