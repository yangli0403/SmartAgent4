/**
 * M2-03 验证：E2E 路径 1b — PrefetchCache 命中（含 schemaVersion 校验）
 *
 * 覆盖：
 * - schemaVersion='v1' 缓存命中 → source=prefetch，0 LLM 调用
 * - schemaVersion='v0'（旧条目）→ source=invalid_version → 降级到规则层
 * - 缺失 schemaVersion 字段 → 同上（视为 invalid_version）
 */

import { describe, it, expect } from "vitest";
import { PreAnalysisNode } from "../../server/agent/preAnalysis/node/preAnalysisNode";
import { PrefetchCache } from "../../server/agent/preAnalysis/cache/prefetchCache";
import { SceneActivationCache } from "../../server/agent/preAnalysis/cache/sceneActivationCache";
import { RuleLayer } from "../../server/agent/preAnalysis/rules/ruleLayer";
import { createDefaultPreAnalyzerOutput } from "../../server/agent/preAnalysis/types/preAnalyzerOutput";
import type { LLMCaller, LLMCallResult } from "../../server/agent/preAnalysis/llm/llmPreAnalyzer";

function mockLLM(): LLMCaller {
  return {
    async call() {
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
}

describe("M2-03 E2E 路径 1b: PrefetchCache 命中", () => {
  it("schemaVersion='v1' 缓存命中 → source=prefetch", async () => {
    const prefetch = new PrefetchCache();
    prefetch.set("打开灯", createDefaultPreAnalyzerOutput({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      memoryRelevant: false,
      source: "prefetch",
      rewrittenQuery: "打开灯",
    }));
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM(),
      prefetchCache: prefetch,
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(r.output.source).toBe("prefetch");
    expect(r.output.domain).toBe("iot");
    expect(r.path).toBe("prefetch");
    expect(r.fellBack).toBe(false);
  });

  it("schemaVersion='v0' 旧条目 → source=invalid_version 降级", async () => {
    const prefetch = new PrefetchCache();
    // 直接注入旧版本条目（schema migration 场景）
    prefetch.setRaw({
      inputHash: prefetch.computeHash("打开灯"),
      output: {
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        rewrittenQuery: "打开灯",
        confidence: 0.9,
        reasoning: "cached",
        source: "prefetch",
        schemaVersion: "v0",                                     // 旧版本（绕开 Zod 字面量校验）
      },
      schemaVersion: "v0",
      cachedAt: Date.now(),
      ttlMs: 60000,
    });

    // 注入规则层以便降级后能返回有效结果
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
      llmCaller: mockLLM(),
      prefetchCache: prefetch,
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    // schema 不匹配 → 降级到规则层
    expect(r.output.source).toBe("rule");
    expect(r.output.domain).toBe("iot");
    expect(["rule", "rule_partial_to_llm"]).toContain(r.path);     // 走规则路径（complete 或 partial）
    expect(r.fellBack).toBe(false);                                // 不是 LLM fallback
  });

  it("缺失 schemaVersion 字段 → 视为 invalid_version 降级", async () => {
    const prefetch = new PrefetchCache();
    prefetch.setRaw({
      inputHash: prefetch.computeHash("打开灯"),
      output: {
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        rewrittenQuery: "打开灯",
        confidence: 0.9,
        reasoning: "cached",
        source: "prefetch",
        schemaVersion: undefined as any,                          // 缺失
      },
      schemaVersion: undefined as any,                          // 缺失 schemaVersion
      cachedAt: Date.now(),
      ttlMs: 60000,
    } as any);
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
      llmCaller: mockLLM(),
      prefetchCache: prefetch,
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(r.output.source).toBe("rule");
  });

  it("缓存 miss + 规则 complete → 走规则路径", async () => {
    const prefetch = new PrefetchCache();                            // 空缓存
    const layer = new RuleLayer();
    layer.addRule({
      id: "iot_rule",
      priority: 10,
      match: (input) => /打开/.test(input),
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
        { field: "rewrittenQuery", value: "x", evidenceScore: 1.0 },
        { field: "confidence", value: 0.9, evidenceScore: 0.9 },
        { field: "reasoning", value: "complete", evidenceScore: 0.8 },
      ],
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: layer,
      llmCaller: mockLLM(),
      prefetchCache: prefetch,
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开空调" });
    expect(r.output.source).toBe("rule");
    expect(r.path).toBe("rule");
  });
});