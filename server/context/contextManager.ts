/**
 * Context Manager — 用户上下文管理器
 *
 * 管理用户的实时上下文信息，包括地理位置、时间、设备信息和用户偏好。
 * 为 Supervisor 和 Domain Agent 提供上下文注入能力。
 */

import type { UserContext, UserLocation } from "../agent/supervisor/state";
import { getUserPreferences as getDbUserPreferences } from "../db";

// ==================== 类型定义 ====================

export type LocationSource = "gps" | "ip" | "manual" | "cached";

export interface LocationWithSource extends UserLocation {
  source: LocationSource;
  obtainedAt: Date;
  accuracy?: number;
}

export interface IContextManager {
  getContext(userId: string, sessionId: string): Promise<UserContext>;
  updateLocation(
    userId: string,
    location: UserLocation,
    source: LocationSource
  ): Promise<void>;
  getLocation(userId: string): Promise<LocationWithSource | undefined>;
  getLocationByIP(ip?: string): Promise<UserLocation | undefined>;
  getUserPreferences(
    userId: string
  ): Promise<{ personality: string; responseStyle: string }>;
}

// ==================== 实现 ====================

export class ContextManager implements IContextManager {
  private locationCache: Map<string, LocationWithSource> = new Map();
  private locationCacheTTL: number = 30 * 60 * 1000; // 30 分钟

  // MCP Manager 引用（用于调用 IP 定位工具）
  private mcpCallTool?: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;

  /**
   * 注入 MCP 工具调用能力
   *
   * 用于通过高德地图 MCP 的 maps_ip_location 工具获取 IP 定位。
   */
  setMCPCallTool(
    callTool: (
      toolName: string,
      args: Record<string, unknown>
    ) => Promise<unknown>
  ): void {
    this.mcpCallTool = callTool;
  }

  /**
   * 获取用户的完整上下文
   */
  async getContext(userId: string, sessionId: string): Promise<UserContext> {
    const location = await this.getLocation(userId);
    const preferences = await this.getUserPreferences(userId);

    return {
      userId,
      sessionId,
      location: location
        ? {
            latitude: location.latitude,
            longitude: location.longitude,
            city: location.city,
            address: location.address,
          }
        : undefined,
      currentTime: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: this.detectPlatform(),
      personality: preferences.personality,
      responseStyle: preferences.responseStyle,
    };
  }

  /**
   * 更新用户位置
   */
  async updateLocation(
    userId: string,
    location: UserLocation,
    source: LocationSource
  ): Promise<void> {
    this.locationCache.set(userId, {
      ...location,
      source,
      obtainedAt: new Date(),
    });
    console.log(
      `[ContextManager] Updated location for user ${userId}: ${location.city || "unknown"} (${source})`
    );
  }

  /**
   * 获取用户位置
   *
   * 优先级：缓存（未过期）→ IP 定位 → 过期缓存
   */
  async getLocation(
    userId: string
  ): Promise<LocationWithSource | undefined> {
    const cached = this.locationCache.get(userId);

    // 检查缓存是否有效
    if (cached) {
      const age = Date.now() - cached.obtainedAt.getTime();
      if (age < this.locationCacheTTL) {
        return cached;
      }
    }

    // 尝试 IP 定位
    try {
      const ipLocation = await this.getLocationByIP();
      if (ipLocation) {
        const locationWithSource: LocationWithSource = {
          ...ipLocation,
          source: "ip",
          obtainedAt: new Date(),
        };
        this.locationCache.set(userId, locationWithSource);
        return locationWithSource;
      }
    } catch (e) {
      console.warn(
        `[ContextManager] IP location failed: ${(e as Error).message}`
      );
    }

    // 返回过期缓存（比没有好）
    return cached;
  }

  /**
   * 通过 IP 定位获取位置
   *
   * 优先尝试高德地图 MCP，不可用时降级到 ip-api.com（免费，无需注册）。
   */
  async getLocationByIP(ip?: string): Promise<UserLocation | undefined> {
    // 1. 优先尝试高德地图 MCP（如果已配置）
    if (this.mcpCallTool) {
      try {
        const result = await this.mcpCallTool("maps_ip_location", {
          ip: ip || "",
        });

        if (typeof result === "string") {
          try {
            const parsed = JSON.parse(result);
            if (parsed.rectangle || parsed.city) {
              const center = parsed.rectangle
                ? this.parseRectangleCenter(parsed.rectangle)
                : undefined;
              return {
                latitude: center?.lat || 0,
                longitude: center?.lng || 0,
                city: parsed.city || parsed.province || undefined,
                address: parsed.province
                  ? `${parsed.province}${parsed.city || ""}`
                  : undefined,
              };
            }
          } catch {
            // 非 JSON 格式
          }
        }
      } catch (e) {
        console.warn(
          `[ContextManager] Amap IP location failed, falling back to ip-api.com: ${(e as Error).message}`
        );
      }
    }

    // 2. 降级到 ip-api.com（免费，无需注册，无需 API Key）
    try {
      const url = ip
        ? `http://ip-api.com/json/${ip}?fields=status,city,regionName,country,lat,lon&lang=zh-CN`
        : `http://ip-api.com/json/?fields=status,city,regionName,country,lat,lon&lang=zh-CN`;

      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json() as {
          status: string;
          city?: string;
          regionName?: string;
          country?: string;
          lat?: number;
          lon?: number;
        };
        if (data.status === "success" && data.lat && data.lon) {
          const city = data.city || data.regionName || undefined;
          const address = [data.country, data.regionName, data.city]
            .filter(Boolean)
            .join(" ");
          console.log(
            `[ContextManager] IP location via ip-api.com: ${city} (${data.lat}, ${data.lon})`
          );
          return {
            latitude: data.lat,
            longitude: data.lon,
            city,
            address,
          };
        }
      }
    } catch (e) {
      console.warn(
        `[ContextManager] ip-api.com location failed: ${(e as Error).message}`
      );
    }

    return undefined;
  }

  /**
   * 获取用户偏好
   *
   * 从数据库查询用户的性格模式和回复风格设置。
   */
  async getUserPreferences(
    userId: string
  ): Promise<{ personality: string; responseStyle: string }> {
    try {
      const numericId = parseInt(userId, 10);
      if (!isNaN(numericId) && numericId > 0) {
        const prefs = await getDbUserPreferences(numericId);
        if (prefs) {
          console.log(
            `[ContextManager] Loaded preferences for user ${userId}: personality=${prefs.personality}, responseStyle=${prefs.responseStyle}`
          );
          return {
            personality: prefs.personality || "friendly",
            responseStyle: prefs.responseStyle || "balanced",
          };
        }
      }
    } catch (e) {
      console.warn(
        `[ContextManager] Failed to load preferences for user ${userId}: ${(e as Error).message}`
      );
    }

    return {
      personality: "friendly",
      responseStyle: "balanced",
    };
  }

  /**
   * 检测当前操作系统平台
   */
  private detectPlatform(): "windows" | "mac" | "linux" {
    const platform = process.platform;
    if (platform === "win32") return "windows";
    if (platform === "darwin") return "mac";
    return "linux";
  }

  /**
   * 解析高德地图矩形区域的中心点
   *
   * @param rectangle - 格式 "lng1,lat1;lng2,lat2"
   */
  private parseRectangleCenter(
    rectangle: string
  ): { lng: number; lat: number } | undefined {
    try {
      const parts = rectangle.split(";");
      if (parts.length === 2) {
        const [lng1, lat1] = parts[0].split(",").map(Number);
        const [lng2, lat2] = parts[1].split(",").map(Number);
        return {
          lng: (lng1 + lng2) / 2,
          lat: (lat1 + lat2) / 2,
        };
      }
    } catch {
      // 解析失败
    }
    return undefined;
  }
}
