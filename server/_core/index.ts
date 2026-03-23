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
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // 新API路由：序列思考、增强聊天（记忆相关功能已统一到 tRPC memory 路由）
  app.use("/api/sequential-thinking", sequentialThinkingRouter);
  app.use("/api/chat", chatRouterEnhanced);
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
