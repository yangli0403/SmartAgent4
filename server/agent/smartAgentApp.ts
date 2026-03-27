/**
 * SmartAgent Application — 应用初始化入口
 *
 * 将所有模块组装在一起：
 * 1. 初始化 Tool Registry 和 MCP Manager
 * 2. 加载 Agent Card 配置并创建 Domain Agent 实例
 * 3. 构建 Supervisor Graph（使用并行执行引擎）
 * 4. 提供统一的 chat 接口
 *
 * V2 增强：
 * - 使用 AgentCardRegistry 替代硬编码 agentRegistry
 * - 自动扫描 agent-cards/ 目录加载 Agent Card
 * - 为每个 Agent 注入 AgentCardRegistry 引用（支持委托协议）
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
} from "./supervisor";
import {
  getAgentCardRegistry,
  type IAgentCardRegistry,
} from "./discovery";
import type { BaseAgent } from "./domains/baseAgent";
import * as path from "path";

// ==================== 应用实例 ====================

export interface SmartAgentAppConfig {
  /** 自定义 MCP 配置路径 */
  mcpConfigPath?: string;
  /** 自定义 Agent Card 目录路径 */
  agentCardsDir?: string;
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
  private agentCardRegistry: IAgentCardRegistry;
  private initialized: boolean = false;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.mcpManager = new MCPManager(this.toolRegistry);
    this.contextManager = new ContextManager();
    this.agentCardRegistry = getAgentCardRegistry();
  }

  /**
   * 初始化应用
   *
   * 1. 加载 MCP 配置
   * 2. 初始化 MCP Manager（连接所有 MCP Server）
   * 3. 注入 MCP 工具调用能力到 Context Manager
   * 4. 加载 Agent Card 配置
   * 5. 创建 Domain Agent 实例并绑定到注册表
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

    // 4. 加载 Agent Card 配置
    const agentCardsDir =
      config?.agentCardsDir ||
      path.resolve(__dirname, "agent-cards");

    try {
      await this.agentCardRegistry.loadFromDirectory(agentCardsDir);
      console.log(
        `[SmartAgentApp] Agent Cards loaded: ${this.agentCardRegistry.size()} agents`
      );
    } catch (error) {
      console.warn(
        `[SmartAgentApp] Failed to load Agent Cards from ${agentCardsDir}: ${(error as Error).message}`
      );
      console.warn("[SmartAgentApp] Falling back to hardcoded agent registration");
    }

    // 5. 创建 Domain Agent 实例并绑定
    this.createAndBindAgents();

    this.initialized = true;

    console.log("[SmartAgentApp] Initialization complete");
    console.log(
      `  - MCP Servers: ${this.mcpManager.getStatus().filter((s) => s.status === "connected").length} connected`
    );
    console.log(`  - Tools registered: ${this.toolRegistry.size()}`);
    console.log(
      `  - Agent Cards: ${this.agentCardRegistry.size()} loaded`
    );
    console.log(
      `  - Agents: ${this.agentCardRegistry.getAllIds().join(", ")}`
    );
  }

  /**
   * 创建 Domain Agent 实例并绑定到注册表
   *
   * 根据 Agent Card 配置创建对应的 Agent 实例。
   * 如果注册表为空（Agent Card 加载失败），则使用硬编码方式注册。
   */
  private createAndBindAgents(): void {
    // Agent 实例映射表：Agent ID → Agent 实例
    const agentInstances: Record<string, BaseAgent> = {
      fileAgent: new FileAgent(this.mcpManager),
      navigationAgent: new NavigationAgent(this.mcpManager),
      multimediaAgent: new MultimediaAgent(this.mcpManager),
      generalAgent: new GeneralAgent(this.mcpManager),
    };

    // 绑定到注册表
    for (const [agentId, agent] of Object.entries(agentInstances)) {
      if (this.agentCardRegistry.has(agentId)) {
        // Agent Card 已加载，绑定实例
        this.agentCardRegistry.bindAgent(agentId, agent);
      } else {
        // Agent Card 未加载，手动注册（降级路径）
        console.warn(
          `[SmartAgentApp] Agent Card not found for ${agentId}, registering with defaults`
        );
        this.agentCardRegistry.register(
          {
            id: agentId,
            name: agent.name,
            description: agent.description,
            capabilities: [],
            tools: agent.availableTools,
            domain: this.inferDomain(agentId),
            implementationClass: agentId,
            llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 8 },
            systemPromptTemplate: "",
            enabled: true,
            priority: 50,
          },
          agent
        );
      }

      // 注入 AgentCardRegistry 引用，启用委托能力
      agent.setAgentCardRegistry(this.agentCardRegistry);
    }

    console.log(
      `[SmartAgentApp] ${Object.keys(agentInstances).length} agents created and bound`
    );
  }

  /**
   * 根据 Agent ID 推断领域（降级用）
   */
  private inferDomain(
    agentId: string
  ): "file_system" | "navigation" | "multimedia" | "general" | "custom" {
    if (agentId.includes("file")) return "file_system";
    if (agentId.includes("navigation")) return "navigation";
    if (agentId.includes("multimedia")) return "multimedia";
    return "general";
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

    // 运行 Supervisor（使用 AgentCardRegistry）
    return runSupervisor(input, this.agentCardRegistry);
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
   * 获取 AgentCardRegistry 实例
   */
  getAgentCardRegistry(): IAgentCardRegistry {
    return this.agentCardRegistry;
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
   *
   * V2 增强：从 AgentCardRegistry 获取，包含 Agent Card 完整信息。
   */
  getAgentInfo() {
    return this.agentCardRegistry.getAllEnabled().map((card) => ({
      id: card.id,
      name: card.name,
      description: card.description,
      domain: card.domain,
      capabilities: card.capabilities,
      tools: card.tools,
      priority: card.priority,
      enabled: card.enabled,
    }));
  }

  /**
   * 关闭应用
   */
  async shutdown(): Promise<void> {
    console.log("[SmartAgentApp] Shutting down...");
    await this.mcpManager.shutdown();
    this.agentCardRegistry.clear();
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
