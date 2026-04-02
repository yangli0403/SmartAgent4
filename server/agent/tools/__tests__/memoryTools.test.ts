/**
 * Memory Tools 单元测试
 *
 * 测试四个记忆技能工具的参数校验、正常调用和错误处理。
 * 底层 memorySystem 函数通过 vi.mock 模拟。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  callMemoryTool,
  registerMemoryTools,
  MEMORY_TOOLS_SERVER_ID,
} from "../memoryTools";

// ==================== Mock 底层 memorySystem ====================

const mockAddMemory = vi.fn();
const mockSearchMemories = vi.fn();
const mockUpdateMemory = vi.fn();
const mockDeleteMemory = vi.fn();

vi.mock("../../../memory/memorySystem", () => ({
  addMemory: (...args: unknown[]) => mockAddMemory(...args),
  searchMemories: (...args: unknown[]) => mockSearchMemories(...args),
  updateMemory: (...args: unknown[]) => mockUpdateMemory(...args),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
}));

// ==================== Mock ToolRegistry ====================

const mockRegister = vi.fn();
const mockToolRegistry = {
  register: mockRegister,
};

// ==================== 测试 ====================

describe("MemoryTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== registerMemoryTools ====================

  describe("registerMemoryTools", () => {
    it("应注册 4 个记忆工具到 ToolRegistry", () => {
      registerMemoryTools(mockToolRegistry as any);
      expect(mockRegister).toHaveBeenCalledTimes(4);
    });

    it("注册的工具名称应正确", () => {
      registerMemoryTools(mockToolRegistry as any);
      const registeredNames = mockRegister.mock.calls.map(
        (call: any[]) => call[0].name
      );
      expect(registeredNames).toContain("memory_store");
      expect(registeredNames).toContain("memory_search");
      expect(registeredNames).toContain("memory_update");
      expect(registeredNames).toContain("memory_forget");
    });

    it("所有工具的 serverId 应为 MEMORY_TOOLS_SERVER_ID", () => {
      registerMemoryTools(mockToolRegistry as any);
      for (const call of mockRegister.mock.calls) {
        expect(call[0].serverId).toBe(MEMORY_TOOLS_SERVER_ID);
      }
    });

    it("所有工具应有 inputSchema 定义", () => {
      registerMemoryTools(mockToolRegistry as any);
      for (const call of mockRegister.mock.calls) {
        expect(call[0].inputSchema).toBeDefined();
        expect(call[0].inputSchema.type).toBe("object");
        expect(call[0].inputSchema.properties).toBeDefined();
      }
    });
  });

  // ==================== memory_store ====================

  describe("memory_store", () => {
    it("参数正确时应成功存储记忆", async () => {
      mockAddMemory.mockResolvedValue({
        id: 42,
        type: "fact",
        kind: "episodic",
        content: "用户喜欢吃川菜",
      });

      const result = await callMemoryTool("memory_store", {
        userId: 1,
        content: "用户喜欢吃川菜",
        type: "fact",
        kind: "episodic",
        tags: ["饮食", "偏好"],
        importance: 0.8,
        confidence: 0.9,
      });

      expect(result).toContain("记忆存储成功");
      expect(result).toContain("ID: 42");
      expect(mockAddMemory).toHaveBeenCalledTimes(1);
      const callArg = mockAddMemory.mock.calls[0][0];
      expect(callArg.userId).toBe(1);
      expect(callArg.content).toBe("用户喜欢吃川菜");
      expect(callArg.type).toBe("fact");
      expect(callArg.source).toBe("agent_skill");
    });

    it("userId 无效时应返回错误", async () => {
      const result = await callMemoryTool("memory_store", {
        userId: 0,
        content: "测试内容",
        type: "fact",
      });
      expect(result).toContain("错误");
      expect(result).toContain("userId");
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    it("content 为空时应返回错误", async () => {
      const result = await callMemoryTool("memory_store", {
        userId: 1,
        content: "",
        type: "fact",
      });
      expect(result).toContain("错误");
      expect(result).toContain("content");
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    it("type 无效时应返回错误", async () => {
      const result = await callMemoryTool("memory_store", {
        userId: 1,
        content: "测试内容",
        type: "invalid_type",
      });
      expect(result).toContain("错误");
      expect(result).toContain("type");
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    it("kind 无效时应返回错误", async () => {
      const result = await callMemoryTool("memory_store", {
        userId: 1,
        content: "测试内容",
        type: "fact",
        kind: "invalid_kind",
      });
      expect(result).toContain("错误");
      expect(result).toContain("kind");
      expect(mockAddMemory).not.toHaveBeenCalled();
    });

    it("importance 应被裁剪到 [0, 1] 范围", async () => {
      mockAddMemory.mockResolvedValue({
        id: 1,
        type: "fact",
        kind: "episodic",
        content: "test",
      });

      await callMemoryTool("memory_store", {
        userId: 1,
        content: "测试内容",
        type: "fact",
        importance: 1.5,
        confidence: -0.5,
      });

      const callArg = mockAddMemory.mock.calls[0][0];
      expect(callArg.importance).toBe(1);
      expect(callArg.confidence).toBe(0);
    });

    it("数据库返回 null 时应提示失败", async () => {
      mockAddMemory.mockResolvedValue(null);

      const result = await callMemoryTool("memory_store", {
        userId: 1,
        content: "测试内容",
        type: "fact",
      });
      expect(result).toContain("存储失败");
    });

    it("数据库抛异常时应返回错误信息", async () => {
      mockAddMemory.mockRejectedValue(new Error("DB connection failed"));

      const result = await callMemoryTool("memory_store", {
        userId: 1,
        content: "测试内容",
        type: "fact",
      });
      expect(result).toContain("存储失败");
      expect(result).toContain("DB connection failed");
    });
  });

  // ==================== memory_search ====================

  describe("memory_search", () => {
    it("参数正确时应返回格式化的搜索结果", async () => {
      mockSearchMemories.mockResolvedValue([
        {
          id: 10,
          kind: "episodic",
          type: "fact",
          content: "用户住在北京朝阳区",
          tags: ["住址"],
          createdAt: new Date("2026-01-15"),
        },
        {
          id: 11,
          kind: "semantic",
          type: "preference",
          content: "用户偏好中式餐厅",
          tags: null,
          createdAt: new Date("2026-02-20"),
        },
      ]);

      const result = await callMemoryTool("memory_search", {
        userId: 1,
        query: "住址",
      });

      expect(result).toContain("找到 2 条相关记忆");
      expect(result).toContain("[ID:10]");
      expect(result).toContain("用户住在北京朝阳区");
      expect(result).toContain("[ID:11]");
      expect(mockSearchMemories).toHaveBeenCalledTimes(1);
      const callArg = mockSearchMemories.mock.calls[0][0];
      expect(callArg.userId).toBe(1);
      expect(callArg.query).toBe("住址");
      expect(callArg.useHybridSearch).toBe(true);
    });

    it("无搜索结果时应提示未找到", async () => {
      mockSearchMemories.mockResolvedValue([]);

      const result = await callMemoryTool("memory_search", {
        userId: 1,
        query: "不存在的内容",
      });
      expect(result).toContain("未找到");
    });

    it("userId 无效时应返回错误", async () => {
      const result = await callMemoryTool("memory_search", {
        userId: -1,
        query: "测试",
      });
      expect(result).toContain("错误");
      expect(mockSearchMemories).not.toHaveBeenCalled();
    });

    it("query 为空时应返回错误", async () => {
      const result = await callMemoryTool("memory_search", {
        userId: 1,
        query: "",
      });
      expect(result).toContain("错误");
      expect(mockSearchMemories).not.toHaveBeenCalled();
    });

    it("limit 应被裁剪到 [1, 50] 范围", async () => {
      mockSearchMemories.mockResolvedValue([]);

      await callMemoryTool("memory_search", {
        userId: 1,
        query: "测试",
        limit: 100,
      });

      const callArg = mockSearchMemories.mock.calls[0][0];
      expect(callArg.limit).toBe(50);
    });
  });

  // ==================== memory_update ====================

  describe("memory_update", () => {
    it("参数正确时应成功更新记忆", async () => {
      mockUpdateMemory.mockResolvedValue(true);

      const result = await callMemoryTool("memory_update", {
        memoryId: 42,
        content: "用户搬到了上海浦东",
        importance: 0.9,
      });

      expect(result).toContain("更新成功");
      expect(result).toContain("ID:42");
      expect(mockUpdateMemory).toHaveBeenCalledTimes(1);
      expect(mockUpdateMemory.mock.calls[0][0]).toBe(42);
      expect(mockUpdateMemory.mock.calls[0][1].content).toBe("用户搬到了上海浦东");
    });

    it("memoryId 无效时应返回错误", async () => {
      const result = await callMemoryTool("memory_update", {
        memoryId: 0,
        content: "新内容",
      });
      expect(result).toContain("错误");
      expect(mockUpdateMemory).not.toHaveBeenCalled();
    });

    it("没有提供任何更新字段时应返回错误", async () => {
      const result = await callMemoryTool("memory_update", {
        memoryId: 42,
      });
      expect(result).toContain("错误");
      expect(result).toContain("至少需要提供一个");
      expect(mockUpdateMemory).not.toHaveBeenCalled();
    });

    it("数据库返回 false 时应提示失败", async () => {
      mockUpdateMemory.mockResolvedValue(false);

      const result = await callMemoryTool("memory_update", {
        memoryId: 999,
        content: "新内容",
      });
      expect(result).toContain("更新失败");
    });
  });

  // ==================== memory_forget ====================

  describe("memory_forget", () => {
    it("参数正确时应成功删除记忆", async () => {
      mockDeleteMemory.mockResolvedValue(true);

      const result = await callMemoryTool("memory_forget", {
        memoryId: 42,
        reason: "用户要求遗忘",
      });

      expect(result).toContain("已成功删除");
      expect(result).toContain("ID:42");
      expect(result).toContain("用户要求遗忘");
      expect(mockDeleteMemory).toHaveBeenCalledWith(42);
    });

    it("memoryId 无效时应返回错误", async () => {
      const result = await callMemoryTool("memory_forget", {
        memoryId: -1,
      });
      expect(result).toContain("错误");
      expect(mockDeleteMemory).not.toHaveBeenCalled();
    });

    it("数据库返回 false 时应提示失败", async () => {
      mockDeleteMemory.mockResolvedValue(false);

      const result = await callMemoryTool("memory_forget", {
        memoryId: 999,
      });
      expect(result).toContain("删除失败");
    });
  });

  // ==================== callMemoryTool 分发 ====================

  describe("callMemoryTool 分发", () => {
    it("未知工具名应抛出错误", async () => {
      await expect(
        callMemoryTool("memory_unknown", { userId: 1 })
      ).rejects.toThrow("未知的记忆工具");
    });
  });
});
