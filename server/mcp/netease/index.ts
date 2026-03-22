/**
 * 网易云音乐 MCP 内嵌服务
 *
 * 作为 SmartAgent3 的子服务运行，提供网易云音乐 MCP SSE 端点。
 * 随主服务自动启动，无需独立部署。
 *
 * SSE 端点: http://localhost:<NETEASE_MCP_PORT>/sse
 * 默认端口: 3001（可通过 NETEASE_MCP_PORT 环境变量覆盖）
 */
import express from "express";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { setGlobalCookie, setSessionCookie, initAnonymousCookie } from "./api.js";

const app = express();
const PORT = parseInt(process.env.NETEASE_MCP_PORT || "3001", 10);

app.use(cors());

// 初始化 Cookie：优先使用环境变量，否则匿名初始化
const envCookie = process.env.NETEASE_COOKIE;
if (envCookie) {
  setGlobalCookie(envCookie);
  console.log("[NeteaseMCP] Loaded NETEASE_COOKIE from environment");
} else {
  initAnonymousCookie().then(() => {
    console.log("[NeteaseMCP] Anonymous cookie initialization complete");
  });
}

// 存储 SSE 传输实例
const transports = new Map<string, SSEServerTransport>();

// SSE 端点
app.get("/sse", async (req, res) => {
  console.log("[NeteaseMCP] New SSE connection");
  const transport = new SSEServerTransport("/netease-mcp/messages", res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  // 支持 Bearer Token 认证（传入用户 Cookie）
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const cookie = authHeader.substring(7);
    if (cookie) {
      setSessionCookie(sessionId, cookie);
      console.log(`[NeteaseMCP] Set session cookie for session ${sessionId}`);
    }
  }

  const server = createServer(sessionId);

  transport.onclose = () => {
    console.log(`[NeteaseMCP] Session ${sessionId} closed`);
    transports.delete(sessionId);
  };

  await server.connect(transport);
});

// 消息处理端点
app.post("/netease-mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    res.status(400).send("Missing sessionId");
    return;
  }
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).send("Session not found");
    return;
  }
  await transport.handlePostMessage(req, res);
});

// 健康检查
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "netease-mcp" });
});

/**
 * 启动网易云音乐 MCP 服务
 * 返回 Promise，resolve 时服务已就绪
 */
export function startNeteaseMCPServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`[NeteaseMCP] Server running on port ${PORT}`);
      console.log(`[NeteaseMCP] SSE Endpoint: http://localhost:${PORT}/sse`);
      resolve();
    });
    server.on("error", (err) => {
      console.error("[NeteaseMCP] Failed to start server:", err);
      reject(err);
    });
  });
}

export { PORT as NETEASE_MCP_PORT };
