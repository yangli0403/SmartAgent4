/**
 * Memory System — 增强版记忆系统
 *
 * 实现三层记忆架构：工作记忆（内存）→ 记忆提取（LLM）→ 长期记忆（MySQL/TiDB）。
 * 在 SmartAgent_PL_E 原有基础上，整合了 SmartAgent2 的以下能力：
 * - LLM 驱动的记忆提取（来自 extractor.ts）
 * - 用户画像构建（来自 storage.ts）
 * - 版本化记忆更新（versionGroup）
 *
 * 核心接口：
 * - searchMemories: 搜索记忆
 * - addMemory: 添加记忆
 * - extractMemoriesFromConversation: 从对话中提取记忆（LLM 异步）
 * - getUserProfileSnapshot: 获取用户画像快照
 * - getDisplayNameFromPersona: 获取用户显示名称
 * - consolidateMemories: 记忆整合（后台任务）
 * - forgetMemories: 记忆遗忘（后台任务）
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import { memories, type Memory, type InsertMemory } from "../../drizzle/schema";
import { callLLMText } from "../llm/langchainAdapter";
import {
  buildProfileFromMemories,
  formatMemoriesForContext,
} from "./profileBuilder";
import type { ContextualProfileSnapshot } from "../personality/types";
import { hybridSearch, reflectOnMemories, type HybridSearchResult } from "./hybridSearch";
import { consolidateMemories as smartMemConsolidate } from "./consolidationService";
import { applyForgettingDecay } from "./forgettingService";

// ==================== 类型定义 ====================

export interface MemorySearchOptions {
  userId: number;
  query?: string;
  type?: "fact" | "behavior" | "preference" | "emotion";
  kind?: "episodic" | "semantic" | "persona";
  versionGroup?: string;
  limit?: number;
  minImportance?: number;
  // --- SmartMem 扩展 ---
  useHybridSearch?: boolean;
  queryEmbedding?: number[] | null;
  alpha?: number; // BM25 与 Vector 的权重调节 (0-1)
  enableReflect?: boolean; // 是否启用 LLM 二次推理
}

export interface MemoryFormationInput {
  userId: number;
  conversationHistory: Array<{ role: string; content: string }>;
}

// ==================== 工作记忆（内存级） ====================

/**
 * 工作记忆管理器
 *
 * 基于 Map 的内存级多轮对话管理，支持 TTL 自动过期。
 * 来源：SmartAgent2 的 working-memory.ts。
 */
class WorkingMemoryManager {
  private store: Map<
    string,
    { messages: Array<{ role: string; content: string }>; expireAt: number }
  > = new Map();
  private readonly TTL = 30 * 60 * 1000; // 30 分钟

  /**
   * 获取工作记忆
   */
  get(
    userId: number,
    sessionId: string
  ): Array<{ role: string; content: string }> {
    const key = `${userId}:${sessionId}`;
    const entry = this.store.get(key);

    if (!entry || Date.now() > entry.expireAt) {
      this.store.delete(key);
      return [];
    }

    return entry.messages;
  }

  /**
   * 追加消息到工作记忆
   */
  append(
    userId: number,
    sessionId: string,
    message: { role: string; content: string }
  ): void {
    const key = `${userId}:${sessionId}`;
    const entry = this.store.get(key) || {
      messages: [],
      expireAt: Date.now() + this.TTL,
    };

    entry.messages.push(message);
    entry.expireAt = Date.now() + this.TTL;

    // 限制工作记忆大小（最近 20 轮）
    if (entry.messages.length > 40) {
      entry.messages = entry.messages.slice(-40);
    }

    this.store.set(key, entry);
  }

  /**
   * 清除过期的工作记忆
   */
  cleanup(): void {
    const now = Date.now();
    const keys = Array.from(this.store.keys());
    for (const key of keys) {
      const entry = this.store.get(key);
      if (entry && now > entry.expireAt) {
        this.store.delete(key);
      }
    }
  }
}

// 工作记忆单例
const workingMemory = new WorkingMemoryManager();

// 定期清理过期工作记忆
setInterval(() => workingMemory.cleanup(), 5 * 60 * 1000);

// ==================== 导出工作记忆接口 ====================

export function getWorkingMemory(
  userId: number,
  sessionId: string
): Array<{ role: string; content: string }> {
  return workingMemory.get(userId, sessionId);
}

export function appendWorkingMemory(
  userId: number,
  sessionId: string,
  message: { role: string; content: string }
): void {
  workingMemory.append(userId, sessionId, message);
}

// ==================== 长期记忆操作 ====================

/**
 * 搜索记忆
 *
 * 支持按类型、种类、版本组和关键词过滤。
 * 自动更新访问计数和时间戳。
 */
export async function searchMemories(
  options: MemorySearchOptions
): Promise<Memory[]> {
  const {
    userId,
    query,
    type,
    kind,
    versionGroup,
    limit = 10,
    minImportance = 0,
  } = options;

  const db = await getDb();
  if (!db) {
    console.warn("[Memory] Database not available");
    return [];
  }

  try {
    const conditions = [
      eq(memories.userId, userId),
      sql`${memories.importance} >= ${minImportance}`,
    ];

    if (type) {
      conditions.push(eq(memories.type, type));
    }

    if (kind) {
      conditions.push(eq(memories.kind, kind));
    }

    if (versionGroup) {
      conditions.push(eq(memories.versionGroup, versionGroup));
    }

    // --- SmartMem 混合检索分支 ---
    if (options.useHybridSearch && query) {
      // 先拉取候选集（不带关键词过滤，由混合检索自行评分）
      const candidates = await db
        .select()
        .from(memories)
        .where(and(...conditions))
        .orderBy(desc(memories.importance))
        .limit(Math.max(limit * 5, 50)); // 拉取更多候选

      const hybridResults = hybridSearch({
        query,
        queryEmbedding: options.queryEmbedding,
        candidates,
        limit,
        alpha: options.alpha ?? 0.5,
      });

      const results = hybridResults.map((r) => r.memory);

      // 异步更新访问计数
      for (const memory of results) {
        db.update(memories)
          .set({
            accessCount: memory.accessCount + 1,
            lastAccessedAt: new Date(),
          })
          .where(eq(memories.id, memory.id))
          .catch(() => {});
      }

      return results;
    }

    // --- 原有关键词匹配（兼容模式） ---
    if (query) {
      conditions.push(sql`${memories.content} LIKE ${`%${query}%`}`);
    }

    const baseQuery = db.select().from(memories).where(and(...conditions));

    const results = await baseQuery
      .orderBy(
        versionGroup
          ? desc(memories.updatedAt)
          : desc(memories.importance),
        desc(memories.lastAccessedAt)
      )
      .limit(limit);

    // 异步更新访问计数（fire-and-forget）
    for (const memory of results) {
      db.update(memories)
        .set({
          accessCount: memory.accessCount + 1,
          lastAccessedAt: new Date(),
        })
        .where(eq(memories.id, memory.id))
        .catch(() => {});
    }

    return results;
  } catch (error) {
    console.error("[Memory] Error searching memories:", error);
    return [];
  }
}

/**
 * 从人格记忆中解析用户希望被称呼的名字
 */
export async function getDisplayNameFromPersona(
  userId: number
): Promise<string | undefined> {
  const list = await searchMemories({
    userId,
    kind: "persona",
    limit: 50,
  });

  const preferNameRe =
    /(?:你可以?叫我|请叫我|称呼我|叫我)\s*([^\s，。！？、]+)/i;
  const myNameRe = /(?:我(?:的名字)?叫|我是)\s*([^\s，。！？、]+)/i;

  // 1) 优先取 versionGroup 为 user_preferred_name 的内容
  for (const m of list) {
    if (m.versionGroup === "user_preferred_name" && m.content?.trim()) {
      const t = m.content.trim();
      const m1 = t.match(preferNameRe);
      if (m1) return m1[1].trim().slice(0, 20);
      if (t.length <= 20 && !/[\d\s]/.test(t)) return t;
      return t.slice(0, 20);
    }
  }

  // 2) 再取 user_profile_basic 中的「我叫XXX」
  for (const m of list) {
    if (m.versionGroup === "user_profile_basic" && m.content) {
      const m2 = m.content.match(myNameRe);
      if (m2) return m2[1].trim().slice(0, 20);
    }
  }

  // 3) 任意人格记忆里出现「你可以叫我/叫我/我叫」
  for (const m of list) {
    if (!m.content) continue;
    const prefer = m.content.match(preferNameRe);
    if (prefer) return prefer[1].trim().slice(0, 20);
    const myName = m.content.match(myNameRe);
    if (myName) return myName[1].trim().slice(0, 20);
  }

  return undefined;
}

/**
 * 添加记忆
 */
export async function addMemory(
  memory: InsertMemory
): Promise<Memory | null> {
  const db = await getDb();
  if (!db) {
    console.warn(
      "[Memory] addMemory 失败: 数据库不可用（DATABASE_URL 未配置或连接失败）"
    );
    return null;
  }

  try {
    // 如果有 versionGroup，检查是否需要更新而非新增
    if (memory.versionGroup) {
      const existing = await searchMemories({
        userId: memory.userId,
        versionGroup: memory.versionGroup,
        limit: 1,
      });

      if (existing.length > 0) {
        // 更新已有记忆
        await db
          .update(memories)
          .set({
            content: memory.content,
            importance: memory.importance,
            confidence: memory.confidence,
            tags: memory.tags,
            metadata: memory.metadata,
          })
          .where(eq(memories.id, existing[0].id));

        console.log(
          `[Memory] Updated existing memory (versionGroup=${memory.versionGroup}): id=${existing[0].id}`
        );

        const updated = await db
          .select()
          .from(memories)
          .where(eq(memories.id, existing[0].id))
          .limit(1);
        return updated[0] || null;
      }
    }

    const result = await db.insert(memories).values(memory);
    const header = Array.isArray(result) ? result[0] : result;
    const insertedId = Number(
      (header as { insertId?: number })?.insertId
    );

    if (!Number.isInteger(insertedId) || insertedId <= 0) {
      console.error(
        "[Memory] addMemory 失败: insert 未返回有效 insertId"
      );
      return null;
    }

    const inserted = await db
      .select()
      .from(memories)
      .where(eq(memories.id, insertedId))
      .limit(1);

    const row = inserted[0] || null;
    if (row) {
      console.log(
        "[Memory] addMemory 成功: id=%s userId=%s kind=%s type=%s",
        row.id,
        row.userId,
        row.kind,
        row.type
      );
    }
    return row;
  } catch (error: unknown) {
    const err = error as {
      message?: string;
      cause?: { sqlMessage?: string; code?: string };
    };
    const detail = err.cause?.sqlMessage || err.message || String(error);
    console.error("[Memory] addMemory 失败:", detail);
    return null;
  }
}

/**
 * 更新记忆
 */
export async function updateMemory(
  memoryId: number,
  updates: Partial<InsertMemory>
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.update(memories).set(updates).where(eq(memories.id, memoryId));
    return true;
  } catch (error) {
    console.error("[Memory] Error updating memory:", error);
    return false;
  }
}

/**
 * 删除记忆
 */
export async function deleteMemory(memoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.delete(memories).where(eq(memories.id, memoryId));
    return true;
  } catch (error) {
    console.error("[Memory] Error deleting memory:", error);
    return false;
  }
}

// ==================== LLM 驱动的记忆提取 ====================

/**
 * 记忆提取系统提示词
 *
 * 来源：SmartAgent2 的 extractor.ts，经过优化和增强。
 */
const MEMORY_EXTRACTION_PROMPT = `你是一个记忆提取专家。请分析以下对话，提取关于用户的重要信息。
对于每条提取的记忆，请确定：
1. kind: episodic（情景记忆，与特定事件/时间相关）| semantic（语义记忆，一般性事实）| persona（人格记忆，用户的身份/特征/偏好称呼）
2. type: fact（事实）| behavior（行为模式）| preference（偏好）| emotion（情感状态）
3. content: 清晰简洁的陈述，使用标准化表达（如"用户喜欢黑色"而非"用户喜欢黑色相关时尚单品和装饰"）
4. importance: 0.0-1.0（信息的重要程度）
5. confidence: 0.0-1.0（你对这条信息的确信程度）
6. versionGroup: 【所有类型记忆必填】用于标识同类信息的稳定键名，确保同一类信息始终使用相同的 versionGroup，这样新信息会自动覆盖旧信息。
   规则：
   - 事实类(fact): 用户姓名用 "user_name"，用户居住地用 "user_location"，用户职业用 "user_occupation"，用户年龄用 "user_age"，用户家乡用 "user_hometown" 等
   - 偏好类(preference): 偏好颜色用 "pref_color"，偏好音乐风格用 "pref_music_style"，偏好食物用 "pref_food"，偏好着装用 "pref_fashion" 等
   - 行为类(behavior): 通勤方式用 "behavior_commute"，作息习惯用 "behavior_schedule" 等
   - 情感类(emotion): 当前情绪用 "emotion_current" 等
   - 人格类(persona): 用户称呼用 "user_preferred_name"，用户基本信息用 "user_profile_basic" 等
7. tags: 可选，短关键词数组

重要原则：
- 只提取有意义的、持久的信息，跳过问候语和闲聊
- 对于相同类型的信息（如都是居住地），只提取最核心的一条，不要拆分为多条
- versionGroup 是记忆融合的关键，相同 versionGroup 的记忆会自动合并更新，务必为每条记忆提供准确的 versionGroup
- 如果对话中没有值得提取的信息，返回空数组 []。`;

/**
 * 从对话中异步提取并存储新记忆
 *
 * 使用 LLM 分析对话内容，提取用户偏好、事实和情感等信息。
 * 这是一个异步操作（fire-and-forget），不阻塞对话响应。
 *
 * 来源：SmartAgent2 的 extractor.ts 的 extractMemoriesAsync 方法。
 */
export async function extractMemoriesFromConversation(
  input: MemoryFormationInput
): Promise<Memory[]> {
  const { userId, conversationHistory } = input;

  if (conversationHistory.length < 2) {
    return [];
  }

  // 使用滑动窗口（最近 5 轮 = 10 条消息）
  const recentMessages = conversationHistory.slice(-10);

  try {
    const conversationText = recentMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const userMessage = `对话内容：\n${conversationText}\n\n请提取记忆（JSON 数组格式）：`;

    const response = await callLLMText(
      MEMORY_EXTRACTION_PROMPT,
      userMessage,
      { temperature: 0.2 }
    );

    // 解析 LLM 响应
    let extractedMemories: any[] = [];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        extractedMemories = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[Memory] Failed to parse LLM extraction response:", e);
      return [];
    }

    // 保存提取的记忆
    const savedMemories: Memory[] = [];

    // 加载用户所有已有记忆，用于全局语义去重（不仅限于 preference）
    const existingMemories = await searchMemories({
      userId,
      limit: 200,
      minImportance: 0,
    });

    for (const mem of extractedMemories) {
      if (!mem.type || !mem.content) continue;

      // 推断 kind
      const rawKind = (mem.kind as string | undefined)?.toLowerCase();
      let kind: "episodic" | "semantic" | "persona" = "semantic";
      if (
        rawKind === "episodic" ||
        rawKind === "semantic" ||
        rawKind === "persona"
      ) {
        kind = rawKind;
      } else if (
        /\d{4}-\d{1,2}-\d{1,2}|昨天|今天|上周|最近|晚上|早上|下午/.test(
          mem.content
        )
      ) {
        kind = "episodic";
      }

      // ====== 记忆融合机制 ======
      // 策略1：如果有 versionGroup，检查是否已存在相同 versionGroup 的记忆
      // 如果存在，则更新而不是新增（融合）
      if (mem.versionGroup) {
        const existingWithSameGroup = existingMemories.find(
          (e) => e.versionGroup === mem.versionGroup && e.type === mem.type
        );
        if (existingWithSameGroup) {
          // 内容相同则跳过，内容不同则更新（融合）
          const existingNorm = String(existingWithSameGroup.content).toLowerCase().replace(/\s+/g, "");
          const newNorm = String(mem.content).toLowerCase().replace(/\s+/g, "");
          if (existingNorm === newNorm) {
            console.log(`[Memory] Skipping identical memory (versionGroup=${mem.versionGroup}): "${mem.content}"`);
            continue;
          }
          // 内容不同，更新已有记忆（融合）
          console.log(`[Memory] Merging memory (versionGroup=${mem.versionGroup}): "${existingWithSameGroup.content}" -> "${mem.content}"`);
          const updateSuccess = await updateMemory(existingWithSameGroup.id, {
            content: mem.content,
            importance: mem.importance ?? existingWithSameGroup.importance,
            confidence: mem.confidence ?? existingWithSameGroup.confidence,
          });
          if (updateSuccess) {
            // 更新成功，将更新后的记忆加入结果列表
            savedMemories.push({ ...existingWithSameGroup, content: mem.content });
          }
          continue;
        }
      }

      // 策略2：全局内容相似度去重（对所有类型记忆生效）
      const newContentNorm = String(mem.content).toLowerCase().replace(/\s+/g, "");
      const duplicateExisting = existingMemories.find((existing) => {
        if (existing.type !== mem.type) return false;
        const existingNorm = String(existing.content).toLowerCase().replace(/\s+/g, "");
        // 完全包含或完全相同则认为重复
        return existingNorm === newContentNorm || 
               existingNorm.includes(newContentNorm) || 
               newContentNorm.includes(existingNorm);
      });

      if (duplicateExisting) {
        console.log(`[Memory] Skipping duplicate ${mem.type} memory: "${mem.content}" (similar to existing: "${duplicateExisting.content}")`);
        continue;
      }

      const tags: string[] | undefined = Array.isArray(mem.tags)
        ? mem.tags.map((t: any) => String(t))
        : undefined;
      const saved = await addMemory({
        userId,
        kind,
        type: mem.type,
        content: mem.content,
        importance: mem.importance ?? 0.5,
        confidence: mem.confidence ?? 0.8,
        versionGroup: mem.versionGroup,
        tags: tags ?? null,
        source: "conversation",
        metadata: {
          source: "conversation",
          tags,
        },
      });

      if (saved) {
        savedMemories.push(saved);
      }
    }

    console.log(
      `[Memory] Extracted ${savedMemories.length} memories from conversation for user ${userId}`
    );
    return savedMemories;
  } catch (error) {
    console.error("[Memory] Error extracting memories:", error);
    return [];
  }
}

// ==================== 用户画像 ====================

/**
 * 获取用户画像快照
 *
 * 从 persona 类型的记忆中构建用户画像。
 * 来源：SmartAgent2 的 storage.ts 的 getUserProfile。
 */
export async function getUserProfileSnapshot(
  userId: number
): Promise<ContextualProfileSnapshot> {
  try {
    // 获取所有 persona 类型的记忆
    const personaMemories = await searchMemories({
      userId,
      kind: "persona",
      limit: 50,
    });

    // 同时获取偏好类型的记忆
    const preferenceMemories = await searchMemories({
      userId,
      type: "preference",
      limit: 30,
    });

    // 合并并去重
    const allMemories = [
      ...personaMemories,
      ...preferenceMemories.filter(
        (pm) => !personaMemories.some((m) => m.id === pm.id)
      ),
    ];

    const profile = buildProfileFromMemories(allMemories);

    // 如果 displayName 未从记忆中提取到，尝试专用方法
    if (!profile.displayName) {
      profile.displayName = await getDisplayNameFromPersona(userId);
    }

    return profile;
  } catch (error) {
    console.error("[Memory] Error building user profile:", error);
    return {
      displayName: undefined,
      activePreferences: [],
      relevantRelationships: [],
    };
  }
}

/**
 * 获取格式化的记忆上下文
 *
 * 搜索与查询相关的记忆，并格式化为可注入 System Prompt 的文本。
 */
export async function getFormattedMemoryContext(
  userId: number,
  query: string,
  maxLength: number = 2000
): Promise<string> {
  try {
    const relevantMemories = await searchMemories({
      userId,
      query,
      limit: 15,
      minImportance: 0.3,
    });

    return formatMemoriesForContext(relevantMemories, maxLength);
  } catch (error) {
    console.error("[Memory] Error getting memory context:", error);
    return "";
  }
}

// ==================== 后台任务 ====================

/**
 * 记忆整合（后台任务）—— SmartMem 增强版
 *
 * 合并相似记忆，创建高层抽象。
 * 现在委托给 SmartMem 的 ConsolidationService 执行 LLM 驱动的记忆巩固。
 */
export async function consolidateMemories(
  userId: number
): Promise<number> {
  try {
    const result = await smartMemConsolidate(userId);
    return result.memoriesConsolidated;
  } catch (error) {
    console.error("[Memory] Error consolidating memories:", error);
    return 0;
  }
}

/**
 * 记忆遗忘（后台任务）—— SmartMem 增强版
 *
 * 基于艾宾浩斯遗忘曲线的指数衰减模型，动态调整记忆重要性分数。
 * 现在委托给 SmartMem 的 ForgettingService 执行。
 */
export async function forgetMemories(userId: number): Promise<number> {
  try {
    const result = await applyForgettingDecay(userId);
    return result.memoriesDecayed + result.memoriesRemoved;
  } catch (error) {
    console.error("[Memory] Error forgetting memories:", error);
    return 0;
  }
}
