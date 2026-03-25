/**
 * Reflection Node — 反思节点（自进化闭环核心）
 *
 * 在 memoryExtractionNode 之后异步执行，负责：
 * 1. 分析本轮执行结果，更新工具效用分数（ToolRegistry.updateUtility）
 * 2. 将工具调用日志持久化到 tool_utility_logs 表
 * 3. 使用 LLM 分析执行质量，生成 Prompt 补丁建议
 * 4. 将 Prompt 补丁写入 prompt_versions 表（版本控制）
 *
 * 设计原则：
 * - 完全异步（fire-and-forget），不阻塞用户响应
 * - 仅在有工具调用时触发反思
 * - Prompt 补丁仅在检测到明显改进空间时生成
 */

import type { SupervisorStateType } from "./state";
import type { StepResult, ToolCallRecord } from "./state";
import { callLLMText } from "../../llm/langchainAdapter";
import { getDb } from "../../db";
import {
  toolUtilityLogs,
  promptVersions,
  type InsertToolUtilityLog,
  type InsertPromptVersion,
} from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import type { ToolUtilityUpdate } from "../../mcp/toolRegistry";

// ==================== 类型定义 ====================

/** Prompt 补丁数据 */
export interface PromptPatch {
  characterId: string;
  patchContent: string;
  reasoning: string;
}

/** 反思分析结果 */
interface ReflectionAnalysis {
  /** 工具效用更新列表 */
  toolUpdates: ToolUtilityUpdate[];
  /** Prompt 补丁建议（可选） */
  promptPatch?: PromptPatch;
  /** 整体执行质量评分 (0-1) */
  qualityScore: number;
  /** 反思摘要 */
  summary: string;
}

// ==================== 反思 Prompt ====================

const REFLECTION_SYSTEM_PROMPT = `你是一个 AI 系统的自我反思模块。请分析以下任务执行结果，评估执行质量并提出改进建议。

## 分析维度
1. **工具使用效率**：工具是否被正确选择？执行是否成功？耗时是否合理？
2. **任务完成质量**：最终回复是否准确、完整地回答了用户问题？
3. **Prompt 改进空间**：当前人格配置是否需要调整以提升回复质量？

## 输出格式（严格 JSON）
{
  "qualityScore": 0.0-1.0,
  "summary": "一句话总结本次执行质量",
  "promptPatchNeeded": true/false,
  "promptPatch": "如果需要补丁，描述具体的 Prompt 调整建议（如：增加XX领域的知识、调整回复风格为更简洁等）",
  "patchReasoning": "补丁建议的推理过程"
}

## 注意事项
- qualityScore: 完美执行=0.9+, 基本完成=0.6-0.8, 有明显问题=0.3-0.5, 失败=0.0-0.2
- 只有在确实发现可改进的模式时才建议 Prompt 补丁（promptPatchNeeded=true）
- 不要因为单次偶然失败就建议修改 Prompt
- 请只输出 JSON，不要包含其他文字`;

// ==================== 反思节点 ====================

/**
 * 反思节点 — 异步分析执行结果并触发自进化
 *
 * 挂接在 memoryExtractionNode 之后，作为图的最后一个节点。
 * 所有操作都是 fire-and-forget，不修改 SupervisorState。
 */
export async function reflectionNode(
  state: SupervisorStateType
): Promise<Partial<SupervisorStateType>> {
  console.log("[ReflectionNode] Starting reflection analysis...");

  const { stepResults, taskClassification, context, characterId, finalResponse } = state;

  // 如果没有步骤结果或没有工具调用，跳过反思
  const allToolCalls = (stepResults || []).flatMap(
    (r: StepResult) => r.toolCalls || []
  );

  if (allToolCalls.length === 0) {
    console.log("[ReflectionNode] No tool calls to reflect on, skipping");
    return {};
  }

  const userId = context?.userId || "unknown";
  const sessionId = context?.sessionId || "unknown";

  // ===== 异步执行反思（fire-and-forget） =====
  performReflection(
    stepResults || [],
    allToolCalls,
    taskClassification,
    characterId || "xiaozhi",
    finalResponse || "",
    userId,
    sessionId
  ).catch((error) => {
    console.error(
      "[ReflectionNode] Reflection failed:",
      (error as Error).message
    );
  });

  // 不修改状态
  return {};
}

/**
 * 执行反思分析的核心逻辑
 */
async function performReflection(
  stepResults: StepResult[],
  allToolCalls: ToolCallRecord[],
  taskClassification: any,
  characterId: string,
  finalResponse: string,
  userId: string,
  sessionId: string
): Promise<void> {
  // ===== 1. 持久化工具调用日志 =====
  await persistToolUtilityLogs(allToolCalls, sessionId, userId);

  // ===== 2. 生成工具效用更新 =====
  const toolUpdates: ToolUtilityUpdate[] = allToolCalls.map((tc) => ({
    toolName: tc.toolName,
    success: tc.status === "success",
    executionTimeMs: tc.durationMs,
    errorMessage: tc.status !== "success" ? String(tc.output) : undefined,
  }));

  // 通过 SmartAgentApp 单例获取 ToolRegistry 实例
  try {
    const { getSmartAgentApp } = await import("../smartAgentApp");
    const app = getSmartAgentApp();
    const registry = app.getToolRegistry();
    if (registry && typeof registry.updateUtility === "function") {
      for (const update of toolUpdates) {
        registry.updateUtility(update);
      }
      console.log(
        `[ReflectionNode] Updated utility for ${toolUpdates.length} tool calls`
      );
    }
  } catch (e) {
    // 降级处理：ToolRegistry 不可达时仅记录日志
    console.log(
      `[ReflectionNode] ToolRegistry not accessible, skipping utility update: ${(e as Error).message}`
    );
  }

  // ===== 3. LLM 反思分析（仅在有失败或复杂任务时触发） =====
  const hasFailures = stepResults.some((r) => r.status !== "success");
  const isComplexTask = taskClassification?.complexity === "complex";

  if (hasFailures || isComplexTask) {
    await performLLMReflection(
      stepResults,
      allToolCalls,
      taskClassification,
      characterId,
      finalResponse,
      sessionId
    );
  } else {
    console.log(
      "[ReflectionNode] Simple successful task, skipping LLM reflection"
    );
  }
}

/**
 * 持久化工具调用日志到数据库
 */
async function persistToolUtilityLogs(
  toolCalls: ToolCallRecord[],
  sessionId: string,
  userId: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log("[ReflectionNode] DB not available, skipping log persistence");
    return;
  }

  try {
    for (const tc of toolCalls) {
      const log: InsertToolUtilityLog = {
        toolName: tc.toolName,
        serverId: tc.serverId,
        status: tc.status as "success" | "error" | "timeout",
        executionTimeMs: tc.durationMs,
        errorMessage:
          tc.status !== "success" ? String(tc.output).substring(0, 1000) : null,
        sessionId,
        userId,
      };
      await db.insert(toolUtilityLogs).values(log);
    }
    console.log(
      `[ReflectionNode] Persisted ${toolCalls.length} tool utility logs`
    );
  } catch (error) {
    console.error(
      "[ReflectionNode] Failed to persist tool logs:",
      (error as Error).message
    );
  }
}

/**
 * LLM 驱动的反思分析 + Prompt 补丁生成
 */
async function performLLMReflection(
  stepResults: StepResult[],
  allToolCalls: ToolCallRecord[],
  taskClassification: any,
  characterId: string,
  finalResponse: string,
  sessionId: string
): Promise<void> {
  try {
    // 构建反思输入
    const reflectionInput = buildReflectionInput(
      stepResults,
      allToolCalls,
      taskClassification,
      finalResponse
    );

    const response = await callLLMText(
      REFLECTION_SYSTEM_PROMPT,
      reflectionInput,
      { temperature: 0.2 }
    );

    // 解析反思结果
    let analysis: any = {};
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[ReflectionNode] Failed to parse reflection response");
      return;
    }

    console.log(
      `[ReflectionNode] Quality score: ${analysis.qualityScore}, Summary: ${analysis.summary}`
    );

    // ===== 4. Prompt 补丁版本控制 =====
    if (analysis.promptPatchNeeded && analysis.promptPatch) {
      await savePromptPatch(
        characterId,
        analysis.promptPatch,
        analysis.patchReasoning || analysis.summary
      );
    }
  } catch (error) {
    console.error(
      "[ReflectionNode] LLM reflection failed:",
      (error as Error).message
    );
  }
}

/**
 * 构建反思输入文本
 */
function buildReflectionInput(
  stepResults: StepResult[],
  allToolCalls: ToolCallRecord[],
  taskClassification: any,
  finalResponse: string
): string {
  const parts: string[] = [];

  parts.push(`## 任务分类`);
  parts.push(
    `- 领域: ${taskClassification?.domain || "unknown"}`
  );
  parts.push(
    `- 复杂度: ${taskClassification?.complexity || "unknown"}`
  );

  parts.push(`\n## 执行步骤 (${stepResults.length} 步)`);
  for (const result of stepResults) {
    parts.push(
      `- Step ${result.stepId}: ${result.status} (${result.durationMs}ms)` +
        (result.error ? ` — Error: ${result.error}` : "")
    );
  }

  parts.push(`\n## 工具调用 (${allToolCalls.length} 次)`);
  for (const tc of allToolCalls) {
    parts.push(
      `- ${tc.toolName}: ${tc.status} (${tc.durationMs}ms)` +
        (tc.status !== "success"
          ? ` — ${String(tc.output).substring(0, 200)}`
          : "")
    );
  }

  parts.push(`\n## 最终回复 (前 500 字)`);
  parts.push(finalResponse.substring(0, 500));

  return parts.join("\n");
}

/**
 * 保存 Prompt 补丁到版本历史
 */
async function savePromptPatch(
  characterId: string,
  patchContent: string,
  reasoning: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 查询当前最大版本号
    const existing = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.characterId, characterId))
      .orderBy(desc(promptVersions.version))
      .limit(1);

    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

    const newVersion: InsertPromptVersion = {
      characterId,
      version: nextVersion,
      patchContent,
      reasoning,
      previousSnapshot: existing.length > 0 ? existing[0].currentSnapshot : null,
      currentSnapshot: null, // 补丁尚未应用，快照在应用时填充
      isActive: false, // 补丁默认不自动激活，需要人工审核或达到阈值后激活
    };

    await db.insert(promptVersions).values(newVersion);

    console.log(
      `[ReflectionNode] Saved prompt patch for "${characterId}" v${nextVersion}: ${patchContent.substring(0, 100)}`
    );
  } catch (error) {
    console.error(
      "[ReflectionNode] Failed to save prompt patch:",
      (error as Error).message
    );
  }
}
