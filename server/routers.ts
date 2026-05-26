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

// ==================== Omni TTS 摘要提取 ====================

/**
 * 从 LLM 回复中提取 TTS 播报摘要。
 * 策略：取第一个完整句子（句号/问号/感叹号结尾），最多 150 字。
 * 如果没有完整句子，取前 150 字。
 */
/**
 * 从 LLM 回复中智能提取 TTS 播报内容。
 *
 * 策略：
 * - 纯对话（< 80字）：完整播报
 * - 行程/表格类内容：提取目的地+天数+总景点数，格式化为流畅播报句
 * - 数字列表/天气数据：提取关键数字和结论句
 * - 其他内容：取第一句完整句（最多 200 字）
 */
function extractSummary(text: string): string {
  if (!text) return "";

  let cleanText = text
    // 移除思考过程，避免把内部推理内容送入 TTS。
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    // 移除代码块、Markdown 表格与表格分隔线。
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/gm, "")
    // Markdown 链接仅保留可读文本，不播报 URL。
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!cleanText) return "执行完毕，请查看详细结果。";

  // 策略 A：如果回复中已经给出明确总结，只合成总结引导句，避免播报全文。
  const summaryMatch = cleanText.match(/(总而言之|简单来说|综上所述|总结一下|整体来看|概括来说)[：:，,\s]*(.*?)(?=\n|$)/);
  if (summaryMatch) {
    const summary = `${summaryMatch[1]}，${summaryMatch[2] || ""}`.trim();
    if (summary.length <= 100) return summary;
    const truncated = summary.substring(0, 100);
    const lastPunc = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("！"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );
    return lastPunc > 50 ? truncated.substring(0, lastPunc + 1) : `${truncated}……`;
  }

  // 策略 B：短对话保留完整播报，但跳过标题、表格、列表等结构化内容。
  const isPlainShortReply =
    cleanText.length <= 80 &&
    !/^#{1,6}\s/m.test(cleanText) &&
    !/^\s*(?:[-*+]|\d+[.)]|[一二三四五六七八九十]+[、.])\s+/m.test(cleanText);
  if (isPlainShortReply) return cleanText;

  // 策略 C：取第一段有实质内容的自然语言；过滤标题、列表项、引用、表格残留等结构化文本。
  const paragraphs = cleanText
    .split(/\n+/)
    .map((p) => p.replace(/^#{1,6}\s*/, "").trim())
    .filter((p) => {
      if (!p) return false;
      if (/^\s*(?:[-*+]|\d+[.)]|[一二三四五六七八九十]+[、.])\s+/.test(p)) return false;
      if (/^>\s*/.test(p)) return false;
      if (/^\|.*\|$/.test(p)) return false;
      if (/^[-=]{3,}$/.test(p)) return false;
      return /[\u4e00-\u9fa5A-Za-z0-9]/.test(p);
    });

  if (paragraphs.length === 0) {
    return "执行完毕，请查看详细结果。";
  }

  let summary = paragraphs[0];

  // 如果第一段只是“好的”“已完成”等极短承接语，则拼接下一段核心内容。
  if (summary.length < 10 && paragraphs.length > 1) {
    summary = `${summary}，${paragraphs[1]}`;
  }

  // 严格控制合成长度，优先在 100 字内完整断句，防止长列表/长分析进入 TTS。
  if (summary.length > 100) {
    const truncated = summary.substring(0, 100);
    const lastPunc = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("！"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );
    summary = lastPunc > 50 ? truncated.substring(0, lastPunc + 1) : `${truncated}……`;
  }

  return summary;
}
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
  deleteAllMemories,
} from "./memory/memorySystem";
import { runUserMemoryMaintenance } from "./memory/memoryMaintenance";
import { auditMemoryExtraction } from "./memory/extractionAudit";
import {
  PERSONALITIES,
  type PersonalityType,
} from "./personality/personalitySystem";
import { getPersonalityEngine } from "./personality/personalityEngine";
import { synthesizeReplyTts } from "./emotions/chatTtsHelper";
import { getEmotionsClient } from "./emotions/emotionsClient";
import { getUserProfileSnapshot } from "./memory/memorySystem";
import type { User } from "../drizzle/schema";
import { AiriBridgeService } from "./airi-bridge";
import { persistSceneEpisode } from "./memory/sceneEpisode";

// ==================== 初始化 AIRI Bridge（可选）====================
let airiBridge: AiriBridgeService | null = null;
try {
  airiBridge = new AiriBridgeService();
  airiBridge.initialize().then(() => {
    console.log("[Router] AIRI Bridge initialized");
  }).catch((err: Error) => {
    console.warn(`[Router] AIRI Bridge init failed (non-blocking): ${err.message}`);
  });
} catch (err) {
  console.warn(`[Router] AIRI Bridge creation failed (non-blocking): ${(err as Error).message}`);
}

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
          /** v0.5 新增：可选流式请求 ID，启用 SSE 中间事件推送 */
          requestId: z.string().min(1).optional(),
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
            const baseChatOpts = {
              userId: String(userId),
              sessionId: String(sessionId ?? userId),
              conversationHistory,
              platform:
                process.platform === "win32"
                  ? "windows"
                  : process.platform === "darwin"
                    ? "mac"
                    : "linux",
              characterId: input.characterId || "xiaozhi",
            } as const;
            // v0.5：提供 requestId 时走流式版本，事件经 SSE 推给前端 ThinkingBubble
            const supervisorResult = input.requestId
              ? await getSmartAgentApp().chatStreaming(input.message, {
                  ...baseChatOpts,
                  requestId: input.requestId,
                })
              : await getSmartAgentApp().chat(input.message, baseChatOpts);
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
        // ===== AIRI Bridge 集成：将回复转发到 AIRI =====
        if (airiBridge && airiBridge.getStatus().status === "ready") {
          try {
            await airiBridge.sendResponse(
              responseText,
              undefined,
              String(sessionId ?? userId)
            );
            console.log("[Chat] Response forwarded to AIRI Bridge");
          } catch (bridgeErr) {
            console.warn(`[Chat] AIRI Bridge forward failed: ${(bridgeErr as Error).message}`);
          }
        }

        return {
          response: responseText,
          memoriesUsed,
          personality,
          persisted,
        };
      }),

    /** 用户点击「生成语音」后单独合成，避免阻塞首包文字回复 */
    synthesizeAssistantTts: protectedProcedure
      .input(
        z.object({
          text: z.string().min(1),
          sessionId: z.number().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const sessionKey = String(input.sessionId ?? user.id);
        const { payload } = await synthesizeReplyTts(input.text, sessionKey);
        return { tts: payload };
      }),

    /**
     * Omni 模式专用：对话完成后合成摘要 TTS
     * - 自动从 LLM 回复文本中提取或生成摘要
     * - 仅合成前 150 字（避免播报过长）
     * - 返回 Base64 音频供前端播放
     */
    synthesizeOmniSummary: protectedProcedure
      .input(
        z.object({
          /** LLM 生成的完整回复文本 */
          fullResponse: z.string().min(1),
          sessionId: z.number().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const sessionKey = String(input.sessionId ?? user.id);

        // 提取摘要：取第一句完整句，或前 150 字
        const summaryText = extractSummary(input.fullResponse);

        console.log(`[Omni] synthesizeOmniSummary: full=${input.fullResponse.length}chars → summary="${summaryText}"`);

        // 调用 Emotions TTS 合成
        const { payload } = await synthesizeReplyTts(summaryText, sessionKey);

        return {
          summary: summaryText,
          tts: payload,
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

        // 审计层：重要性门控 + 去重校验
        const auditResult = await auditMemoryExtraction({
          userId: user.id,
          content: input.content,
          type: input.type,
          kind: input.kind,
          importance: input.importance ?? 0.5,
          confidence: input.confidence ?? 0.8,
          versionGroup: input.versionGroup,
          tags: input.tags,
        });

        if (auditResult.verdict === "REJECT") {
          console.warn("[Memory] create 审计拒绝: %s", auditResult.feedbackMessage);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: auditResult.feedbackMessage,
          });
        }

        if (auditResult.verdict === "MERGE" && auditResult.matchedMemory) {
          // 合并模式：更新已有记忆而非新建
          const { matchedMemory, similarityScore } = auditResult;
          await updateMemory(matchedMemory.id, {
            content: input.content,
            importance: input.importance ?? 0.5,
            confidence: input.confidence ?? 0.8,
            tags: input.tags,
          });
          console.log(
            "[Memory] create 合并写入: matchedId=%s similarity=%.2f",
            matchedMemory.id,
            similarityScore
          );
          return { ...matchedMemory, merged: true, similarityScore };
        }

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

    clearAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        const user = await ensureUser(ctx);
        const result = await deleteAllMemories(user.id);
        return { deleted: result.deleted };
      }),

    saveSuggestedScene: protectedProcedure
      .input(
        z.object({
          suggestedSceneName: z.string().min(1),
          patternDescription: z.string().min(1),
          patternType: z.string().min(1),
          frequency: z.number().optional(),
          suggestedSteps: z.array(z.string()).optional().default([]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const domain = /车|vehicle|灯|空调|座椅|ac|light|seat/i.test(
          `${input.patternType} ${input.patternDescription} ${input.suggestedSteps.join(" ")}`
        )
          ? "vehicle_control"
          : "general";
        const episode = await persistSceneEpisode({
          userId: user.id,
          domain,
          sceneName: input.suggestedSceneName,
          summary: `${input.patternDescription}。用户已确认保存为常用场景。`,
          triggerPhrases: [
            input.suggestedSceneName,
            `开启${input.suggestedSceneName}`,
            `执行${input.suggestedSceneName}`,
          ],
          actions: input.suggestedSteps.map((step, index) => ({
            tool: "scene_replay",
            command: step,
            args: { stepIndex: index + 1, sourcePatternType: input.patternType },
          })),
          safetyLevel: "confirm_before_execute",
          importance: 0.88,
          confidence: Math.min(0.95, 0.72 + (input.frequency ?? 3) * 0.04),
          tags: ["scene", "proactive_suggestion", `pattern:${input.patternType}`],
          versionGroup: `scene:${input.patternType}`,
        });
        return { success: Boolean(episode), episode };
      }),

    /**
     * 手动触发记忆后台任务（与定时 cron 对应，便于调试无需等待数小时）
     */
    runMaintenance: protectedProcedure
      .input(
        z
          .object({
            jobs: z
              .array(
                z.enum([
                  "consolidation",
                  "forgetting",
                  "prediction",
                  "prefetch_cache_cleanup",
                ])
              )
              .optional(),
            all: z.boolean().optional(),
          })
          .optional()
      )
      .mutation(async ({ ctx, input }) => {
        const user = await ensureUser(ctx);
        const raw = input ?? {};
        const jobs =
          raw.all === true || !raw.jobs?.length
            ? ("all" as const)
            : raw.jobs;
        try {
          return await runUserMemoryMaintenance(user.id, jobs);
        } catch (e) {
          console.error("[Memory] runMaintenance failed:", e);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: (e as Error).message || "后台任务执行失败",
          });
        }
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

  // ==================== SmartAgent4 新增：AIRI Bridge 路由 ====================

  airi: router({
    /** 查询 AIRI Bridge 连接状态 */
    status: publicProcedure.query(() => {
      if (!airiBridge) {
        return { status: "disconnected" as const, serverUrl: "", messageCount: 0, activeCharacterId: "xiaozhi" };
      }
      return airiBridge.getStatus();
    }),

    /** 手动连接 AIRI Server */
    connect: protectedProcedure
      .input(z.object({
        serverUrl: z.string().url().optional(),
        token: z.string().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        if (!airiBridge) {
          airiBridge = new AiriBridgeService(input ? {
            airiServerUrl: input.serverUrl,
            airiToken: input.token,
          } : undefined);
        }
        try {
          await airiBridge.connect();
          return { success: true, status: airiBridge.getStatus().status };
        } catch (err) {
          return { success: false, status: airiBridge.getStatus().status, error: (err as Error).message };
        }
      }),

    /** 断开 AIRI 连接 */
    disconnect: protectedProcedure.mutation(() => {
      if (airiBridge) {
        airiBridge.disconnect();
      }
      return { success: true };
    }),

    /** 获取 Bridge 配置 */
    getConfig: protectedProcedure.query(() => {
      if (!airiBridge) {
        return null;
      }
      return airiBridge.getConfig();
    }),

    /** 更新 Bridge 配置 */
    updateConfig: protectedProcedure
      .input(z.object({
        airiServerUrl: z.string().url().optional(),
        autoConnect: z.boolean().optional(),
        enableEmotionRendering: z.boolean().optional(),
        enableTTS: z.boolean().optional(),
        defaultCharacterId: z.string().optional(),
      }))
      .mutation(({ input }) => {
        if (!airiBridge) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AIRI Bridge 未初始化" });
        }
        const config = airiBridge.updateConfig(input);
        return { success: true, config };
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
