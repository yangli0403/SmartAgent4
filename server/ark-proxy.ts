/**
 * 轻量级 Ark LLM 代理服务器
 * 
 * 直接调用火山引擎 Ark API（DeepSeek 模型），
 * 为前端 Cockpit 提供 /api/chat 接口，
 * 无需数据库、OAuth 等重依赖。
 */

import http from "http";

const ARK_API_KEY = process.env.ARK_API_KEY || "7c4d52bf-e540-4337-a9ab-1a5228acedaa";
const ARK_BASE_URL = process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_MODEL = process.env.ARK_MODEL || "ep-20250811200411-zctsd"; // DeepSeek

const PORT = parseInt(process.env.ARK_PROXY_PORT || "3001", 10);

// 车载助手系统提示词
const SYSTEM_PROMPT = `你是"小智"，一个车载智能语音助手。你的特点：
- 回复简洁、自然、口语化，适合车载场景
- 关注驾驶安全，必要时提醒用户注意路况
- 具备情感感知能力，能根据用户语气调整回复风格
- 支持车辆控制、导航、音乐、天气等常见车载功能
- 回复中可以包含情感标签，格式为 [expression:表情名] [animation:动作名]
  可用表情：happy, sad, angry, surprised, thinking, neutral, smile, wink
  可用动作：nod, shake, wave, bow, think, idle

请根据对话内容自然地加入表情和动作标签。`;

interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// 简单的会话历史管理（内存中）
const sessions = new Map<string, ConversationMessage[]>();

async function callArk(messages: ConversationMessage[]): Promise<string> {
  const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: ARK_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ark API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || "";
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS 头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 健康检查
  if (req.url === "/api/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: ARK_MODEL }));
    return;
  }

  // 聊天接口
  if (req.url === "/api/chat" && req.method === "POST") {
    try {
      const rawBody = await parseBody(req);
      const { message, sessionId = "default" } = JSON.parse(rawBody);

      if (!message || typeof message !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "message is required" }));
        return;
      }

      // 获取或创建会话历史
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, []);
      }
      const history = sessions.get(sessionId)!;

      // 构建消息列表
      const messages: ConversationMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-10), // 保留最近 10 条历史
        { role: "user", content: message },
      ];

      console.log(`[Ark Proxy] User (${sessionId}): ${message}`);

      // 调用 Ark API
      const reply = await callArk(messages);

      console.log(`[Ark Proxy] Assistant: ${reply.substring(0, 100)}...`);

      // 保存到会话历史
      history.push({ role: "user", content: message });
      history.push({ role: "assistant", content: reply });

      // 限制历史长度
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        response: reply,
        personality: "professional",
        memoriesUsed: [],
        persisted: false,
      }));
    } catch (err: any) {
      console.error("[Ark Proxy] Error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 重置会话
  if (req.url === "/api/reset" && req.method === "POST") {
    try {
      const rawBody = await parseBody(req);
      const { sessionId = "default" } = JSON.parse(rawBody);
      sessions.delete(sessionId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch {
      sessions.clear();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Ark Proxy] LLM Proxy running on http://0.0.0.0:${PORT}`);
  console.log(`[Ark Proxy] Model: ${ARK_MODEL}`);
  console.log(`[Ark Proxy] Endpoints:`);
  console.log(`  POST /api/chat   - Send message`);
  console.log(`  POST /api/reset  - Reset session`);
  console.log(`  GET  /api/health - Health check`);
});
