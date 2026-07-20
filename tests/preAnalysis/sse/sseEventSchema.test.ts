/**
 * M3-01 验证：SSE sseSchemaVersion 字段（v1.3 修复 #11）
 *
 * 契约：
 * - 所有 SSE 事件必须包含 `sseSchemaVersion: "v1.3"`
 * - 前端通过检测 sseSchemaVersion 决定是否读 `complexity` 字段
 * - v1.3 后 classify 事件不再包含 complexity 字段
 */

import { describe, it, expect } from "vitest";
import {
  CURRENT_SSE_SCHEMA_VERSION,
  SUPPORTED_SSE_SCHEMA_VERSIONS,
  compareSSEVersions,
  isSSEVersionAtLeast,
  createPreAnalysisSSEEvent,
  createClassifySSEEvent,
  createErrorSSEEvent,
  createDoneSSEEvent,
  PreAnalysisSSEEventSchema,
  ClassifySSEEventSchema,
  resetSSEEventCounter,
} from "../../../server/agent/preAnalysis/sse/sseEventSchema";

describe("M3-01 SSE sseSchemaVersion 字段（v1.3 修复 #11）", () => {
  beforeEach(() => resetSSEEventCounter());

  it("CURRENT_SSE_SCHEMA_VERSION === 'v1.3'", () => {
    expect(CURRENT_SSE_SCHEMA_VERSION).toBe("v1.3");
  });

  it("SUPPORTED_SSE_SCHEMA_VERSIONS 包含 v1.0~v1.3", () => {
    expect(SUPPORTED_SSE_SCHEMA_VERSIONS).toContain("v1.0");
    expect(SUPPORTED_SSE_SCHEMA_VERSIONS).toContain("v1.3");
  });

  it("createPreAnalysisSSEEvent 自动注入 sseSchemaVersion='v1.3'", () => {
    const evt = createPreAnalysisSSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      memoryRelevant: false,
      source: "rule",
      confidence: 0.9,
      durationMs: 50,
    });
    expect(evt.sseSchemaVersion).toBe("v1.3");
    expect(evt.eventType).toBe("preAnalysis");
    expect(PreAnalysisSSEEventSchema.safeParse(evt).success).toBe(true);
  });

  it("createClassifySSEEvent 自动注入 sseSchemaVersion='v1.3'", () => {
    const evt = createClassifySSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      executionMode: "single",
    });
    expect(evt.sseSchemaVersion).toBe("v1.3");
    // 注意：v1.3 移除 complexity 字段
    expect((evt.payload as any).complexity).toBeUndefined();
    expect(ClassifySSEEventSchema.safeParse(evt).success).toBe(true);
  });

  it("createErrorSSEEvent 包含 sseSchemaVersion", () => {
    const evt = createErrorSSEEvent("LLM 限流", "LLM_RATE_LIMITED");
    expect(evt.sseSchemaVersion).toBe("v1.3");
    expect(evt.eventType).toBe("error");
  });

  it("createDoneSSEEvent 包含 sseSchemaVersion", () => {
    const evt = createDoneSSEEvent();
    expect(evt.sseSchemaVersion).toBe("v1.3");
    expect(evt.eventType).toBe("done");
  });
});

describe("M3-01 版本比较函数", () => {
  it("compareSSEVersions: v1.3 > v1.2", () => {
    expect(compareSSEVersions("v1.3", "v1.2")).toBeGreaterThan(0);
  });

  it("compareSSEVersions: v1.0 < v1.3", () => {
    expect(compareSSEVersions("v1.0", "v1.3")).toBeLessThan(0);
  });

  it("compareSSEVersions: v1.3 === v1.3", () => {
    expect(compareSSEVersions("v1.3", "v1.3")).toBe(0);
  });

  it("isSSEVersionAtLeast: v1.3 >= v1.2 → true", () => {
    expect(isSSEVersionAtLeast("v1.3", "v1.2")).toBe(true);
  });

  it("isSSEVersionAtLeast: v1.0 >= v1.3 → false", () => {
    expect(isSSEVersionAtLeast("v1.0", "v1.3")).toBe(false);
  });
});

describe("M3-01 Zod 校验", () => {
  it("缺失 sseSchemaVersion 字段 → 校验失败", () => {
    const evt = {
      eventId: "evt_1",
      eventType: "preAnalysis" as const,
      timestamp: Date.now(),
      payload: {
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        source: "rule" as const,
        confidence: 0.9,
        durationMs: 50,
      },
      // sseSchemaVersion 缺失
    };
    expect(PreAnalysisSSEEventSchema.safeParse(evt).success).toBe(false);
  });

  it("sseSchemaVersion='v1.0'（旧版本）→ 校验失败", () => {
    const evt = {
      eventId: "evt_1",
      eventType: "preAnalysis" as const,
      timestamp: Date.now(),
      sseSchemaVersion: "v1.0" as const,
      payload: {
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        source: "rule" as const,
        confidence: 0.9,
        durationMs: 50,
      },
    };
    expect(PreAnalysisSSEEventSchema.safeParse(evt).success).toBe(false);
  });

  it("classify 事件 payload 不应包含 complexity 字段", () => {
    const evt = createClassifySSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      executionMode: "single",
    });
    // strict mode 默认 strip 未知字段 — 验证 stripped 后不存在
    const parsed = ClassifySSEEventSchema.parse(evt);
    expect((parsed.payload as any).complexity).toBeUndefined();
  });
});