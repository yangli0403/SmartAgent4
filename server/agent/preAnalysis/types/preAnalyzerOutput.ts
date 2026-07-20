/**
 * PreAnalyzerOutput — 预分析节点标准输出 schema (v1.3)
 *
 * 对齐 03-接口文档.md §3.1 + 02-架构设计.md §11 Observability。
 * 6 字段 + source 枚举 + schemaVersion 强制校验。
 */

import { z } from "zod";

/**
 * Source 枚举（5 个合法值）
 * v1.3 新增 invalid_version（缓存 schemaVersion 不匹配）
 */
export const SourceSchema = z.enum([
  "rule",
  "llm",
  "similarity",
  "prefetch",
  "invalid_version",
]);
export type Source = z.infer<typeof SourceSchema>;

/**
 * PreAnalyzerOutput — 预分析节点对外输出
 *
 * 6 业务字段 + 2 元字段（source, schemaVersion）
 */
export const PreAnalyzerOutputSchema = z.object({
  // 6 业务字段
  domain: z.string(),                              // 业务领域（iot/navigation/.../unknown）
  requiredAgents: z.array(z.string()),              // 委派目标 Agent 列表
  memoryRelevant: z.boolean(),                     // 是否需要查记忆（v1.3 默认 false 保守）
  rewrittenQuery: z.string(),                      // 查询改写（代词消解后）
  confidence: z.number().min(0).max(1),            // 置信度 ∈ [0, 1]
  reasoning: z.string(),                           // 决策理由（调试用）

  // 2 元字段
  source: SourceSchema,                            // 决策来源
  schemaVersion: z.literal("v1"),                  // 当前 schema 版本（必填）
});

export type PreAnalyzerOutput = z.infer<typeof PreAnalyzerOutputSchema>;

/**
 * Source 常量（便于 import）
 */
export const Source = {
  RULE: "rule" as const,
  LLM: "llm" as const,
  SIMILARITY: "similarity" as const,
  PREFETCH: "prefetch" as const,
  INVALID_VERSION: "invalid_version" as const,
} as const;

/**
 * 当前 schema 版本常量
 */
export const CURRENT_SCHEMA_VERSION = "v1" as const;

/**
 * 默认输出工厂
 */
export function createDefaultPreAnalyzerOutput(
  overrides: Partial<PreAnalyzerOutput> = {}
): PreAnalyzerOutput {
  return PreAnalyzerOutputSchema.parse({
    domain: "unknown",
    requiredAgents: [],
    memoryRelevant: false,       // v1.3 修复 #1：保守默认
    rewrittenQuery: "",
    confidence: 0,
    reasoning: "",
    source: "rule",
    schemaVersion: "v1",
    ...overrides,
  });
}