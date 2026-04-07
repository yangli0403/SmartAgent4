/**
 * Memory Tools — 记忆技能工具集
 *
 * 将底层记忆系统的数据库操作封装为 Agent 可调用的结构化工具（Tools），
 * 实现"记忆技能化"（Skills-based Memory）理念。
 *
 * 四个核心工具：
 * - memory_store  : Agent 主动写入一条结构化记忆
 * - memory_search : Agent 主动检索历史记忆
 * - memory_update : Agent 修正错误/过期的记忆
 * - memory_forget : Agent 删除错误/过期的记忆
 *
 * 注册方式：内置工具（builtin），与 freeWeatherTools 模式一致。
 * 底层调用：memorySystem.ts 中的 addMemory / searchMemories / updateMemory / deleteMemory。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";
import {
  addMemory,
  searchMemories,
  updateMemory,
  deleteMemory,
  type MemorySearchOptions,
} from "../../memory/memorySystem";
import type { InsertMemory } from "../../../drizzle/schema";
import { auditMemoryExtraction } from "../../memory/extractionAudit";
import { generateEmbedding } from "../../memory/embeddingService";

// ==================== 常量 ====================

/** 内置记忆工具的 serverId */
export const MEMORY_TOOLS_SERVER_ID = "builtin-memory-tools";

// ==================== 工具实现 ====================

/**
 * memory_store — 主动存储记忆
 *
 * Agent 在完成多轮任务后，主动调用此工具将核心决策和关键信息
 * 总结为一条完整记忆写入长期存储。
 *
 * @param args 工具参数
 * @returns 存储结果的文本描述
 */
async function memoryStoreImpl(args: Record<string, unknown>): Promise<string> {
  const userId = Number(args.userId);
  const content = String(args.content || "");
  const type = String(args.type || "fact") as "fact" | "behavior" | "preference" | "emotion";
  const kind = String(args.kind || "episodic") as "episodic" | "semantic" | "persona";
  const tags = args.tags as string[] | undefined;
  const importance = Number(args.importance ?? 0.7);
  const confidence = Number(args.confidence ?? 0.8);
  const versionGroup = args.versionGroup as string | undefined;

  // 参数校验
  if (!userId || userId <= 0) {
    return "错误：userId 无效，无法存储记忆。";
  }
  if (!content || content.trim().length === 0) {
    return "错误：content 不能为空，请提供要存储的记忆内容。";
  }
  const validTypes = ["fact", "behavior", "preference", "emotion"];
  if (!validTypes.includes(type)) {
    return `错误：type 必须是 ${validTypes.join("/")} 之一，收到 "${type}"。`;
  }
  const validKinds = ["episodic", "semantic", "persona"];
  if (!validKinds.includes(kind)) {
    return `错误：kind 必须是 ${validKinds.join("/")} 之一，收到 "${kind}"。`;
  }

  try {
    // --- 新增：审计层检查（重要性门控 + 去重） ---
    const auditResult = await auditMemoryExtraction({
      userId,
      content: content.trim(),
      type,
      importance: Math.max(0, Math.min(1, importance)),
    });

    if (auditResult.verdict === "REJECT") {
      console.log(
        `[MemoryTools] 审计拒绝: ${auditResult.reason}`
      );
      return `记忆未存储：${auditResult.reason}`;
    }

    if (auditResult.verdict === "MERGE" && auditResult.matchedMemory) {
      // 建议合并：更新已有记忆而非新建
      const mergeResult = await updateMemory(auditResult.matchedMemory.id, {
        content: content.trim(),
        importance: Math.max(0, Math.min(1, importance)),
        confidence: Math.max(0, Math.min(1, confidence)),
        tags: tags || undefined,
      });
      if (mergeResult) {
        return `记忆已合并到已有记忆 ID:${auditResult.matchedMemory.id}（相似度: ${(auditResult.similarityScore ?? 0).toFixed(2)}）。内容已更新。`;
      }
    }

    const memory: InsertMemory = {
      userId,
      content: content.trim(),
      type,
      kind,
      importance: Math.max(0, Math.min(1, importance)),
      confidence: Math.max(0, Math.min(1, confidence)),
      tags: tags || null,
      source: "agent_skill",
      versionGroup: versionGroup || undefined,
    };

    const result = await addMemory(memory);
    if (result) {
      return `记忆存储成功。ID: ${result.id}, 类型: ${result.type}, 大类: ${result.kind}, 内容摘要: "${content.substring(0, 80)}${content.length > 80 ? "..." : ""}"`;
    }
    return "记忆存储失败：数据库操作未返回结果，请稍后重试。";
  } catch (error) {
    return `记忆存储失败：${(error as Error).message}`;
  }
}

/**
 * memory_search — 主动检索记忆
 *
 * Agent 遇到模糊指代或需要历史上下文时，主动调用此工具
 * 检索相关记忆。支持关键词搜索和混合检索（BM25 + 向量）。
 *
 * @param args 工具参数
 * @returns 检索结果的文本描述
 */
async function memorySearchImpl(args: Record<string, unknown>): Promise<string> {
  const userId = Number(args.userId);
  const query = String(args.query || "");
  const type = args.type as "fact" | "behavior" | "preference" | "emotion" | undefined;
  const kind = args.kind as "episodic" | "semantic" | "persona" | undefined;
  const limit = Number(args.limit ?? 10);

  // 参数校验
  if (!userId || userId <= 0) {
    return "错误：userId 无效，无法检索记忆。";
  }
  if (!query || query.trim().length === 0) {
    return "错误：query 不能为空，请提供搜索关键词。";
  }

  try {
    const searchOptions: MemorySearchOptions = {
      userId,
      query: query.trim(),
      type,
      kind,
      limit: Math.max(1, Math.min(50, limit)),
      useHybridSearch: true,
      alpha: 0.5,
    };

    const results = await searchMemories(searchOptions);

    if (results.length === 0) {
      return `未找到与 "${query}" 相关的记忆。`;
    }

    // 格式化结果
    const formatted = results.map((mem, idx) => {
      const tagsStr = mem.tags && Array.isArray(mem.tags) ? ` [标签: ${(mem.tags as string[]).join(", ")}]` : "";
      const timeStr = mem.createdAt ? ` (创建于: ${new Date(mem.createdAt).toLocaleString("zh-CN")})` : "";
      return `${idx + 1}. [ID:${mem.id}] [${mem.kind}/${mem.type}] ${mem.content}${tagsStr}${timeStr}`;
    });

    return `找到 ${results.length} 条相关记忆：\n${formatted.join("\n")}`;
  } catch (error) {
    return `记忆检索失败：${(error as Error).message}`;
  }
}

/**
 * memory_update — 修正记忆
 *
 * Agent 在用户指出之前的记忆有误或状态发生改变时，
 * 主动调用此工具修正指定记忆的内容。
 *
 * @param args 工具参数
 * @returns 更新结果的文本描述
 */
async function memoryUpdateImpl(args: Record<string, unknown>): Promise<string> {
  const memoryId = Number(args.memoryId);
  const content = args.content as string | undefined;
  const importance = args.importance as number | undefined;
  const confidence = args.confidence as number | undefined;
  const tags = args.tags as string[] | undefined;

  // 参数校验
  if (!memoryId || memoryId <= 0) {
    return "错误：memoryId 无效，请提供要更新的记忆 ID。";
  }
  if (!content && importance === undefined && confidence === undefined && !tags) {
    return "错误：至少需要提供一个要更新的字段（content / importance / confidence / tags）。";
  }

  try {
    const updates: Record<string, unknown> = {};
    if (content !== undefined) updates.content = content.trim();
    if (importance !== undefined) updates.importance = Math.max(0, Math.min(1, importance));
    if (confidence !== undefined) updates.confidence = Math.max(0, Math.min(1, confidence));
    if (tags !== undefined) updates.tags = tags;

    const success = await updateMemory(memoryId, updates);
    if (success) {
      return `记忆 ID:${memoryId} 更新成功。更新字段: ${Object.keys(updates).join(", ")}`;
    }
    return `记忆 ID:${memoryId} 更新失败：数据库操作未成功，请检查 ID 是否存在。`;
  } catch (error) {
    return `记忆更新失败：${(error as Error).message}`;
  }
}

/**
 * memory_forget — 删除记忆
 *
 * Agent 在用户明确要求遗忘某条记忆，或判断某条记忆已完全过期时，
 * 主动调用此工具删除指定记忆。
 *
 * @param args 工具参数
 * @returns 删除结果的文本描述
 */
async function memoryForgetImpl(args: Record<string, unknown>): Promise<string> {
  const memoryId = Number(args.memoryId);
  const reason = String(args.reason || "用户请求删除");

  // 参数校验
  if (!memoryId || memoryId <= 0) {
    return "错误：memoryId 无效，请提供要删除的记忆 ID。";
  }

  try {
    const success = await deleteMemory(memoryId);
    if (success) {
      return `记忆 ID:${memoryId} 已成功删除。原因: ${reason}`;
    }
    return `记忆 ID:${memoryId} 删除失败：数据库操作未成功，请检查 ID 是否存在。`;
  } catch (error) {
    return `记忆删除失败：${(error as Error).message}`;
  }
}

// ==================== 工具注册 ====================

/**
 * 将四个记忆技能工具注册到 ToolRegistry
 *
 * 注册方式与 freeWeatherTools 一致，使用 builtin serverId 前缀，
 * 在 MCPManager 中通过 callMemoryTool 分发调用。
 *
 * @param registry ToolRegistry 实例
 */
export function registerMemoryTools(registry: ToolRegistry): void {
  // 1. memory_store — 主动存储记忆
  registry.register({
    name: "memory_store",
    description:
      "主动存储一条结构化记忆。当你完成一个多轮任务（如导航规划、行程预订、复杂方案讨论）后，" +
      "必须调用此工具将本次任务的核心决策和关键信息总结为一条完整记忆。" +
      "输入参数：userId（用户ID）、content（记忆内容）、type（fact/behavior/preference/emotion）、" +
      "kind（episodic/semantic/persona）、tags（标签数组，可选）、importance（重要度0-1，可选）、" +
      "confidence（置信度0-1，可选）、versionGroup（版本分组，可选）。",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "number",
          description: "用户 ID（从上下文中获取）",
        },
        content: {
          type: "string",
          description: "要存储的记忆内容，应是完整、准确的总结性描述",
        },
        type: {
          type: "string",
          enum: ["fact", "behavior", "preference", "emotion"],
          description: "记忆类型：fact（事实）、behavior（行为）、preference（偏好）、emotion（情感）",
        },
        kind: {
          type: "string",
          enum: ["episodic", "semantic", "persona"],
          description: "记忆大类：episodic（情景记忆）、semantic（语义记忆）、persona（人格记忆）",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签数组，用于分类和检索（可选）",
        },
        importance: {
          type: "number",
          description: "重要度 (0.0 - 1.0)，默认 0.7（可选）",
        },
        confidence: {
          type: "number",
          description: "置信度 (0.0 - 1.0)，默认 0.8（可选）",
        },
        versionGroup: {
          type: "string",
          description: "版本分组标识，相同 versionGroup 的记忆会自动合并更新（可选）",
        },
      },
      required: ["userId", "content", "type"],
    },
    serverId: MEMORY_TOOLS_SERVER_ID,
    category: "navigation" as const,
    registeredAt: new Date(),
  });

  // 2. memory_search — 主动检索记忆
  registry.register({
    name: "memory_search",
    description:
      "主动检索历史记忆。当用户的指令包含模糊指代（如'上次那家'、'昨晚的路线'）" +
      "或需要隐式偏好时，必须先调用此工具检索历史记忆，然后再回复用户。" +
      "支持关键词搜索和混合检索（BM25 + 向量）。" +
      "输入参数：userId（用户ID）、query（搜索关键词）、type（可选过滤）、kind（可选过滤）、limit（返回数量，可选）。",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "number",
          description: "用户 ID（从上下文中获取）",
        },
        query: {
          type: "string",
          description: "搜索关键词或短语，如'导航路线'、'饮食偏好'",
        },
        type: {
          type: "string",
          enum: ["fact", "behavior", "preference", "emotion"],
          description: "按记忆类型过滤（可选）",
        },
        kind: {
          type: "string",
          enum: ["episodic", "semantic", "persona"],
          description: "按记忆大类过滤（可选）",
        },
        limit: {
          type: "number",
          description: "返回结果数量上限，默认 10（可选）",
        },
      },
      required: ["userId", "query"],
    },
    serverId: MEMORY_TOOLS_SERVER_ID,
    category: "navigation" as const,
    registeredAt: new Date(),
  });

  // 3. memory_update — 修正记忆
  registry.register({
    name: "memory_update",
    description:
      "修正错误或过期的记忆。当用户明确指出之前的记忆有误或状态发生改变" +
      "（如'我搬家了'、'我不吃辣了'）时，必须主动调用此工具更新对应记忆。" +
      "需要先通过 memory_search 找到目标记忆的 ID。" +
      "输入参数：memoryId（记忆ID）、content（新内容，可选）、importance（新重要度，可选）、" +
      "confidence（新置信度，可选）、tags（新标签，可选）。",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: {
          type: "number",
          description: "要更新的记忆 ID（通过 memory_search 获取）",
        },
        content: {
          type: "string",
          description: "更新后的记忆内容（可选）",
        },
        importance: {
          type: "number",
          description: "更新后的重要度 (0.0 - 1.0)（可选）",
        },
        confidence: {
          type: "number",
          description: "更新后的置信度 (0.0 - 1.0)（可选）",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "更新后的标签数组（可选）",
        },
      },
      required: ["memoryId"],
    },
    serverId: MEMORY_TOOLS_SERVER_ID,
    category: "navigation" as const,
    registeredAt: new Date(),
  });

  // 4. memory_forget — 删除记忆
  registry.register({
    name: "memory_forget",
    description:
      "删除错误或过期的记忆。当用户明确要求遗忘某条记忆，" +
      "或你判断某条记忆已完全过期不再有效时，调用此工具。" +
      "需要先通过 memory_search 找到目标记忆的 ID。" +
      "输入参数：memoryId（记忆ID）、reason（删除原因，可选）。",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: {
          type: "number",
          description: "要删除的记忆 ID（通过 memory_search 获取）",
        },
        reason: {
          type: "string",
          description: "删除原因（可选，用于日志记录）",
        },
      },
      required: ["memoryId"],
    },
    serverId: MEMORY_TOOLS_SERVER_ID,
    category: "navigation" as const,
    registeredAt: new Date(),
  });

  console.log("[MemoryTools] 已注册 4 个记忆技能工具: memory_store, memory_search, memory_update, memory_forget");
}

// ==================== 工具调用分发 ====================

/**
 * 分发记忆工具调用
 *
 * 由 MCPManager 在检测到 builtin-memory-tools serverId 时调用。
 *
 * @param toolName 工具名称
 * @param args 工具参数
 * @returns 工具执行结果
 */
export async function callMemoryTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "memory_store":
      return memoryStoreImpl(args);
    case "memory_search":
      return memorySearchImpl(args);
    case "memory_update":
      return memoryUpdateImpl(args);
    case "memory_forget":
      return memoryForgetImpl(args);
    default:
      throw new Error(`[MemoryTools] 未知的记忆工具: ${toolName}`);
  }
}
