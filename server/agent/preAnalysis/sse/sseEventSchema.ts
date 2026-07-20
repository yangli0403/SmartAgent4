/**
 * server/agent/preAnalysis/sse/sseEventSchema.ts
 *
 * SSE 事件 schema（v1.3 修复 #11）
 *
 * 问题：v1.3 移除了 `complexity` 字段，前端不知道何时停止读旧字段
 * 解决：所有 SSE 事件携带 `sseSchemaVersion` 字段
 *       前端检测到 ≥ v1.3 → 停止读 `complexity` 字段
 */

import { z } from "zod";

// ============================================================
// schema 版本常量
// ============================================================

/** 当前 SSE schema 版本 */
export const CURRENT_SSE_SCHEMA_VERSION = "v1.3";

/** 支持的 schema 版本列表（兼容性检查） */
export const SUPPORTED_SSE_SCHEMA_VERSIONS = ["v1.0", "v1.1", "v1.2", "v1.3"] as const;

export type SSESchemaVersion = (typeof SUPPORTED_SSE_SCHEMA_VERSIONS)[number];

/** 比较版本号（"v1.3" >= "v1.2"） */
export function compareSSEVersions(a: SSESchemaVersion, b: SSESchemaVersion): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** 当前版本是否 >= 目标版本 */
export function isSSEVersionAtLeast(current: SSESchemaVersion, target: SSESchemaVersion): boolean {
  return compareSSEVersions(current, target) >= 0;
}

// ============================================================
// SSE 事件基类
// ============================================================

const BaseSSEEventSchema = z.object({
  /** 事件唯一 ID（用于去重 + 排序） */
  eventId: z.string(),
  /** 事件类型 */
  eventType: z.enum([
    "preAnalysis",
    "contextEnrich",
    "classify",
    "plan",
    "execute",
    "respond",
    "memory",
    "error",
    "done",
  ]),
  /** 时间戳 */
  timestamp: z.number(),
  /** v1.3 修复 #11：SSE schema 版本（前端用来判断是否读 complexity 等已废弃字段） */
  sseSchemaVersion: z.literal("v1.3"),
});

export type BaseSSEEvent = z.infer<typeof BaseSSEEventSchema>;

// ============================================================
// preAnalysis 事件（v1.3 新增）
// ============================================================

export const PreAnalysisSSEEventSchema = BaseSSEEventSchema.extend({
  eventType: z.literal("preAnalysis"),
  payload: z.object({
    domain: z.string(),
    requiredAgents: z.array(z.string()),
    memoryRelevant: z.boolean(),
    source: z.enum(["rule", "llm", "similarity", "prefetch", "invalid_version"]),
    confidence: z.number(),
    durationMs: z.number(),
    fellBack: z.boolean().optional(),
  }),
});

export type PreAnalysisSSEEvent = z.infer<typeof PreAnalysisSSEEventSchema>;

// ============================================================
// classify 事件（v1.3 移除 complexity 字段）
// ============================================================

export const ClassifySSEEventSchema = BaseSSEEventSchema.extend({
  eventType: z.literal("classify"),
  payload: z.object({
    domain: z.string(),
    requiredAgents: z.array(z.string()),
    executionMode: z.enum(["single", "parallel", "plan"]),
    // 注意：v1.3 移除 complexity 字段；前端通过 sseSchemaVersion 判断是否读
  }),
});

export type ClassifySSEEvent = z.infer<typeof ClassifySSEEventSchema>;

// ============================================================
// 工厂方法
// ============================================================

let _eventCounter = 0;

/** 创建 preAnalysis SSE 事件（自动注入 sseSchemaVersion） */
export function createPreAnalysisSSEEvent(payload: PreAnalysisSSEEvent["payload"]): PreAnalysisSSEEvent {
  _eventCounter++;
  return {
    eventId: `evt_${Date.now()}_${_eventCounter}`,
    eventType: "preAnalysis",
    timestamp: Date.now(),
    sseSchemaVersion: CURRENT_SSE_SCHEMA_VERSION,             // 自动注入
    payload,
  };
}

/** 创建 classify SSE 事件 */
export function createClassifySSEEvent(payload: ClassifySSEEvent["payload"]): ClassifySSEEvent {
  _eventCounter++;
  return {
    eventId: `evt_${Date.now()}_${_eventCounter}`,
    eventType: "classify",
    timestamp: Date.now(),
    sseSchemaVersion: CURRENT_SSE_SCHEMA_VERSION,
    payload,
  };
}

/** 通用错误事件 */
export function createErrorSSEEvent(message: string, code?: string): BaseSSEEvent & { eventType: "error"; payload: { message: string; code?: string } } {
  _eventCounter++;
  return {
    eventId: `evt_${Date.now()}_${_eventCounter}`,
    eventType: "error",
    timestamp: Date.now(),
    sseSchemaVersion: CURRENT_SSE_SCHEMA_VERSION,
    payload: { message, code },
  };
}

/** 终止事件 */
export function createDoneSSEEvent(): BaseSSEEvent & { eventType: "done"; payload: Record<string, never> } {
  _eventCounter++;
  return {
    eventId: `evt_${Date.now()}_${_eventCounter}`,
    eventType: "done",
    timestamp: Date.now(),
    sseSchemaVersion: CURRENT_SSE_SCHEMA_VERSION,
    payload: {},
  };
}

/** 重置事件计数器（测试用） */
export function resetSSEEventCounter(): void {
  _eventCounter = 0;
}