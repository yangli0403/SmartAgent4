/**
 * Config 单元测试
 *
 * 测试 AIRI Bridge 配置管理：
 * 1. 默认配置值
 * 2. 环境变量覆盖
 * 3. 配置合并优先级
 */

import { loadAiriBridgeConfig, getDefaultConfig } from "../config";

describe("AiriBridge Config", () => {
  // 保存原始环境变量
  const originalEnv = { ...process.env };

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv };
  });

  // ==================== 默认配置测试 ====================

  describe("getDefaultConfig", () => {
    test("应返回完整的默认配置", () => {
      const config = getDefaultConfig();

      expect(config.airiServerUrl).toBe("ws://localhost:6121/ws");
      expect(config.autoConnect).toBe(true);
      expect(config.autoReconnect).toBe(true);
      expect(config.maxReconnectAttempts).toBe(-1);
      expect(config.enableEmotionRendering).toBe(true);
      expect(config.enableTTS).toBe(true);
      expect(config.defaultCharacterId).toBe("xiaozhi");
    });

    test("返回的配置应为副本（不可变）", () => {
      const config1 = getDefaultConfig();
      const config2 = getDefaultConfig();

      config1.airiServerUrl = "ws://modified:9999/ws";
      expect(config2.airiServerUrl).toBe("ws://localhost:6121/ws");
    });
  });

  // ==================== loadAiriBridgeConfig 测试 ====================

  describe("loadAiriBridgeConfig", () => {
    test("无环境变量时应使用默认值", () => {
      // 清除相关环境变量
      delete process.env.AIRI_SERVER_URL;
      delete process.env.AIRI_TOKEN;
      delete process.env.AIRI_AUTO_CONNECT;

      const config = loadAiriBridgeConfig();
      expect(config.airiServerUrl).toBe("ws://localhost:6121/ws");
      expect(config.autoConnect).toBe(true);
    });

    test("环境变量应覆盖默认值", () => {
      process.env.AIRI_SERVER_URL = "ws://custom:8080/ws";
      process.env.AIRI_TOKEN = "test-token";
      process.env.AIRI_AUTO_CONNECT = "false";
      process.env.AIRI_ENABLE_EMOTION = "false";
      process.env.AIRI_ENABLE_TTS = "false";
      process.env.AIRI_DEFAULT_CHARACTER = "jarvis";

      const config = loadAiriBridgeConfig();

      expect(config.airiServerUrl).toBe("ws://custom:8080/ws");
      expect(config.airiToken).toBe("test-token");
      expect(config.autoConnect).toBe(false);
      expect(config.enableEmotionRendering).toBe(false);
      expect(config.enableTTS).toBe(false);
      expect(config.defaultCharacterId).toBe("jarvis");
    });

    test("overrides 应覆盖环境变量", () => {
      process.env.AIRI_SERVER_URL = "ws://env:8080/ws";

      const config = loadAiriBridgeConfig({
        airiServerUrl: "ws://override:9090/ws",
      });

      expect(config.airiServerUrl).toBe("ws://override:9090/ws");
    });

    test("部分 overrides 不应影响其他字段", () => {
      const config = loadAiriBridgeConfig({
        defaultCharacterId: "alfred",
      });

      expect(config.defaultCharacterId).toBe("alfred");
      expect(config.airiServerUrl).toBe("ws://localhost:6121/ws"); // 默认值保持
      expect(config.autoConnect).toBe(true); // 默认值保持
    });
  });
});
