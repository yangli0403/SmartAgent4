/**
 * MCP Config — MCP Server 配置加载
 *
 * 从 mcp-config.json 文件加载 MCP Server 配置，
 * 支持环境变量替换（API Key 等敏感信息）。
 */

import fs from "fs/promises";
import path from "path";
import type { MCPServerConfig } from "./mcpManager";

/**
 * 默认 MCP Server 配置
 *
 * 包含本地文件系统、应用浏览器、高德地图和网易云音乐四个 Server。
 */
export const DEFAULT_MCP_CONFIGS: MCPServerConfig[] = [
  // ==================== 本地 MCP Servers (stdio) ====================
  {
    id: "local-filesystem",
    name: "文件系统",
    transport: "stdio",
    enabled: true,
    autoConnect: true,
    category: "file_system",
    command: "node",
    args: ["local-mcp-server/dist/filesystem/index.js"],
    connectTimeout: 10000,
    toolTimeout: 30000,
  },
  {
    id: "local-appbrowser",
    name: "应用浏览器",
    transport: "stdio",
    enabled: true,
    autoConnect: true,
    category: "app_browser",
    command: "node",
    args: ["local-mcp-server/dist/appbrowser/index.js"],
    connectTimeout: 10000,
    toolTimeout: 30000,
  },

  // ==================== 远程 MCP Servers (SSE) ====================
  {
    id: "amap",
    name: "高德地图",
    transport: "sse",
    enabled: true,
    autoConnect: true,
    category: "navigation",
    // 高德地图 MCP 要求 API Key 作为 URL 参数（?key=xxx）而非 Authorization header
    url: process.env.AMAP_API_KEY
      ? `https://mcp.amap.com/sse?key=${process.env.AMAP_API_KEY}`
      : "https://mcp.amap.com/sse",
    apiKey: process.env.AMAP_API_KEY || "",
    connectTimeout: 15000,
    toolTimeout: 30000,
    reconnectInterval: 5000,
    maxReconnectAttempts: 3,
  },
  {
    id: "netease-music",
    name: "网易云音乐",
    transport: "sse",
    enabled: true,
    autoConnect: true,
    category: "multimedia",
    // 内嵌服务：随主服务自动启动，源码位于 server/mcp/netease/
    url: process.env.NETEASE_MUSIC_MCP_URL ||
      `http://localhost:${process.env.NETEASE_MCP_PORT || "3001"}/sse`,
    connectTimeout: 15000,
    toolTimeout: 30000,
    reconnectInterval: 5000,
    maxReconnectAttempts: 3,
  },
];

/**
 * 加载 MCP Server 配置
 *
 * 优先从 mcp-config.json 文件加载，如果不存在则使用默认配置。
 * 支持环境变量替换。
 *
 * @param configPath - 配置文件路径（可选）
 * @returns MCP Server 配置列表
 */
export async function loadMCPConfig(
  configPath?: string
): Promise<MCPServerConfig[]> {
  const filePath =
    configPath || path.resolve(process.cwd(), "mcp-config.json");

  try {
    // 尝试读取配置文件
    const fileContent = await fs.readFile(filePath, "utf-8");
    const rawConfig = JSON.parse(fileContent);

    // 验证格式
    if (!Array.isArray(rawConfig.servers)) {
      console.warn(
        "[MCPConfig] Invalid config format (missing servers array), using defaults"
      );
      return DEFAULT_MCP_CONFIGS;
    }

    // 替换环境变量
    const configs: MCPServerConfig[] = rawConfig.servers.map(
      (server: any) => resolveEnvVars(server)
    );

    console.log(
      `[MCPConfig] Loaded ${configs.length} server configs from ${filePath}`
    );
    return configs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(
        `[MCPConfig] Config file not found at ${filePath}, using defaults`
      );
    } else {
      console.warn(
        `[MCPConfig] Error reading config: ${(error as Error).message}, using defaults`
      );
    }
    return DEFAULT_MCP_CONFIGS;
  }
}

/**
 * 生成默认的 mcp-config.json 文件
 *
 * @param outputPath - 输出路径
 */
export async function generateDefaultConfig(
  outputPath: string
): Promise<void> {
  const configContent = {
    $schema: "SmartAgent MCP Config v2.0",
    description:
      "MCP Server 配置文件。API Key 等敏感信息建议使用环境变量（格式：${ENV_VAR_NAME}）。",
    servers: DEFAULT_MCP_CONFIGS.map((config) => ({
      ...config,
      // 将实际值替换为环境变量占位符
      apiKey: config.apiKey ? `\${${config.id.toUpperCase().replace(/-/g, "_")}_API_KEY}` : undefined,
    })),
  };

  await fs.writeFile(
    outputPath,
    JSON.stringify(configContent, null, 2),
    "utf-8"
  );

  console.log(`[MCPConfig] Default config generated at ${outputPath}`);
}

/**
 * 替换配置中的环境变量占位符
 *
 * 支持格式：${ENV_VAR_NAME}
 */
function resolveEnvVars(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, envVar) => {
      return process.env[envVar] || "";
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }

  if (obj && typeof obj === "object") {
    const resolved: any = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvVars(value);
    }
    return resolved;
  }

  return obj;
}
