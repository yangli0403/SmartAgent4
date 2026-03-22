/**
 * Supervisor Router — Supervisor Agent 路由
 *
 * 提供基于 Supervisor 多 Agent 架构的聊天接口，
 * 替代原有的 chatRouterEnhanced 中的 send-enhanced 接口。
 * 同时保留原有接口的向后兼容。
 */

import { Router, Request, Response } from "express";
import { getSmartAgentApp } from "../agent/smartAgentApp";

const router = Router();

// 会话历史缓存
const sessionHistory: Map<
  string,
  Array<{ role: string; content: string }>
> = new Map();

/**
 * 发送消息（Supervisor 版）
 * POST /api/supervisor/chat
 *
 * 通过 Supervisor 多 Agent 架构处理用户消息。
 */
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      session_id = "default",
      message,
      platform,
    } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({
        success: false,
        message: "user_id and message are required",
      });
    }

    // 获取会话历史
    const historyKey = `${user_id}:${session_id}`;
    const conversationHistory = sessionHistory.get(historyKey) || [];

    // 调用 SmartAgent App
    const app = getSmartAgentApp();
    const result = await app.chat(message, {
      userId: user_id,
      sessionId: session_id,
      conversationHistory,
      platform,
    });

    // 更新会话历史
    conversationHistory.push({ role: "user", content: message });
    conversationHistory.push({
      role: "assistant",
      content: result.response,
    });

    // 限制历史长度
    if (conversationHistory.length > 30) {
      conversationHistory.splice(0, conversationHistory.length - 30);
    }

    sessionHistory.set(historyKey, conversationHistory);

    // 返回响应
    res.json({
      success: true,
      response: result.response,
      metadata: {
        classification: result.classification,
        stepsExecuted: result.stepsExecuted,
        totalToolCalls: result.totalToolCalls,
        totalDurationMs: result.totalDurationMs,
      },
    });
  } catch (error) {
    console.error("[SupervisorRouter] Chat error:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

/**
 * 流式聊天（SSE）
 * POST /api/supervisor/stream
 *
 * 通过 Supervisor 多 Agent 架构处理用户消息，以 SSE 流式返回。
 */
router.post("/stream", async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      session_id = "default",
      message,
      platform,
    } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({
        success: false,
        message: "user_id and message are required",
      });
    }

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // 获取会话历史
    const historyKey = `${user_id}:${session_id}`;
    const conversationHistory = sessionHistory.get(historyKey) || [];

    // 发送开始信号
    res.write(
      `data: ${JSON.stringify({ type: "start", message: "Processing..." })}\n\n`
    );

    // 调用 SmartAgent App
    const app = getSmartAgentApp();
    const result = await app.chat(message, {
      userId: user_id,
      sessionId: session_id,
      conversationHistory,
      platform,
    });

    // 发送分类信息
    res.write(
      `data: ${JSON.stringify({
        type: "classification",
        classification: result.classification,
      })}\n\n`
    );

    // 流式输出响应内容
    const chars = result.response.split("");
    for (let i = 0; i < chars.length; i++) {
      res.write(
        `data: ${JSON.stringify({
          type: "content",
          content: chars[i],
          done: false,
        })}\n\n`
      );
      // 模拟打字效果
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    // 发送完成信号
    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        done: true,
        metadata: {
          stepsExecuted: result.stepsExecuted,
          totalToolCalls: result.totalToolCalls,
          totalDurationMs: result.totalDurationMs,
        },
      })}\n\n`
    );

    // 更新会话历史
    conversationHistory.push({ role: "user", content: message });
    conversationHistory.push({
      role: "assistant",
      content: result.response,
    });

    if (conversationHistory.length > 30) {
      conversationHistory.splice(0, conversationHistory.length - 30);
    }

    sessionHistory.set(historyKey, conversationHistory);

    res.end();
  } catch (error) {
    console.error("[SupervisorRouter] Stream error:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error instanceof Error ? error.message : "Internal server error",
        done: true,
      })}\n\n`
    );
    res.end();
  }
});

/**
 * 获取系统状态
 * GET /api/supervisor/status
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const app = getSmartAgentApp();

    res.json({
      success: true,
      mcpServers: app.getMCPStatus(),
      tools: app.getRegisteredTools(),
      agents: app.getAgentInfo(),
    });
  } catch (error) {
    console.error("[SupervisorRouter] Status error:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

/**
 * 更新用户位置
 * POST /api/supervisor/location
 */
router.post("/location", async (req: Request, res: Response) => {
  try {
    const { user_id, latitude, longitude, city } = req.body;

    if (!user_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "user_id, latitude, and longitude are required",
      });
    }

    const app = getSmartAgentApp();
    await app.updateUserLocation(
      user_id,
      { latitude, longitude, city },
      "manual"
    );

    res.json({
      success: true,
      message: "Location updated",
    });
  } catch (error) {
    console.error("[SupervisorRouter] Location error:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

/**
 * 获取会话历史
 * GET /api/supervisor/history
 */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const { user_id, session_id = "default" } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    const historyKey = `${user_id}:${session_id}`;
    const history = sessionHistory.get(historyKey) || [];

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("[SupervisorRouter] History error:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

/**
 * 清除会话历史
 * DELETE /api/supervisor/history
 */
router.delete("/history", async (req: Request, res: Response) => {
  try {
    const { user_id, session_id = "default" } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    const historyKey = `${user_id}:${session_id}`;
    sessionHistory.delete(historyKey);

    res.json({
      success: true,
      message: "History cleared",
    });
  } catch (error) {
    console.error("[SupervisorRouter] Clear history error:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
