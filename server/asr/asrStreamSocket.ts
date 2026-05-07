/**
 * 浏览器 WebSocket → 百炼 DashScope 实时 ASR（流式）
 * 协议参考：https://help.aliyun.com/zh/model-studio/realtime-asr-websocket-api
 *
 * v0.5：
 * - 默认模型升级为 paraformer-realtime-v2（多方言版）
 * - 添加 language_hints 参数以允许粁语/吴语/闽南语等粘合输入
 * - 将模型选型与报文构造抽出到 ./asrConfig.ts
 *
 * Omni 全模态支持（v0.5 Batch2）：
 * - /api/omni/ws 路径代理到 DashScope Omni Realtime API
 * - 使用 qwen3.5-omni-plus-realtime 模型
 * - Authorization header 由后端添加，前端无需处理
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
import { getVoiceMode } from "../voice/voiceMode";

const DEFAULT_DASHSCOPE_WS =
  "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
const LOCAL_ASR_HEALTH_URL =
  process.env.LOCAL_ASR_HEALTH_URL || "http://127.0.0.1:8001/health";

// Omni 全模态常量
// DashScope Omni Realtime API WebSocket 端点
const DASHSCOPE_OMNI_WS =
  process.env.DASHSCOPE_OMNI_WS_URL ||
  "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
// Omni 模型：qwen3.5-omni-plus-realtime（旗舰全模态模型）
const OMNI_MODEL =
  process.env.DASHSCOPE_OMNI_MODEL || "qwen3.5-omni-plus-realtime";

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

async function transcribeLocalPcm(pcmData: Buffer): Promise<string> {
  const localAsrUrl =
    process.env.LOCAL_ASR_URL || "http://127.0.0.1:8001/api/local-asr";
  const response = await fetch(localAsrUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Audio-Format": "pcm_s16le",
      "X-Sample-Rate": "16000",
      "X-Channels": "1",
    },
    body: new Uint8Array(pcmData),
  });
  if (!response.ok) {
    throw new Error(`Local ASR HTTP ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { text?: string };
  return data.text ?? "";
}

async function bridgeClientToLocalAsr(clientWs: WebSocket): Promise<void> {
  const chunks: Buffer[] = [];
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({ type: "ready" }));
  }

  clientWs.on("message", async (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      chunks.push(buf);
      return;
    }

    try {
      const j = JSON.parse(data.toString()) as { type?: string };
      if (j.type !== "end") return;

      const pcm = Buffer.concat(chunks);
      const text = await transcribeLocalPcm(pcm);

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: "asr",
            text,
            sentenceEnd: true,
          })
        );
        clientWs.send(JSON.stringify({ type: "done" }));
      }
      clientWs.close();
    } catch (error) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: "error",
            message: (error as Error).message || "Local ASR failed",
          })
        );
      }
      clientWs.close();
    }
  });
}

async function isLocalAsrHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(LOCAL_ASR_HEALTH_URL, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
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
        socket.destroy();
        return;
      }

      // Omni 全模态 WebSocket 代理
      if (pathname === "/api/omni/ws") {
        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          socket.destroy();
          return;
        }

        // 用 wss.handleUpgrade 处理客户端 WebSocket 握手
        wss.handleUpgrade(request, socket, head, (clientWs) => {
          const clientIp = request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown";
          console.log(`[OmniProxy] Client connected: ${clientIp}, proxying to ${DASHSCOPE_OMNI_WS} (model=${OMNI_MODEL})`);

          // 创建后端 → DashScope 的上游连接
          const upstream = new WebSocket(
            `${DASHSCOPE_OMNI_WS}?model=${encodeURIComponent(OMNI_MODEL)}`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            }
          );

          upstream.on("open", () => {
            console.log("[OmniProxy] DashScope Omni upstream connected");
          });

          upstream.on("close", (code, reason) => {
            console.log(`[OmniProxy] DashScope Omni connection closed: code=${code} reason=${reason}`);
            try { clientWs.close(); } catch {}
          });

          upstream.on("error", (err) => {
            console.error(`[OmniProxy] DashScope Omni error: ${err.message}`);
            if (clientWs.readyState === clientWs.OPEN) {
              try {
                clientWs.send(JSON.stringify({ type: "error", message: `Omni上游连接失败: ${err.message}` }));
              } catch {}
            }
            try { clientWs.close(); } catch {}
          });

          // DashScope → 客户端
          upstream.on("message", (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              try {
                clientWs.send(data);
              } catch {}
            }
          });

          // 客户端 → DashScope
          clientWs.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              try {
                upstream.send(data);
              } catch {}
            }
          });

          clientWs.on("close", () => {
            try { upstream.close(); } catch {}
          });

          clientWs.on("error", () => {
            try { upstream.close(); } catch {}
          });

          console.log("[OmniProxy] Client connected, proxying to DashScope Omni");
        });
        return;
      }

      // ASR WebSocket 处理
      if (pathname !== "/api/asr/stream") {
        return;
      }

      wss.handleUpgrade(request, socket, head, ws => {
        if (getVoiceMode() === "local") {
          void (async () => {
            const localReady = await isLocalAsrHealthy();
            if (localReady) {
              await bridgeClientToLocalAsr(ws);
              return;
            }
            const apiKey = process.env.DASHSCOPE_API_KEY;
            if (apiKey) {
              console.warn(
                "[ASR] Local mode selected but local ASR unavailable, fallback to cloud"
              );
              await bridgeClientToDashScope(ws, apiKey);
              return;
            }
            ws.send(
              JSON.stringify({
                type: "error",
                message:
                  "Local ASR unavailable and cloud fallback missing DASHSCOPE_API_KEY",
              })
            );
            ws.close();
          })();
          return;
        }
        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "DASHSCOPE_API_KEY is required in cloud mode",
            })
          );
          ws.close();
          return;
        }
        void bridgeClientToDashScope(ws, apiKey);
      });
    }
  );
}
