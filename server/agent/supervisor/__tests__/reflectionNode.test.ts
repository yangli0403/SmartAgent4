/**
 * Reflection Node — 反思节点单元测试
 *
 * 测试 Phase 4 新增的自进化闭环核心组件：
 * - reflectionNode 的跳过逻辑（无工具调用时跳过）
 * - reflectionNode 的触发逻辑（有工具调用时异步执行）
 * - buildReflectionInput 的输出格式
 * - PromptPatch 接口定义
 *
 * 注意：reflectionNode 内部的 LLM 调用和数据库写入属于集成测试范围，
 * 此处通过 mock 隔离外部依赖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ==================== Mock 外部依赖 ====================

// Mock LLM 调用
vi.mock("../../llm/langchainAdapter", () => ({
  callLLMText: vi.fn().mockResolvedValue(
    JSON.stringify({
      qualityScore: 0.8,
      summary: "执行质量良好",
      promptPatchNeeded: false,
    })
  ),
}));

// Mock 数据库
vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// Mock schema（避免 drizzle 初始化）
vi.mock("../../../drizzle/schema", () => ({
  toolUtilityLogs: {},
  promptVersions: {},
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
}));

// Mock SmartAgentApp
vi.mock("../smartAgentApp", () => ({
  getSmartAgentApp: vi.fn().mockReturnValue({
    getToolRegistry: vi.fn().mockReturnValue({
      updateUtility: vi.fn(),
    }),
  }),
}));

import { reflectionNode } from "../reflectionNode";
import type { SupervisorStateType } from "../state";
import type { StepResult, ToolCallRecord } from "../state";
import { HumanMessage } from "@langchain/core/messages";

// ==================== 辅助函数 ====================

function createMockState(
  overrides: Partial<SupervisorStateType> = {}
): SupervisorStateType {
  return {
    messages: overrides.messages || [new HumanMessage("测试消息")],
    taskClassification: overrides.taskClassification || {
      domain: "general",
      complexity: "simple",
      reasoning: "测试",
      requiredAgents: ["generalAgent"],
    },
    plan: overrides.plan || [],
    currentStepIndex: overrides.currentStepIndex || 0,
    stepResults: overrides.stepResults || [],
    finalResponse: overrides.finalResponse || "测试回复",
    context: overrides.context || {
      userId: "1",
      sessionId: "test-session",
      currentTime: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      platform: "windows",
      personality: "xiaozhi",
      responseStyle: "friendly",
    },
    dynamicSystemPrompt: overrides.dynamicSystemPrompt || "",
    retrievedMemories: overrides.retrievedMemories || [],
    characterId: overrides.characterId || "xiaozhi",
  };
}

function createToolCallRecord(
  overrides: Partial<ToolCallRecord> = {}
): ToolCallRecord {
  return {
    toolName: overrides.toolName || "test_tool",
    serverId: overrides.serverId || "server-1",
    input: overrides.input || {},
    output: overrides.output || "success result",
    status: overrides.status || "success",
    durationMs: overrides.durationMs || 150,
  };
}

function createStepResult(
  overrides: Partial<StepResult> = {}
): StepResult {
  return {
    stepId: overrides.stepId || 1,
    status: overrides.status || "success",
    output: overrides.output || "步骤完成",
    error: overrides.error,
    durationMs: overrides.durationMs || 500,
    toolCalls: overrides.toolCalls || [],
  };
}

// ==================== 测试 ====================

describe("ReflectionNode — 反思节点", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("跳过逻辑", () => {
    it("没有步骤结果时应跳过反思，返回空对象", async () => {
      const state = createMockState({ stepResults: [] });
      const result = await reflectionNode(state);
      expect(result).toEqual({});
    });

    it("步骤结果中没有工具调用时应跳过反思", async () => {
      const state = createMockState({
        stepResults: [createStepResult({ toolCalls: [] })],
      });
      const result = await reflectionNode(state);
      expect(result).toEqual({});
    });

    it("步骤结果中 toolCalls 为 undefined 时应跳过反思", async () => {
      const state = createMockState({
        stepResults: [createStepResult({ toolCalls: undefined })],
      });
      const result = await reflectionNode(state);
      expect(result).toEqual({});
    });
  });

  describe("触发逻辑", () => {
    it("有工具调用时应触发反思（fire-and-forget），返回空对象", async () => {
      const state = createMockState({
        stepResults: [
          createStepResult({
            toolCalls: [createToolCallRecord({ toolName: "search_files" })],
          }),
        ],
      });
      const result = await reflectionNode(state);
      // reflectionNode 始终返回空对象（不修改状态）
      expect(result).toEqual({});
    });

    it("多个步骤中有工具调用时应触发反思", async () => {
      const state = createMockState({
        stepResults: [
          createStepResult({ stepId: 1, toolCalls: [] }),
          createStepResult({
            stepId: 2,
            toolCalls: [
              createToolCallRecord({ toolName: "navigate" }),
              createToolCallRecord({ toolName: "search_poi" }),
            ],
          }),
        ],
      });
      const result = await reflectionNode(state);
      expect(result).toEqual({});
    });
  });

  describe("状态不变性", () => {
    it("reflectionNode 不应修改 SupervisorState", async () => {
      const state = createMockState({
        stepResults: [
          createStepResult({
            toolCalls: [createToolCallRecord()],
          }),
        ],
        finalResponse: "原始回复",
        characterId: "xiaozhi",
      });

      const result = await reflectionNode(state);

      // 返回空对象，不修改任何状态字段
      expect(result).toEqual({});
      expect(Object.keys(result)).toHaveLength(0);

      // 原始状态不应被修改
      expect(state.finalResponse).toBe("原始回复");
      expect(state.characterId).toBe("xiaozhi");
    });
  });
});

// ==================== buildReflectionInput 逻辑测试 ====================
// 由于 buildReflectionInput 是模块私有函数，我们复制其逻辑进行独立测试

function buildReflectionInput(
  stepResults: StepResult[],
  allToolCalls: ToolCallRecord[],
  taskClassification: any,
  finalResponse: string
): string {
  const parts: string[] = [];

  parts.push(`## 任务分类`);
  parts.push(`- 领域: ${taskClassification?.domain || "unknown"}`);
  parts.push(`- 复杂度: ${taskClassification?.complexity || "unknown"}`);

  parts.push(`\n## 执行步骤 (${stepResults.length} 步)`);
  for (const result of stepResults) {
    parts.push(
      `- Step ${result.stepId}: ${result.status} (${result.durationMs}ms)` +
        (result.error ? ` — Error: ${result.error}` : "")
    );
  }

  parts.push(`\n## 工具调用 (${allToolCalls.length} 次)`);
  for (const tc of allToolCalls) {
    parts.push(
      `- ${tc.toolName}: ${tc.status} (${tc.durationMs}ms)` +
        (tc.status !== "success"
          ? ` — ${String(tc.output).substring(0, 200)}`
          : "")
    );
  }

  parts.push(`\n## 最终回复 (前 500 字)`);
  parts.push(finalResponse.substring(0, 500));

  return parts.join("\n");
}

describe("buildReflectionInput — 反思输入构建", () => {
  it("应包含任务分类信息", () => {
    const input = buildReflectionInput(
      [],
      [],
      { domain: "navigation", complexity: "complex" },
      ""
    );
    expect(input).toContain("navigation");
    expect(input).toContain("complex");
  });

  it("应包含步骤执行信息", () => {
    const stepResults: StepResult[] = [
      createStepResult({ stepId: 1, status: "success", durationMs: 200 }),
      createStepResult({
        stepId: 2,
        status: "error",
        durationMs: 5000,
        error: "连接超时",
      }),
    ];
    const input = buildReflectionInput(stepResults, [], {}, "");
    expect(input).toContain("Step 1: success (200ms)");
    expect(input).toContain("Step 2: error (5000ms)");
    // buildReflectionInput 中 error 字段仅在 result.error 存在时追加
    expect(input).toContain("Error: 连接超时");
  });

  it("应包含工具调用信息", () => {
    const toolCalls: ToolCallRecord[] = [
      createToolCallRecord({
        toolName: "search_files",
        status: "success",
        durationMs: 100,
      }),
      createToolCallRecord({
        toolName: "navigate",
        status: "error",
        durationMs: 3000,
        output: "API rate limit exceeded",
      }),
    ];
    const input = buildReflectionInput([], toolCalls, {}, "");
    expect(input).toContain("search_files: success (100ms)");
    expect(input).toContain("navigate: error (3000ms)");
    expect(input).toContain("API rate limit exceeded");
  });

  it("应截断过长的最终回复", () => {
    const longResponse = "a".repeat(1000);
    const input = buildReflectionInput([], [], {}, longResponse);
    // 应只包含前 500 字
    const responseSection = input.split("## 最终回复 (前 500 字)")[1];
    expect(responseSection.trim().length).toBe(500);
  });

  it("taskClassification 为 null 时应使用 unknown", () => {
    const input = buildReflectionInput([], [], null, "");
    expect(input).toContain("领域: unknown");
    expect(input).toContain("复杂度: unknown");
  });
});
