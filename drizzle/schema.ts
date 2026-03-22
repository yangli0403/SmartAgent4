import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  json,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * User preferences for personality, behavior, and service settings
 */
export const userPreferences = mysqlTable(
  "user_preferences",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personality: varchar("personality", { length: 50 })
      .default("professional")
      .notNull(), // professional, humorous, warm, concise, creative
    responseStyle: varchar("responseStyle", { length: 50 })
      .default("balanced")
      .notNull(), // concise, detailed, balanced
    proactiveService: mysqlEnum("proactiveService", ["enabled", "disabled"])
      .default("enabled")
      .notNull(),
    notificationPreference: json("notificationPreference").$type<{
      taskReminders: boolean;
      behaviorInsights: boolean;
      dailySummary: boolean;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
  })
);

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * Memory entries - core of "the more you use, the more it understands you"
 */
export const memories = mysqlTable(
  "memories",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 记忆大类：情景 / 语义 / 人格（供记忆中心与上层分类使用）
    kind: mysqlEnum("kind", ["episodic", "semantic", "persona"])
      .default("semantic")
      .notNull(),
    type: mysqlEnum("type", [
      "fact",
      "behavior",
      "preference",
      "emotion",
    ]).notNull(),
    content: text("content").notNull(),
    importance: float("importance").default(0.5).notNull(), // 0-1
    confidence: float("confidence").default(0.8).notNull(), // 0-1
    accessCount: int("accessCount").default(0).notNull(),
    clusterId: int("clusterId"), // reference to memory_clusters for consolidation
    // --- SmartMem 扩展字段 ---
    embedding: json("embedding").$type<number[] | null>(), // 向量嵌入，用于混合检索
    validFrom: timestamp("validFrom"), // 记忆生效时间（可选）
    validUntil: timestamp("validUntil"), // 记忆失效时间（可选）
    // 统一标签与来源说明，便于搜索与调试
    tags: json("tags").$type<string[] | null>(),
    source: varchar("source", { length: 64 }),
    // 用于同一类信息（如姓名、常用饮品）的版本分组，方便“只取最新一条”
    versionGroup: varchar("versionGroup", { length: 100 }),
    metadata: json("metadata").$type<{
      source?: string; // conversation, analysis, user_input
      relatedMemoryIds?: number[];
      tags?: string[];
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastAccessedAt: timestamp("lastAccessedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    kindIdx: index("kind_idx").on(table.kind),
    typeIdx: index("type_idx").on(table.type),
    importanceIdx: index("importance_idx").on(table.importance),
    lastAccessedIdx: index("last_accessed_idx").on(table.lastAccessedAt),
    versionGroupIdx: index("version_group_idx").on(table.versionGroup),
  })
);

export type Memory = typeof memories.$inferSelect;
export type InsertMemory = typeof memories.$inferInsert;

/**
 * Memory clusters - consolidated long-term memories
 */
export const memoryClusters = mysqlTable(
  "memory_clusters",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    memberCount: int("memberCount").default(0).notNull(),
    avgImportance: float("avgImportance").default(0.5).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
  })
);

export type MemoryCluster = typeof memoryClusters.$inferSelect;
export type InsertMemoryCluster = typeof memoryClusters.$inferInsert;

/**
 * Chat sessions - one per "conversation" / "new chat"
 */
export const chatSessions = mysqlTable(
  "chat_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).default("新会话").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
  })
);

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * Conversation history for context and memory formation
 */
export const conversations = mysqlTable(
  "conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: int("sessionId").references(() => chatSessions.id, {
      onDelete: "cascade",
    }),
    role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
    content: text("content").notNull(),
    metadata: json("metadata").$type<{
      personality?: string;
      toolCalls?: Array<{ tool: string; args: any; result: any }>;
      memoriesUsed?: string[];
      tokensUsed?: number;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    sessionIdIdx: index("session_id_idx").on(table.sessionId),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Behavior patterns detected by the system
 */
export const behaviorPatterns = mysqlTable(
  "behavior_patterns",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patternType: varchar("patternType", { length: 100 }).notNull(), // e.g., "morning_routine", "work_schedule"
    description: text("description").notNull(),
    confidence: float("confidence").default(0.7).notNull(),
    frequency: int("frequency").default(1).notNull(), // how many times observed
    lastObserved: timestamp("lastObserved").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    patternTypeIdx: index("pattern_type_idx").on(table.patternType),
  })
);

export type BehaviorPattern = typeof behaviorPatterns.$inferSelect;
export type InsertBehaviorPattern = typeof behaviorPatterns.$inferInsert;
