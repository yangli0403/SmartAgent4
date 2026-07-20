/**
 * M2-04 验证：E2E 路径 4b — rulePartial 完整跳 LLM
 *
 * 契约（v1.3 修复 #3）：
 * - 当 rulePartial 命中所有 6 字段 → 直接走 source=rule，0 LLM 调用
 * - 当 rulePartial 命中 domain/requiredAgents/memoryRelevant 三个必需字段 → 跳过 LLM
 * - 当 rulePartial 缺失必需字段 → 走 LLM 补全
 */

import { describe, it, expect } from "vitest";
import { PreAnalysisNode } from "../../server/agent/preAnalysis/node/preAnalysisNode";
import { PrefetchCache } from "../../server/agent/preAnalysis/cache/prefetchCache";
import { SceneActivationCache } from "../../server/agent/preAnalysis/cache/sceneActivationCache";
import { RuleLayer } from "../../server/agent/preAnalysis/rules/ruleLayer";
import type { LLMCaller, LLMCallResult } from "../../server/agent/preAnalysis/llm/llmPreAnalyzer";

function makeLLMSpy() {
  const spy = { calls: 0 };
  const caller: LLMCaller = {
    async call() {
      spy.calls++;
      return {
        content: JSON.stringify({
          domain: "iot",
          requiredAgents: ["iotAgent"],
          memoryRelevant: false,
          rewrittenQuery: "x",
          confidence: 0.9,
        }),
        promptTokens: 50,
        completionTokens: 30,
      } as LLMCallResult;
    },
  };
  return { spy, caller };
}

describe("M2-04 E2E 路径 4b: rulePartial 完整跳 LLM", () => {
  it("rulePartial 全 6 字段 → 0 LLM 调用，source=rule", async () => {
    const { spy, caller } = makeLLMSpy();
    const layer = new RuleLayer();
    layer.addRule({
      id: "all_six_fields",
      priority: 10,
      match: () => true,
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
        { field: "rewrittenQuery", value: "x", evidenceScore: 1.0 },
        { field: "confidence", value: 0.92, evidenceScore: 0.9 },
        { field: "reasoning", value: "rule complete", evidenceScore: 0.8 },
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: caller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开空调" });
    expect(spy.calls).toBe(0);                                  // 关键：0 LLM 调用
    expect(r.output.source).toBe("rule");
    expect(r.path).toBe("rule");
    expect(r.output.domain).toBe("iot");
    expect(r.output.confidence).toBe(0.92);
  });

  it("rulePartial 命中必需 3 字段 → 跳 LLM，path=rule_partial_to_llm", async () => {
    const { spy, caller } = makeLLMSpy();
    const layer = new RuleLayer();
    layer.addRule({
      id: "three_required",
      priority: 10,
      match: () => true,
      produce: () => [
        { field: "domain", value: "navigation", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["navigationAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: true, evidenceScore: 0.95 },
        // 缺 confidence/reasoning/rewrittenQuery → 部分字段
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: caller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "导航到公司" });
    expect(spy.calls).toBe(0);                                  // 关键：0 LLM 调用
    expect(r.output.source).toBe("rule");
    expect(r.path).toBe("rule_partial_to_llm");                // 标签区分"实际未调 LLM"
    expect(r.output.domain).toBe("navigation");
    expect(r.output.memoryRelevant).toBe(true);
  });

  it("rulePartial 缺必需字段 → 走 LLM 补全", async () => {
    const { spy, caller } = makeLLMSpy();
    const layer = new RuleLayer();
    layer.addRule({
      id: "only_domain",
      priority: 10,
      match: () => true,
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        // 缺 requiredAgents/memoryRelevant → 必需字段不全
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: caller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(spy.calls).toBe(1);                                  // LLM 调用 1 次
    expect(r.output.source).toBe("llm");
    // v1.3 修复 #3：rulePartial.domain 优先
    expect(r.output.domain).toBe("iot");
    // LLM 补全其余字段
    expect(r.output.requiredAgents).toEqual(["iotAgent"]);
    expect(r.output.memoryRelevant).toBe(false);
  });

  it("rulePartial 提供 domain + memoryRelevant → LLM 补 requiredAgents", async () => {
    const { spy, caller } = makeLLMSpy();
    const layer = new RuleLayer();
    layer.addRule({
      id: "partial",
      priority: 10,
      match: () => true,
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "memoryRelevant", value: true, evidenceScore: 0.95 },
        // 缺 requiredAgents
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: caller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(spy.calls).toBe(1);
    // rulePartial 字段保留
    expect(r.output.domain).toBe("iot");
    expect(r.output.memoryRelevant).toBe(true);
  });

  it("空规则层 → 必走 LLM", async () => {
    const { spy, caller } = makeLLMSpy();
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: caller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "随便问个问题" });
    expect(spy.calls).toBe(1);
    expect(r.output.source).toBe("llm");
  });
});