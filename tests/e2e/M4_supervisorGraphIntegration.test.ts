/**
 * M4 验证：supervisorGraph 集成 preAnalysisNode 全链路
 *
 * 测试契约（PRD v1.2 §5.3 + 架构 §3.5）：
 * - 入口新增 preAnalysisNode（4 路流水线：PrefetchCache → RuleLayer → Similarity → LLM）
 * - TaskClassification 字段：domain + executionMode（替代 complexity）
 * - contextEnrichNode 读 state.preAnalysisResult.rewrittenQuery / memoryRelevant
 * - sceneActivationResult 命中时走 special plan（generalAgent + memory_search）
 *
 * 这里用 stub LLM 和 in-memory cache 模拟整图，避免真实 DB / 网络。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

// 复用 M0-M3 模块
import { PreAnalysisNode } from "../../server/agent/preAnalysis/node/preAnalysisNode";
import { PrefetchCache } from "../../server/agent/preAnalysis/cache/prefetchCache";
import { RuleLayer } from "../../server/agent/preAnalysis/rules/ruleLayer";
import { SceneActivationCache } from "../../server/agent/preAnalysis/cache/sceneActivationCache";
import type { LLMCaller, LLMCallResult } from "../../server/agent/preAnalysis/llm/llmPreAnalyzer";

// ============================================================
// 复用 state.ts 中的核心 schema（精简版，避免拉入整个 SupervisorState）
// ============================================================

const TestState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
  userText: Annotation<string>({
    reducer: (_e, i) => i,
    default: () => "",
  }),
  preAnalysisResult: Annotation<any | null>({
    reducer: (_e, i) => i,
    default: () => null,
  }),
  sceneActivationResult: Annotation<any | null>({
    reducer: (_e, i) => i,
    default: () => null,
  }),
  taskClassification: Annotation<any | null>({
    reducer: (_e, i) => i,
    default: () => null,
  }),
  /** contextEnrichNode stub 输出：是否触发检索 */
  retrievedMemories: Annotation<number>({
    reducer: (_e, i) => i,
    default: () => 0,
  }),
  /** contextEnrichNode stub 输出：检索关键词 */
  retrievalQuery: Annotation<string>({
    reducer: (_e, i) => i,
    default: () => "",
  }),
});

// ============================================================
// Mocks
// ============================================================

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

/** 模拟 classifyNode（M4-05 重写后的 v1.3 行为）：
 *  读 preAnalysisResult 构建 TaskClassification
 *  sceneActivation 命中时切到 "plan" mode + 注入 memory_search Agent
 */
async function stubClassifyNode(state: any) {
  const pa = state.preAnalysisResult;
  if (!pa) {
    return {
      taskClassification: {
        domain: "unknown",
        executionMode: "single",
        complexity: "simple",
        reasoning: "[stub] no preAnalysis",
        requiredAgents: ["generalAgent"],
      },
    };
  }
  let executionMode = "single";
  let requiredAgents = pa.requiredAgents ?? ["generalAgent"];

  // sceneActivation 命中 → special plan
  if (state.sceneActivationResult?.matches && state.sceneActivationResult.matches.length > 0) {
    executionMode = "plan";
    // 合并 matches 中的 matchedAgents（如 memory_search）
    for (const m of state.sceneActivationResult.matches) {
      if (Array.isArray(m.matchedAgents)) {
        for (const a of m.matchedAgents) {
          if (!requiredAgents.includes(a)) requiredAgents = [...requiredAgents, a];
        }
      }
    }
  } else if (requiredAgents.length >= 2) {
    executionMode = "parallel";
  }

  return {
    taskClassification: {
      domain: pa.domain,
      executionMode,
      complexity:
        executionMode === "single"
          ? "simple"
          : executionMode === "parallel"
            ? "moderate"
            : "complex",
      reasoning: `[stub] from preAnalysis source=${pa.source}`,
      requiredAgents,
    },
  };
}

/** 模拟 contextEnrichNode（M4-06 行为）：读 memoryRelevant 决定是否检索 */
async function stubContextEnrichNode(state: any) {
  const pa = state.preAnalysisResult;
  if (!pa) return { retrievedMemories: 0, retrievalQuery: state.userText };
  return {
    retrievedMemories: pa.memoryRelevant ? 3 : 0,
    retrievalQuery: pa.rewrittenQuery ?? state.userText,
  };
}

function buildTestGraph(preAnalysisNode: PreAnalysisNode) {
  const preAnalysisNodeFn = async (state: any) => {
    const r = await preAnalysisNode.analyze({ userText: state.userText });
    return { preAnalysisResult: r.output };
  };

  return new StateGraph(TestState)
    .addNode("preAnalysis", preAnalysisNodeFn)
    .addNode("contextEnrich", stubContextEnrichNode)
    .addNode("classify", stubClassifyNode)
    .addEdge(START, "preAnalysis")
    .addEdge("preAnalysis", "contextEnrich")
    .addEdge("contextEnrich", "classify")
    .addEdge("classify", END)
    .compile();
}

// ============================================================
// 测试套件
// ============================================================

describe("M4-12 supervisorGraph 集成 e2e", () => {
  let prefetchCache: PrefetchCache;
  let sceneActivationCache: SceneActivationCache;

  beforeEach(() => {
    prefetchCache = new PrefetchCache();
    sceneActivationCache = new SceneActivationCache();
  });

  it("完整流程：preAnalysis → contextEnrich → classify 输出 executionMode", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "navigation",
        requiredAgents: ["navigationAgent"],
        memoryRelevant: false,
        rewrittenQuery: "导航到国贸",
        confidence: 0.92,
      }),
      prefetchCache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);

    const state = await graph.invoke({
      messages: [new HumanMessage("导航到国贸")],
      userText: "导航到国贸",
    });

    expect(state.preAnalysisResult).toBeDefined();
    expect(state.preAnalysisResult.source).toBe("llm");
    expect(state.preAnalysisResult.domain).toBe("navigation");
    expect(state.taskClassification).toBeDefined();
    expect(state.taskClassification.domain).toBe("navigation");
    expect(state.taskClassification.executionMode).toBe("single");
    expect(state.taskClassification.requiredAgents).toContain("navigationAgent");
    // executionMode ↔ complexity 双写保持一致
    expect(state.taskClassification.complexity).toBe("simple");
  });

  it("RuleLayer 命中 → 无 LLM 调用 → source=rule", async () => {
    const ruleLayer = new RuleLayer();
    ruleLayer.addRule({
      id: "iot_rule",
      priority: 10,
      match: (input) => /打开/.test(input),
      produce: () => [
        { field: "domain", value: "iot", evidenceScore: 0.9 },
        { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
        { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
      ],
    });
    let llmCalled = false;
    const tracker: LLMCaller = {
      async call() {
        llmCalled = true;
        return { content: "{}", promptTokens: 10, completionTokens: 5 } as LLMCallResult;
      },
    };
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer,
      llmCaller: tracker,
      prefetchCache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);
    const state = await graph.invoke({
      messages: [new HumanMessage("打开客厅的灯")],
      userText: "打开客厅的灯",
    });

    expect(llmCalled).toBe(false);
    expect(state.preAnalysisResult.source).toBe("rule");
    expect(state.preAnalysisResult.domain).toBe("iot");
    expect(state.taskClassification.executionMode).toBe("single");
  });

  it("PrefetchCache 命中 → 跳过 RuleLayer + LLM", async () => {
    const cache = new PrefetchCache();
    const inputHash = cache.computeHash("查询余额");
    cache.setRaw({
      inputHash,
      output: {
        domain: "finance",
        requiredAgents: ["financeAgent"],
        memoryRelevant: false,
        rewrittenQuery: "查询余额",
        confidence: 0.95,
        source: "prefetch",
        schemaVersion: "v1",
      },
      schemaVersion: "v1",
      cachedAt: Date.now(),
      ttlMs: 60000,
    });
    let llmCalled = false;
    const tracker: LLMCaller = {
      async call() {
        llmCalled = true;
        return { content: "{}", promptTokens: 10, completionTokens: 5 } as LLMCallResult;
      },
    };
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: tracker,
      prefetchCache: cache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);
    const state = await graph.invoke({
      messages: [new HumanMessage("查询余额")],
      userText: "查询余额",
    });

    expect(llmCalled).toBe(false);
    expect(state.preAnalysisResult.source).toBe("prefetch");
    expect(state.taskClassification.domain).toBe("finance");
  });

  it("sceneActivation 命中 → executionMode='plan' + 注入 memory_search Agent", async () => {
    // 注意：M4 阶段 preAnalysisNode 内 fireAndForgetSceneActivation 仅占位（M2-02 接入）。
    // 本测试通过直接注入 state.sceneActivationResult 验证 classifyNode 的 special plan 路径。
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "general",
        requiredAgents: ["generalAgent"],
        memoryRelevant: true,
        rewrittenQuery: "最近做了什么",
        confidence: 0.8,
      }),
      prefetchCache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);
    const state = await graph.invoke({
      messages: [new HumanMessage("最近做了什么")],
      userText: "最近做了什么",
      // M2-02 接入后由 preAnalysisNode 自动填充；当前由测试桩直接注入
      sceneActivationResult: {
        schemaVersion: "v1",
        cacheHit: true,
        matches: [
          {
            sceneId: "memory_summary",
            sceneName: "记忆摘要",
            confidence: 0.88,
            matchedAgents: ["memory_search"],
          } as any,
        ],
        dbFallback: false,
        durationMs: 5,
      },
    });

    expect(state.preAnalysisResult.domain).toBe("general");
    expect(state.taskClassification.executionMode).toBe("plan");
    expect(state.taskClassification.requiredAgents).toContain("generalAgent");
    expect(state.taskClassification.requiredAgents).toContain("memory_search");
    expect(state.taskClassification.complexity).toBe("complex");
  });

  it("多 Agent → executionMode='parallel'", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "cross_domain",
        requiredAgents: ["navAgent", "weatherAgent"],
        memoryRelevant: false,
        rewrittenQuery: "查天气然后导航",
        confidence: 0.85,
      }),
      prefetchCache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);
    const state = await graph.invoke({
      messages: [new HumanMessage("查天气然后导航")],
      userText: "查天气然后导航",
    });

    expect(state.taskClassification.executionMode).toBe("parallel");
    expect(state.taskClassification.requiredAgents).toHaveLength(2);
    expect(state.taskClassification.complexity).toBe("moderate");
  });

  it("contextEnrichNode 读 memoryRelevant=false → 跳过记忆检索", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        rewrittenQuery: "关闭空调",
        confidence: 0.9,
      }),
      prefetchCache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);
    const state = await graph.invoke({
      messages: [new HumanMessage("关闭空调")],
      userText: "关闭空调",
    });

    // stubContextEnrichNode 用 retrievedMemories 字段表达是否触发检索
    expect(state.retrievedMemories).toBe(0);
    expect(state.retrievalQuery).toBe("关闭空调");
  });

  it("contextEnrichNode 读 memoryRelevant=true → 触发记忆检索", async () => {
    const node = new PreAnalysisNode({
      mode: "llm",
      ruleLayer: new RuleLayer(),
      llmCaller: mockLLM({
        domain: "general",
        requiredAgents: ["generalAgent"],
        memoryRelevant: true,
        rewrittenQuery: "上次公司地址",
        confidence: 0.88,
      }),
      prefetchCache,
      sceneActivationCache,
      enableMetrics: false,
    });
    const graph = buildTestGraph(node);
    const state = await graph.invoke({
      messages: [new HumanMessage("上次公司地址是什么")],
      userText: "上次公司地址是什么",
    });

    expect(state.retrievedMemories).toBe(3);
    expect(state.retrievalQuery).toBe("上次公司地址");
  });
});