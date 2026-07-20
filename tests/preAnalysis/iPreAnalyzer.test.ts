/**
 * M1-01 验证：IPreAnalyzer 接口 + 4 实现注册表
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPreAnalyzer,
  getPreAnalyzer,
  clearRegistry,
  listImplementations,
  type PreAnalysisContext,
} from "../../server/agent/preAnalysis/iPreAnalyzer";
import {
  RuleOnlyPreAnalyzer,
  LLMPreAnalyzer,
  FineTunedPreAnalyzer,
  ABTestPreAnalyzer,
  registerDefaultPreAnalyzers,
} from "../../server/agent/preAnalysis/implementations";

const baseCtx: PreAnalysisContext = {
  userId: "user_123",
  sessionId: "sess_456",
  traceId: "0af7651916cd43dd8448eb211c80319c",
};

describe("M1-01 IPreAnalyzer 注册表", () => {
  beforeEach(() => clearRegistry());

  it("registerPreAnalyzer 注册 4 种实现", () => {
    registerPreAnalyzer("llm", new LLMPreAnalyzer());
    registerPreAnalyzer("finetuned", new FineTunedPreAnalyzer());
    registerPreAnalyzer("rule_only", new RuleOnlyPreAnalyzer());
    registerPreAnalyzer("ab_test", new ABTestPreAnalyzer(new LLMPreAnalyzer(), new RuleOnlyPreAnalyzer()));

    expect(listImplementations()).toHaveLength(4);
  });

  it("getPreAnalyzer 按名获取", () => {
    registerDefaultPreAnalyzers();
    const llm = getPreAnalyzer("llm");
    expect(llm.name).toBe("llm");

    const rule = getPreAnalyzer("rule_only");
    expect(rule.name).toBe("rule_only");
  });

  it("getPreAnalyzer 未注册时抛错", () => {
    expect(() => getPreAnalyzer("llm")).toThrow(/未注册/);
  });

  it("registerDefaultPreAnalyzers 注册 4 种默认实现", () => {
    registerDefaultPreAnalyzers();
    expect(listImplementations().sort()).toEqual(
      ["ab_test", "finetuned", "llm", "rule_only"].sort()
    );
  });
});

describe("M1-01 RuleOnlyPreAnalyzer 行为", () => {
  it("IoT 关键词识别", async () => {
    const a = new RuleOnlyPreAnalyzer();
    const out = await a.analyze("打开午睡模式", baseCtx);
    expect(out.domain).toBe("iot");
    expect(out.requiredAgents).toContain("iotAgent");
    expect(out.source).toBe("rule");
    expect(out.schemaVersion).toBe("v1");
  });

  it("navigation 关键词识别", async () => {
    const a = new RuleOnlyPreAnalyzer();
    const out = await a.analyze("导航到上海虹桥机场", baseCtx);
    expect(out.domain).toBe("navigation");
    expect(out.requiredAgents).toContain("navigationAgent");
  });

  it("未命中关键词 → general", async () => {
    const a = new RuleOnlyPreAnalyzer();
    const out = await a.analyze("今天天气不错", baseCtx);
    expect(out.domain).toBe("general");
  });

  it("memoryRelevant 默认 false（v1.3 修复 #1）", async () => {
    const a = new RuleOnlyPreAnalyzer();
    const out = await a.analyze("打开灯", baseCtx);
    expect(out.memoryRelevant).toBe(false);
  });

  it("含'之前/上次'关键词 → memoryRelevant=true", async () => {
    const a = new RuleOnlyPreAnalyzer();
    const out = await a.analyze("上次我跟你说的那个", baseCtx);
    expect(out.memoryRelevant).toBe(true);
  });
});

describe("M1-01 ABTestPreAnalyzer fallback（v1.3 修复 #6）", () => {
  it("A 成功 → A 结果", async () => {
    const a = new ABTestPreAnalyzer(
      new RuleOnlyPreAnalyzer(),
      new LLMPreAnalyzer(),
      1.0                                              // 100% 走 A
    );
    const out = await a.analyze("打开灯", baseCtx);
    expect(out.source).toBe("rule");                  // 来自 RuleOnlyPreAnalyzer
  });

  it("A 抛错 → B 兜底", async () => {
    const failingA = {
      name: "failing",
      analyze: () => Promise.reject(new Error("A boom")),
    };
    const ab = new ABTestPreAnalyzer(
      failingA as any,
      new RuleOnlyPreAnalyzer(),
      1.0
    );
    const out = await ab.analyze("打开灯", baseCtx);
    expect(out.source).toBe("rule");                  // 来自 fallback RuleOnlyPreAnalyzer
  });

  it("A 和 B 都抛错 → 默认 rule", async () => {
    const failingA = {
      name: "failing",
      analyze: () => Promise.reject(new Error("A boom")),
    };
    const failingB = {
      name: "failing",
      analyze: () => Promise.reject(new Error("B boom")),
    };
    const ab = new ABTestPreAnalyzer(failingA as any, failingB as any);
    const out = await ab.analyze("打开灯", baseCtx);
    expect(out.source).toBe("rule");
    expect(out.reasoning).toContain("ab_test fallback");
  });
});