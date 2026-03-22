/**
 * Tool Registry — 动态工具注册表
 *
 * 统一管理所有 MCP Server 提供的工具，
 * 支持运行时动态注册/注销，按类别查询。
 * 为 Domain Agent 提供工具绑定接口。
 */

import { z, type ZodSchema } from "zod";

// ==================== 工具类别 ====================

/** 工具所属类别 */
export type ToolCategory =
  | "file_system"
  | "app_browser"
  | "navigation"
  | "multimedia";

// ==================== 注册工具 ====================

/** 注册到 Registry 中的工具 */
export interface RegisteredTool {
  /** 工具名称（全局唯一） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 JSON Schema */
  inputSchema: Record<string, unknown>;
  /** 输入参数 Zod Schema（用于运行时验证） */
  inputZodSchema?: ZodSchema;
  /** 所属 MCP Server ID */
  serverId: string;
  /** 工具类别 */
  category: ToolCategory;
  /** 注册时间 */
  registeredAt: Date;
}

/**
 * LangGraph 兼容的工具定义
 *
 * 用于 LLM 的 function calling（bind_tools）。
 */
export interface LangGraphToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ==================== Tool Registry 接口 ====================

/**
 * Tool Registry 接口
 */
export interface IToolRegistry {
  /**
   * 注册工具
   *
   * @param tool - 工具信息
   */
  register(tool: RegisteredTool): void;

  /**
   * 批量注册工具
   *
   * @param tools - 工具列表
   */
  registerBatch(tools: RegisteredTool[]): void;

  /**
   * 注销工具
   *
   * @param toolName - 工具名称
   */
  unregister(toolName: string): void;

  /**
   * 注销指定 Server 的所有工具
   *
   * @param serverId - MCP Server ID
   */
  unregisterByServer(serverId: string): void;

  /**
   * 获取指定工具
   *
   * @param toolName - 工具名称
   * @returns 工具信息，不存在则返回 undefined
   */
  get(toolName: string): RegisteredTool | undefined;

  /**
   * 按类别获取工具列表
   *
   * @param category - 工具类别
   * @returns 该类别下的所有工具
   */
  getByCategory(category: ToolCategory): RegisteredTool[];

  /**
   * 按 Server ID 获取工具列表
   *
   * @param serverId - MCP Server ID
   * @returns 该 Server 下的所有工具
   */
  getByServer(serverId: string): RegisteredTool[];

  /**
   * 按名称列表获取工具
   *
   * @param names - 工具名称列表
   * @returns 匹配的工具列表
   */
  getByNames(names: string[]): RegisteredTool[];

  /**
   * 获取所有已注册工具
   *
   * @returns 所有工具列表
   */
  getAll(): RegisteredTool[];

  /**
   * 将工具转换为 LangGraph 兼容的工具定义
   *
   * 用于 LLM 的 bind_tools / function calling。
   *
   * @param toolNames - 工具名称列表
   * @returns LangGraph 工具定义列表
   */
  toLangGraphTools(toolNames: string[]): LangGraphToolDefinition[];

  /**
   * 获取已注册工具总数
   */
  size(): number;

  /**
   * 清空所有注册
   */
  clear(): void;
}

/**
 * Tool Registry 实现
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(
        `[ToolRegistry] Tool "${tool.name}" already registered, overwriting.`
      );
    }
    this.tools.set(tool.name, { ...tool, registeredAt: new Date() });
  }

  registerBatch(tools: RegisteredTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(toolName: string): void {
    this.tools.delete(toolName);
  }

  unregisterByServer(serverId: string): void {
    const toDelete: string[] = [];
    this.tools.forEach((tool, name) => {
      if (tool.serverId === serverId) {
        toDelete.push(name);
      }
    });
    toDelete.forEach((name) => this.tools.delete(name));
  }

  get(toolName: string): RegisteredTool | undefined {
    return this.tools.get(toolName);
  }

  getByCategory(category: ToolCategory): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.category === category
    );
  }

  getByServer(serverId: string): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.serverId === serverId
    );
  }

  getByNames(names: string[]): RegisteredTool[] {
    return names
      .map((name) => this.tools.get(name))
      .filter((t): t is RegisteredTool => t !== undefined);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  toLangGraphTools(toolNames: string[]): LangGraphToolDefinition[] {
    return this.getByNames(toolNames).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}
