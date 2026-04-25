/**
 * OmniRealtimeClient 单元测试
 *
 * 测试 Token 获取、WebSocket 连接管理、音频发送和回调机制。
 * 关联用户测试用例：UTC-B6-1 ~ UTC-B6-4, UTC-B7-1 ~ UTC-B7-6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OmniRealtimeClient,
  type OmniRealtimeCallbacks,
  type OmniConnectionState,
} from "../omniRealtimeClient";

// ==================== Mock WebSocket ====================
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: string[] = [];
  readyState = 1;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // 模拟异步连接成功
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  // 模拟接收消息
  simulateMessage(data: unknown) {
    this.onmessage?.({ data });
  }

  // 模拟错误
  simulateError(message: string) {
    this.onerror?.({ message });
  }
}

// ==================== 测试 ====================
describe("OmniRealtimeClient", () => {
  let callbacks: OmniRealtimeCallbacks;
  let stateChanges: OmniConnectionState[];
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    MockWebSocket.instances = [];
    stateChanges = [];

    callbacks = {
      onTranscript: vi.fn(),
      onReplyText: vi.fn(),
      onAudioOutput: vi.fn(),
      onStateChange: vi.fn((state: OmniConnectionState) => {
        stateChanges.push(state);
      }),
      onError: vi.fn(),
    };

    // Mock WebSocket
    originalWebSocket = globalThis.WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;

    // Mock fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });

  // ==================== 构造函数 ====================
  describe("constructor", () => {
    it("初始状态应为 disconnected", () => {
      const client = new OmniRealtimeClient(callbacks);
      expect(client.getState()).toBe("disconnected");
    });

    it("应接受自定义配置", () => {
      const client = new OmniRealtimeClient(callbacks, {
        tokenEndpoint: "/custom/token",
        model: "qwen-omni-max",
      });
      expect(client.getState()).toBe("disconnected");
    });
  });

  // ==================== fetchToken ====================
  describe("fetchToken", () => {
    // UTC-B7-1: Token 获取成功
    it("应从后端获取 Token", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const token = await client.fetchToken();

      expect(token).toBe("sk-test-token");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/omni/token");
    });

    // UTC-B7-2: Token 获取失败
    it("Token 获取失败时应触发 onError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: false,
            error: "DASHSCOPE_API_KEY 未配置",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);

      await expect(client.fetchToken()).rejects.toThrow("DASHSCOPE_API_KEY 未配置");
      expect(callbacks.onError).toHaveBeenCalled();
    });

    it("网络错误时应触发 onError", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const client = new OmniRealtimeClient(callbacks);

      await expect(client.fetchToken()).rejects.toThrow("Network error");
      expect(callbacks.onError).toHaveBeenCalled();
    });
  });

  // ==================== connect ====================
  describe("connect", () => {
    // UTC-B7-3: 连接成功后状态变为 connected
    it("连接成功后状态应变为 connected", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);

      // connect 是异步的，需要等待 WebSocket onopen
      const connectPromise = client.connect();

      // 等待微任务完成（MockWebSocket 的 setTimeout）
      await new Promise((r) => setTimeout(r, 10));
      await connectPromise;

      expect(client.getState()).toBe("connected");
      expect(stateChanges).toContain("connecting");
      expect(stateChanges).toContain("connected");
    });

    it("重复连接应被忽略", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const p1 = client.connect();
      await new Promise((r) => setTimeout(r, 10));
      await p1;

      // 再次连接应被忽略
      await client.connect();
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  // ==================== disconnect ====================
  describe("disconnect", () => {
    // UTC-B7-4: 断开连接后状态变为 disconnected
    it("断开连接后状态应变为 disconnected", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const p = client.connect();
      await new Promise((r) => setTimeout(r, 10));
      await p;

      client.disconnect();
      expect(client.getState()).toBe("disconnected");
    });
  });

  // ==================== sendAudio ====================
  describe("sendAudio", () => {
    // UTC-B7-5: 发送音频数据
    it("连接状态下应能发送音频数据", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const p = client.connect();
      await new Promise((r) => setTimeout(r, 10));
      await p;

      const audioData = new ArrayBuffer(320); // 10ms of 16kHz 16bit mono
      client.sendAudio(audioData);

      const ws = MockWebSocket.instances[0];
      // 第一条是 init 消息，第二条是音频消息
      expect(ws.sentMessages.length).toBe(2);

      const audioMsg = JSON.parse(ws.sentMessages[1]);
      expect(audioMsg.header.action).toBe("continue");
      expect(audioMsg.payload.input.audio.sample_rate).toBe(16000);
    });

    it("未连接时发送音频应被忽略", () => {
      const client = new OmniRealtimeClient(callbacks);
      const audioData = new ArrayBuffer(320);
      // 不应抛出错误
      client.sendAudio(audioData);
    });
  });

  // ==================== 消息处理 ====================
  describe("message handling", () => {
    // UTC-B7-6: 接收转写和回复
    it("应正确处理用户转写消息", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const p = client.connect();
      await new Promise((r) => setTimeout(r, 10));
      await p;

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage(
        JSON.stringify({
          payload: {
            output: {
              text: "你好",
              role: "user",
              finish_reason: "stop",
            },
          },
        })
      );

      expect(callbacks.onTranscript).toHaveBeenCalledWith("你好", true);
    });

    it("应正确处理 AI 回复文本", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const p = client.connect();
      await new Promise((r) => setTimeout(r, 10));
      await p;

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage(
        JSON.stringify({
          payload: {
            output: {
              text: "你好，有什么可以帮你的？",
              role: "assistant",
              finish_reason: null,
            },
          },
        })
      );

      expect(callbacks.onReplyText).toHaveBeenCalledWith(
        "你好，有什么可以帮你的？",
        false
      );
    });

    it("应正确处理二进制音频输出", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            token: "sk-test-token",
            expireAt: "2026-04-26T00:00:00Z",
          }),
      });

      const client = new OmniRealtimeClient(callbacks);
      const p = client.connect();
      await new Promise((r) => setTimeout(r, 10));
      await p;

      const ws = MockWebSocket.instances[0];
      const audioBuffer = new ArrayBuffer(640);
      ws.simulateMessage(audioBuffer);

      expect(callbacks.onAudioOutput).toHaveBeenCalledWith(audioBuffer);
    });
  });
});
