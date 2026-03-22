import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getUserPreferences,
  updateUserPreferences,
  saveConversation,
  getRecentConversations,
  createChatSession,
  listChatSessions,
  updateChatSession,
  deleteChatSession,
} from "./db";
import * as db from "./db";
import { runAgent } from "./agent/agentEngine";
import { getSmartAgentApp } from "./agent/smartAgentApp";

// ==================== 初始化 SmartAgentApp（单例，服务启动时初始化）====================
let smartAgentReady = false;
let smartAgentInitError: string | null = null;

getSmartAgentApp()
  .initialize()
  .then(() => {
    smartAgentReady = true;
    console.log("[Router] SmartAgentApp initialized successfully");
  })
  .catch((err: Error) => {
    smartAgentInitError = err.message;
    console.error("[Router] SmartAgentApp initialization failed:", err.message);
  });
import {
  searchMemories,
  getDisplayNameFromPersona,
  addMemory,
  updateMemory,
  deleteMemory,
} from "./memory/memorySystem";
import {
  PERSONALITIES,
  type PersonalityType,
} from "./personality/personalitySystem";
import { getPersonalityEngine } from "./personality/personalityEngine";
import { getEmotionsClient } from "./emotions/emotionsClient";
import { getUserProfileSnapshot } from "./memory/memorySystem";
import type { User } from "../drizzle/schema";

// 测试模式辅助函数：确保有用户可用
const SKIP_AUTH = process.env.SKIP_AUTH === "true" || process.env.VITE_SKIP_OAUTH === "true";

async function ensureUser(ctx: { user: User | null }): Promise<User> {
  if (ctx.user) {
    return ctx.user;
  }
  
  if (SKIP_AUTH) {
    // 尝试获取测试用户
    let testUser = await db.getUserByOpenId("test_user_skip_auth");
    if (!testUser) {
      // 如果测试用户不存在，尝试创建
      await db.upsertUser({
        openId: "test_user_skip_auth",
        name: "测试用户",
        email: "test@example.com",
        loginMethod: "test",
      });
      testUser = await db.getUserByOpenId("test_user_skip_auth");
    }
    
    if (testUser) {
      ctx.user = testUser;
      return testUser;
    }
  }
  
  throw new Error("用户未认证");
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Chat router - main conversation interface
  chat: router({
    sendMessage: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
          sessionId: z.number().nullable().optional(),
          /** SmartAgent3 新增：人格 ID */
          characterId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const userId = user.id;
        const sessionId = input.sessionId ?? null;

        const prefs = await getUserPreferences(userId);
        const personality = (prefs?.personality ||
          "professional") as PersonalityType;

        const recentConvs = await getRecentConversations(userId, 10, sessionId);
        const conversationHistory = recentConvs.map(c => ({
          role: c.role as "user" | "assistant" | "system",
          content: c.content,
        }));

        // 优先使用人格记忆中的称呼/姓名，再回退到账号名
        const displayName =
          (await getDisplayNameFromPersona(userId).catch(() => undefined)) ||
          user.name ||
          undefined;

         // ==================== 路由逻辑 ====================
        // 优先使用 SmartAgentApp（Supervisor 多 Agent 架构，支持高德地图 MCP）
        // 降级到旧 runAgent（仅处理文件/浏览器工具）
        let responseText: string;
        let memoriesUsed: string[] = [];
        let agentDomain = "general";
        let agentComplexity = "simple";

        if (smartAgentReady) {
          console.log("[Chat] 路由到 SmartAgentApp (Supervisor 架构)");
          try {
            const supervisorResult = await getSmartAgentApp().chat(
              input.message,
              {
                userId: String(userId),
                sessionId: String(sessionId ?? userId),
                conversationHistory,
                platform: "linux",
                characterId: input.characterId || "xiaozhi",
              }
            );
            responseText = supervisorResult.response;
            agentDomain = supervisorResult.classification.domain;
            agentComplexity = supervisorResult.classification.complexity;
            console.log(
              `[Chat] Supervisor 完成: domain=${agentDomain}, complexity=${agentComplexity}, steps=${supervisorResult.stepsExecuted}, tools=${supervisorResult.totalToolCalls}`
            );
          } catch (supervisorErr) {
            console.error("[Chat] Supervisor 失败，降级到旧 runAgent:", (supervisorErr as Error).message);
            const agentState = await runAgent(
              { userId, personality, userName: displayName },
              input.message,
              conversationHistory
            );
            responseText = agentState.finalResponse || "抱歉，我无法生成回复。";
            memoriesUsed = agentState.memories;
          }
        } else {
          console.log(
            `[Chat] SmartAgentApp 未就绪 (${smartAgentInitError || "初始化中"})，使用旧 runAgent`
          );
          const agentState = await runAgent(
            { userId, personality, userName: displayName },
            input.message,
            conversationHistory
          );
          responseText = agentState.finalResponse || "抱歉，我无法生成回复。";
          memoriesUsed = agentState.memories;
        }

        const savedUser = await saveConversation({
          userId,
          sessionId,
          role: "user",
          content: input.message,
          metadata: {},
        });
        const savedAssistant = await saveConversation({
          userId,
          sessionId,
          role: "assistant",
          content: responseText,
          metadata: {
            personality,
            memoriesUsed,
          },
        });
        const persisted = savedUser !== null && savedAssistant !== null;
        if (!persisted) {
          console.warn(
            "[Chat] 对话未写入数据库（请检查 MySQL 是否已启动且 DATABASE_URL 已配置）"
          );
        }
        return {
          response: responseText,
          memoriesUsed,
          personality,
          persisted,
        };
      }),

    getHistory: protectedProcedure
      .input(
        z.object({
          limit: z.number().optional().default(50),
          sessionId: z.number().nullable().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const conversations = await getRecentConversations(
          user.id,
          input.limit,
          input.sessionId ?? null
        );
        return conversations;
      }),

    createSession: protectedProcedure
      .input(z.object({ title: z.string().optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const session = await createChatSession(
          user.id,
          input?.title ?? "新会话"
        );
        return session;
      }),

    listSessions: protectedProcedure.query(async ({ ctx }) => {
      const user = await ensureUser(ctx);
      return listChatSessions(user.id);
    }),

    updateSession: protectedProcedure
      .input(z.object({ id: z.number(), title: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const session = await updateChatSession(input.id, user.id, input.title);
        return session;
      }),

    deleteSession: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        await deleteChatSession(input.id, user.id);
        return { success: true };
      }),

    clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
      return { success: true };
    }),
  }),

  // Memory router - manage user memories
  memory: router({
    list: protectedProcedure
      .input(
        z.object({
          type: z.enum(["fact", "behavior", "preference", "emotion"]).optional(),
          kind: z.enum(["episodic", "semantic", "persona"]).optional(),
          versionGroup: z.string().optional(),
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        console.log("[Memory] list 请求: userId=%s kind=%s limit=%s", user.id, input.kind ?? "(全部)", input.limit);
        const memories = await searchMemories({
          userId: user.id,
          type: input.type,
          kind: input.kind,
          versionGroup: input.versionGroup,
          limit: input.limit,
          minImportance: 0,
        });
        console.log("[Memory] list 返回: %s 条", memories.length);
        return memories;
      }),

    create: protectedProcedure
      .input(
        z.object({
          type: z.enum(["fact", "behavior", "preference", "emotion"]),
          content: z.string().min(1),
          kind: z.enum(["episodic", "semantic", "persona"]).optional().default("semantic"),
          versionGroup: z.string().optional(),
          tags: z.array(z.string()).optional(),
          importance: z.number().min(0).max(1).optional().default(0.5),
          confidence: z.number().min(0).max(1).optional().default(0.8),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        console.log("[Memory] create 请求: userId=%s kind=%s type=%s contentLen=%s", user.id, input.kind, input.type, input.content?.length ?? 0);
        const memory = await addMemory({
          userId: user.id,
          type: input.type,
          content: input.content,
          importance: input.importance,
          confidence: input.confidence,
          kind: input.kind,
          versionGroup: input.versionGroup,
          tags: input.tags ?? null,
          source: "user_input",
          metadata: {
            source: "user_input",
            tags: input.tags,
          },
        });
        if (!memory) {
          console.error("[Memory] create 失败: addMemory 返回 null，请查看上方 [Memory] 日志中的具体错误");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "保存记忆失败：数据库未就绪或写入异常，请确认 MySQL 已启动且 DATABASE_URL 已配置。",
          });
        }
        console.log("[Memory] create 成功: id=%s", memory.id);
        return memory;
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          content: z.string().optional(),
          importance: z.number().min(0).max(1).optional(),
          confidence: z.number().min(0).max(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const success = await updateMemory(id, updates);
        return { success };
      }),

    delete: protectedProcedure
      .input(
        z.object({
          id: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const success = await deleteMemory(input.id);
        return { success };
      }),
  }),

  // Preferences router - manage user preferences
  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const user = await ensureUser(ctx);
      const prefs = await getUserPreferences(user.id);
      return prefs;
    }),

    update: protectedProcedure
      .input(
        z.object({
          personality: z
            .enum(["professional", "humorous", "warm", "concise", "creative"])
            .optional(),
          responseStyle: z.enum(["concise", "detailed", "balanced"]).optional(),
          proactiveService: z.enum(["enabled", "disabled"]).optional(),
          notificationPreference: z
            .object({
              taskReminders: z.boolean(),
              behaviorInsights: z.boolean(),
              dailySummary: z.boolean(),
            })
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const success = await updateUserPreferences(user.id, input);
        return { success };
      }),

    getPersonalities: publicProcedure.query(() => {
      return Object.entries(PERSONALITIES).map(([key, value]) => ({
        id: key,
        name: value.name,
        traits: value.traits,
        responseStyle: value.responseStyle,
      }));
    }),
  }),

  // Agent router - agent status and control
  agent: router({
    getStatus: protectedProcedure.query(async ({ ctx }) => {
      const user = await ensureUser(ctx);
      const prefs = await getUserPreferences(user.id);
      const memoryCount = await searchMemories({
        userId: user.id,
        limit: 1000,
        minImportance: 0,
      });

      return {
        personality: prefs?.personality || "professional",
        memoryCount: memoryCount.length,
        proactiveService: prefs?.proactiveService || "enabled",
      };
    }),
  }),

  // ==================== SmartAgent3 新增路由 ====================

  // Character router - 人格配置管理
  character: router({
    /** 列出所有可用人格 */
    list: publicProcedure.query(() => {
      const engine = getPersonalityEngine();
      return engine.listCharacters().map((c) => ({
        id: c.id,
        name: c.name,
        bio: c.bio[0] || "",
        adjectives: c.adjectives,
        sourceFormat: c.sourceFormat,
      }));
    }),

    /** 获取单个人格详情 */
    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => {
        const engine = getPersonalityEngine();
        const character = engine.getCharacter(input.id);
        if (!character) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `人格配置不存在: ${input.id}`,
          });
        }
        return character;
      }),

    /** 生成个性化问候语 */
    greeting: protectedProcedure
      .input(z.object({ characterId: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const engine = getPersonalityEngine();
        const profile = await getUserProfileSnapshot(user.id);
        const greeting = engine.generateGreeting(
          input.characterId || "xiaozhi",
          profile
        );
        return { greeting, characterId: input.characterId || "xiaozhi" };
      }),
  }),

  // Emotions router - 情感表达服务状态
  emotions: router({
    /** 检查 Emotions-Express 服务状态 */
    status: publicProcedure.query(async () => {
      const client = getEmotionsClient();
      const available = await client.isAvailable();
      return {
        available,
        message: available
          ? "Emotions-Express 服务运行正常"
          : "Emotions-Express 服务不可用（回复将使用纯文本模式）",
      };
    }),

    /** 解析文本中的情感标签（不调用 LLM） */
    parse: publicProcedure
      .input(z.object({ text: z.string() }))
      .mutation(async ({ input }) => {
        const client = getEmotionsClient();
        const segments = await client.parseOnly(input.text);
        return { segments };
      }),
  }),
});

export type AppRouter = typeof appRouter;
