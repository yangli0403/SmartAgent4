import {
  serial,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  doublePrecision,
  jsonb,
  index,
  boolean,
} from "drizzle-orm/pg-core";

// ==================== PostgreSQL 枚举定义 ====================

/** 用户角色枚举 */
export const roleEnum = pgEnum("role", ["user", "admin"]);

/** 记忆大类枚举 */
export const kindEnum = pgEnum("kind", ["episodic", "semantic", "persona"]);

/** 记忆类型枚举 */
export const memoryTypeEnum = pgEnum("memory_type", [
  "fact",
  "behavior",
  "preference",
  "emotion",
]);

/** 主动服务枚举 */
export const proactiveServiceEnum = pgEnum("proactive_service", [
  "enabled",
  "disabled",
]);

/** 对话角色枚举 */
export const conversationRoleEnum = pgEnum("conversation_role", [
  "user",
  "assistant",
  "system",
]);

/** 工具调用状态枚举 */
export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "success",
  "error",
  "timeout",
]);

// ==================== 表定义 ====================

/**
 * 核心用户表，支撑认证流程。
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // PostgreSQL 不支持 onUpdateNow()，在应用层手动更新
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 用户偏好设置：人格、行为和服务配置
 */
export const userPreferences = pgTable(
  "user_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personality: varchar("personality", { length: 50 })
      .default("professional")
      .notNull(),
    responseStyle: varchar("responseStyle", { length: 50 })
      .default("balanced")
      .notNull(),
    proactiveService: proactiveServiceEnum("proactiveService")
      .default("enabled")
      .notNull(),
    notificationPreference: jsonb("notificationPreference").$type<{
      taskReminders: boolean;
      behaviorInsights: boolean;
      dailySummary: boolean;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("user_pref_user_id_idx").on(table.userId),
  })
);

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * 记忆条目 —— "越用越懂你"的核心
 */
export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 记忆大类：情景 / 语义 / 人格（供记忆中心与上层分类使用）
    kind: kindEnum("kind").default("semantic").notNull(),
    type: memoryTypeEnum("type").notNull(),
    content: text("content").notNull(),
    importance: doublePrecision("importance").default(0.5).notNull(),
    confidence: doublePrecision("confidence").default(0.8).notNull(),
    accessCount: integer("accessCount").default(0).notNull(),
    clusterId: integer("clusterId"),
    // --- SmartMem 扩展字段 ---
    embedding: jsonb("embedding").$type<number[] | null>(),
    validFrom: timestamp("validFrom"),
    validUntil: timestamp("validUntil"),
    // 统一标签与来源说明，便于搜索与调试
    tags: jsonb("tags").$type<string[] | null>(),
    source: varchar("source", { length: 64 }),
    // 用于同一类信息（如姓名、常用饮品）的版本分组，方便"只取最新一条"
    versionGroup: varchar("versionGroup", { length: 100 }),
    metadata: jsonb("metadata").$type<{
      source?: string;
      relatedMemoryIds?: number[];
      tags?: string[];
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastAccessedAt: timestamp("lastAccessedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("mem_user_id_idx").on(table.userId),
    kindIdx: index("mem_kind_idx").on(table.kind),
    typeIdx: index("mem_type_idx").on(table.type),
    importanceIdx: index("mem_importance_idx").on(table.importance),
    lastAccessedIdx: index("mem_last_accessed_idx").on(table.lastAccessedAt),
    versionGroupIdx: index("mem_version_group_idx").on(table.versionGroup),
  })
);

export type Memory = typeof memories.$inferSelect;
export type InsertMemory = typeof memories.$inferInsert;

/**
 * 记忆聚类 —— 巩固后的长期记忆
 */
export const memoryClusters = pgTable(
  "memory_clusters",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    memberCount: integer("memberCount").default(0).notNull(),
    avgImportance: doublePrecision("avgImportance").default(0.5).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("cluster_user_id_idx").on(table.userId),
  })
);

export type MemoryCluster = typeof memoryClusters.$inferSelect;
export type InsertMemoryCluster = typeof memoryClusters.$inferInsert;

/**
 * 聊天会话 —— 每个"新对话"对应一条
 */
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).default("新会话").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("session_user_id_idx").on(table.userId),
  })
);

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * 对话历史，用于上下文和记忆形成
 */
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: integer("sessionId").references(() => chatSessions.id, {
      onDelete: "cascade",
    }),
    role: conversationRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      personality?: string;
      toolCalls?: Array<{ tool: string; args: any; result: any }>;
      memoriesUsed?: string[];
      tokensUsed?: number;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("conv_user_id_idx").on(table.userId),
    sessionIdIdx: index("conv_session_id_idx").on(table.sessionId),
    createdAtIdx: index("conv_created_at_idx").on(table.createdAt),
  })
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * 行为模式 —— 系统检测到的用户行为规律
 */
export const behaviorPatterns = pgTable(
  "behavior_patterns",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patternType: varchar("patternType", { length: 100 }).notNull(),
    description: text("description").notNull(),
    confidence: doublePrecision("confidence").default(0.7).notNull(),
    frequency: integer("frequency").default(1).notNull(),
    lastObserved: timestamp("lastObserved").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("bp_user_id_idx").on(table.userId),
    patternTypeIdx: index("bp_pattern_type_idx").on(table.patternType),
  })
);

export type BehaviorPattern = typeof behaviorPatterns.$inferSelect;
export type InsertBehaviorPattern = typeof behaviorPatterns.$inferInsert;

// ==================== 自进化闭环新增表 ====================

/**
 * 工具效用日志 —— 记录每次工具调用的效用数据
 *
 * 自进化闭环的核心数据源，用于计算工具效用分数。
 * 由 ReflectionNode 异步写入。
 */
export const toolUtilityLogs = pgTable(
  "tool_utility_logs",
  {
    id: serial("id").primaryKey(),
    /** 工具名称 */
    toolName: varchar("toolName", { length: 200 }).notNull(),
    /** 所属 MCP Server ID */
    serverId: varchar("serverId", { length: 200 }),
    /** 调用状态 */
    status: toolCallStatusEnum("status").notNull(),
    /** 执行耗时（毫秒） */
    executionTimeMs: integer("executionTimeMs").default(0).notNull(),
    /** 错误信息（失败时） */
    errorMessage: text("errorMessage"),
    /** 关联的会话 ID */
    sessionId: varchar("sessionId", { length: 200 }),
    /** 关联的用户 ID */
    userId: varchar("userId", { length: 200 }),
    /** 创建时间 */
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    toolNameIdx: index("tul_tool_name_idx").on(table.toolName),
    statusIdx: index("tul_status_idx").on(table.status),
    createdAtIdx: index("tul_created_at_idx").on(table.createdAt),
  })
);

export type ToolUtilityLog = typeof toolUtilityLogs.$inferSelect;
export type InsertToolUtilityLog = typeof toolUtilityLogs.$inferInsert;

/**
 * Prompt 版本历史 —— 记录 System Prompt 的每次变更
 *
 * 自进化闭环的 Prompt 版本控制，由 ReflectionNode 生成补丁后写入。
 * 支持回滚到任意历史版本。
 */
export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: serial("id").primaryKey(),
    /** 人格 ID（如 xiaozhi / jarvis / alfred） */
    characterId: varchar("characterId", { length: 100 }).notNull(),
    /** 版本号（自增） */
    version: integer("version").default(1).notNull(),
    /** 补丁内容（描述本次变更） */
    patchContent: text("patchContent").notNull(),
    /** 变更推理过程 */
    reasoning: text("reasoning"),
    /** 变更前的完整 Prompt 快照（用于回滚） */
    previousSnapshot: text("previousSnapshot"),
    /** 变更后的完整 Prompt 快照 */
    currentSnapshot: text("currentSnapshot"),
    /** 是否为当前激活版本 */
    isActive: boolean("isActive").default(true).notNull(),
    /** 创建时间 */
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    characterIdIdx: index("pv_character_id_idx").on(table.characterId),
    versionIdx: index("pv_version_idx").on(table.version),
    activeIdx: index("pv_active_idx").on(table.isActive),
  })
);

export type PromptVersion = typeof promptVersions.$inferSelect;
export type InsertPromptVersion = typeof promptVersions.$inferInsert;
