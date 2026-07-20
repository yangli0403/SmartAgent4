/**
 * M0-03 验证：source enum + 14 错误码字典
 */

import { describe, it, expect } from "vitest";
import {
  Source,
  SourceSchema,
  CURRENT_SCHEMA_VERSION,
  ERROR_CODES,
  isRetryable,
  getErrorCode,
  type ErrorCode,
} from "../../../server/agent/preAnalysis/types/errorCodes";

describe("M0-03 Source enum 完整性", () => {
  it("5 个 source 值齐全", () => {
    expect(Source.RULE).toBe("rule");
    expect(Source.LLM).toBe("llm");
    expect(Source.SIMILARITY).toBe("similarity");
    expect(Source.PREFETCH).toBe("prefetch");
    expect(Source.INVALID_VERSION).toBe("invalid_version");
  });

  it("SourceSchema 与 Source 常量等价", () => {
    expect(SourceSchema.options).toEqual(
      expect.arrayContaining(Object.values(Source))
    );
  });

  it("CURRENT_SCHEMA_VERSION = 'v1'", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("v1");
  });
});

describe("M0-03 14 错误码字典完整性", () => {
  const allCodes = Object.keys(ERROR_CODES) as ErrorCode[];

  it("错误码总数 = 14", () => {
    expect(allCodes).toHaveLength(14);
  });

  it("每个错误码 4 字段齐全", () => {
    for (const code of allCodes) {
      const entry = ERROR_CODES[code];
      expect(entry.code).toBe(code);
      expect(typeof entry.httpStatus).toBe("number");
      expect(typeof entry.message).toBe("string");
      expect(typeof entry.retryable).toBe("boolean");
      expect(["info", "warning", "critical"]).toContain(entry.severity);
    }
  });

  it("INVALID_VERSION_SCHEMA 是 200 + warning（降级非失败）", () => {
    const e = ERROR_CODES.INVALID_VERSION_SCHEMA;
    expect(e.httpStatus).toBe(200);
    expect(e.severity).toBe("warning");
    expect(e.retryable).toBe(false);
  });

  it("LLM_TIMEOUT_SOFT 是 200 + retryable", () => {
    expect(ERROR_CODES.LLM_TIMEOUT_SOFT.retryable).toBe(true);
    expect(ERROR_CODES.LLM_TIMEOUT_SOFT.severity).toBe("warning");
  });

  it("LLM_TIMEOUT_HARD 是 200 + not retryable（已降级）", () => {
    expect(ERROR_CODES.LLM_TIMEOUT_HARD.retryable).toBe(false);
  });

  it("getErrorCode 返回正确条目", () => {
    expect(getErrorCode("RULE_TIMEOUT").code).toBe("RULE_TIMEOUT");
    expect(getErrorCode("INTERNAL_ERROR").httpStatus).toBe(500);
  });

  it("isRetryable 判断正确", () => {
    expect(isRetryable("LLM_TIMEOUT_SOFT")).toBe(true);
    expect(isRetryable("LLM_TIMEOUT_HARD")).toBe(false);
    expect(isRetryable("INVALID_VERSION_SCHEMA")).toBe(false);
    expect(isRetryable("CACHE_LOOKUP_TIMEOUT")).toBe(true);
  });

  it("critical 级别错误 5xx 状态（500 或 502）", () => {
    const criticals = allCodes.filter((c) => ERROR_CODES[c].severity === "critical");
    expect(criticals.length).toBeGreaterThan(0);
    for (const c of criticals) {
      expect([500, 502]).toContain(ERROR_CODES[c].httpStatus);
    }
  });

  it("14 错误码具体清单（含按类型分组）", () => {
    // 缓存类 3
    expect(allCodes).toContain("INVALID_VERSION_SCHEMA");
    expect(allCodes).toContain("CACHE_LOOKUP_TIMEOUT");
    expect(allCodes).toContain("CACHE_WRITE_FAILED");
    // 规则类 2
    expect(allCodes).toContain("RULE_TIMEOUT");
    expect(allCodes).toContain("RULE_LAYER_MISSING");
    // LLM 类 5
    expect(allCodes).toContain("LLM_TIMEOUT_SOFT");
    expect(allCodes).toContain("LLM_TIMEOUT_HARD");
    expect(allCodes).toContain("LLM_RATE_LIMITED");
    expect(allCodes).toContain("LLM_RESPONSE_INVALID");
    expect(allCodes).toContain("LLM_API_KEY_MISSING");
    // Scene 类 2
    expect(allCodes).toContain("SCENE_DB_TIMEOUT");
    expect(allCodes).toContain("SCENE_INVALID_OUTPUT");
    // 配置 1 + 通用 1
    expect(allCodes).toContain("INVALID_CONFIG");
    expect(allCodes).toContain("INTERNAL_ERROR");
  });
});