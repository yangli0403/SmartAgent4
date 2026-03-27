/**
 * ParallelExecuteEngine 集成测试
 *
 * 测试 createParallelExecuteNode 和 executeStep 的完整执行流程，
 * 使用 Mock Agent 实例模拟真实执行环境。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createParallelExecuteNode } from "../parallelExecuteEngine";
import { AgentCardRegistry } from "../agentCardRegistry";
import type { AgentCard } from "../types";
import type { DomainAgentInterface } from "../../domains/types";
import type { SupervisorStateType, PlanStep } from "../../supervisor/state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// ==================== 测试辅助函数 ====================

function createTestCard(id: string, domain: string = "general"): AgentCard {
  return {
    id,
    name: `${id} 测试专员`,
    description: `测试用 ${id}`,
    capabilities: ["test"],
    tools: ["tool_a"],
    domain: domain as any,
    implementationClass: "TestAgent",
    llmConfig: { temperature: 0.7, maxTokens: 4096, maxIterations: 5 },
    systemPromptTemplate: "测试",
    enabled: true,
    priority: 50,
  };
}

function createMockAgent(
  name: string,
  output: string = "mock output",
  success: boolean = true
): DomainAgentInterface {
  return {
    name,
    description: `Mock ${name}`,
    availableTools: ["tool_a"],
    execute: vi.fn().mockResolvedValue({
      success,
      output,
      toolCalls: success
        ? [
            {
              toolName: "tool_a",
              serverId: "test",
              input: {},
              output: { result: output },
              status: "success",
              durationMs: 100,
            },
          ]
        : [],
      error: success ? undefined : "执行失败",
    }),
    getSystemPrompt: vi.fn().mockReturnValue("mock prompt"),
    parseStructuredData: vi.fn().mockReturnValue(null),
  };
}

function createMinimalState(
  plan: PlanStep[],
  userMessage: string = "测试请求"
): SupervisorStateType {
  return {
    messages: [new HumanMessage(userMessage)],
    taskClassification: null,
    plan,
    currentStepIndex: 0,
    stepResults: [],
    replanCount: 0,
    maxReplans: 3,
    finalResponse: null,
    context: {
      userId: "test-user",
      sessionId: "test-session",
      currentTime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      platform: "linux",
      personality: "friendly",
      responseStyle: "balanced",
    },
  };
}

// ==================== 测试套件 ====================

describe("createParallelExecuteNode() 集成测试", () => {
  let registry: AgentCardRegistry;

  beforeEach(() => {
    registry = new AgentCardRegistry();
  });

  // ==================== 基本执行 ====================

  it("应能执行单个步骤", async () => {
    const agent = createMockAgent("navAgent", "找到 3 个充电桩");
    registry.register(createTestCard("navAgent", "navigation"), agent);

    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "搜索充电桩",
        targetAgent: "navAgent",
        expectedTools: ["tool_a"],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    const state = createMinimalState(plan);
    const result = await executeNode(state);

    expect(result.stepResults).toBeDefined();
    expect(result.stepResults!.length).toBe(1);
    expect(result.stepResults![0].stepId).toBe(1);
    expect(result.stepResults![0].status).toBe("success");
    expect(result.stepResults![0].output).toBe("找到 3 个充电桩");
  });

  // ==================== 并行执行 ====================

  it("应能并行执行无依赖的多个步骤", async () => {
    const navAgent = createMockAgent("navAgent", "天气：晴");
    const fileAgent = createMockAgent("fileAgent", "文件已创建");

    registry.register(createTestCard("navAgent", "navigation"), navAgent);
    registry.register(createTestCard("fileAgent", "file_system"), fileAgent);

    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "查天气",
        targetAgent: "navAgent",
        expectedTools: ["tool_a"],
        dependsOn: [],
        inputMapping: {},
      },
      {
        id: 2,
        description: "创建文件",
        targetAgent: "fileAgent",
        expectedTools: ["tool_a"],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    const state = createMinimalState(plan);
    const result = await executeNode(state);

    // 两个步骤应该都在同一批次执行
    expect(result.stepResults!.length).toBe(2);
    expect(result.stepResults!.find((r) => r.stepId === 1)?.status).toBe("success");
    expect(result.stepResults!.find((r) => r.stepId === 2)?.status).toBe("success");

    // 验证两个 Agent 都被调用了
    expect(navAgent.execute).toHaveBeenCalledTimes(1);
    expect(fileAgent.execute).toHaveBeenCalledTimes(1);
  });

  // ==================== Agent 不存在 ====================

  it("Agent 不存在时应返回错误结果", async () => {
    // 不注册任何 Agent
    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "搜索",
        targetAgent: "nonexistentAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    const state = createMinimalState(plan);
    const result = await executeNode(state);

    expect(result.stepResults!.length).toBe(1);
    expect(result.stepResults![0].status).toBe("error");
    expect(result.stepResults![0].error).toContain("not found");
  });

  // ==================== 空计划 ====================

  it("空计划应返回空对象", async () => {
    const executeNode = createParallelExecuteNode(registry);
    const state = createMinimalState([]);
    const result = await executeNode(state);

    expect(result).toEqual({});
  });

  // ==================== 所有步骤已完成 ====================

  it("所有步骤已完成时应返回完成状态", async () => {
    const agent = createMockAgent("navAgent");
    registry.register(createTestCard("navAgent"), agent);

    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "搜索",
        targetAgent: "navAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    const state = createMinimalState(plan);
    state.stepResults = [
      { stepId: 1, status: "success", output: "已完成", durationMs: 100 },
    ];

    const result = await executeNode(state);
    expect(result.currentStepIndex).toBe(1); // plan.length
  });

  // ==================== Agent 执行失败 ====================

  it("Agent 执行失败时应返回错误状态", async () => {
    const failAgent = createMockAgent("failAgent", "", false);
    registry.register(createTestCard("failAgent"), failAgent);

    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "会失败的操作",
        targetAgent: "failAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    const state = createMinimalState(plan);
    const result = await executeNode(state);

    expect(result.stepResults!.length).toBe(1);
    expect(result.stepResults![0].status).toBe("error");
  });

  // ==================== Agent 抛出异常 ====================

  it("Agent 抛出异常时应被捕获并返回错误", async () => {
    const throwAgent: DomainAgentInterface = {
      name: "throwAgent",
      description: "会抛异常的 Agent",
      availableTools: [],
      execute: vi.fn().mockRejectedValue(new Error("网络超时")),
      getSystemPrompt: vi.fn().mockReturnValue(""),
      parseStructuredData: vi.fn().mockReturnValue(null),
    };
    registry.register(createTestCard("throwAgent"), throwAgent);

    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "会异常的操作",
        targetAgent: "throwAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
    ];

    const state = createMinimalState(plan);
    const result = await executeNode(state);

    expect(result.stepResults!.length).toBe(1);
    expect(result.stepResults![0].status).toBe("error");
    expect(result.stepResults![0].error).toBe("网络超时");
  });

  // ==================== inputMapping 解析 ====================

  it("应正确解析 inputMapping 并传递给 Agent", async () => {
    const agent = createMockAgent("generalAgent", "汇总完成");
    registry.register(createTestCard("generalAgent"), agent);

    const executeNode = createParallelExecuteNode(registry);
    const plan: PlanStep[] = [
      {
        id: 1,
        description: "搜索",
        targetAgent: "generalAgent",
        expectedTools: [],
        dependsOn: [],
        inputMapping: {},
      },
      {
        id: 2,
        description: "汇总",
        targetAgent: "generalAgent",
        expectedTools: [],
        dependsOn: [1],
        inputMapping: { searchResult: "step_1.output" },
      },
    ];

    // 模拟第一步已完成
    const state = createMinimalState(plan);
    state.stepResults = [
      { stepId: 1, status: "success", output: "搜索结果数据", durationMs: 100 },
    ];

    const result = await executeNode(state);

    expect(result.stepResults!.length).toBe(1);
    expect(result.stepResults![0].stepId).toBe(2);

    // 验证 agent.execute 被调用时传入了解析后的 inputMapping
    const executeCall = (agent.execute as any).mock.calls[0][0];
    expect(executeCall.resolvedInputs.searchResult).toBe("搜索结果数据");
  });
});
