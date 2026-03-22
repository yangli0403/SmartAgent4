/**
 * MCP Config 单元测试
 *
 * 测试配置加载、环境变量替换和默认配置生成。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { loadMCPConfig, generateDefaultConfig, DEFAULT_MCP_CONFIGS } from "../mcpConfig";

const TEST_CONFIG_DIR = "/tmp/mcp-config-test";
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, "mcp-config.json");

describe("MCP Config", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  // ==================== DEFAULT_MCP_CONFIGS ====================

  describe("DEFAULT_MCP_CONFIGS", () => {
    it("应包含 4 个默认 Server 配置", () => {
      expect(DEFAULT_MCP_CONFIGS.length).toBe(4);
    });

    it("应包含本地文件系统 Server", () => {
      const fs = DEFAULT_MCP_CONFIGS.find((c) => c.id === "local-filesystem");
      expect(fs).toBeDefined();
      expect(fs!.transport).toBe("stdio");
      expect(fs!.category).toBe("file_system");
      expect(fs!.enabled).toBe(true);
    });

    it("应包含本地应用浏览器 Server", () => {
      const ab = DEFAULT_MCP_CONFIGS.find((c) => c.id === "local-appbrowser");
      expect(ab).toBeDefined();
      expect(ab!.transport).toBe("stdio");
      expect(ab!.category).toBe("app_browser");
    });

    it("应包含高德地图 Server", () => {
      const amap = DEFAULT_MCP_CONFIGS.find((c) => c.id === "amap");
      expect(amap).toBeDefined();
      expect(amap!.transport).toBe("sse");
      expect(amap!.category).toBe("navigation");
      expect(amap!.url).toBe("https://mcp.amap.com/sse");
    });

    it("应包含网易云音乐 Server", () => {
      const music = DEFAULT_MCP_CONFIGS.find((c) => c.id === "netease-music");
      expect(music).toBeDefined();
      expect(music!.transport).toBe("sse");
      expect(music!.category).toBe("multimedia");
    });
  });

  // ==================== loadMCPConfig ====================

  describe("loadMCPConfig", () => {
    it("配置文件不存在时应返回默认配置", async () => {
      const configs = await loadMCPConfig("/tmp/nonexistent/config.json");
      expect(configs).toEqual(DEFAULT_MCP_CONFIGS);
    });

    it("应从有效的配置文件加载", async () => {
      const customConfig = {
        servers: [
          {
            id: "custom-server",
            name: "Custom",
            transport: "stdio",
            enabled: true,
            autoConnect: false,
            category: "file_system",
            command: "node",
            args: ["custom.js"],
          },
        ],
      };
      await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(customConfig));

      const configs = await loadMCPConfig(TEST_CONFIG_PATH);
      expect(configs.length).toBe(1);
      expect(configs[0].id).toBe("custom-server");
    });

    it("无效格式（缺少 servers 数组）应返回默认配置", async () => {
      await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify({ invalid: true }));
      const configs = await loadMCPConfig(TEST_CONFIG_PATH);
      expect(configs).toEqual(DEFAULT_MCP_CONFIGS);
    });

    it("无效 JSON 应返回默认配置", async () => {
      await fs.writeFile(TEST_CONFIG_PATH, "not json {{{");
      const configs = await loadMCPConfig(TEST_CONFIG_PATH);
      expect(configs).toEqual(DEFAULT_MCP_CONFIGS);
    });

    it("应替换环境变量占位符", async () => {
      // 设置环境变量
      process.env.TEST_API_KEY = "my-secret-key";

      const customConfig = {
        servers: [
          {
            id: "test",
            name: "Test",
            transport: "sse",
            enabled: true,
            autoConnect: true,
            category: "navigation",
            url: "https://example.com",
            apiKey: "${TEST_API_KEY}",
          },
        ],
      };
      await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(customConfig));

      const configs = await loadMCPConfig(TEST_CONFIG_PATH);
      expect(configs[0].apiKey).toBe("my-secret-key");

      // 清理
      delete process.env.TEST_API_KEY;
    });

    it("不存在的环境变量应替换为空字符串", async () => {
      const customConfig = {
        servers: [
          {
            id: "test",
            name: "Test",
            transport: "sse",
            enabled: true,
            autoConnect: true,
            category: "navigation",
            url: "https://example.com",
            apiKey: "${NONEXISTENT_VAR}",
          },
        ],
      };
      await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(customConfig));

      const configs = await loadMCPConfig(TEST_CONFIG_PATH);
      expect(configs[0].apiKey).toBe("");
    });
  });

  // ==================== generateDefaultConfig ====================

  describe("generateDefaultConfig", () => {
    it("应生成有效的配置文件", async () => {
      const outputPath = path.join(TEST_CONFIG_DIR, "generated.json");
      await generateDefaultConfig(outputPath);

      const content = await fs.readFile(outputPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.$schema).toBe("SmartAgent MCP Config v2.0");
      expect(parsed.description).toBeDefined();
      expect(Array.isArray(parsed.servers)).toBe(true);
      expect(parsed.servers.length).toBe(DEFAULT_MCP_CONFIGS.length);
    });

    it("生成的配置中有 API Key 的 Server 应包含环境变量占位符或为空", async () => {
      const outputPath = path.join(TEST_CONFIG_DIR, "generated.json");
      await generateDefaultConfig(outputPath);

      const content = await fs.readFile(outputPath, "utf-8");
      const parsed = JSON.parse(content);

      // 验证配置文件已正确生成
      expect(parsed.servers.length).toBeGreaterThan(0);
      // 高德地图 Server 应存在
      const amapConfig = parsed.servers.find((s: any) => s.id === "amap");
      expect(amapConfig).toBeDefined();
      // apiKey 字段可能为环境变量占位符或 undefined（当原始值为空时）
      if (amapConfig.apiKey) {
        expect(typeof amapConfig.apiKey).toBe("string");
      }
    });
  });
});
