/**
 * server/observability/schemas.ts — 日志 Zod schema
 *
 * 对齐 02-架构设计.md §11 Observability + TESTING §13.2
 */

import { z } from "zod";
import { SourceSchema } from "../agent/preAnalysis/types/preAnalyzerOutput";

// ============================================================
// PreAnalysisLog
// ============================================================

export const PreAnalysisLogSchema = z.object({
  timestamp: z.string(),                                  // ISO8601
  traceId: z.string().regex(/^[0-9a-f]{32}$/i),         // W3C 32 hex
  userId: z.string(),
  sessionId: z.string(),
  input: z.string(),

  output: z.object({
    domain: z.string(),
    requiredAgents: z.array(z.string()),
    memoryRelevant: z.boolean(),
    rewrittenQuery: z.string(),
    confidence: z.number().min(0).max(1),
    source: SourceSchema,
    reasoning: z.string(),
    schemaVersion: z.literal("v1"),                      // 强制
  }),

  durationMs: z.number().min(0),
  cacheHit: z.boolean(),
  schemaVersion: z.literal("v1"),                        // 顶层 schemaVersion 强制
});

export type PreAnalysisLog = z.infer<typeof PreAnalysisLogSchema>;

// ============================================================
// ContextEnrichLog
// ============================================================

export const ContextEnrichLogSchema = z.object({
  timestamp: z.string(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/i),
  userId: z.string(),
  sessionId: z.string(),
  durationMs: z.number().min(0),
  retrievalCalled: z.boolean(),
  retrievalResultCount: z.number().int().min(0).optional(),
  profileSnapshotSize: z.number().int().min(0),
  promptLength: z.number().int().min(0),
});

export type ContextEnrichLog = z.infer<typeof ContextEnrichLogSchema>;

// ============================================================
// SceneActivationLog
// ============================================================

export const SceneActivationLogSchema = z.object({
  timestamp: z.string(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/i),
  userId: z.string(),
  sceneName: z.string().nullable(),
  cacheHit: z.boolean(),
  durationMs: z.number().min(0),
});

export type SceneActivationLog = z.infer<typeof SceneActivationLogSchema>;