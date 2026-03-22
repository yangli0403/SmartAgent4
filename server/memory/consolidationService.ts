/**
 * Consolidation Service — 记忆巩固服务 (SmartMem)
 *
 * 通过 LLM 驱动的聚类和提炼，将零散的情景记忆升华为高阶的语义记忆。
 * 定期运行，将高频访问的零散记忆聚合为抽象化的语义记忆或行为模式。
 *
 * 来源：SmartMem/src/services/consolidationService.ts
 */

import { eq, and, sql, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  memories,
  memoryClusters,
  type Memory,
  type InsertMemory,
} from "../../drizzle/schema";
import { callLLMText } from "../llm/langchainAdapter";

// ==================== 类型定义 ====================

interface MemoryGroup {
  type: string;
  memories: Memory[];
}

interface ConsolidationResult {
  clustersCreated: number;
  memoriesConsolidated: number;
  semanticMemoriesCreated: number;
}

// ==================== 核心逻辑 ====================

/**
 * 按类型对记忆进行分组
 */
function groupMemoriesByType(mems: Memory[]): MemoryGroup[] {
  const groups = new Map<string, Memory[]>();

  for (const mem of mems) {
    const key = mem.type;
    const group = groups.get(key) || [];
    group.push(mem);
    groups.set(key, group);
  }

  return Array.from(groups.entries()).map(([type, memories]) => ({
    type,
    memories,
  }));
}

/**
 * 使用 LLM 对一组相关记忆进行提炼，生成高阶语义摘要
 */
async function distillMemoryGroup(group: MemoryGroup): Promise<string | null> {
  if (group.memories.length < 3) return null;

  const memoriesText = group.memories
    .map((m, i) => `${i + 1}. ${m.content} (重要性: ${m.importance})`)
    .join("\n");

  const systemPrompt = `你是一个记忆巩固专家。请将以下多条零散的${group.type}类记忆提炼为一条高阶的语义记忆。
要求：
- 输出一条简洁的总结性陈述（不超过 100 字）
- 保留关键信息，去除冗余
- 如果信息之间有矛盾，以最新的为准
- 只输出提炼后的文本，不要包含任何解释`;

  const userMessage = `以下是 ${group.memories.length} 条 ${group.type} 类记忆：\n${memoriesText}\n\n请提炼：`;

  try {
    const result = await callLLMText(systemPrompt, userMessage, {
      temperature: 0.1,
    });
    return result.trim();
  } catch (error) {
    console.error(
      `[Consolidation] Failed to distill ${group.type} group:`,
      error
    );
    return null;
  }
}

// ==================== 导出接口 ====================

/**
 * 执行记忆巩固
 *
 * 工作流程：
 * 1. 查询用户的所有情景记忆（episodic），按类型分组
 * 2. 对每组中记忆数量 >= 3 的组，调用 LLM 提炼为语义记忆
 * 3. 创建 memory_cluster 记录，将原始记忆关联到 cluster
 * 4. 将提炼后的语义记忆写入 memories 表
 */
export async function consolidateMemories(
  userId: number
): Promise<ConsolidationResult> {
  const result: ConsolidationResult = {
    clustersCreated: 0,
    memoriesConsolidated: 0,
    semanticMemoriesCreated: 0,
  };

  const db = await getDb();
  if (!db) {
    console.warn("[Consolidation] Database not available");
    return result;
  }

  try {
    // 1. 查询未被巩固的情景记忆（没有 clusterId 的）
    const episodicMemories = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          eq(memories.kind, "episodic"),
          sql`${memories.clusterId} IS NULL`
        )
      )
      .orderBy(desc(memories.createdAt))
      .limit(200);

    if (episodicMemories.length < 5) {
      console.log(
        `[Consolidation] User ${userId}: only ${episodicMemories.length} unconsolidated episodic memories, skipping.`
      );
      return result;
    }

    // 2. 按类型分组
    const groups = groupMemoriesByType(episodicMemories);

    // 3. 对每组进行提炼
    for (const group of groups) {
      if (group.memories.length < 3) continue;

      const summary = await distillMemoryGroup(group);
      if (!summary) continue;

      // 4. 创建 cluster
      const clusterResult = await db.insert(memoryClusters).values({
        userId,
        summary,
        memberCount: group.memories.length,
        avgImportance:
          group.memories.reduce((sum, m) => sum + m.importance, 0) /
          group.memories.length,
      });

      const clusterId = Number(
        (Array.isArray(clusterResult)
          ? clusterResult[0]
          : (clusterResult as any)
        )?.insertId
      );

      if (!clusterId || clusterId <= 0) continue;

      result.clustersCreated++;

      // 5. 将原始记忆关联到 cluster
      for (const mem of group.memories) {
        await db
          .update(memories)
          .set({ clusterId })
          .where(eq(memories.id, mem.id));
        result.memoriesConsolidated++;
      }

      // 6. 写入提炼后的语义记忆
      await db.insert(memories).values({
        userId,
        kind: "semantic",
        type: group.type as InsertMemory["type"],
        content: summary,
        importance: Math.min(
          1.0,
          group.memories.reduce((sum, m) => sum + m.importance, 0) /
            group.memories.length +
            0.1
        ),
        confidence: 0.9,
        clusterId,
        source: "consolidation",
        tags: ["consolidated"],
        metadata: {
          source: "consolidation",
          relatedMemoryIds: group.memories.map((m) => m.id),
        },
      } as InsertMemory);

      result.semanticMemoriesCreated++;

      console.log(
        `[Consolidation] User ${userId}: consolidated ${group.memories.length} ${group.type} memories into semantic memory.`
      );
    }

    console.log(
      `[Consolidation] User ${userId}: created ${result.clustersCreated} clusters, consolidated ${result.memoriesConsolidated} memories, generated ${result.semanticMemoriesCreated} semantic memories.`
    );

    return result;
  } catch (error) {
    console.error("[Consolidation] Error:", error);
    return result;
  }
}
