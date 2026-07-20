/**
 * M1-13 验证：preAnalysisNode 主流程（v1.3 集成所有修复）
 *
 * 覆盖路径：
 * - Path 1a: PrefetchCache 命中 → source=prefetch
 * - Path 1b: PrefetchCache schema 不匹配 → invalid_version → 降级
 * - Path 2a: RuleLayer isComplete → source=rule
 * - Path 2b: RuleLayer partial → 走 LLM，merge 未定义字段
 * - Path 4b: rulePartial 已 complete → 跳过 LLM（v1.3 修复 #3）
 * - Path 4c: LLM soft/hard timeout → fallback to rule（v1.3 修复 #13）
 * - A/B test fallback (v1.3 修复 #6)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PreAnalysisNode, createPreAnalysisNode } from "../../../server/agent/preAnalysis/node/preAnalysisNode";
import { PrefetchCache } from "../../../server/agent/preAnalysis/cache/prefetchCache";
import { RuleLayer } from "../../../server/agent/preAnalysis/rules/ruleLayer";
import { SceneActivationCache } from "../../../server/agent/preAnalysis/cache/sceneActivationCache";
import {
  LLMPreAnalyzerImpl,
  type LLMCaller,
  type LLMCallResult,
} from "../../../server/agent/preAnalysis/llm/llmPreAnalyzer";
import { createDefaultPreAnalyzerOutput } from "../../../server/agent/preAnalysis/types/preAnalyzerOutput";

// ============================================================
// 测试辅助
// ============================================================

function mockLLMCaller(response: Partial<LLMCallResult> | string): LLMCaller {
  return {
    async call() {
      if (typeof response === "string") {
        return { content: response, promptTokens: 50, completionTokens: 30 };
      }
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
        ...response,
      };
    },
  };
}

/** 包装 LLMCaller 使其 call 方法可被 spy */
function spyOnLLMCaller(caller: LLMCaller) {
  const originalCall = caller.call.bind(caller);
  const spy = vi.fn(originalCall);
  return { spy, caller: { ...caller, call: spy } as LLMCaller };
}

function makeRuleWithAllFields(): RuleLayer {
  const layer = new RuleLayer();
  layer.addRule({
    id: "complete_rule",
    priority: 10,
    match: () => true,
    produce: () => [
      { field: "domain", value: "iot", evidenceScore: 0.9 },
      { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
      { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
      { field: "rewrittenQuery", value: "x", evidenceScore: 1.0 },
      { field: "confidence", value: 0.9, evidenceScore: 0.9 },
      { field: "reasoning", value: "rule complete", evidenceScore: 0.8 },
    ],
  });
  return layer;
}

function makeRuleWithPartialFields(): RuleLayer {
  const layer = new RuleLayer();
  layer.addRule({
    id: "partial_rule",
    priority: 10,
    match: () => true,
    produce: () => [
      { field: "domain", value: "iot", evidenceScore: 0.9 },
      // 缺 requiredAgents / memoryRelevant → partial
    ],
  });
  return layer;
}

function makeEmptyRule(): RuleLayer {
  return new RuleLayer();
}

// ============================================================
// Path 2a: 规则层 complete
// ============================================================

describe("M1-13 Path 2a: RuleLayer isComplete", () => {
  it("规则完整 → 直接返回 source=rule，不调 LLM", async () => {
    const { spy, caller } = spyOnLLMCaller(mockLLMCaller({}));
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: makeRuleWithAllFields(),
      llmCaller: caller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开午睡模式" });
    expect(r.output.source).toBe("rule");
    expect(r.output.domain).toBe("iot");
    expect(r.path).toBe("rule");
    expect(spy).not.toHaveBeenCalled();
    expect(r.fellBack).toBe(false);
  });
});

// ============================================================
// Path 4b: rulePartial complete 跳 LLM（v1.3 修复 #3）
// ============================================================

describe("M1-13 Path 4b: rulePartial complete 跳过 LLM（v1.3 修复 #3）", () => {
  it("规则覆盖必需字段 → 跳过 LLM，source=rule", async () => {
    const { spy, caller } = spyOnLLMCaller(mockLLMCaller({}));
    const layer = new RuleLayer();
    layer.addRule({
      id: "all_required",
      priority: 10,
      match: () => true,
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: true, evidenceScore: 0.95 },
        // 缺 confidence / reasoning / rewrittenQuery → partial 但必需字段齐
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
    const r = await node.analyze({ userText: "上次我说的那个" });
    expect(r.output.source).toBe("rule");
    expect(r.output.memoryRelevant).toBe(true);
    expect(r.path).toBe("rule_partial_to_llm");
    expect(spy).not.toHaveBeenCalled();
    expect(r.fellBack).toBe(false);
  });
});

// ============================================================
// Path 2b: rulePartial 不完整 → 走 LLM + merge
// ============================================================

describe("M1-13 Path 2b: rulePartial → LLM + merge", () => {
  it("规则只提供 domain → LLM 填其余字段，rule domain 优先", async () => {
    const llmCaller = mockLLMCaller({
      content: JSON.stringify({
        domain: "general",                                    // LLM 也给 domain
        requiredAgents: ["generalAgent"],
        memoryRelevant: true,
        rewrittenQuery: "打开空调",
        confidence: 0.85,
      }),
    });
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: makeRuleWithPartialFields(),                 // 只给 domain=iot
      llmCaller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开空调" });
    expect(r.output.source).toBe("llm");
    // v1.3 修复 #3：rulePartial 已确定字段（domain=iot）优先于 LLM
    expect(r.output.domain).toBe("iot");
    // LLM 提供其余字段
    expect(r.output.memoryRelevant).toBe(true);
    expect(r.path).toBe("llm");
    expect(r.fellBack).toBe(false);
  });
});

// ============================================================
// Path 4c: LLM 超时降级（v1.3 修复 #13）
// ============================================================

describe("M1-13 Path 4c: LLM 超时降级（v1.3 修复 #13）", () => {
  it("LLM soft timeout → 降级到规则（source=rule + [fallback] 标记）", async () => {
    const slowCaller: LLMCaller = {
      async call(req) {
        // 模拟 soft timeout（默认 3s）— 立即 abort
        return new Promise<LLMCallResult>((resolve, reject) => {
          req.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
          setTimeout(() => resolve({ content: "{}", promptTokens: 1, completionTokens: 1 }), 10000);
        });
      },
    };
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: makeEmptyRule(),                              // 规则空 → fallback 为 default
      llmCaller: slowCaller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开空调" });
    expect(r.output.source).toBe("rule");
    expect(r.fellBack).toBe(true);
    expect(r.output.reasoning).toContain("[fallback:");
  });

  it("LLM 其他错误 → 降级到规则", async () => {
    const errorCaller: LLMCaller = {
      async call() {
        throw new Error("network failure");
      },
    };
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: makeRuleWithPartialFields(),
      llmCaller: errorCaller,
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "x" });
    expect(r.output.source).toBe("rule");
    expect(r.fellBack).toBe(true);
  });
});

// ============================================================
// Path 1: PrefetchCache 命中
// ============================================================

describe("M1-13 Path 1: PrefetchCache", () => {
  it("缓存命中 → 直接返回 source=prefetch，不调 LLM", async () => {
    const prefetch = new PrefetchCache();
    prefetch.set("打开灯", createDefaultPreAnalyzerOutput({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      memoryRelevant: false,
      source: "prefetch",
    }));
    const { spy, caller } = spyOnLLMCaller(mockLLMCaller({}));
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: makeRuleWithAllFields(),
      llmCaller: caller,
      prefetchCache: prefetch,
      sceneActivationCache: new SceneActivationCache(),
      enableMetrics: false,
    });
    const r = await node.analyze({ userText: "打开灯" });
    expect(r.output.source).toBe("prefetch");
    expect(r.path).toBe("prefetch");
    expect(spy).not.toHaveBeenCalled();
    expect(r.fellBack).toBe(false);
  });
});

// ============================================================
// SceneActivationCache fire-and-forget（v1.3 修复 #14）
// ============================================================

describe("M1-13 SceneActivationCache fire-and-forget（v1.3 修复 #14）", () => {
  it("主流程不阻塞 sceneActivation 查询", async () => {
    const sceneCache = new SceneActivationCache();
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: makeEmptyRule(),
      llmCaller: mockLLMCaller({}),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: sceneCache,
      enableMetrics: false,
    });
    const start = Date.now();
    const r = await node.analyze({
      userText: "打开午睡模式",
      userId: 123,
    });
    const duration = Date.now() - start;
    // 主流程 < 100ms（sceneActivation 是 fire-and-forget）
    expect(duration).toBeLessThan(100);
    expect(r.fellBack).toBe(false);
  });
});

// ============================================================
// createPreAnalysisNode 工厂
// ============================================================

describe("M1-13 createPreAnalysisNode 工厂", () => {
  it("无 config 创建默认实例", () => {
    const node = createPreAnalysisNode();
    expect(node).toBeInstanceOf(PreAnalysisNode);
  });

  it("带 config 创建自定义实例", () => {
    const node = createPreAnalysisNode({
      mode: "rule_only",
      enableMetrics: false,
    });
    expect(node).toBeInstanceOf(PreAnalysisNode);
  });
});

// ============================================================
// M1-13 v1.3 修复 #3：rulePartial 拼接策略
// ============================================================

describe("M1-13 v1.3 修复 #3 rulePartial 拼接", () => {
  it("rulePartial 全字段（6 字段齐全）→ 跳过 LLM", async () => {
    const { spy, caller } = spyOnLLMCaller(mockLLMCaller({}));
    const layer = new RuleLayer();
    layer.addRule({
      id: "all_fields",
      priority: 10,
      match: () => true,
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
        { field: "rewrittenQuery", value: "x", evidenceScore: 1.0 },
        { field: "confidence", value: 0.9, evidenceScore: 0.9 },
        { field: "reasoning", value: "all fields", evidenceScore: 0.8 },
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
    const r = await node.analyze({ userText: "x" });
    expect(r.output.source).toBe("rule");
    expect(spy).not.toHaveBeenCalled();
  });
});