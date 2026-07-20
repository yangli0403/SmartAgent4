/**
 * M2-02 验证：SceneActivationCache 真实 DB 查询接入
 *
 * 测试契约：
 * 1. fireAndForgetSceneActivation 调 sceneSearcher 注入函数
 * 2. 命中结果写入 sceneActivationCache.set
 * 3. 第二次同 query 直接走 cache 命中
 * 4. sceneSearcher 抛错时不阻塞主流程，返回空 matches
 * 5. sceneActivationPromise 在 supervisorGraph 集成中可被 await（200ms 上限）
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PreAnalysisNode } from "../../server/agent/preAnalysis/node/preAnalysisNode";
import { PrefetchCache } from "../../server/agent/preAnalysis/cache/prefetchCache";
import { RuleLayer } from "../../server/agent/preAnalysis/rules/ruleLayer";
import {
  SceneActivationCache,
  resetSceneActivationCache,
} from "../../server/agent/preAnalysis/cache/sceneActivationCache";
import { createDefaultPreAnalyzerOutput } from "../../server/agent/preAnalysis/types/preAnalyzerOutput";
import type { LLMCaller, LLMCallResult } from "../../server/agent/preAnalysis/llm/llmPreAnalyzer";

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

describe("M2-02 SceneActivation DB 查询接入", () => {
  let sceneCache: SceneActivationCache;

  beforeEach(() => {
    resetSceneActivationCache();
    sceneCache = new SceneActivationCache();
  });

  it("fireAndForgetSceneActivation 调 sceneSearcher 注入并写回 cache", async () => {
    let called = false;
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({ domain: "general", requiredAgents: ["generalAgent"], memoryRelevant: true, confidence: 0.8 }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: sceneCache,
      enableMetrics: false,
      sceneSearcher: async ({ query }) => {
        called = true;
        expect(query).toBe("打开午睡模式");
        return [{
          memoryId: 100,
          sceneName: "午睡模式",
          summary: "关窗帘+调低空调+播放白噪音",
          domain: "vehicle",
          triggerPhrases: ["午睡"],
          matchScore: 0.92,
        }];
      },
    });
    const r = await node.analyze({ userText: "打开午睡模式", userId: 1 });
    expect(r.sceneActivationPromise).toBeDefined();
    const sceneResult = await r.sceneActivationPromise!;
    expect(called).toBe(true);
    expect(sceneResult.matches).toHaveLength(1);
    expect(sceneResult.matches[0].sceneName).toBe("午睡模式");
    expect(sceneResult.dbFallback).toBe(true);

    // 验证 cache 写回
    const cached = sceneCache.get(1, "打开午睡模式");
    expect(cached.cacheHit).toBe(true);
    expect(cached.matches[0].memoryId).toBe(100);
  });

  it("第二次同 query 走 cache 命中（不调 searcher）", async () => {
    let callCount = 0;
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({ domain: "general", requiredAgents: ["generalAgent"], memoryRelevant: true, confidence: 0.8 }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: sceneCache,
      enableMetrics: false,
      sceneSearcher: async () => {
        callCount++;
        return [{ memoryId: 200, sceneName: "回家路线", summary: "导航回家", domain: "navigation" }];
      },
    });
    await node.analyze({ userText: "回家", userId: 2 });
    await new Promise((r) => setTimeout(r, 50)); // 等异步完成
    expect(callCount).toBe(1);

    // 第二次：cache 命中
    const r2 = await node.analyze({ userText: "回家", userId: 2 });
    const scene2 = await r2.sceneActivationPromise!;
    expect(scene2.cacheHit).toBe(true);
    expect(callCount).toBe(1); // searcher 未再调
  });

  it("sceneSearcher 抛错 → 返回空 matches，不阻塞主流程", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({ domain: "general", requiredAgents: ["generalAgent"], memoryRelevant: true, confidence: 0.8 }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: sceneCache,
      enableMetrics: false,
      sceneSearcher: async () => {
        throw new Error("DB connection lost");
      },
    });
    const r = await node.analyze({ userText: "测试", userId: 3 });
    const sceneResult = await r.sceneActivationPromise!;
    expect(sceneResult.matches).toHaveLength(0);
    expect(sceneResult.dbFallback).toBe(false); // 失败时 dbFallback=false
  });

  it("userId 缺失时 sceneActivationPromise 返回空结果", async () => {
    let called = false;
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({ domain: "general", requiredAgents: ["generalAgent"], memoryRelevant: true, confidence: 0.8 }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: sceneCache,
      enableMetrics: false,
      sceneSearcher: async () => {
        called = true;
        return [];
      },
    });
    const r = await node.analyze({ userText: "无用户ID" });
    const sceneResult = await r.sceneActivationPromise!;
    expect(called).toBe(false);
    expect(sceneResult.matches).toHaveLength(0);
  });

  it("预填 cache 后 analyze 直接命中（不调 searcher）", async () => {
    sceneCache.set(5, "午睡", [{
      memoryId: 999,
      sceneName: "午睡模式",
      summary: "预设场景",
      domain: "vehicle",
    }]);
    let called = false;
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({ domain: "general", requiredAgents: ["generalAgent"], memoryRelevant: true, confidence: 0.8 }),
      prefetchCache: new PrefetchCache(),
      sceneActivationCache: sceneCache,
      enableMetrics: false,
      sceneSearcher: async () => {
        called = true;
        return [];
      },
    });
    const r = await node.analyze({ userText: "午睡", userId: 5 });
    const sceneResult = await r.sceneActivationPromise!;
    expect(called).toBe(false);
    expect(sceneResult.cacheHit).toBe(true);
    expect(sceneResult.matches[0].memoryId).toBe(999);
  });
});
