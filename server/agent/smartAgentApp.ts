/**
 * SmartAgent Application — 应用初始化入口
 *
 * 将所有模块组装在一起：
 * 1. 初始化 Tool Registry 和 MCP Manager
 * 2. 创建 Domain Agent 实例
 * 3. 构建 Supervisor Graph
 * 4. 提供统一的 chat 接口
 */

import { ToolRegistry } from "../mcp/toolRegistry";
import { MCPManager } from "../mcp/mcpManager";
import { loadMCPConfig } from "../mcp/mcpConfig";
import { ContextManager } from "../context/contextManager";
import { FileAgent } from "./domains/fileAgent";
import { NavigationAgent } from "./domains/navigationAgent";
import { MultimediaAgent } from "./domains/multimediaAgent";
import { GeneralAgent } from "./domains/generalAgent";
import { registerFreeWeatherTools } from "../mcp/freeWeatherTools";
import { registerFileOrganizerTools } from "../mcp/fileOrganizerRegistration";
import {
  runSupervisor,
  type SupervisorInput,
  type SupervisorOutput,
  type AgentRegistry,
} from "./supervisor";

// ==================== 应用实例 ====================

export interface SmartAgentAppConfig {
  /** 自定义 MCP 配置路径 */
  mcpConfigPath?: string;
}

/**
 * SmartAgent 应用
 *
 * 单例模式，管理所有子系统的生命周期。
 */
export class SmartAgentApp {
  private toolRegistry: ToolRegistry;
  private mcpManager: MCPManager;
  private contextManager: ContextManager;
  private agentRegistry: AgentRegistry;
  private initialized: boolean = false;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.mcpManager = new MCPManager(this.toolRegistry);
    this.contextManager = new ContextManager();
    this.agentRegistry = {};
  }

  /**
   * 初始化应用
   *
   * 1. 加载 MCP 配置
   * 2. 初始化 MCP Manager（连接所有 MCP Server）
   * 3. 注入 MCP 工具调用能力到 Context Manager
   * 4. 创建 Domain Agent 实例
   */
  async initialize(config?: SmartAgentAppConfig): Promise<void> {
    if (this.initialized) {
      console.log("[SmartAgentApp] Already initialized");
      return;
    }

    console.log("[SmartAgentApp] Initializing...");

    // 1. 加载 MCP 配置
    const mcpConfigs = await loadMCPConfig(config?.mcpConfigPath);
    this.mcpManager.loadConfigs(mcpConfigs);

    // 2. 初始化 MCP Manager
    await this.mcpManager.initialize();

    // 2.5 注册内置免费工具（无需 API Key，无需 MCP Server 连接）
    registerFreeWeatherTools(this.toolRegistry);
    console.log("[SmartAgentApp] Free weather/location tools registered");

    // 2.6 注册文件整理大师工具（SmartAgent4 新增）
    registerFileOrganizerTools(this.toolRegistry);
    console.log("[SmartAgentApp] File organizer tools registered");

    // 3. 注入 MCP 工具调用能力到 Context Manager
    this.contextManager.setMCPCallTool(
      this.mcpManager.callTool.bind(this.mcpManager)
    );

    // 4. 创建 Domain Agent 实例
    this.agentRegistry = {
      fileAgent: new FileAgent(this.mcpManager),
      navigationAgent: new NavigationAgent(this.mcpManager),
      multimediaAgent: new MultimediaAgent(this.mcpManager),
      generalAgent: new GeneralAgent(this.mcpManager),
    };

    this.initialized = true;

    console.log("[SmartAgentApp] Initialization complete");
    console.log(
      `  - MCP Servers: ${this.mcpManager.getStatus().filter((s) => s.status === "connected").length} connected`
    );
    console.log(`  - Tools registered: ${this.toolRegistry.size()}`);
    console.log(
      `  - Domain Agents: ${Object.keys(this.agentRegistry).join(", ")}`
    );
  }

  /**
   * 处理用户消息
   *
   * 核心 chat 接口，接收用户消息，通过 Supervisor 图处理并返回结果。
   */
  async chat(
    userMessage: string,
    options: {
      userId: string;
      sessionId: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      platform?: "windows" | "mac" | "linux";
      /** SmartAgent3 新增：人格 ID */
      characterId?: string;
    }
  ): Promise<SupervisorOutput> {
    if (!this.initialized) {
      throw new Error(
        "[SmartAgentApp] Not initialized. Call initialize() first."
      );
    }

    // 获取用户上下文
    const context = await this.contextManager.getContext(
      options.userId,
      options.sessionId
    );

    // 构建 Supervisor 输入
    const input: SupervisorInput = {
      userMessage,
      conversationHistory: options.conversationHistory,
      context: {
        userId: options.userId,
        sessionId: options.sessionId,
        location: context.location,
        platform: options.platform || context.platform,
        personality: context.personality,
        responseStyle: context.responseStyle,
        characterId: options.characterId || "xiaozhi",
      },
    };

    // 运行 Supervisor
    return runSupervisor(input, this.agentRegistry);
  }

  /**
   * 更新用户位置
   */
  async updateUserLocation(
    userId: string,
    location: { latitude: number; longitude: number; city?: string },
    source: "gps" | "ip" | "manual" = "manual"
  ): Promise<void> {
    await this.contextManager.updateLocation(userId, location, source);
  }

  /**
   * 获取 MCP Server 状态
   */
  getMCPStatus() {
    return this.mcpManager.getStatus();
  }

  /**
   * 获取 ToolRegistry 实例（供自进化闭环使用）
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 获取已注册的工具列表
   */
  getRegisteredTools() {
    return this.toolRegistry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      serverId: t.serverId,
    }));
  }

  /**
   * 获取 Domain Agent 信息
   */
  getAgentInfo() {
    return Object.entries(this.agentRegistry).map(([key, agent]) => ({
      name: agent.name,
      description: agent.description,
      availableTools: agent.availableTools,
    }));
  }

  /**
   * 关闭应用
   */
  async shutdown(): Promise<void> {
    console.log("[SmartAgentApp] Shutting down...");
    await this.mcpManager.shutdown();
    this.initialized = false;
    console.log("[SmartAgentApp] Shutdown complete");
  }
}

// ==================== 全局单例 ====================

let appInstance: SmartAgentApp | null = null;

/**
 * 获取 SmartAgent 应用单例
 */
export function getSmartAgentApp(): SmartAgentApp {
  if (!appInstance) {
    appInstance = new SmartAgentApp();
  }
  return appInstance;
}
