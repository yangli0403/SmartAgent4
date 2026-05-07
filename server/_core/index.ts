import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
// 导入新路由（已统一为基于 MySQL 的 tRPC 记忆系统）
import sequentialThinkingRouter from "../routers/sequentialThinkingRouter";
import chatRouterEnhanced from "../routers/chatRouterEnhanced";
// 网易云音乐 MCP 内嵌服务
import { startNeteaseMCPServer, NETEASE_MCP_PORT } from "../mcp/netease/index";
import { attachAsrWebSocket } from "../asr/asrStreamSocket";
import { createSupervisorSseRouter } from "../agent/supervisor/supervisorSseRouter";
import { createOmniTokenRouter } from "../routers/omniTokenRouter";
import { getVoiceMode, getTtsMode, setVoiceMode, setTtsMode } from "../voice/voiceMode";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * 启动网易云音乐 MCP 子服务
 * 自动设置 NETEASE_MUSIC_MCP_URL 环境变量，供 MCPManager 使用
 */
async function startNeteaseMCP() {
  try {
    await startNeteaseMCPServer();
    // 动态注入环境变量，确保 MCPManager 能读取到正确的 URL
    if (!process.env.NETEASE_MUSIC_MCP_URL) {
      process.env.NETEASE_MUSIC_MCP_URL = `http://localhost:${NETEASE_MCP_PORT}/sse`;
      console.log(`[NeteaseMCP] Auto-set NETEASE_MUSIC_MCP_URL=http://localhost:${NETEASE_MCP_PORT}/sse`);
    }
  } catch (err) {
    console.warn("[NeteaseMCP] Failed to start embedded server, skipping:", err);
  }
}

async function startServer() {
  // 先启动网易云音乐 MCP 子服务
  await startNeteaseMCP();

  const app = express();
  const server = createServer(app);
  attachAsrWebSocket(server);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/voice-mode", (_req, res) => {
    res.json({ mode: getVoiceMode(), ttsMode: getTtsMode() });
  });
  app.post("/api/voice-mode", (req, res) => {
    // 支持三种格式：
    // 1. { asrMode, ttsMode }  — 两个独立字段（新版）
    // 2. { ttsMode }           — 单独更新 TTS
    // 3. { mode }              — 旧版单一开关，同步更新 ASR+TTS
    const { mode, ttsMode, asrMode } = req.body ?? {};

    if (typeof asrMode === "string" && (asrMode === "cloud" || asrMode === "local")) {
      setVoiceMode(asrMode);
    }
    if (typeof ttsMode === "string" && (ttsMode === "cloud" || ttsMode === "local")) {
      setTtsMode(ttsMode);
    }
    if (typeof asrMode !== "string" && typeof ttsMode !== "string") {
      // 旧格式：单一 mode 同时影响 ASR 和 TTS
      if (mode !== "cloud" && mode !== "local") {
        return res
          .status(400)
          .json({ error: "Invalid mode. Expected 'cloud' or 'local'." });
      }
      setVoiceMode(mode);
      setTtsMode(mode);
    }
    return res.json({ mode: getVoiceMode(), ttsMode: getTtsMode() });
  });
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // 新API路由：序列思考、增强聊天（记忆相关功能已统一到 tRPC memory 路由）
  app.use("/api/sequential-thinking", sequentialThinkingRouter);
  app.use("/api/chat", chatRouterEnhanced);
  // v0.5: Supervisor 流式事件 SSE 端点（前端 ThinkingBubble 订阅）
  app.use(createSupervisorSseRouter());
  // v0.5 Batch2: Omni 端到端语音模式 Token 端点
  app.use(createOmniTokenRouter());
  // ==================== TTS 合成端点（供前端直接调用）====================
  // 优先 Emotions-System，fallback 本地 Piper
  app.post("/api/tts/synthesize", async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    try {
      const { getEmotionsClient } = await import("../emotions/emotionsClient");
      const { synthesizeReplyTts } = await import("../emotions/chatTtsHelper");
      const client = getEmotionsClient();
      const available = await client.isAvailable();
      console.log(`[TTS] isAvailable=${available}, EMOTIONS_SYSTEM_ENABLED=${process.env.EMOTIONS_SYSTEM_ENABLED}`);
      if (available) {
        const { payload } = await synthesizeReplyTts(text.trim(), "frontend-tts");
        console.log(`[TTS] synthesizeReplyTts status=${payload.status}, reason=${payload.reason}, segments=${payload.segments?.length}`);
        const seg = payload.segments?.[0];
        if (seg?.audioBase64) {
          console.log(`[TTS] Success: audioBase64 length=${seg.audioBase64.length}`);
          res.json({ audio_base64: seg.audioBase64, format: seg.audioFormat || "wav" });
          return;
        }
        // CosyVoice 合成失败时直接返回错误信息，不再 fallback 到本地 Piper
        res.status(503).json({ error: payload.reason || "TTS synthesis returned no audio" });
        return;
      }
      res.status(503).json({ error: "TTS service unavailable: DASHSCOPE_API_KEY not configured" });
    } catch (err) {
      console.error("[TTS] /api/tts/synthesize error:", err);
      res.status(500).json({ error: String(err) });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
