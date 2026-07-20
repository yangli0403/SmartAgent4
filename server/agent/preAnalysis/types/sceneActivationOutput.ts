/**
 * server/agent/preAnalysis/types/sceneActivationOutput.ts
 *
 * SceneActivationOutput — scene 激活查询的缓存结果（v1.3 修复 #4）
 *
 * 与 PreAnalyzerOutput 的关键区别：不包含 memoryRelevant 字段
 * 原因：scene 激活只关心"匹配到哪个 scene"，是否查记忆由 preAnalysisNode 后续决定
 */

import { z } from "zod";

// ============================================================
// 单个 scene 匹配项
// ============================================================

export const SceneMatchSchema = z.object({
  /** memoryId（来自 memory 表） */
  memoryId: z.number().int().positive(),
  /** scene 名称，如"午睡模式" */
  sceneName: z.string().min(1),
  /** 场景摘要 */
  summary: z.string(),
  /** domain（来自 SceneDomain） */
  domain: z.string(),
  /** 触发短语 */
  triggerPhrases: z.array(z.string()).optional(),
  /** 匹配得分（hybrid search 分数） */
  matchScore: z.number().min(0).max(1).optional(),
});

export type SceneMatch = z.infer<typeof SceneMatchSchema>;

// ============================================================
// 输出 Schema（v1.3 修复 #4：不包含 memoryRelevant）
// ============================================================

export const SceneActivationOutputSchema = z.object({
  /** schema 版本 */
  schemaVersion: z.literal("v1"),
  /** 是否命中缓存 */
  cacheHit: z.boolean(),
  /** 命中时返回的匹配列表 */
  matches: z.array(SceneMatchSchema),
  /** miss 时是否回退到 DB */
  dbFallback: z.boolean(),
  /** 查询耗时（ms） */
  durationMs: z.number().nonnegative(),
});

export type SceneActivationOutput = z.infer<typeof SceneActivationOutputSchema>;

// ============================================================
// 工厂方法
// ============================================================

export function createEmptySceneActivationOutput(
  cacheHit: boolean,
  dbFallback: boolean,
  durationMs: number
): SceneActivationOutput {
  return {
    schemaVersion: "v1",
    cacheHit,
    matches: [],
    dbFallback,
    durationMs,
  };
}

export const CURRENT_SCENE_ACTIVATION_SCHEMA_VERSION = "v1";