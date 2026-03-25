/**
 * ContextManager 单元测试
 *
 * 测试用户上下文管理器的位置缓存、IP 定位和偏好加载。
 *
 * 修复说明（2026-03-25）：
 * - 原测试未 mock global.fetch，导致 getLocationByIP() 中的 ip-api.com
 *   降级逻辑在有网络环境中真正发起 HTTP 请求，返回真实位置而非 undefined。
 * - 修复方案：在 beforeEach 中 mock global.fetch 使其默认拒绝连接，
 *   确保测试与外部网络完全隔离。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContextManager } from "../contextManager";
import type { UserLocation } from "../../agent/supervisor/state";

// ==================== Mock global.fetch ====================

const mockFetch = vi.fn();

describe("ContextManager", () => {
  let manager: ContextManager;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 fetch 拒绝连接，隔离外部 API（ip-api.com）
    mockFetch.mockRejectedValue(new Error("Network disabled in test"));
    global.fetch = mockFetch as unknown as typeof fetch;
    manager = new ContextManager();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ==================== getContext ====================

  describe("getContext", () => {
    it("应返回完整的用户上下文", async () => {
      const ctx = await manager.getContext("user-1", "session-1");
      expect(ctx.userId).toBe("user-1");
      expect(ctx.sessionId).toBe("session-1");
      expect(ctx.currentTime).toBeDefined();
      expect(ctx.timezone).toBeDefined();
      expect(ctx.platform).toBeDefined();
      expect(ctx.personality).toBe("friendly");
      expect(ctx.responseStyle).toBe("balanced");
    });

    it("无位置信息时 location 应为 undefined", async () => {
      const ctx = await manager.getContext("user-1", "session-1");
      expect(ctx.location).toBeUndefined();
    });

    it("有缓存位置时应包含 location", async () => {
      const location: UserLocation = {
        latitude: 39.9,
        longitude: 116.4,
        city: "北京",
      };
      await manager.updateLocation("user-1", location, "manual");
      const ctx = await manager.getContext("user-1", "session-1");
      expect(ctx.location).toBeDefined();
      expect(ctx.location!.city).toBe("北京");
      expect(ctx.location!.latitude).toBe(39.9);
    });
  });

  // ==================== updateLocation ====================

  describe("updateLocation", () => {
    it("应成功缓存用户位置", async () => {
      const location: UserLocation = {
        latitude: 31.23,
        longitude: 121.47,
        city: "上海",
        address: "上海市",
      };
      await manager.updateLocation("user-1", location, "gps");
      const cached = await manager.getLocation("user-1");
      expect(cached).toBeDefined();
      expect(cached!.latitude).toBe(31.23);
      expect(cached!.longitude).toBe(121.47);
      expect(cached!.city).toBe("上海");
      expect(cached!.source).toBe("gps");
    });

    it("应覆盖已有的位置缓存", async () => {
      await manager.updateLocation(
        "user-1",
        { latitude: 1, longitude: 1, city: "A" },
        "manual"
      );
      await manager.updateLocation(
        "user-1",
        { latitude: 2, longitude: 2, city: "B" },
        "gps"
      );
      const cached = await manager.getLocation("user-1");
      expect(cached!.city).toBe("B");
      expect(cached!.source).toBe("gps");
    });
  });

  // ==================== getLocation ====================

  describe("getLocation", () => {
    it("无缓存且无 MCP 时应返回 undefined", async () => {
      // fetch 已被 mock 为拒绝连接，ip-api.com 降级也会失败
      const loc = await manager.getLocation("unknown-user");
      expect(loc).toBeUndefined();
    });

    it("有效缓存应直接返回", async () => {
      await manager.updateLocation(
        "user-1",
        { latitude: 39.9, longitude: 116.4, city: "北京" },
        "manual"
      );
      const loc = await manager.getLocation("user-1");
      expect(loc).toBeDefined();
      expect(loc!.city).toBe("北京");
    });

    it("过期缓存应尝试 IP 定位，失败后返回过期缓存", async () => {
      // 手动设置过期缓存
      await manager.updateLocation(
        "user-1",
        { latitude: 39.9, longitude: 116.4, city: "北京" },
        "manual"
      );

      // 模拟过期：修改 obtainedAt
      const cache = (manager as any).locationCache;
      const cached = cache.get("user-1");
      cached.obtainedAt = new Date(Date.now() - 60 * 60 * 1000); // 1小时前

      const loc = await manager.getLocation("user-1");
      // 无 MCP，IP 定位失败（fetch 被 mock），应返回过期缓存
      expect(loc).toBeDefined();
      expect(loc!.city).toBe("北京");
    });
  });

  // ==================== getLocationByIP ====================

  describe("getLocationByIP", () => {
    it("无 MCP callTool 时应返回 undefined", async () => {
      // fetch 被 mock 为拒绝连接，ip-api.com 降级也会失败
      const loc = await manager.getLocationByIP();
      expect(loc).toBeUndefined();
    });

    it("MCP 返回有效 JSON 时应解析位置", async () => {
      const mockCallTool = vi.fn().mockResolvedValue(
        JSON.stringify({
          rectangle: "116.0,39.0;117.0,40.0",
          city: "北京",
          province: "北京市",
        })
      );
      manager.setMCPCallTool(mockCallTool);

      const loc = await manager.getLocationByIP("1.2.3.4");
      expect(loc).toBeDefined();
      expect(loc!.city).toBe("北京");
      expect(loc!.latitude).toBeCloseTo(39.5, 1);
      expect(loc!.longitude).toBeCloseTo(116.5, 1);
      expect(mockCallTool).toHaveBeenCalledWith("maps_ip_location", {
        ip: "1.2.3.4",
      });
    });

    it("MCP 调用失败时应返回 undefined", async () => {
      const mockCallTool = vi.fn().mockRejectedValue(new Error("timeout"));
      manager.setMCPCallTool(mockCallTool);

      // MCP 失败 → 降级到 ip-api.com → fetch 被 mock 拒绝 → 返回 undefined
      const loc = await manager.getLocationByIP();
      expect(loc).toBeUndefined();
    });

    it("MCP 返回非 JSON 字符串时应返回 undefined", async () => {
      const mockCallTool = vi.fn().mockResolvedValue("not json");
      manager.setMCPCallTool(mockCallTool);

      // MCP 返回无效数据 → 降级到 ip-api.com → fetch 被 mock 拒绝 → 返回 undefined
      const loc = await manager.getLocationByIP();
      expect(loc).toBeUndefined();
    });

    it("ip-api.com 返回有效数据时应解析位置", async () => {
      // 模拟 ip-api.com 返回成功
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "success",
          city: "上海",
          regionName: "上海",
          country: "中国",
          lat: 31.23,
          lon: 121.47,
        }),
      });

      const loc = await manager.getLocationByIP();
      expect(loc).toBeDefined();
      expect(loc!.city).toBe("上海");
      expect(loc!.latitude).toBe(31.23);
      expect(loc!.longitude).toBe(121.47);
    });
  });

  // ==================== getUserPreferences ====================

  describe("getUserPreferences", () => {
    it("应返回默认偏好", async () => {
      const prefs = await manager.getUserPreferences("user-1");
      expect(prefs.personality).toBe("friendly");
      expect(prefs.responseStyle).toBe("balanced");
    });
  });

  // ==================== parseRectangleCenter (private) ====================

  describe("parseRectangleCenter (via getLocationByIP)", () => {
    it("应正确解析高德矩形区域中心点", async () => {
      const mockCallTool = vi.fn().mockResolvedValue(
        JSON.stringify({
          rectangle: "116.0,39.0;118.0,41.0",
          city: "测试",
        })
      );
      manager.setMCPCallTool(mockCallTool);

      const loc = await manager.getLocationByIP();
      expect(loc).toBeDefined();
      // 中心点应为 (117.0, 40.0)
      expect(loc!.longitude).toBeCloseTo(117.0, 1);
      expect(loc!.latitude).toBeCloseTo(40.0, 1);
    });
  });
});
