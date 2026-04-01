/**
 * Agent Card 动态发现层 — 类型定义
 *
 * 定义 Agent Card 数据结构、注册表接口、动态 Prompt 组装器接口
 * 和委托协议接口。这些类型构成了多智能体协同架构的核心契约。
 *
 * V2 增强（第五轮迭代）：
 * - DelegateRequest 增加 forkContext 和 async 字段
 * - IDynamicPromptAssembler 增加 buildSeparated* 方法
 */

import type { DomainAgentInterface, AgentExecutionOutput } from "../domains/types";
import type { ForkContext } from "../events/types";

// ==================== Agent Card 数据结构 ====================

/**
 * Agent Card — Agent 的身份证
 *
 * 每个 Agent 通过一个 JSON 文件描述自己的身份、能力和工具集。
 * 系统启动时自动扫描 `agent-cards/` 目录加载。
 *
 * 参考：Google A2A 协议的 Agent Card 概念
 */
export interface AgentCard {
  /** Agent 唯一标识符（如 "fileAgent"、"navigationAgent"） */
  id: string;

  /** Agent 显示名称（如 "文件管理专员"） */
  name: string;

  /** Agent 能力描述（供 LLM 理解，用于分类和规划 Prompt） */
  description: string;

  /** Agent 的能力标签列表（用于委托时的能力匹配） */
  capabilities: string[];

  /** Agent 绑定的工具名称列表 */
  tools: string[];

  /** Agent 的领域分类 */
  domain: AgentDomain;

  /** Agent 的实现类路径（相对于 server/agent/domains/） */
  implementationClass: string;

  /** Agent 的 LLM 配置 */
  llmConfig: AgentLLMConfig;

  /** Agent 的系统提示词模板（支持 {{variable}} 占位符） */
  systemPromptTemplate: string;

  /** Agent 是否启用（支持运行时禁用） */
  enabled: boolean;

  /** Agent 的优先级（同域多个 Agent 时的选择权重，越高越优先） */
  priority: number;

  /** Agent 的元数据（扩展字段） */
  metadata?: Record<string, unknown>;
}

/** Agent 领域分类 */
export type AgentDomain =
  | "file_system"
  | "navigation"
  | "multimedia"
  | "general"
  | "custom";

/** Agent LLM 配置 */
export interface AgentLLMConfig {
  /** LLM 温度参数 */
  temperature: number;
  /** LLM 最大 Token 数 */
  maxTokens: number;
  /** ReACT 循环最大迭代次数 */
  maxIterations: number;
}

// ==================== AgentCardRegistry 接口 ====================

/**
 * Agent Card 注册表接口
 *
 * 管理所有 Agent Card 的生命周期，提供注册、注销、查询和实例获取能力。
 */
export interface IAgentCardRegistry {
  /**
   * 从目录加载所有 Agent Card JSON 文件
   * @param directory - agent-cards 目录的绝对路径
   */
  loadFromDirectory(directory: string): Promise<void>;

  /**
   * 注册单个 Agent Card
   * @param card - Agent Card 配置
   * @param agent - Agent 实例（可选，延迟绑定）
   */
  register(card: AgentCard, agent?: DomainAgentInterface): void;

  /**
   * 注销 Agent
   * @param agentId - Agent ID
   */
  unregister(agentId: string): void;

  /**
   * 获取 Agent Card
   * @param agentId - Agent ID
   * @returns Agent Card 或 undefined
   */
  getCard(agentId: string): AgentCard | undefined;

  /**
   * 获取 Agent 实例
   * @param agentId - Agent ID
   * @returns Agent 实例或 undefined
   */
  getAgent(agentId: string): DomainAgentInterface | undefined;

  /**
   * 绑定 Agent 实例到已注册的 Card
   * @param agentId - Agent ID
   * @param agent - Agent 实例
   */
  bindAgent(agentId: string, agent: DomainAgentInterface): void;

  /**
   * 检查 Agent 是否已注册
   * @param agentId - Agent ID
   */
  has(agentId: string): boolean;

  /**
   * 获取所有已启用的 Agent Card
   */
  getAllEnabled(): AgentCard[];

  /**
   * 获取所有已注册的 Agent ID
   */
  getAllIds(): string[];

  /**
   * 按能力标签查找匹配的 Agent
   * @param capability - 能力标签
   * @returns 匹配的 Agent Card 列表（按优先级降序）
   */
  findByCapability(capability: string): AgentCard[];

  /**
   * 按领域查找 Agent
   * @param domain - 领域分类
   * @returns 匹配的 Agent Card 列表
   */
  findByDomain(domain: AgentDomain): AgentCard[];

  /**
   * 获取注册表大小
   */
  size(): number;

  /**
   * 清空注册表
   */
  clear(): void;
}

// ==================== DynamicPromptAssembler 接口 ====================

/**
 * 动态 Prompt 组装器接口
 *
 * 运行时遍历 AgentCardRegistry，将所有已注册 Agent 的名称、
 * 描述和工具列表动态拼接为 LLM Prompt 片段。
 *
 * V2 增强（第五轮迭代）：新增 buildSeparated* 方法用于 Prompt Caching 优化
 */
export interface IDynamicPromptAssembler {
  /**
   * 构建分类节点的 System Prompt
   * 包含所有已注册 Agent 的能力描述
   */
  buildClassifyPrompt(): string;

  /**
   * 构建规划节点的 System Prompt
   * 包含所有已注册 Agent 的名称、描述和工具列表
   */
  buildPlanPrompt(): string;

  /**
   * 获取所有已注册 Agent 的能力摘要
   * 用于注入到其他 Prompt 中
   */
  getAgentCapabilitySummary(): string;

  /**
   * 构建分离的分类 Prompt（第五轮迭代新增）
   *
   * 将静态规则与动态 Agent 列表分离，提高 Prompt Caching 命中率。
   * @returns 分离的 Prompt 载荷
   */
  buildSeparatedClassifyPrompt(): { staticSystemPrompt: string; dynamicContentMessage: string };

  /**
   * 构建分离的规划 Prompt（第五轮迭代新增）
   *
   * 将静态规划原则与动态 Agent/工具列表分离。
   * @returns 分离的 Prompt 载荷
   */
  buildSeparatedPlanPrompt(): { staticSystemPrompt: string; dynamicContentMessage: string };
}

// ==================== 委托协议接口 ====================

/**
 * 委托请求
 *
 * Agent 在执行过程中发现能力不足时，构造委托请求。
 *
 * V2 增强（第五轮迭代）：
 * - 新增 forkContext 字段，支持 Fork 子代理模式
 * - 新增 async 字段，支持异步委托（事件驱动通知）
 */
export interface DelegateRequest {
  /** 需要的能力标签 */
  capability: string;
  /** 委托的子任务描述 */
  task: string;
  /** 传递给目标 Agent 的上下文数据 */
  context?: Record<string, unknown>;
  /** 当前委托深度（防止无限递归） */
  depth?: number;
  /** Fork 上下文，如果提供，则子代理将继承父代理的对话历史和缓存（第五轮迭代新增） */
  forkContext?: ForkContext;
  /** 是否异步执行（触发事件通知而非阻塞等待）（第五轮迭代新增） */
  async?: boolean;
}

/**
 * 委托结果
 */
export interface DelegateResult {
  /** 委托是否成功 */
  success: boolean;
  /** 执行结果 */
  output: string;
  /** 执行该委托的 Agent ID */
  delegatedTo: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 异步任务 ID（当 async=true 时返回，用于后续查询结果）（第五轮迭代新增） */
  asyncTaskId?: string;
  /** 工具调用记录 */
  toolCalls?: Array<{
    toolName: string;
    serverId: string;
    input: Record<string, unknown>;
    output: unknown;
    status: "success" | "error" | "timeout";
    durationMs: number;
  }>;
}

/**
 * 可委托的 Agent 接口
 *
 * 扩展 DomainAgentInterface，增加委托能力。
 */
export interface IDelegatableAgent extends DomainAgentInterface {
  /**
   * 委托子任务给其他 Agent
   * @param request - 委托请求
   * @returns 委托结果
   */
  delegate(request: DelegateRequest): Promise<DelegateResult>;
}

// ==================== 并行执行引擎接口 ====================

/**
 * 步骤执行批次
 *
 * DAG 分析后，将步骤分组为可并行执行的批次。
 */
export interface ExecutionBatch {
  /** 批次编号（从 0 开始） */
  batchIndex: number;
  /** 本批次包含的步骤 ID 列表 */
  stepIds: number[];
}

/**
 * 并行执行引擎接口
 */
export interface IParallelExecuteEngine {
  /**
   * 分析 PlanStep[] 的依赖关系，生成执行批次
   * @param steps - 执行步骤列表
   * @returns 按依赖顺序排列的执行批次
   */
  analyzeDependencies(steps: Array<{ id: number; dependsOn: number[] }>): ExecutionBatch[];
}
