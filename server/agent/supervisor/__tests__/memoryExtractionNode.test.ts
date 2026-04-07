/**
 * MemoryExtractionNode 单元测试
 *
 * 测试记忆提取节点的降级开关行为：
 * - AUTO_EXTRACTION_ENABLED = false 时，跳过 LLM 提取管道
 * - 工作记忆更新始终执行
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { SupervisorStateType } from "../state";

// ==================== Mock 底层模块 ====================

const mockExtractMemoriesFromConversation = vi.fn();
const mockAppendWorkingMemory = vi.fn();
const mockDetectAndPersistPatterns = vi.fn();

vi.mock("../../../memory/memorySystem", () => ({
  extractMemoriesFromConversation: (...args: unknown[]) =>
    mockExtractMemoriesFromConversation(...args),
  appendWorkingMemory: (...args: unknown[]) =>
    mockAppendWorkingMemory(...args),
}));

vi.mock("../../../memory/behaviorDetector", () => ({
  detectAndPersistPatterns: (...args: unknown[]) =>
    mockDetectAndPersistPatterns(...args),
}));

// ==================== 辅助函数 ====================

function createMockState(
  overrides: Partial<SupervisorStateType> = {}
): SupervisorStateType {
  return {
    messages: overrides.messages || [
      new HumanMessage("帮我规划一条从北京到上海的路线"),
      new AIMessage("好的，我来帮你规划路线。"),
    ],
    taskClassification: overrides.taskClassification || null,
    plan: overrides.plan || [],
    currentStepIndex: overrides.currentStepIndex || 0,
    stepResults: overrides.stepResults || [],
    finalResponse: overrides.finalResponse || "路线规划完成",
    context: overrides.context || {
      userId: "1",
      sessionId: "test-session",
    },
  };
}

// ==================== 测试 ====================

describe("MemoryExtractionNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置模块缓存以支持环境变量切换
    vi.resetModules();
  });

  describe("AUTO_EXTRACTION_ENABLED = false（默认）", () => {
    it("应跳过 extractMemoriesFromConversation 调用", async () => {
      // 确保环境变量未设置
      delete process.env.MEMORY_AUTO_EXTRACTION;

      // 解耦后行为检测基于对话计数器触发
      mockDetectAndPersistPatterns.mockResolvedValue(undefined);

      const { memoryExtractionNode } = await import(
        "../memoryExtractionNode"
      );

      const state = createMockState();
      await memoryExtractionNode(state);

      // 不应调用 LLM 提取
      expect(mockExtractMemoriesFromConversation).not.toHaveBeenCalled();
      // 行为检测基于对话计数器，第1轮不会触发（阈值默认=10）
      expect(mockDetectAndPersistPatterns).not.toHaveBeenCalled();
    });

    it("应在达到对话轮数阈值时触发行为检测", async () => {
      delete process.env.MEMORY_AUTO_EXTRACTION;
      process.env.BEHAVIOR_DETECTION_THRESHOLD = "3";

      mockDetectAndPersistPatterns.mockResolvedValue(undefined);

      const { memoryExtractionNode } = await import(
        "../memoryExtractionNode"
      );

      const state = createMockState();

      // 第1轮和第2轮不触发
      await memoryExtractionNode(state);
      await memoryExtractionNode(state);
      expect(mockDetectAndPersistPatterns).not.toHaveBeenCalled();

      // 第3轮触发
      await memoryExtractionNode(state);
      expect(mockDetectAndPersistPatterns).toHaveBeenCalledTimes(1);

      // 清理
      delete process.env.BEHAVIOR_DETECTION_THRESHOLD;
    });

    it("应始终更新工作记忆", async () => {
      delete process.env.MEMORY_AUTO_EXTRACTION;

      mockDetectAndPersistPatterns.mockResolvedValue(undefined);

      const { memoryExtractionNode } = await import(
        "../memoryExtractionNode"
      );

      const state = createMockState();
      await memoryExtractionNode(state);

      // 应更新工作记忆（用户消息 + 最终回复 = 2 次）
      expect(mockAppendWorkingMemory).toHaveBeenCalledTimes(2);
    });

    it("应返回空对象（不修改状态）", async () => {
      delete process.env.MEMORY_AUTO_EXTRACTION;

      mockDetectAndPersistPatterns.mockResolvedValue(undefined);

      const { memoryExtractionNode } = await import(
        "../memoryExtractionNode"
      );

      const state = createMockState();
      const result = await memoryExtractionNode(state);

      expect(result).toEqual({});
    });
  });

  describe("AUTO_EXTRACTION_ENABLED = true", () => {
    it("应调用 extractMemoriesFromConversation", async () => {
      process.env.MEMORY_AUTO_EXTRACTION = "true";

      mockExtractMemoriesFromConversation.mockResolvedValue([
        { kind: "episodic", type: "fact", content: "测试记忆", importance: 0.7, confidence: 0.8 },
      ]);
      mockDetectAndPersistPatterns.mockResolvedValue(undefined);

      const { memoryExtractionNode } = await import(
        "../memoryExtractionNode"
      );

      const state = createMockState();
      await memoryExtractionNode(state);

      // 等待异步 fire-and-forget 完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockExtractMemoriesFromConversation).toHaveBeenCalledTimes(1);

      // 清理
      delete process.env.MEMORY_AUTO_EXTRACTION;
    });
  });

  describe("无 userId 场景", () => {
    it("userId 为空时应跳过所有操作", async () => {
      delete process.env.MEMORY_AUTO_EXTRACTION;

      const { memoryExtractionNode } = await import(
        "../memoryExtractionNode"
      );

      const state = createMockState({
        context: { userId: "", sessionId: "test" },
      });
      const result = await memoryExtractionNode(state);

      expect(result).toEqual({});
      expect(mockAppendWorkingMemory).not.toHaveBeenCalled();
      expect(mockExtractMemoriesFromConversation).not.toHaveBeenCalled();
    });
  });
});
