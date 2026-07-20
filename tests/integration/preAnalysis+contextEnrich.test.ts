/**
 * M2-01 验证：preAnalysisNode → contextEnrichNode 串联
 *
 * 测试契约：
 * - preAnalysisNode.output.memoryRelevant=true → contextEnrichNode 触发记忆检索
 * - preAnalysisNode.output.memoryRelevant=false → contextEnrichNode 跳过检索
 *
 * 这里不直接调真实 contextEnrichNode（避免 DB 依赖），
 * 而是模拟其核心行为：读取 preAnalysisResult.memoryRelevant 决定是否检索。
 */

import { describe, it, expect } from "vitest";
import { PreAnalysisNode } from "../../server/agent/preAnalysis/node/preAnalysisNode";
import { PrefetchCache } from "../../server/agent/preAnalysis/cache/prefetchCache";
import { RuleLayer } from "../../server/agent/preAnalysis/rules/ruleLayer";
import { SceneActivationCache } from "../../server/agent/preAnalysis/cache/sceneActivationCache";
import { createDefaultPreAnalyzerOutput } from "../../server/agent/preAnalysis/types/preAnalyzerOutput";
import type { LLMCaller, LLMCallResult } from "../../server/agent/preAnalysis/llm/llmPreAnalyzer";

/** 模拟 contextEnrichNode 的核心决策：基于 memoryRelevant 决定是否检索 */
function mockContextEnrich(preAnalysisOutput: { memoryRelevant: boolean; rewrittenQuery: string }) {
  return {
    shouldRetrieveMemory: preAnalysisOutput.memoryRelevant,
    retrievalQuery: preAnalysisOutput.rewrittenQuery,
    retrievalTriggered: preAnalysisOutput.memoryRelevant,
    retrievalSkipped: !preAnalysisOutput.memoryRelevant,
  };
}

function mockLLM(response: any): LLMCaller {
  return {
    async call() {
      return {
        content: typeof response === "string" ? response : JSON.stringify(response),
        promptTokens: 50,
        completionTokens: 30,
      } as LLMCallResult;
    },
  };
}

describe("M2-01 preAnalysisNode → contextEnrichNode 串联", () => {
  it("memoryRelevant=true → contextEnrichNode 触发检索", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "general",
        requiredAgents: ["generalAgent"],
        memoryRelevant: true,
        rewrittenQuery: "上次我说的那个",
        confidence: 0.85,
      }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "上次我说的那个" });
    const enrich = mockContextEnrich(r.output);
    expect(enrich.shouldRetrieveMemory).toBe(true);
    expect(enrich.retrievalTriggered).toBe(true);
    expect(enrich.retrievalQuery).toBe("上次我说的那个");
  });

  it("memoryRelevant=false → contextEnrichNode 跳过检索", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        rewrittenQuery: "打开空调",
        confidence: 0.9,
      }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开空调" });
    const enrich = mockContextEnrich(r.output);
    expect(enrich.shouldRetrieveMemory).toBe(false);
    expect(enrich.retrievalSkipped).toBe(true);
  });

  it("prefetch 缓存命中 → 输出 memoryRelevant 由 cache 决定", async () => {
    const prefetch = new PrefetchCache();
    prefetch.set("打开灯", createDefaultPreAnalyzerOutput({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      memoryRelevant: false,                                  // 缓存：不需要查记忆
      source: "prefetch",
      rewrittenQuery: "打开灯",
    }));
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({}),
      prefetchCache: prefetch,
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(r.output.source).toBe("prefetch");
    const enrich = mockContextEnrich(r.output);
    expect(enrich.shouldRetrieveMemory).toBe(false);
  });

  it("规则层提供 memoryRelevant=false → contextEnrichNode 跳过检索（无 LLM）", async () => {
    const layer = new RuleLayer();
    layer.addRule({
      id: "iot_rule",
      priority: 10,
      match: (input) => /打开/.test(input),
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: mockLLM({}),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(r.output.source).toBe("rule");
    expect(r.output.memoryRelevant).toBe(false);
    const enrich = mockContextEnrich(r.output);
    expect(enrich.retrievalSkipped).toBe(true);
  });

  it("规则层提供 memoryRelevant=true → contextEnrichNode 触发检索（无 LLM）", async () => {
    const layer = new RuleLayer();
    layer.addRule({
      id: "memory_rule",
      priority: 10,
      match: (input) => /(之前|上次|记得)/.test(input),
      produce: () => [
        { field: "domain", value: "general", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["generalAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: true, evidenceScore: 0.95 },
        { field: "rewrittenQuery", value: "上次提到的地址", evidenceScore: 1.0 },
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: mockLLM({}),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "上次说的地址是哪里" });
    expect(r.output.source).toBe("rule");
    expect(r.output.memoryRelevant).toBe(true);
    const enrich = mockContextEnrich(r.output);
    expect(enrich.retrievalTriggered).toBe(true);
    expect(enrich.retrievalQuery).toBe("上次提到的地址");
  });
});