/**
 * Tool Registry — 动态工具注册表（v2 — 自进化闭环增强）
 *
 * 统一管理所有 MCP Server 提供的工具，
 * 支持运行时动态注册/注销，按类别查询。
 * 为 Domain Agent 提供工具绑定接口。
 *
 * Phase 4 增强：
 * - 新增工具效用分数（utilityScore）、成功/失败计数、平均执行时间
 * - 新增 updateUtility() 方法，由 ReflectionNode 调用
 * - 新增 getRankedTools() 方法，按效用分数排序
 */

import { z, type ZodSchema } from "zod";

// ==================== 工具类别 ====================

/** 工具所属类别 */
export type ToolCategory =
  | "file_system"
  | "app_browser"
  | "navigation"
  | "multimedia";

// ==================== 工具效用更新 ====================

/** 工具效用更新数据（由 ReflectionNode 提供） */
export interface ToolUtilityUpdate {
  toolName: string;
  success: boolean;
  executionTimeMs: number;
  errorMessage?: string;
}

// ==================== 注册工具 ====================

/** 注册到 Registry 中的工具（v2 — 含效用分数） */
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
  /** 工具效用分数 (0.0 - 1.0)，默认为 0.5 */
  utilityScore: number;
  /** 成功调用次数 */
  successCount: number;
  /** 失败调用次数 */
  failureCount: number;
  /** 平均执行时间 (ms) */
  avgExecutionTimeMs: number;
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
 * Tool Registry 接口（v2 — 含效用分数管理）
 */
export interface IToolRegistry {
  register(tool: RegisteredTool): void;
  registerBatch(tools: RegisteredTool[]): void;
  unregister(toolName: string): void;
  unregisterByServer(serverId: string): void;
  get(toolName: string): RegisteredTool | undefined;
  getByCategory(category: ToolCategory): RegisteredTool[];
  getByServer(serverId: string): RegisteredTool[];
  getByNames(names: string[]): RegisteredTool[];
  getAll(): RegisteredTool[];
  toLangGraphTools(toolNames: string[]): LangGraphToolDefinition[];
  size(): number;
  clear(): void;

  // ===== 自进化闭环新增 =====

  /**
   * 更新工具效用统计信息
   *
   * 由 ReflectionNode 在每次工具调用后异步调用。
   * 使用指数移动平均（EMA）更新效用分数。
   *
   * @param update - 更新数据
   */
  updateUtility(update: ToolUtilityUpdate): void;

  /**
   * 获取按效用分数排序的工具列表
   *
   * @param category - 可选的类别过滤
   * @returns 按 utilityScore 降序排列的工具列表
   */
  getRankedTools(category?: ToolCategory): RegisteredTool[];
}

/**
 * Tool Registry 实现（v2 — 含效用分数管理）
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /** EMA 平滑因子：越大越重视最近的调用结果 */
  private readonly EMA_ALPHA = 0.3;

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(
        `[ToolRegistry] Tool "${tool.name}" already registered, overwriting.`
      );
    }
    this.tools.set(tool.name, {
      ...tool,
      registeredAt: new Date(),
      // 确保新注册的工具有默认效用字段
      utilityScore: tool.utilityScore ?? 0.5,
      successCount: tool.successCount ?? 0,
      failureCount: tool.failureCount ?? 0,
      avgExecutionTimeMs: tool.avgExecutionTimeMs ?? 0,
    });
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

  // ===== 自进化闭环新增方法 =====

  /**
   * 更新工具效用统计信息
   *
   * 使用指数移动平均（EMA）更新效用分数：
   *   newScore = alpha * currentResult + (1 - alpha) * oldScore
   *
   * 其中 currentResult:
   *   - 成功且耗时合理: 1.0
   *   - 成功但耗时较长: 0.7
   *   - 失败: 0.0
   */
  updateUtility(update: ToolUtilityUpdate): void {
    const tool = this.tools.get(update.toolName);
    if (!tool) {
      console.warn(
        `[ToolRegistry] Cannot update utility: tool "${update.toolName}" not found`
      );
      return;
    }

    // 更新计数
    if (update.success) {
      tool.successCount += 1;
    } else {
      tool.failureCount += 1;
    }

    // 更新平均执行时间（增量平均）
    const totalCalls = tool.successCount + tool.failureCount;
    tool.avgExecutionTimeMs =
      tool.avgExecutionTimeMs +
      (update.executionTimeMs - tool.avgExecutionTimeMs) / totalCalls;

    // 计算本次调用的效用值
    let currentResult: number;
    if (!update.success) {
      currentResult = 0.0;
    } else if (update.executionTimeMs > 10000) {
      // 超过 10 秒视为"慢但成功"
      currentResult = 0.7;
    } else {
      currentResult = 1.0;
    }

    // EMA 更新效用分数
    tool.utilityScore =
      this.EMA_ALPHA * currentResult +
      (1 - this.EMA_ALPHA) * tool.utilityScore;

    // 限制在 [0.05, 1.0] 范围内（不完全归零，给工具恢复机会）
    tool.utilityScore = Math.max(0.05, Math.min(1.0, tool.utilityScore));

    console.log(
      `[ToolRegistry] Updated utility for "${update.toolName}": ` +
        `score=${tool.utilityScore.toFixed(3)}, ` +
        `success=${tool.successCount}, fail=${tool.failureCount}, ` +
        `avgTime=${tool.avgExecutionTimeMs.toFixed(0)}ms`
    );
  }

  /**
   * 获取按效用分数排序的工具列表
   */
  getRankedTools(category?: ToolCategory): RegisteredTool[] {
    let tools = Array.from(this.tools.values());
    if (category) {
      tools = tools.filter((t) => t.category === category);
    }
    return tools.sort((a, b) => b.utilityScore - a.utilityScore);
  }
}
