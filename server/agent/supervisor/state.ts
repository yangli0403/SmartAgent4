/**
 * Supervisor Agent 状态定义
 *
 * 定义顶层 Supervisor 图的状态结构，包含任务分类、执行计划、
 * 步骤结果和用户上下文等信息。
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

// ==================== 任务分类 ====================

/**
 * 任务所属领域（分类节点输出）。
 * 内置：navigation | multimedia | file_system | general | cross_domain；
 * 亦可与 Agent Card 的 `domain` 对齐为任意非空字符串（由注册表动态校验）。
 */
export type TaskDomain = string;

/** 任务复杂度 */
export type TaskComplexity = "simple" | "moderate" | "complex";

/** Supervisor 对用户输入的分类结果 */
export interface TaskClassification {
  /** 任务所属领域 */
  domain: TaskDomain;
  /** 任务复杂度 */
  complexity: TaskComplexity;
  /** 分类推理过程 */
  reasoning: string;
  /** 需要调用的 Agent 列表 */
  requiredAgents: string[];
}

// ==================== 执行计划 ====================

/** 单个执行步骤 */
export interface PlanStep {
  /** 步骤 ID（从 1 开始） */
  id: number;
  /** 步骤描述（自然语言） */
  description: string;
  /** 执行该步骤的目标 Agent（动态字符串，运行时通过 AgentCardRegistry 验证） */
  targetAgent: string;
  /** 预期使用的工具名称列表 */
  expectedTools: string[];
  /** 依赖的前置步骤 ID 列表 */
  dependsOn: number[];
  /** 从前置步骤结果中提取的输入映射 */
  inputMapping: Record<string, string>;
}

/** 完整的执行计划 */
export interface ExecutionPlan {
  /** 任务目标描述 */
  goal: string;
  /** 有序的执行步骤 */
  steps: PlanStep[];
  /** 预估复杂度 */
  estimatedComplexity: TaskComplexity;
}

// ==================== 步骤执行结果 ====================

/** 单个步骤的执行状态 */
export type StepStatus = "success" | "error" | "timeout" | "skipped";

/** 单个步骤的执行结果 */
export interface StepResult {
  /** 对应的步骤 ID */
  stepId: number;
  /** 执行状态 */
  status: StepStatus;
  /** 执行结果（成功时） */
  output?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 工具调用记录 */
  toolCalls?: ToolCallRecord[];
}

/** 工具调用记录 */
export interface ToolCallRecord {
  /** 工具名称 */
  toolName: string;
  /** 工具所属 MCP Server */
  serverId: string;
  /** 输入参数 */
  input: Record<string, unknown>;
  /** 输出结果 */
  output: unknown;
  /** 执行状态 */
  status: "success" | "error" | "timeout";
  /** 执行耗时（毫秒） */
  durationMs: number;
}

// ==================== Replan 决策 ====================

/** Replanner 的决策类型 */
export type ReplanAction = "continue" | "replan" | "complete" | "abort";

/** Replanner 的决策结果 */
export interface ReplanDecision {
  /** 决策动作 */
  action: ReplanAction;
  /** 决策推理过程 */
  reasoning: string;
  /** 更新后的计划（仅当 action='replan' 时） */
  updatedPlan?: PlanStep[];
  /** 最终回复（仅当 action='complete' 时） */
  finalResponse?: string;
  /** 中止原因（仅当 action='abort' 时） */
  abortReason?: string;
}

// ==================== 用户上下文 ====================

/** 用户地理位置 */
export interface UserLocation {
  /** 纬度 */
  latitude: number;
  /** 经度 */
  longitude: number;
  /** 城市 */
  city?: string;
  /** 详细地址 */
  address?: string;
}

/** 用户上下文信息 */
export interface UserContext {
  /** 用户 ID */
  userId: string;
  /** 会话 ID */
  sessionId: string;
  /** 地理位置 */
  location?: UserLocation;
  /** 当前时间（ISO 格式） */
  currentTime: string;
  /** 时区 */
  timezone: string;
  /** 操作系统平台 */
  platform: "windows" | "mac" | "linux";
  /** 性格模式 */
  personality: string;
  /** 回答风格 */
  responseStyle: string;
}

// ==================== Supervisor 图状态 ====================

/**
 * Supervisor 图的状态注解
 *
 * 使用 LangGraph Annotation 定义，支持状态的增量更新。
 * SmartAgent3 增强：新增 dynamicSystemPrompt、retrievedMemories、characterId 字段。
 */
export const SupervisorState = Annotation.Root({
  /** 消息历史（LangGraph 标准消息流） */
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),

  /** 任务分类结果 */
  taskClassification: Annotation<TaskClassification | null>({
    reducer: (_existing, incoming) => incoming,
    default: () => null,
  }),

  /** 执行计划 */
  plan: Annotation<PlanStep[]>({
    reducer: (_existing, incoming) => incoming,
    default: () => [],
  }),

  /** 当前执行的步骤索引 */
  currentStepIndex: Annotation<number>({
    reducer: (_existing, incoming) => incoming,
    default: () => 0,
  }),

  /** 已完成步骤的结果列表 */
  stepResults: Annotation<StepResult[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),

  /** 最终回复文本 */
  finalResponse: Annotation<string>({
    reducer: (_existing, incoming) => incoming,
    default: () => "",
  }),

  /** 用户上下文 */
  context: Annotation<UserContext | null>({
    reducer: (_existing, incoming) => incoming,
    default: () => null,
  }),

  // ==================== SmartAgent3 增强字段 ====================

  /**
   * 动态 System Prompt
   * 由 PersonalityEngine 构建，融合人格+用户画像+记忆+情感指令
   */
  dynamicSystemPrompt: Annotation<string>({
    reducer: (_existing, incoming) => incoming,
    default: () => "",
  }),

  /**
   * 检索到的相关记忆（格式化文本）
   * 由 MemorySystem.getFormattedMemoryContext 生成
   */
  retrievedMemories: Annotation<string[]>({
    reducer: (_existing, incoming) => incoming,
    default: () => [],
  }),

  /**
   * 当前激活的人格 ID
   * 默认为 "xiaozhi"
   */
  characterId: Annotation<string>({
    reducer: (_existing, incoming) => incoming,
    default: () => "xiaozhi",
  }),
});

/** Supervisor 图状态的类型别名 */
export type SupervisorStateType = typeof SupervisorState.State;
