/**
 * Supervisor Chat Router — tRPC 集成
 *
 * 将 Supervisor 多 Agent 架构集成到现有 tRPC 路由体系中，
 * 提供与原有 chat.sendMessage 兼容的接口。
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getSmartAgentApp } from "../agent/smartAgentApp";
import {
  getUserPreferences,
  saveConversation,
  getRecentConversations,
} from "../db";
import {
  getDisplayNameFromPersona,
} from "../memory/memorySystem";
import type { User } from "../../drizzle/schema";
import * as db from "../db";

// 测试模式辅助函数
const SKIP_AUTH =
  process.env.SKIP_AUTH === "true" ||
  process.env.VITE_SKIP_OAUTH === "true";

async function ensureUser(ctx: { user: User | null }): Promise<User> {
  if (ctx.user) {
    return ctx.user;
  }

  if (SKIP_AUTH) {
    let testUser = await db.getUserByOpenId("test_user_skip_auth");
    if (!testUser) {
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

/**
 * Supervisor Chat tRPC Router
 *
 * 提供 supervisorChat.sendMessage 接口，
 * 使用 Supervisor 多 Agent 架构处理消息。
 */
export const supervisorChatRouter = router({
  /**
   * 发送消息（Supervisor 版）
   *
   * 与原有 chat.sendMessage 接口兼容，
   * 但使用 Supervisor 多 Agent 架构处理。
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1),
        sessionId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ensureUser(ctx);
      const userId = user.id;
      const sessionId = input.sessionId ?? null;

      // 获取用户偏好
      const prefs = await getUserPreferences(userId);
      const personality = prefs?.personality || "professional";
      const responseStyle = prefs?.responseStyle || "balanced";

      // 获取对话历史
      const recentConvs = await getRecentConversations(
        userId,
        10,
        sessionId
      );
      const conversationHistory = recentConvs.map((c) => ({
        role: c.role as string,
        content: c.content,
      }));

      // 获取用户显示名称
      const displayName =
        (await getDisplayNameFromPersona(userId).catch(
          () => undefined
        )) ||
        ctx.user?.name ||
        undefined;

      // 调用 SmartAgent App
      const app = getSmartAgentApp();
      const result = await app.chat(input.message, {
        userId: String(userId),
        sessionId: sessionId ? String(sessionId) : "default",
        conversationHistory,
        platform: undefined,
      });

      // 保存对话到数据库
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
        content: result.response,
        metadata: {
          personality,
          memoriesUsed: [
            `domain:${result.classification.domain}`,
            `steps:${result.stepsExecuted}`,
            `tools:${result.totalToolCalls}`,
            `duration:${result.totalDurationMs}ms`,
          ],
        },
      });

      const persisted = savedUser !== null && savedAssistant !== null;
      if (!persisted) {
        console.warn(
          "[SupervisorChat] 对话未写入数据库（请检查 MySQL 是否已启动且 DATABASE_URL 已配置）"
        );
      }

      return {
        response: result.response || "抱歉，我无法生成回复。",
        classification: result.classification,
        stepsExecuted: result.stepsExecuted,
        totalToolCalls: result.totalToolCalls,
        totalDurationMs: result.totalDurationMs,
        personality,
        persisted,
      };
    }),

  /**
   * 获取系统状态
   */
  getStatus: protectedProcedure.query(async () => {
    const app = getSmartAgentApp();
    return {
      mcpServers: app.getMCPStatus(),
      tools: app.getRegisteredTools(),
      agents: app.getAgentInfo(),
    };
  }),
});
