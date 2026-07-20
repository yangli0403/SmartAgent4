/**
 * PreAnalyzerOutput schema 单元测试
 */

import { describe, it, expect } from "vitest";
import {
  PreAnalyzerOutputSchema,
  SourceSchema,
  Source,
  CURRENT_SCHEMA_VERSION,
  createDefaultPreAnalyzerOutput,
} from "../../../server/agent/preAnalysis/types/preAnalyzerOutput";

describe("PreAnalyzerOutput Zod schema", () => {
  const validBase = {
    domain: "iot",
    requiredAgents: ["iotAgent"],
    memoryRelevant: false,
    rewrittenQuery: "打开午睡模式",
    confidence: 0.9,
    reasoning: "硬规则命中",
    source: "rule" as const,
    schemaVersion: "v1" as const,
  };

  describe("合法输入", () => {
    it("合法 base 输出通过校验", () => {
      expect(() => PreAnalyzerOutputSchema.parse(validBase)).not.toThrow();
    });

    it("5 种 source 全部合法", () => {
      const sources = ["rule", "llm", "similarity", "prefetch", "invalid_version"] as const;
      for (const source of sources) {
        expect(() =>
          PreAnalyzerOutputSchema.parse({ ...validBase, source })
        ).not.toThrow();
      }
    });

    it("confidence = 0 和 1 都合法", () => {
      expect(() => PreAnalyzerOutputSchema.parse({ ...validBase, confidence: 0 })).not.toThrow();
      expect(() => PreAnalyzerOutputSchema.parse({ ...validBase, confidence: 1 })).not.toThrow();
    });
  });

  describe("非法输入拒绝", () => {
    it("confidence = 1.5 拒绝", () => {
      expect(() =>
        PreAnalyzerOutputSchema.parse({ ...validBase, confidence: 1.5 })
      ).toThrow();
    });

    it("confidence = -0.1 拒绝", () => {
      expect(() =>
        PreAnalyzerOutputSchema.parse({ ...validBase, confidence: -0.1 })
      ).toThrow();
    });

    it("source = 'magic' 拒绝", () => {
      expect(() =>
        PreAnalyzerOutputSchema.parse({ ...validBase, source: "magic" as any })
      ).toThrow();
    });

    it("schemaVersion 缺失拒绝", () => {
      const { schemaVersion, ...rest } = validBase;
      expect(() => PreAnalyzerOutputSchema.parse(rest)).toThrow();
    });

    it("schemaVersion = 'v0' 拒绝（仅允许 'v1'）", () => {
      expect(() =>
        PreAnalyzerOutputSchema.parse({ ...validBase, schemaVersion: "v0" as any })
      ).toThrow();
    });

    it("requiredAgents 非数组拒绝", () => {
      expect(() =>
        PreAnalyzerOutputSchema.parse({ ...validBase, requiredAgents: "iotAgent" as any })
      ).toThrow();
    });
  });

  describe("Source 枚举常量", () => {
    it("5 个常量值正确", () => {
      expect(Source.RULE).toBe("rule");
      expect(Source.LLM).toBe("llm");
      expect(Source.SIMILARITY).toBe("similarity");
      expect(Source.PREFETCH).toBe("prefetch");
      expect(Source.INVALID_VERSION).toBe("invalid_version");
    });

    it("CURRENT_SCHEMA_VERSION = 'v1'", () => {
      expect(CURRENT_SCHEMA_VERSION).toBe("v1");
    });
  });

  describe("createDefaultPreAnalyzerOutput 工厂", () => {
    it("无 overrides 返回默认值", () => {
      const out = createDefaultPreAnalyzerOutput();
      expect(out.domain).toBe("unknown");
      expect(out.memoryRelevant).toBe(false);   // v1.3 修复 #1
      expect(out.confidence).toBe(0);
      expect(out.source).toBe("rule");
      expect(out.schemaVersion).toBe("v1");
    });

    it("partial overrides 应用", () => {
      const out = createDefaultPreAnalyzerOutput({ domain: "navigation", confidence: 0.8 });
      expect(out.domain).toBe("navigation");
      expect(out.confidence).toBe(0.8);
      expect(out.memoryRelevant).toBe(false);   // 未 override 保留默认
    });

    it("SchemaSource enum 与 Source 常量等价", () => {
      expect(SourceSchema.options).toContain(Source.INVALID_VERSION);
    });
  });
});