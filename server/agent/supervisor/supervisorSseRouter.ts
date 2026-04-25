/**
 * Supervisor SSE 路由（v0.5 引入）
 *
 * GET /api/supervisor/stream?requestId=xxx
 * - 推送指定 requestId 通道的事件给前端 EventSource
 * - 心跳：每 SUPERVISOR_STREAM_HEARTBEAT_MS 毫秒发送一次注释行，避免代理超时
 * - 客户端断开时自动取消订阅
 *
 * 与 tRPC 的关系：
 * - 完全独立：不通过 tRPC subscription，避免引入 wsLink 依赖
 * - 前端用原生 EventSource，配合 tRPC mutation 触发实际任务执行
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { supervisorEventBus } from "./supervisorEventBus";
import type { SupervisorEventEnvelope } from "@shared/supervisorEvents";

const DEFAULT_HEARTBEAT_MS = 15000;

function resolveHeartbeatMs(): number {
  const raw = process.env.SUPERVISOR_STREAM_HEARTBEAT_MS;
  if (!raw) return DEFAULT_HEARTBEAT_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 1000 ? n : DEFAULT_HEARTBEAT_MS;
}

export function createSupervisorSseRouter(): Router {
  const router = Router();

  router.get("/api/supervisor/stream", (req: Request, res: Response) => {
    const requestId = (req.query.requestId as string | undefined)?.trim();
    if (!requestId) {
      res.status(400).json({ error: "requestId is required" });
      return;
    }

    // SSE 必备 headers
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx 友好
    // 立即 flush headers，让客户端知道已连上
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    // 第一条事件：connected（让客户端可以更早展示"连接已建立"）
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ requestId, ts: Date.now() })}\n\n`);

    // 订阅事件
    const unsubscribe = supervisorEventBus.subscribe(
      requestId,
      (env: SupervisorEventEnvelope) => {
        try {
          res.write(`event: ${env.type}\n`);
          res.write(`data: ${JSON.stringify(env)}\n\n`);
        } catch {
          // 写入失败说明已断开，交给 close 清理
        }
      }
    );

    // 心跳，避免反向代理在静默期主动关闭连接
    const heartbeatMs = resolveHeartbeatMs();
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, heartbeatMs);

    // 客户端断开 → 清理订阅与心跳
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  return router;
}
