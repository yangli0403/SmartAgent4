/**
 * 任务模块公共类型
 * 用于「复杂条件约束搜索」与「跨域任务」两种任务类型，便于迁移到其他系统
 */

/** 任务类型枚举 */
export type TaskType = "complex_conditional" | "cross_domain" | "simple";

/** 工具执行器抽象：迁移时由目标系统实现（可对接 MCP / gRPC / 车载总线等） */
export interface ToolExecutor {
  executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown>;
}

/** 单步计划（工具名 + 参数） */
export interface TaskStep {
  tool: string;
  parameters: Record<string, unknown>;
  description?: string;
}

/** 复杂条件约束搜索：输入与输出 */
export interface ComplexConditionalInput {
  userInput: string;
  /** 可选：用户主目录或下载目录等，用于解析「下载」「桌面」 */
  defaultSearchDirectory?: string;
}

export interface ComplexConditionalResult {
  success: boolean;
  steps: TaskStep[];
  outputs: unknown[];
  summary?: string;
  error?: string;
}

/** 跨域任务：域标识（与当前 MCP 一致，迁移时可扩展为 navigation / vehicle / multimedia 等） */
export type TaskDomain = "fileSystem" | "appBrowser" | string;

/** 跨域任务：输入与输出 */
export interface CrossDomainInput {
  userInput: string;
  /** 当前支持的域列表，迁移时可改为目标系统的域 */
  domains?: TaskDomain[];
}

export interface CrossDomainResult {
  success: boolean;
  /** 按域分组的步骤 */
  stepsByDomain: Partial<Record<TaskDomain, TaskStep[]>>;
  /** 扁平步骤顺序（便于顺序执行） */
  steps: TaskStep[];
  outputs: unknown[];
  summary?: string;
  error?: string;
}
