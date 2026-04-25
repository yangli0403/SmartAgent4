/**
 * 浏览器 WebSocket → 百炼 DashScope 实时 ASR（流式）
 * 协议参考：https://help.aliyun.com/zh/model-studio/realtime-asr-websocket-api
 *
 * v0.5：
 * - 默认模型升级为 paraformer-realtime-v2（多方言版）
 * - 添加 language_hints 参数以允许粁语/吴语/闽南语等粘合输入
 * - 将模型选型与报文构造抽出到 ./asrConfig.ts
 */
import type { IncomingMessage } from "http";
import type { Server } from "http";
import crypto from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import {
  resolveAsrModel,
  resolveLanguageHints,
  buildAsrRunTaskPayload,
  buildAsrFinishTaskPayload,
} from "./asrConfig";

const DEFAULT_DASHSCOPE_WS =
  "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";

function getTaskId(): string {
  return crypto.randomBytes(16).toString("hex");
}

async function bridgeClientToDashScope(
  clientWs: WebSocket,
  apiKey: string
): Promise<void> {
  const dashscopeUrl =
    process.env.DASHSCOPE_ASR_WS_URL || DEFAULT_DASHSCOPE_WS;
  const model = resolveAsrModel();
  const languageHints = resolveLanguageHints();
  const taskId = getTaskId();

  const upstream = new WebSocket(dashscopeUrl, {
    headers: {
      Authorization: `bearer ${apiKey}`,
    },
  });

  let taskStarted = false;
  const pendingAudio: Buffer[] = [];

  const flushPending = () => {
    if (!taskStarted) return;
    while (pendingAudio.length > 0) {
      const b = pendingAudio.shift();
      if (b && upstream.readyState === WebSocket.OPEN) {
        upstream.send(b);
      }
    }
  };

  upstream.on("open", () => {
    upstream.send(
      JSON.stringify(buildAsrRunTaskPayload(taskId, model, languageHints))
    );
  });

  upstream.on("message", (data, isBinary) => {
    if (isBinary) return;
    const text =
      typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
    if (!text.startsWith("{")) return;
    try {
      const msg = JSON.parse(text) as {
        header?: { event?: string; error_message?: string };
        payload?: {
          output?: {
            sentence?: { text?: string; sentence_end?: boolean };
          };
        };
      };
      const event = msg.header?.event;
      if (event === "task-started") {
        taskStarted = true;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "ready" }));
        }
        flushPending();
        return;
      }
      if (event === "result-generated") {
        const sentence = msg.payload?.output?.sentence;
        const t = sentence?.text ?? "";
        const sentenceEnd = sentence?.sentence_end === true;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "asr",
              text: t,
              sentenceEnd,
            })
          );
        }
        return;
      }
      if (event === "task-finished") {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "done" }));
        }
        clientWs.close();
        return;
      }
      if (event === "task-failed") {
        const err = msg.header?.error_message || "ASR task failed";
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "error", message: err }));
        }
        clientWs.close();
      }
    } catch {
      // ignore malformed
    }
  });

  upstream.on("error", err => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: (err as Error).message || "Upstream WebSocket error",
        })
      );
    }
    clientWs.close();
  });

  upstream.on("close", () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  clientWs.on("message", (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      if (!taskStarted) {
        pendingAudio.push(buf);
        return;
      }
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(buf);
      }
      return;
    }
    const s = data.toString();
    try {
      const j = JSON.parse(s) as { type?: string };
      if (j.type === "end") {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify(buildAsrFinishTaskPayload(taskId)));
        }
      }
    } catch {
      // ignore
    }
  });

  clientWs.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN) {
      try {
        upstream.send(JSON.stringify(buildAsrFinishTaskPayload(taskId)));
      } catch {
        /* noop */
      }
      upstream.close();
    }
  });

  clientWs.on("error", () => {
    upstream.close();
  });
}

const wss = new WebSocketServer({ noServer: true });

export function attachAsrWebSocket(server: Server): void {
  server.on(
    "upgrade",
    (request: IncomingMessage, socket, head) => {
      const host = request.headers.host || "localhost";
      let pathname = "";
      try {
        pathname = new URL(
          request.url || "",
          `http://${host}`
        ).pathname;
      } catch {
        return;
      }
      if (pathname !== "/api/asr/stream") {
        return;
      }

      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, ws => {
        void bridgeClientToDashScope(ws, apiKey);
      });
    }
  );
}
