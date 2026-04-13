/**
 * ExpressionMapping 单元测试
 *
 * 关联用户测试用例：UTC-007, UTC-008
 */
import { describe, it, expect } from "vitest";
import { EXPRESSION_MAPPING, getExpressionParams } from "../expressionMapping";

describe("ExpressionMapping", () => {
  it("应包含 16 种表情映射", () => {
    const keys = Object.keys(EXPRESSION_MAPPING);
    expect(keys.length).toBe(16);
  });

  it("每种表情都应有 name 和 params 字段", () => {
    for (const [key, mapping] of Object.entries(EXPRESSION_MAPPING)) {
      expect(mapping.name).toBe(key);
      expect(mapping.params).toBeDefined();
      expect(typeof mapping.params).toBe("object");
    }
  });

  it("neutral 表情的 ParamMouthForm 应为 0", () => {
    const neutral = EXPRESSION_MAPPING.neutral;
    expect(neutral.params.ParamMouthForm).toBe(0);
  });

  it("happy 表情的 ParamMouthForm 应为正值（微笑）", () => {
    const happy = EXPRESSION_MAPPING.happy;
    expect(happy.params.ParamMouthForm).toBeGreaterThan(0);
  });

  it("sad 表情的 ParamMouthForm 应为负值", () => {
    const sad = EXPRESSION_MAPPING.sad;
    expect(sad.params.ParamMouthForm).toBeLessThan(0);
  });

  it("shy 表情的 ParamCheek 应为高值（脸红）", () => {
    const shy = EXPRESSION_MAPPING.shy;
    expect(shy.params.ParamCheek).toBeGreaterThanOrEqual(0.5);
  });

  it("getExpressionParams 应返回已知表情的参数", () => {
    const result = getExpressionParams("happy");
    expect(result.name).toBe("happy");
    expect(result.params.ParamMouthForm).toBe(1.0);
  });

  it("getExpressionParams 应对未知表情降级为 neutral", () => {
    const result = getExpressionParams("unknown_emotion");
    expect(result.name).toBe("neutral");
  });
});
