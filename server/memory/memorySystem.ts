/**
 * Memory System — 增强版记忆系统 (v2 — PostgreSQL + 四层过滤管道)
 *
 * 实现三层记忆架构：工作记忆（内存）→ 记忆提取（LLM）→ 长期记忆（PostgreSQL）。
 *
 * Phase 4 增强：
 * 1. 数据库从 MySQL 迁移至 PostgreSQL（insert 使用 .returning()）
 * 2. 记忆提取管道四层过滤：预过滤 → LLM 提取 → 置信度门控 → 动态阈值去重
 * 3. 增强版 Prompt（更严格的噪声过滤规则 + 反面示例）
 * 4. 动态阈值去重（基于 Jaccard 相似度，阈值随记忆数量自适应）
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
import { generateEmbedding } from "./embeddingService";
import { evolveConfidence } from "./confidenceEvolution";

// ==================== 类型定义 ====================

export interface MemorySearchOptions {
  userId: number;
  query?: string;
  type?: "fact" | "behavior" | "preference" | "emotion";
  kind?: "episodic" | "semantic" | "persona";
  versionGroup?: string;
  limit?: number;
  minImportance?: number;
  useHybridSearch?: boolean;
  queryEmbedding?: number[] | null;
  alpha?: number;
  enableReflect?: boolean;
}

export interface MemoryFormationInput {
  userId: number;
  conversationHistory: Array<{ role: string; content: string }>;
}

/**
 * 记忆提取配置选项（与 INTERFACE_DESIGN.md 对齐）
 */
export interface MemoryExtractionOptions {
  /** 是否启用四层过滤机制，默认为 true */
  enableFiltering?: boolean;
  /** 动态去重阈值 (0.0 - 1.0)，默认为自动计算 */
  deduplicationThreshold?: number;
  /** 是否强制要求 LLM 输出时间锚定，默认为 true */
  requireTimeAnchor?: boolean;
}

// ==================== 工作记忆（内存级） ====================

class WorkingMemoryManager {
  private store: Map<
    string,
    { messages: Array<{ role: string; content: string }>; expireAt: number }
  > = new Map();
  private readonly TTL = 30 * 60 * 1000;

  get(userId: number, sessionId: string): Array<{ role: string; content: string }> {
    const key = `${userId}:${sessionId}`;
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expireAt) {
      this.store.delete(key);
      return [];
    }
    return entry.messages;
  }

  append(userId: number, sessionId: string, message: { role: string; content: string }): void {
    const key = `${userId}:${sessionId}`;
    const entry = this.store.get(key) || { messages: [], expireAt: Date.now() + this.TTL };
    entry.messages.push(message);
    entry.expireAt = Date.now() + this.TTL;
    if (entry.messages.length > 40) {
      entry.messages = entry.messages.slice(-40);
    }
    this.store.set(key, entry);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expireAt) this.store.delete(key);
    }
  }
}

const workingMemory = new WorkingMemoryManager();
setInterval(() => workingMemory.cleanup(), 5 * 60 * 1000);

export function getWorkingMemory(userId: number, sessionId: string) {
  return workingMemory.get(userId, sessionId);
}

export function appendWorkingMemory(userId: number, sessionId: string, message: { role: string; content: string }) {
  workingMemory.append(userId, sessionId, message);
}

// ==================== 长期记忆操作 ====================

export async function searchMemories(options: MemorySearchOptions): Promise<Memory[]> {
  const { userId, query, type, kind, versionGroup, limit = 10, minImportance = 0 } = options;
  const db = await getDb();
  if (!db) { console.warn("[Memory] Database not available"); return []; }

  try {
    const conditions = [eq(memories.userId, userId), sql`${memories.importance} >= ${minImportance}`];
    if (type) conditions.push(eq(memories.type, type));
    if (kind) conditions.push(eq(memories.kind, kind));
    if (versionGroup) conditions.push(eq(memories.versionGroup, versionGroup));

    if (options.useHybridSearch && query) {
      const candidates = await db.select().from(memories).where(and(...conditions)).orderBy(desc(memories.importance)).limit(Math.max(limit * 5, 50));
      const hybridResults = hybridSearch({ query, queryEmbedding: options.queryEmbedding, candidates, limit, alpha: options.alpha ?? 0.5 });
      const results = hybridResults.map((r) => r.memory);
      for (const memory of results) {
        db.update(memories).set({ accessCount: memory.accessCount + 1, lastAccessedAt: new Date() }).where(eq(memories.id, memory.id)).catch(() => {});
      }
      return results;
    }

    // PostgreSQL: 使用 ILIKE 替代 LIKE 实现大小写不敏感搜索
    if (query) conditions.push(sql`${memories.content} ILIKE ${`%${query}%`}`);

    const results = await db.select().from(memories).where(and(...conditions))
      .orderBy(versionGroup ? desc(memories.updatedAt) : desc(memories.importance), desc(memories.lastAccessedAt))
      .limit(limit);

    for (const memory of results) {
      db.update(memories).set({ accessCount: memory.accessCount + 1, lastAccessedAt: new Date() }).where(eq(memories.id, memory.id)).catch(() => {});
    }
    return results;
  } catch (error) {
    console.error("[Memory] Error searching memories:", error);
    return [];
  }
}

export async function getDisplayNameFromPersona(userId: number): Promise<string | undefined> {
  const list = await searchMemories({ userId, kind: "persona", limit: 50 });
  const preferNameRe = /(?:你可以?叫我|请叫我|称呼我|叫我)\s*([^\s，。！？、]+)/i;
  const myNameRe = /(?:我(?:的名字)?叫|我是)\s*([^\s，。！？、]+)/i;

  for (const m of list) {
    if (m.versionGroup === "user_preferred_name" && m.content?.trim()) {
      const t = m.content.trim();
      const m1 = t.match(preferNameRe);
      if (m1) return m1[1].trim().slice(0, 20);
      if (t.length <= 20 && !/[\d\s]/.test(t)) return t;
      return t.slice(0, 20);
    }
  }
  for (const m of list) {
    if (m.versionGroup === "user_profile_basic" && m.content) {
      const m2 = m.content.match(myNameRe);
      if (m2) return m2[1].trim().slice(0, 20);
    }
  }
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
 * 添加记忆 — PostgreSQL 版（使用 .returning()）
 *
 * 增强功能（记忆优化迭代）：
 * 1. 写入前生成 Embedding 向量（异步，失败不阻塞）
 * 2. 有 versionGroup 时执行 Confidence 演化
 */
export async function addMemory(memory: InsertMemory): Promise<Memory | null> {
  const db = await getDb();
  if (!db) { console.warn("[Memory] addMemory: DB not available"); return null; }

  try {
    // --- 新增：生成 Embedding 向量 ---
    if (memory.content && !memory.embedding) {
      const embedding = await generateEmbedding(memory.content);
      if (embedding) {
        memory = { ...memory, embedding };
        console.log(`[Memory] Embedding generated: dim=${embedding.length}`);
      }
    }

    // --- 新增：Confidence 演化 ---
    if (memory.versionGroup) {
      const existing = await searchMemories({
        userId: memory.userId,
        versionGroup: memory.versionGroup,
        limit: 10,
      });

      if (existing.length > 0) {
        const evolution = await evolveConfidence(
          {
            content: memory.content,
            kind: memory.kind,
            versionGroup: memory.versionGroup,
            userId: memory.userId,
          },
          existing
        );

        if (evolution.action === "BOOST") {
          // 内容一致：提升已有记忆置信度，跳过写入
          const targetId = evolution.affectedMemory!.id;
          await db.update(memories).set({
            confidence: evolution.newConfidence,
            accessCount: (evolution.affectedMemory!.accessCount ?? 0) + 1,
            lastAccessedAt: new Date(),
          }).where(eq(memories.id, targetId));
          console.log(
            `[Memory] BOOST: id=${targetId}, confidence=${evolution.previousConfidence} → ${evolution.newConfidence}`
          );
          const updated = await db.select().from(memories).where(eq(memories.id, targetId)).limit(1);
          return updated[0] || null;
        }

        if (evolution.action === "SUPERSEDE") {
          // 内容矛盾：降低已有记忆置信度，继续写入新记忆
          const targetId = evolution.affectedMemory!.id;
          await db.update(memories).set({
            confidence: evolution.newConfidence,
          }).where(eq(memories.id, targetId));
          console.log(
            `[Memory] SUPERSEDE: old id=${targetId}, confidence=${evolution.previousConfidence} → ${evolution.newConfidence}`
          );
          // 继续执行下方的 insert 逻辑
        }

        if (evolution.action === "SKIP" || evolution.action === "NO_MATCH") {
          // 人格记忆或无匹配：保留原有 versionGroup 更新逻辑
          if (existing.length > 0 && evolution.action !== "NO_MATCH") {
            await db.update(memories).set({
              content: memory.content, importance: memory.importance, confidence: memory.confidence,
              tags: memory.tags, metadata: memory.metadata, embedding: memory.embedding,
            }).where(eq(memories.id, existing[0].id));
            console.log(`[Memory] Updated (versionGroup=${memory.versionGroup}): id=${existing[0].id}`);
            const updated = await db.select().from(memories).where(eq(memories.id, existing[0].id)).limit(1);
            return updated[0] || null;
          }
        }
      }
    }

    // PostgreSQL: .returning() 直接返回插入行
    const result = await db.insert(memories).values(memory).returning();
    const row = result[0] || null;
    if (row) console.log("[Memory] addMemory OK: id=%s kind=%s type=%s", row.id, row.kind, row.type);
    return row;
  } catch (error: unknown) {
    const err = error as { detail?: string; message?: string };
    console.error("[Memory] addMemory failed:", err.detail || err.message || error);
    return null;
  }
}

export async function updateMemory(memoryId: number, updates: Partial<InsertMemory>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.update(memories).set(updates).where(eq(memories.id, memoryId));
    return true;
  } catch (error) { console.error("[Memory] Error updating memory:", error); return false; }
}

export async function deleteMemory(memoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.delete(memories).where(eq(memories.id, memoryId));
    return true;
  } catch (error) { console.error("[Memory] Error deleting memory:", error); return false; }
}

// ==================== 四层过滤记忆提取管道 ====================

/**
 * Layer 1: 预过滤 — 过滤掉明显无价值的对话
 */
function preFilterConversation(messages: Array<{ role: string; content: string }>): { pass: boolean; reason?: string } {
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  if (userMessages.length === 0 || assistantMessages.length === 0) {
    return { pass: false, reason: "no_user_or_assistant_message" };
  }

  const totalUserChars = userMessages.reduce((sum, m) => sum + m.content.trim().length, 0);
  if (totalUserChars < 4) return { pass: false, reason: "user_content_too_short" };

  const greetingPatterns = /^(你好|hi|hello|hey|嗨|喂|早|晚安|早安|午安|嗯|好的|ok|行|哦|哈哈|呵呵|嘿嘿|谢谢|感谢|再见|拜拜|bye)$/i;
  if (userMessages.every((m) => greetingPatterns.test(m.content.trim()))) {
    return { pass: false, reason: "pure_greeting" };
  }

  return { pass: true };
}

/**
 * Layer 2: 增强版 LLM 提取 Prompt
 */
const MEMORY_EXTRACTION_PROMPT_V2 = `你是一个高精度记忆提取专家。请分析以下对话，提取关于用户的重要、持久、可复用的信息。

## 输出格式
对于每条提取的记忆，请严格按以下 JSON 格式输出：
{
  "kind": "episodic|semantic|persona",
  "type": "fact|behavior|preference|emotion",
  "content": "清晰简洁的标准化陈述",
  "importance": 0.0-1.0,
  "confidence": 0.0-1.0,
  "versionGroup": "稳定键名",
  "tags": ["关键词"]
}

## 字段说明
- **kind**: episodic（与特定事件/时间相关）| semantic（一般性事实）| persona（用户身份/特征/偏好称呼）
- **type**: fact（事实）| behavior（行为模式）| preference（偏好）| emotion（情感状态）
- **content**: 使用标准化表达，如"用户喜欢黑色"而非"用户说他比较喜欢黑色那种感觉"
- **importance**: 越持久、越个人化的信息越重要（姓名=0.9, 临时情绪=0.3）
- **confidence**: 用户明确陈述=0.9, 推断得出=0.5
- **versionGroup**: 同类信息的稳定键名
  - 事实类: user_name, user_location, user_occupation, user_age, user_hometown
  - 偏好类: pref_color, pref_music_style, pref_food, pref_fashion, pref_temperature
  - 行为类: behavior_commute, behavior_schedule, behavior_exercise
  - 情感类: emotion_current, emotion_toward_work
  - 人格类: user_preferred_name, user_profile_basic

## 提取原则（严格遵守）
1. **只提取用户主动透露的个人信息**，不要从 AI 回复中反推
2. **跳过以下内容**：问候语、闲聊、感谢、确认（"好的"/"嗯"）、对 AI 能力的询问
3. **同类信息只提取一条**：如用户提到多次居住地，只取最新/最明确的一条
4. **importance < 0.3 的信息不要提取**
5. **confidence < 0.4 的推断不要提取**

## 反面示例（不应提取）
- 用户说"你好" → 不提取（纯问候）
- 用户说"帮我查一下天气" → 不提取（任务指令，非个人信息）
- 用户说"谢谢你" → 不提取（礼貌用语）
- AI 说"你看起来喜欢音乐" → 不提取（AI 推测，非用户陈述）

## 正面示例（应该提取）
- 用户说"我叫小明" → {"kind":"persona","type":"fact","content":"用户名字是小明","importance":0.9,"confidence":0.95,"versionGroup":"user_name"}
- 用户说"我住在上海" → {"kind":"semantic","type":"fact","content":"用户居住在上海","importance":0.8,"confidence":0.9,"versionGroup":"user_location"}
- 用户说"我不喜欢吃辣" → {"kind":"semantic","type":"preference","content":"用户不喜欢吃辣","importance":0.7,"confidence":0.9,"versionGroup":"pref_spicy"}

如果对话中没有值得提取的信息，返回空数组 []。
请只输出 JSON 数组，不要包含其他文字。`;

/**
 * Layer 3: 置信度门控
 */
function confidenceGate(mem: any): { pass: boolean; reason?: string } {
  if (!mem.type || !mem.content) return { pass: false, reason: "missing_type_or_content" };

  const content = String(mem.content).trim();
  if (content.length < 2 || content.length > 500) return { pass: false, reason: "content_length_invalid" };

  const importance = Number(mem.importance ?? 0.5);
  if (importance < 0.3) return { pass: false, reason: `importance_too_low(${importance})` };

  const confidence = Number(mem.confidence ?? 0.8);
  if (confidence < 0.4) return { pass: false, reason: `confidence_too_low(${confidence})` };

  const validTypes = ["fact", "behavior", "preference", "emotion"];
  if (!validTypes.includes(mem.type)) return { pass: false, reason: `invalid_type(${mem.type})` };

  return { pass: true };
}

/**
 * Layer 4: 动态阈值去重（Jaccard 相似度 + 自适应阈值）
 */
function computeJaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().replace(/\s+/g, "").split(""));
  const setB = new Set(b.toLowerCase().replace(/\s+/g, "").split(""));
  let intersection = 0;
  for (const char of setA) { if (setB.has(char)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function getDynamicDeduplicationThreshold(existingCount: number): number {
  if (existingCount < 50) return 0.6;
  if (existingCount <= 200) return 0.5;
  return 0.4;
}

function dynamicDeduplication(newContent: string, newType: string, existingMemories: Memory[], threshold: number): { isDuplicate: boolean; matchedMemory?: Memory } {
  const newNorm = String(newContent).toLowerCase().replace(/\s+/g, "");
  for (const existing of existingMemories) {
    if (existing.type !== newType) continue;
    const existingNorm = String(existing.content).toLowerCase().replace(/\s+/g, "");
    if (existingNorm === newNorm) return { isDuplicate: true, matchedMemory: existing };
    if (existingNorm.includes(newNorm) || newNorm.includes(existingNorm)) return { isDuplicate: true, matchedMemory: existing };
    if (computeJaccardSimilarity(existingNorm, newNorm) >= threshold) return { isDuplicate: true, matchedMemory: existing };
  }
  return { isDuplicate: false };
}

/**
 * 从对话中异步提取并存储新记忆 — 四层过滤管道版
 */
export async function extractMemoriesFromConversation(
  input: MemoryFormationInput,
  options?: MemoryExtractionOptions
): Promise<Memory[]> {
  const { userId, conversationHistory } = input;
  const enableFiltering = options?.enableFiltering ?? true;
  const customDeduplicationThreshold = options?.deduplicationThreshold;
  // requireTimeAnchor 当前已内嵌在 MEMORY_EXTRACTION_PROMPT_V2 中，预留接口供后续扩展
  // const requireTimeAnchor = options?.requireTimeAnchor ?? true;

  if (conversationHistory.length < 2) return [];

  const recentMessages = conversationHistory.slice(-10);

  // ====== Layer 1: 预过滤 ======
  if (enableFiltering) {
    const preFilterResult = preFilterConversation(recentMessages);
    if (!preFilterResult.pass) {
      console.log(`[Memory] Layer1 预过滤拦截: ${preFilterResult.reason} (user ${userId})`);
      return [];
    }
  }

  try {
    const conversationText = recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const userMessage = `对话内容：\n${conversationText}\n\n请提取记忆（JSON 数组格式）：`;

    // ====== Layer 2: 增强版 LLM 提取 ======
    const response = await callLLMText(MEMORY_EXTRACTION_PROMPT_V2, userMessage, { temperature: 0.1 });

    let extractedMemories: any[] = [];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) extractedMemories = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[Memory] Failed to parse LLM extraction response:", e);
      return [];
    }

    if (extractedMemories.length === 0) {
      console.log(`[Memory] LLM 未提取到任何记忆 (user ${userId})`);
      return [];
    }
    console.log(`[Memory] Layer2 LLM 提取到 ${extractedMemories.length} 条候选记忆`);

    // ====== Layer 3: 置信度门控 ======
    const gatedMemories: any[] = [];
    for (const mem of extractedMemories) {
      const gateResult = confidenceGate(mem);
      if (gateResult.pass) {
        gatedMemories.push(mem);
      } else {
        console.log(`[Memory] Layer3 门控拦截: ${gateResult.reason} — "${String(mem.content || "").substring(0, 40)}"`);
      }
    }
    if (gatedMemories.length === 0) {
      console.log(`[Memory] Layer3 门控后无剩余记忆 (user ${userId})`);
      return [];
    }
    console.log(`[Memory] Layer3 门控通过 ${gatedMemories.length}/${extractedMemories.length} 条`);

    // 加载已有记忆用于 Layer 4
    const existingMemories = await searchMemories({ userId, limit: 200, minImportance: 0 });

    // ====== Layer 4: 动态阈值去重 + 记忆融合 ======
    const deduplicationThreshold = customDeduplicationThreshold ?? getDynamicDeduplicationThreshold(existingMemories.length);
    console.log(`[Memory] Layer4 去重阈值: ${deduplicationThreshold}${customDeduplicationThreshold ? ' (自定义)' : ''} (已有 ${existingMemories.length} 条记忆)`);

    const savedMemories: Memory[] = [];

    for (const mem of gatedMemories) {
      const rawKind = (mem.kind as string | undefined)?.toLowerCase();
      let kind: "episodic" | "semantic" | "persona" = "semantic";
      if (rawKind === "episodic" || rawKind === "semantic" || rawKind === "persona") {
        kind = rawKind;
      } else if (/\d{4}-\d{1,2}-\d{1,2}|昨天|今天|上周|最近|晚上|早上|下午/.test(mem.content)) {
        kind = "episodic";
      }

      // 策略1: versionGroup 融合
      if (mem.versionGroup) {
        const existingWithSameGroup = existingMemories.find((e) => e.versionGroup === mem.versionGroup && e.type === mem.type);
        if (existingWithSameGroup) {
          const existingNorm = String(existingWithSameGroup.content).toLowerCase().replace(/\s+/g, "");
          const newNorm = String(mem.content).toLowerCase().replace(/\s+/g, "");
          if (existingNorm === newNorm) { console.log(`[Memory] Layer4 跳过相同 (versionGroup=${mem.versionGroup})`); continue; }
          console.log(`[Memory] Layer4 融合 (versionGroup=${mem.versionGroup}): "${existingWithSameGroup.content}" -> "${mem.content}"`);
          const ok = await updateMemory(existingWithSameGroup.id, {
            content: mem.content,
            importance: mem.importance ?? existingWithSameGroup.importance,
            confidence: mem.confidence ?? existingWithSameGroup.confidence,
          });
          if (ok) savedMemories.push({ ...existingWithSameGroup, content: mem.content });
          continue;
        }
      }

      // 策略2: 动态阈值去重
      const dedup = dynamicDeduplication(mem.content, mem.type, existingMemories, deduplicationThreshold);
      if (dedup.isDuplicate) {
        console.log(`[Memory] Layer4 去重拦截: "${mem.content}" ~ "${dedup.matchedMemory?.content}"`);
        continue;
      }

      const tags: string[] | undefined = Array.isArray(mem.tags) ? mem.tags.map((t: any) => String(t)) : undefined;
      const saved = await addMemory({
        userId, kind, type: mem.type, content: mem.content,
        importance: mem.importance ?? 0.5, confidence: mem.confidence ?? 0.8,
        versionGroup: mem.versionGroup, tags: tags ?? null, source: "conversation",
        metadata: { source: "conversation", tags },
      });
      if (saved) savedMemories.push(saved);
    }

    console.log(`[Memory] 四层管道最终保存 ${savedMemories.length} 条记忆 (user ${userId})`);
    return savedMemories;
  } catch (error) {
    console.error("[Memory] Error extracting memories:", error);
    return [];
  }
}

// ==================== 用户画像 ====================

export async function getUserProfileSnapshot(userId: number): Promise<ContextualProfileSnapshot> {
  try {
    const personaMemories = await searchMemories({ userId, kind: "persona", limit: 50 });
    const preferenceMemories = await searchMemories({ userId, type: "preference", limit: 30 });
    const allMemories = [...personaMemories, ...preferenceMemories.filter((pm) => !personaMemories.some((m) => m.id === pm.id))];
    const profile = buildProfileFromMemories(allMemories);
    if (!profile.displayName) profile.displayName = await getDisplayNameFromPersona(userId);
    return profile;
  } catch (error) {
    console.error("[Memory] Error building user profile:", error);
    return { displayName: undefined, activePreferences: [], relevantRelationships: [] };
  }
}

/** 与姓名/身份相关的问法，需放宽检索（整句无法 ILIKE 匹配「用户名为李华」类正文） */
const NAME_OR_IDENTITY_QUERY_RE =
  /(?:姓名|名字|大名|称呼|我是谁|我叫什么|叫什么|猜我|我的名|哪国人)/u;

/**
 * 为对话注入格式化的长期记忆上下文。
 *
 * 注意：不能用「整句用户话」做唯一子串匹配——例如「你猜我叫什么」无法匹配任何一条记忆正文，
 * 会导致检索为空、模型看不到已存储的姓名。优先混合检索，并在问身份/姓名为空时补充重要记忆。
 */
export async function getFormattedMemoryContext(
  userId: number,
  query: string,
  queryEmbeddingOrMaxLength?: number[] | number | null,
  maxLength: number = 2000
): Promise<string> {
  // 兼容旧调用方式：第三个参数可能是 maxLength（number）或 queryEmbedding（number[]）
  let queryEmbedding: number[] | null = null;
  if (Array.isArray(queryEmbeddingOrMaxLength)) {
    queryEmbedding = queryEmbeddingOrMaxLength;
  } else if (typeof queryEmbeddingOrMaxLength === "number") {
    maxLength = queryEmbeddingOrMaxLength;
  }
  try {
    const q = query.trim();
    const seen = new Set<number>();
    const merged: Memory[] = [];

    const pushUnique = (rows: Memory[]) => {
      for (const m of rows) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          merged.push(m);
        }
      }
    };

    // 1) 混合检索：整句不作为子串匹配，BM25 按词相关性排序
    if (q.length > 0) {
      const hybrid = await searchMemories({
        userId,
        query: q,
        limit: 15,
        minImportance: 0.25,
        useHybridSearch: true,
        queryEmbedding,
      });
      pushUnique(hybrid);
    }

    // 2) 混合仍为空，或明显在问姓名/身份：补充按重要度拉取（不依赖问句出现在正文中）
    if (
      merged.length === 0 ||
      (q.length > 0 && NAME_OR_IDENTITY_QUERY_RE.test(q))
    ) {
      const broad = await searchMemories({
        userId,
        limit: 25,
        minImportance: 0.2,
      });
      pushUnique(broad);
    }

    merged.sort(
      (a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0)
    );

    return formatMemoriesForContext(merged.slice(0, 25), maxLength);
  } catch (error) {
    console.error("[Memory] Error getting memory context:", error);
    return "";
  }
}

// ==================== 后台任务 ====================

export async function consolidateMemories(userId: number): Promise<number> {
  try {
    const result = await smartMemConsolidate(userId);
    return result.memoriesConsolidated;
  } catch (error) {
    console.error("[Memory] Error consolidating memories:", error);
    return 0;
  }
}

export async function forgetMemories(userId: number): Promise<number> {
  try {
    const result = await applyForgettingDecay(userId);
    return result.memoriesDecayed + result.memoriesRemoved;
  } catch (error) {
    console.error("[Memory] Error forgetting memories:", error);
    return 0;
  }
}
