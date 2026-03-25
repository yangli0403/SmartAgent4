/**
 * MCP Manager — MCP Server 连接管理器
 *
 * 管理所有 MCP Server 的生命周期（连接、断开、重连），
 * 支持 stdio（本地进程）和 SSE（远程服务）两种传输方式。
 * 启动时自动发现并注册所有可用工具到 Tool Registry。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ToolRegistry, type RegisteredTool, type ToolCategory } from "./toolRegistry";
import { callFreeWeatherTool } from "./freeWeatherTools";

// 内置工具的 serverId 前缀
const BUILTIN_SERVER_PREFIX = "builtin-";

// ==================== 类型定义 ====================

export type MCPTransport = "stdio" | "sse";
export type MCPConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  enabled: boolean;
  autoConnect: boolean;
  category: ToolCategory | "app_browser";

  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // SSE
  url?: string;
  apiKey?: string;
  headers?: Record<string, string>;

  // 通用
  connectTimeout?: number;
  toolTimeout?: number;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface MCPServerStatus {
  id: string;
  status: MCPConnectionStatus;
  toolCount: number;
  lastConnectedAt?: Date;
  lastError?: string;
  reconnectAttempts: number;
}

// ==================== MCP Manager 接口 ====================

export interface IMCPManager {
  initialize(): Promise<void>;
  connect(serverId: string): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  getStatus(): MCPServerStatus[];
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  getToolRegistry(): ToolRegistry;
  shutdown(): Promise<void>;
}

// ==================== MCP Manager 实现 ====================

export class MCPManager implements IMCPManager {
  private configs: Map<string, MCPServerConfig> = new Map();
  private clients: Map<string, Client> = new Map();
  private statuses: Map<string, MCPServerStatus> = new Map();
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * 加载 MCP Server 配置
   */
  loadConfigs(configs: MCPServerConfig[]): void {
    for (const config of configs) {
      this.configs.set(config.id, config);
      this.statuses.set(config.id, {
        id: config.id,
        status: "disconnected",
        toolCount: 0,
        reconnectAttempts: 0,
      });
    }
    console.log(
      `[MCPManager] Loaded ${configs.length} server configs: ${configs.map((c) => c.name).join(", ")}`
    );
  }

  /**
   * 初始化：连接所有已启用且自动连接的 MCP Server
   */
  async initialize(): Promise<void> {
    console.log("[MCPManager] Initializing...");

    const autoConnectServers = Array.from(this.configs.values()).filter(
      (c) => c.enabled && c.autoConnect
    );

    const results = await Promise.allSettled(
      autoConnectServers.map((config) => this.connect(config.id))
    );

    let successCount = 0;
    let failCount = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        successCount++;
      } else {
        failCount++;
        console.error(
          `[MCPManager] Failed to connect ${autoConnectServers[index].name}:`,
          result.reason
        );
      }
    });

    console.log(
      `[MCPManager] Initialization complete: ${successCount} connected, ${failCount} failed`
    );
    console.log(
      `[MCPManager] Total tools registered: ${this.toolRegistry.size()}`
    );
  }

  /**
   * 连接指定的 MCP Server
   */
  async connect(serverId: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`[MCPManager] Unknown server: ${serverId}`);
    }

    const status = this.statuses.get(serverId)!;
    status.status = "connecting";

    try {
      const client = new Client(
        { name: `SmartAgent-${config.id}`, version: "2.0.0" },
        { capabilities: {} }
      );

      // 创建传输层
      let transport;
      if (config.transport === "stdio") {
        if (!config.command) {
          throw new Error(
            `[MCPManager] stdio server ${serverId} missing command`
          );
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
        });
      } else if (config.transport === "sse") {
        if (!config.url) {
          throw new Error(`[MCPManager] SSE server ${serverId} missing url`);
        }
        const sseUrl = new URL(config.url);
        // 如果有 API Key，添加到 URL 参数或 headers
        const headers: Record<string, string> = {
          ...(config.headers || {}),
        };
        if (config.apiKey) {
          headers["Authorization"] = `Bearer ${config.apiKey}`;
        }
        transport = new SSEClientTransport(sseUrl, {
          requestInit: { headers },
        });
      } else {
        throw new Error(
          `[MCPManager] Unknown transport: ${config.transport}`
        );
      }

      // 连接（带超时）
      const connectTimeout = config.connectTimeout || 15000;
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Connection timeout (${connectTimeout}ms)`)),
            connectTimeout
          )
        ),
      ]);

      // 发现工具
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools || [];

      // 注册工具到 Tool Registry
      const category = config.category as ToolCategory;
      for (const tool of tools) {
        const registered: RegisteredTool = {
          name: tool.name,
          description: tool.description || "",
          inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
          serverId: config.id,
          category: category,
          registeredAt: new Date(),
          // 自进化闭环：初始化效用字段
          utilityScore: 0.5,
          successCount: 0,
          failureCount: 0,
          avgExecutionTimeMs: 0,
        };
        this.toolRegistry.register(registered);
      }

      // 保存 client 引用
      this.clients.set(serverId, client);

      // 更新状态
      status.status = "connected";
      status.toolCount = tools.length;
      status.lastConnectedAt = new Date();
      status.reconnectAttempts = 0;
      status.lastError = undefined;

      console.log(
        `[MCPManager] Connected to ${config.name} (${config.transport}): ${tools.length} tools discovered`
      );

      // 打印工具列表
      tools.forEach((t) => {
        console.log(`  - ${t.name}: ${(t.description || "").substring(0, 60)}`);
      });
    } catch (error) {
      status.status = "error";
      status.lastError = (error as Error).message;
      status.reconnectAttempts++;

      console.error(
        `[MCPManager] Failed to connect ${config.name}: ${(error as Error).message}`
      );

      // 自动重连
      if (
        config.maxReconnectAttempts &&
        status.reconnectAttempts < config.maxReconnectAttempts
      ) {
        const interval = config.reconnectInterval || 5000;
        console.log(
          `[MCPManager] Scheduling reconnect for ${config.name} in ${interval}ms (attempt ${status.reconnectAttempts}/${config.maxReconnectAttempts})`
        );
        setTimeout(() => this.connect(serverId).catch(() => {}), interval);
      }

      throw error;
    }
  }

  /**
   * 断开指定的 MCP Server
   */
  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      try {
        await client.close();
      } catch (e) {
        console.warn(
          `[MCPManager] Error closing ${serverId}: ${(e as Error).message}`
        );
      }
      this.clients.delete(serverId);
    }

    // 注销该 Server 的所有工具
    this.toolRegistry.unregisterByServer(serverId);

    // 更新状态
    const status = this.statuses.get(serverId);
    if (status) {
      status.status = "disconnected";
      status.toolCount = 0;
    }

    console.log(`[MCPManager] Disconnected from ${serverId}`);
  }

  /**
   * 获取所有 MCP Server 的状态
   */
  getStatus(): MCPServerStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * 调用指定工具
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // 从 Tool Registry 查找工具所属的 Server
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`[MCPManager] Tool not found: ${toolName}`);
    }

    // 内置工具直接调用，不需要 MCP 客户端
    if (tool.serverId.startsWith(BUILTIN_SERVER_PREFIX)) {
      console.log(
        `[MCPManager] Calling builtin tool: ${toolName} with args:`,
        JSON.stringify(args).substring(0, 200)
      );
      const startTime = Date.now();
      try {
        const result = await callFreeWeatherTool(toolName, args);
        console.log(`[MCPManager] Builtin tool ${toolName} completed in ${Date.now() - startTime}ms`);
        return result;
      } catch (error) {
        console.error(`[MCPManager] Builtin tool ${toolName} failed:`, (error as Error).message);
        throw error;
      }
    }

    const client = this.clients.get(tool.serverId);
    if (!client) {
      throw new Error(
        `[MCPManager] Server not connected: ${tool.serverId} (for tool ${toolName})`
      );
    }

    const config = this.configs.get(tool.serverId);
    const timeout = config?.toolTimeout || 30000;

    console.log(
      `[MCPManager] Calling tool: ${toolName} on ${tool.serverId} with args:`,
      JSON.stringify(args).substring(0, 200)
    );

    const startTime = Date.now();

    try {
      // 带超时的工具调用
      const result = await Promise.race([
        client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool call timeout (${timeout}ms)`)),
            timeout
          )
        ),
      ]);

      const duration = Date.now() - startTime;
      console.log(
        `[MCPManager] Tool ${toolName} completed in ${duration}ms`
      );

      // 解析结果
      if (result.content && Array.isArray(result.content)) {
        // MCP 标准格式：content 是 ContentPart 数组
        const textParts = result.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text);
        return textParts.join("\n");
      }

      return result.content || result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `[MCPManager] Tool ${toolName} failed after ${duration}ms:`,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * 获取 Tool Registry 引用
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 关闭所有连接并清理资源
   */
  async shutdown(): Promise<void> {
    console.log("[MCPManager] Shutting down...");

    const disconnectPromises = Array.from(this.clients.keys()).map((id) =>
      this.disconnect(id)
    );

    await Promise.allSettled(disconnectPromises);

    this.toolRegistry.clear();
    console.log("[MCPManager] Shutdown complete");
  }
}
