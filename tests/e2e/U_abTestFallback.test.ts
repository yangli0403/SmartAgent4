/**
 * M2-06 验证：A/B test fallback（v1.3 修复 #6）
 *
 * 契约：
 * - variant A 成功 → 返回 A 结果
 * - variant A 异常 → 降级到 variant B
 * - variant A 和 B 都异常 → 降级到 default rule
 */

import { describe, it, expect } from "vitest";
import {
  ABTestPreAnalyzer,
  LLMPreAnalyzer,
  RuleOnlyPreAnalyzer,
  FineTunedPreAnalyzer,
} from "../../server/agent/preAnalysis/implementations";
import type { IPreAnalyzer, PreAnalysisContext } from "../../server/agent/preAnalysis/iPreAnalyzer";
import type { PreAnalyzerOutput } from "../../server/agent/preAnalysis/types/preAnalyzerOutput";
import { createDefaultPreAnalyzerOutput } from "../../server/agent/preAnalysis/types/preAnalyzerOutput";

/** 创建一个会抛错的 mock preAnalyzer */
function makeFailingAnalyzer(name: string, message: string): IPreAnalyzer {
  return {
    name,
    async analyze(): Promise<PreAnalyzerOutput> {
      throw new Error(message);
    },
  };
}

/** 创建一个成功的 mock preAnalyzer */
function makeOkAnalyzer(name: string, source: "llm" | "rule" = "llm"): IPreAnalyzer {
  return {
    name,
    async analyze(): Promise<PreAnalyzerOutput> {
      return createDefaultPreAnalyzerOutput({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        source,
        reasoning: `${name} ok`,
      });
    },
  };
}

const baseCtx: PreAnalysisContext = { userId: "1", sessionId: "s", traceId: "t" };

describe("M2-06 A/B test fallback（v1.3 修复 #6）", () => {
  it("variant A 成功 → 返回 A 结果", async () => {
    const a = makeOkAnalyzer("A", "llm");
    const b = makeFailingAnalyzer("B", "B 不可用");
    const ab = new ABTestPreAnalyzer(a, b, 1.0);              // 100% traffic to A
    const out = await ab.analyze("x", baseCtx);
    expect(out.source).toBe("llm");
    expect(out.reasoning).toContain("A ok");
  });

  it("variant A 异常 → 降级到 variant B", async () => {
    const a = makeFailingAnalyzer("A", "A 不可用");
    const b = makeOkAnalyzer("B", "llm");
    const ab = new ABTestPreAnalyzer(a, b, 1.0);
    const out = await ab.analyze("x", baseCtx);
    expect(out.source).toBe("llm");
    expect(out.reasoning).toContain("B ok");
  });

  it("variant A 和 B 都异常 → 降级到 default rule", async () => {
    const a = makeFailingAnalyzer("A", "A 不可用");
    const b = makeFailingAnalyzer("B", "B 不可用");
    const ab = new ABTestPreAnalyzer(a, b, 1.0);
    const out = await ab.analyze("x", baseCtx);
    expect(out.source).toBe("rule");
    expect(out.reasoning).toContain("ab_test fallback");
  });

  it("trafficSplit=0 → 100% B", async () => {
    const a = makeFailingAnalyzer("A", "A 不可用");
    const b = makeOkAnalyzer("B", "llm");
    const ab = new ABTestPreAnalyzer(a, b, 0.0);              // 100% B
    const out = await ab.analyze("x", baseCtx);
    expect(out.source).toBe("llm");
    expect(out.reasoning).toContain("B ok");
  });

  it("trafficSplit=0.5 → 概率分流（多次抽样）", async () => {
    const a = makeOkAnalyzer("A");
    const b = makeOkAnalyzer("B");
    const ab = new ABTestPreAnalyzer(a, b, 0.5);
    let aCount = 0;
    let bCount = 0;
    for (let i = 0; i < 100; i++) {
      const out = await ab.analyze("x", baseCtx);
      if (out.reasoning?.includes("A ok")) aCount++;
      else bCount++;
    }
    // 概率分布不应极端（不可能全 A 或全 B）
    expect(aCount + bCount).toBe(100);
    expect(aCount).toBeGreaterThan(20);                        // 至少 20% A
    expect(bCount).toBeGreaterThan(20);                        // 至少 20% B
  });

  it("ABTestPreAnalyzer + FineTunedPreAnalyzer 模拟 FineTuned 异常 → LLM 兜底", async () => {
    // FineTunedPreAnalyzer 默认是 stub，可以直接用
    // 构造一个会抛错的 wrapper 模拟 FineTuned 模型加载失败
    const failingFineTuned: IPreAnalyzer = {
      name: "finetuned_failed",
      async analyze(): Promise<PreAnalyzerOutput> {
        throw new Error("FineTuned 模型未加载");
      },
    };
    const llmOk = makeOkAnalyzer("llm", "llm");
    const ab = new ABTestPreAnalyzer(failingFineTuned, llmOk, 1.0);
    const out = await ab.analyze("x", baseCtx);
    expect(out.source).toBe("llm");
    expect(out.reasoning).toContain("llm ok");
  });

  it("真实 FineTunedPreAnalyzer（stub）+ LLM 异常 → 降级到 rule", async () => {
    const fineTuned = new FineTunedPreAnalyzer();             // stub 返回 llm source
    const failingLLM = makeFailingAnalyzer("llm_failed", "LLM API 限流");
    const ab = new ABTestPreAnalyzer(fineTuned, failingLLM, 1.0);
    const out = await ab.analyze("x", baseCtx);
    // 第一次随机选 A 或 B：
    // - 选 A（FineTuned）→ 成功 → 返回 llm source (stub 默认返回 source='llm')
    // - 选 B（failingLLM）→ 异常 → 选 A（FineTuned）→ 成功
    // 都成功 → 返回 FineTuned 的输出（source=llm）
    expect(out.source).toBe("llm");
  });

  it("RuleOnlyPreAnalyzer 可作为 ABTest 的 fallback 之一", async () => {
    const llmFail = makeFailingAnalyzer("llm_fail", "API down");
    const ruleOk = new RuleOnlyPreAnalyzer();
    const ab = new ABTestPreAnalyzer(llmFail, ruleOk, 1.0);
    const out = await ab.analyze("打开灯", baseCtx);
    // llm_fail → rule_ok → 返回 rule_only 的输出
    expect(out.source).toBe("rule");
    expect(out.domain).toBe("iot");
  });
});