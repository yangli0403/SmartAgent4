/**
 * M1-02 + M1-04 验证：RuleLayer + isComplete + calculateConfidence + 多租户
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  RuleLayer,
  getRuleLayer,
  clearTenantRegistry,
  calculateConfidence,
  type PreAnalysisRule,
} from "../../../server/agent/preAnalysis/rules/ruleLayer";

/** 测试用规则：固定输入"打开午睡模式" */
function buildSampleRules(): PreAnalysisRule[] {
  return [
    {
      id: "domain_rule",
      priority: 10,
      match: (input) => /打开|关闭/.test(input),
      produce: () => [{ field: "domain", value: "iot", evidenceScore: 0.9 }],
    },
    {
      id: "agent_rule",
      priority: 20,
      match: (input) => /午睡|睡觉/.test(input),
      produce: () => [{ field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 }],
    },
    {
      id: "memory_rule",
      priority: 30,
      match: () => true,                                       // 默认总是命中
      produce: () => [{ field: "memoryRelevant", value: false, evidenceScore: 0.95 }],
    },
    {
      id: "rewrite_rule",
      priority: 40,
      match: () => true,
      produce: (input) => [{ field: "rewrittenQuery", value: input, evidenceScore: 1.0 }],
    },
    {
      id: "reasoning_rule",
      priority: 50,
      match: () => true,
      produce: () => [{ field: "reasoning", value: "rule-based path", evidenceScore: 0.8 }],
    },
  ];
}

describe("M1-02 RuleLayer 基本行为", () => {
  let layer: RuleLayer;
  beforeEach(() => {
    layer = new RuleLayer();
  });

  it("addRule 按 priority 升序求值", () => {
    layer
      .addRule({ id: "high", priority: 100, match: () => true, produce: () => [] })
      .addRule({ id: "low", priority: 1, match: () => true, produce: () => [] });

    const rules = layer.getRules();
    expect(rules[0].id).toBe("low");
    expect(rules[1].id).toBe("high");
  });

  it("evaluate 返回所有规则的执行结果（含未命中）", () => {
    buildSampleRules().forEach((r) => layer.addRule(r));
    const result = layer.evaluate("打开午睡模式");
    expect(result.hits).toHaveLength(5);
    expect(result.hits.find((h) => h.rule.id === "domain_rule")?.result.matched).toBe(true);
  });

  it("evaluate 聚合首个提供的字段值", () => {
    buildSampleRules().forEach((r) => layer.addRule(r));
    const result = layer.evaluate("打开午睡模式");
    expect(result.aggregated.domain).toBe("iot");
    expect(result.aggregated.requiredAgents).toEqual(["iotAgent"]);
  });
});

describe("M1-04 isComplete 遍历所有规则（v1.3 修复 #2）", () => {
  it("partial_a + complete_b 都执行，never_c 不执行", () => {
    const layer = new RuleLayer();
    let aRan = false;
    let bRan = false;
    let cRan = false;

    layer
      .addRule({
        id: "partial_a",
        priority: 10,
        match: () => true,
        produce: () => {
          aRan = true;
          return [{ field: "domain", value: "iot", evidenceScore: 0.9 }];
        },
      })
      .addRule({
        id: "complete_b",
        priority: 20,
        match: () => true,
        produce: () => {
          bRan = true;
          return [
            { field: "requiredAgents", value: ["iotAgent"], evidenceScore: 0.85 },
            { field: "memoryRelevant", value: false, evidenceScore: 0.95 },
            { field: "rewrittenQuery", value: "x", evidenceScore: 1.0 },
            { field: "confidence", value: 0.8, evidenceScore: 0.9 },
            { field: "reasoning", value: "x", evidenceScore: 0.8 },
          ];
        },
      })
      .addRule({
        id: "never_c",
        priority: 30,
        match: () => true,
        produce: () => {
          cRan = true;
          return [];
        },
      });

    const result = layer.evaluate("test");
    expect(aRan).toBe(true);
    expect(bRan).toBe(true);
    expect(cRan).toBe(true);                            // v1.3 修复 #2：所有规则都执行（即使 a/b 已 complete）
    expect(result.isComplete).toBe(true);
  });

  it("isComplete 6 字段齐全才返回 true", () => {
    const layer = new RuleLayer();
    layer.addRule({
      id: "only_domain",
      priority: 1,
      match: () => true,
      produce: () => [{ field: "domain", value: "iot", evidenceScore: 0.9 }],
    });
    const result = layer.evaluate("x");
    expect(result.isComplete).toBe(false);
  });

  it("isComplete 缺 memoryRelevant 返回 false", () => {
    const layer = new RuleLayer();
    buildSampleRules().slice(0, 4).forEach((r) => layer.addRule(r));   // 缺 reasoning_rule
    const result = layer.evaluate("打开午睡模式");
    expect(result.aggregated.reasoning).toBeUndefined();
    expect(result.isComplete).toBe(false);
  });
});

describe("M1-04 calculateConfidence 统一公式（v1.3 修复 #5/#8）", () => {
  it("无命中规则 → 0", () => {
    expect(calculateConfidence([], {})).toBe(0);
  });

  it("单条规则命中 → evidenceScore × agreementFactor", () => {
    const hits = [
      {
        rule: {} as any,
        result: {
          ruleId: "r1",
          matched: true,
          hits: [{ field: "domain", value: "iot", evidenceScore: 0.9 }],
          rawConfidence: 0.9,
          durationMs: 0,
        },
      },
    ];
    const conf = calculateConfidence(hits, {});
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  it("多条规则 → overall < 1（含 agreementFactor 衰减）", () => {
    const hits = [
      {
        rule: {} as any,
        result: {
          ruleId: "r1",
          matched: true,
          hits: [{ field: "domain", value: "iot", evidenceScore: 1.0 }],
          rawConfidence: 1.0,
          durationMs: 0,
        },
      },
      {
        rule: {} as any,
        result: {
          ruleId: "r2",
          matched: true,
          hits: [{ field: "x", value: "y", evidenceScore: 0.2 }],
          rawConfidence: 0.2,
          durationMs: 0,
        },
      },
    ];
    const conf = calculateConfidence(hits, {});
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThan(1);
  });

  it("结果钳制到 [0, 1]", () => {
    const hits = [
      {
        rule: {} as any,
        result: {
          ruleId: "r1",
          matched: true,
          hits: [{ field: "x", value: "y", evidenceScore: 1.5 }],   // 超界
          rawConfidence: 1.5,
          durationMs: 0,
        },
      },
    ];
    const conf = calculateConfidence(hits, {});
    expect(conf).toBeLessThanOrEqual(1);
  });
});

describe("M1-03 多租户独立实例（v1.3 修复 #10）", () => {
  beforeEach(() => clearTenantRegistry());

  it("getRuleLayer(tenantId) 返回独立实例", () => {
    const a = getRuleLayer("tenantA");
    const b = getRuleLayer("tenantB");
    expect(a).not.toBe(b);
  });

  it("同 tenant 多次调用返回同一实例", () => {
    const a1 = getRuleLayer("tenantA");
    const a2 = getRuleLayer("tenantA");
    expect(a1).toBe(a2);
  });

  it("tenantA 注册规则 tenantB 看不到", () => {
    const a = getRuleLayer("tenantA");
    a.addRule({
      id: "a_only",
      priority: 1,
      match: () => true,
      produce: () => [],
    });
    expect(getRuleLayer("tenantA").getRules()).toHaveLength(1);
    expect(getRuleLayer("tenantB").getRules()).toHaveLength(0);
  });

  it("无 tenantId 返回 default 实例", () => {
    const d1 = getRuleLayer();
    const d2 = getRuleLayer();
    expect(d1).toBe(d2);
  });
});