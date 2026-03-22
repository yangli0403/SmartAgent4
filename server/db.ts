import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  userPreferences,
  type UserPreference,
  type InsertUserPreference,
  conversations,
  type Conversation,
  type InsertConversation,
  chatSessions,
  type ChatSession,
  type InsertChatSession,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    throw new Error("数据库连接不可用，请检查 DATABASE_URL 配置");
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  try {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
  } catch (error: any) {
    console.error("[Database] Error getting user by openId:", error);
    // 如果是表不存在错误，提供更友好的提示
    if (error.message?.includes("doesn't exist") || error.message?.includes("Table") || error.code === "ER_NO_SUCH_TABLE") {
      console.error("[Database] 数据库表不存在，请运行: pnpm db:push");
      throw new Error("数据库表不存在，请先运行 'pnpm db:push' 创建数据库表");
    }
    throw error;
  }
}

/**
 * Get or create user preferences
 */
export async function getUserPreferences(
  userId: number
): Promise<UserPreference | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (result.length > 0) {
    const prefs = result[0];
    // 确保 notificationPreference 是对象而不是字符串
    if (prefs.notificationPreference && typeof prefs.notificationPreference === 'string') {
      try {
        (prefs as any).notificationPreference = JSON.parse(prefs.notificationPreference);
      } catch (e) {
        (prefs as any).notificationPreference = {
          taskReminders: true,
          behaviorInsights: true,
          dailySummary: false,
        };
      }
    }
    return prefs;
  }

  // Create default preferences
  const defaultPrefs: InsertUserPreference = {
    userId,
    personality: "professional",
    responseStyle: "balanced",
    proactiveService: "enabled",
    notificationPreference: {
      taskReminders: true,
      behaviorInsights: true,
      dailySummary: false,
    },
  };

  await db.insert(userPreferences).values(defaultPrefs);

  const newResult = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return newResult[0] || null;
}

/**
 * Update user preferences
 */
export async function updateUserPreferences(
  userId: number,
  updates: Partial<InsertUserPreference>
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    // 确保 notificationPreference 是对象而不是字符串
    const cleanUpdates = { ...updates };
    if (cleanUpdates.notificationPreference && typeof cleanUpdates.notificationPreference === 'string') {
      try {
        cleanUpdates.notificationPreference = JSON.parse(cleanUpdates.notificationPreference);
      } catch (e) {
        console.error("[Database] Failed to parse notificationPreference:", e);
        delete cleanUpdates.notificationPreference;
      }
    }
    
    await db
      .update(userPreferences)
      .set(cleanUpdates)
      .where(eq(userPreferences.userId, userId));
    return true;
  } catch (error) {
    console.error("[Database] Error updating preferences:", error);
    return false;
  }
}

/**
 * Save conversation message
 */
export async function saveConversation(
  conversation: InsertConversation
): Promise<Conversation | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(conversations).values(conversation);
    const insertedId = Number(result[0].insertId);

    const inserted = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, insertedId))
      .limit(1);

    return inserted[0] || null;
  } catch (error) {
    console.error("[Database] Error saving conversation:", error);
    return null;
  }
}

/**
 * Get recent conversations for a user (optionally for a session)
 */
export async function getRecentConversations(
  userId: number,
  limit: number = 20,
  sessionId: number | null = null
): Promise<Conversation[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const where =
      sessionId !== null
        ? and(eq(conversations.userId, userId), eq(conversations.sessionId, sessionId))
        : and(eq(conversations.userId, userId), isNull(conversations.sessionId));
    const result = await db
      .select()
      .from(conversations)
      .where(where)
      .orderBy(desc(conversations.createdAt))
      .limit(limit);

    return result.reverse();
  } catch (error) {
    console.error("[Database] Error getting conversations:", error);
    return [];
  }
}

/**
 * Chat sessions
 */
export async function createChatSession(
  userId: number,
  title: string = "新会话"
): Promise<ChatSession | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.insert(chatSessions).values({ userId, title });
    const id = Number(result[0].insertId);
    const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error("[Database] Error creating chat session:", error);
    return null;
  }
}

export async function listChatSessions(userId: number): Promise<ChatSession[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt));
  } catch (error) {
    console.error("[Database] Error listing chat sessions:", error);
    return [];
  }
}

export async function updateChatSession(
  id: number,
  userId: number,
  title: string
): Promise<ChatSession | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    await db
      .update(chatSessions)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)));
    const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error("[Database] Error updating chat session:", error);
    return null;
  }
}

export async function deleteChatSession(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)));
    return true;
  } catch (error) {
    console.error("[Database] Error deleting chat session:", error);
    return false;
  }
}
