/**
 * US-5：Supervisor SSE 端点单测
 *
 * 关联用户测试用例：U-SSE-1 / U-SSE-2 / U-SSE-3 / U-SSE-4
 *
 * 不依赖真实图执行，直接通过 publishSupervisorEvent 推事件给订阅 SSE 的客户端。
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { createSupervisorSseRouter } from "../supervisorSseRouter";
import {
  publishSupervisorEvent,
  supervisorEventBus,
} from "../supervisorEventBus";

interface SseChunk {
  event?: string;
  data?: string;
}

/** 建立一个临时 HTTP server 并发起 GET 请求（不结束连接，用于读取事件） */
function startServerWithRouter(): Promise<{
  url: string;
  close: () => void;
}> {
  return new Promise((resolve) => {
    const app = express();
    app.use(createSupervisorSseRouter());
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

/** 打开一个 SSE 连接，按 envelope 解析为 chunk，max 条达到后 resolve */
function collectSse(
  url: string,
  requestId: string,
  maxChunks: number,
  timeoutMs: number = 1500
): Promise<SseChunk[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${url}/api/supervisor/stream?requestId=${requestId}`,
      { headers: { Accept: "text/event-stream" } },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Unexpected status ${res.statusCode}`));
          return;
        }
        const chunks: SseChunk[] = [];
        let buffer = "";
        const timer = setTimeout(() => {
          req.destroy();
          resolve(chunks);
        }, timeoutMs);

        res.on("data", (data: Buffer) => {
          buffer += data.toString("utf-8");
          // SSE 块以 "\n\n" 分隔
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const chunk: SseChunk = {};
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) chunk.event = line.slice(6).trim();
              else if (line.startsWith("data:")) chunk.data = line.slice(5).trim();
            }
            chunks.push(chunk);
            if (chunks.length >= maxChunks) {
              clearTimeout(timer);
              req.destroy();
              resolve(chunks);
              return;
            }
          }
        });
        res.on("error", () => {
          clearTimeout(timer);
          resolve(chunks);
        });
      }
    );
    req.on("error", reject);
  });
}

describe("US-5 supervisorSseRouter", () => {
  beforeEach(() => {
    supervisorEventBus.removeAllListeners();
  });

  it("U-SSE-1：缺少 requestId 应返回 400", async () => {
    const srv = await startServerWithRouter();
    try {
      await new Promise<void>((resolve, reject) => {
        http.get(
          `${srv.url}/api/supervisor/stream`,
          (res) => {
            try {
              expect(res.statusCode).toBe(400);
              resolve();
            } catch (e) {
              reject(e);
            }
          }
        );
      });
    } finally {
      srv.close();
    }
  });

  it("U-SSE-2：连接成功后会先收到一条 'connected' 事件", async () => {
    const srv = await startServerWithRouter();
    try {
      const collectPromise = collectSse(srv.url, "rt-1", 1, 800);
      // 不需要发送实际事件，初始化事件应自动发送
      const chunks = await collectPromise;
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].event).toBe("connected");
    } finally {
      srv.close();
    }
  });

  it("U-SSE-3：发布事件后客户端能按顺序接收", async () => {
    const srv = await startServerWithRouter();
    try {
      const collectPromise = collectSse(srv.url, "rt-2", 3, 1000);
      // 给 SSE 一点点时间订阅
      setTimeout(() => {
        publishSupervisorEvent({
          requestId: "rt-2",
          type: "classified",
          phase: "classified",
          summary: "分类完成",
        });
        publishSupervisorEvent({
          requestId: "rt-2",
          type: "final",
          phase: "completed",
          summary: "最终回复",
          payload: { response: "你好" },
        });
      }, 100);

      const chunks = await collectPromise;
      // 第一条是 connected，后续应包含 classified / final
      const events = chunks.map((c) => c.event);
      expect(events).toContain("classified");
      expect(events).toContain("final");
      const finalChunk = chunks.find((c) => c.event === "final");
      expect(finalChunk?.data).toContain("你好");
    } finally {
      srv.close();
    }
  });

  it("U-SSE-4：不同 requestId 互相隔离", async () => {
    const srv = await startServerWithRouter();
    try {
      // 只订阅 rt-A
      const collectPromise = collectSse(srv.url, "rt-A", 2, 800);
      setTimeout(() => {
        publishSupervisorEvent({
          requestId: "rt-B",
          type: "classified",
          phase: "classified",
          summary: "B 通道",
        });
        publishSupervisorEvent({
          requestId: "rt-A",
          type: "classified",
          phase: "classified",
          summary: "A 通道",
        });
      }, 100);

      const chunks = await collectPromise;
      const events = chunks
        .filter((c) => c.event && c.event !== "connected")
        .map((c) => JSON.parse(c.data ?? "{}"));
      expect(events.every((e) => e.requestId === "rt-A")).toBe(true);
    } finally {
      srv.close();
    }
  });
});
