/**
 * MemoryWorkerManager 单元测试
 *
 * 测试后台"做梦"Worker 管理器的核心逻辑：
 * - 消息触发做梦
 * - 异步任务执行
 * - 事件通知
 * - 统计信息
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MemoryWorkerManager,
  resetMemoryWorkerManager,
  type TaskExecutor,
} from "../memoryWorkerManager";
import type { MemoryWorkerResponse } from "../types";

// ==================== 辅助函数 ====================

function createMockExecutor(
  result: any = { type: "consolidate" },
  delay: number = 10
): TaskExecutor {
  return vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return result;
  });
}

function createFailingExecutor(errorMsg: string = "Test error"): TaskExecutor {
  return vi.fn(async () => {
    throw new Error(errorMsg);
  });
}

/**
 * 等待事件被触发
 */
function waitForEvent(
  manager: MemoryWorkerManager,
  event: string,
  timeout: number = 2000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Event timeout")), timeout);
    manager.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ==================== 测试套件 ====================

describe("MemoryWorkerManager", () => {
  beforeEach(() => {
    resetMemoryWorkerManager();
  });

  // ==================== 基本功能 ====================

  describe("基本功能", () => {
    it("应能创建实例", () => {
      const manager = new MemoryWorkerManager();
      expect(manager).toBeDefined();
      expect(manager.getStats().activeWorkers).toBe(0);
    });

    it("startDream 应返回任务 ID", async () => {
      const executor = createMockExecutor();
      const manager = new MemoryWorkerManager({}, executor);

      const taskId = await manager.startDream(1);
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe("string");
      expect(taskId.length).toBeGreaterThan(0);

      manager.stop();
    });

    it("startDream 应触发异步执行", async () => {
      const executor = createMockExecutor();
      const manager = new MemoryWorkerManager({}, executor);

      const eventPromise = waitForEvent(manager, "dreamCompleted");
      await manager.startDream(1);

      const response: MemoryWorkerResponse = await eventPromise;
      expect(response.success).toBe(true);
      expect(executor).toHaveBeenCalledTimes(1);

      manager.stop();
    });
  });

  // ==================== 消息触发 ====================

  describe("消息触发", () => {
    it("消息数量达到阈值时应自动触发做梦", async () => {
      const executor = createMockExecutor();
      const manager = new MemoryWorkerManager(
        { messageThreshold: 3, timeThresholdMs: 999999999 },
        executor
      );

      // 先标记一次做梦完成，避免时间门控干扰
      manager.getGatekeeper().markDreamCompleted(1);

      const eventPromise = waitForEvent(manager, "dreamCompleted");

      // 发送 3 条消息
      await manager.onUserMessage(1);
      await manager.onUserMessage(1);
      await manager.onUserMessage(1);

      const response = await eventPromise;
      expect(response.success).toBe(true);
      expect(executor).toHaveBeenCalled();

      manager.stop();
    });

    it("消息数量未达到阈值时不应触发做梦", async () => {
      const executor = createMockExecutor();
      const manager = new MemoryWorkerManager(
        { messageThreshold: 5, timeThresholdMs: 999999999 },
        executor
      );

      // 先标记一次做梦完成
      manager.getGatekeeper().markDreamCompleted(1);

      await manager.onUserMessage(1);
      await manager.onUserMessage(1);

      // 等待一小段时间确认没有触发
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(executor).not.toHaveBeenCalled();

      manager.stop();
    });
  });

  // ==================== 错误处理 ====================

  describe("错误处理", () => {
    it("任务失败时应触发事件并记录失败", async () => {
      const executor = createFailingExecutor("Dream failed");
      const manager = new MemoryWorkerManager({}, executor);

      const eventPromise = waitForEvent(manager, "dreamCompleted");
      await manager.startDream(1);

      const response: MemoryWorkerResponse = await eventPromise;
      expect(response.success).toBe(false);
      expect(response.error).toBe("Dream failed");

      const stats = manager.getStats();
      expect(stats.failedTasks).toBe(1);

      manager.stop();
    });

    it("任务失败后应重置用户做梦状态", async () => {
      const executor = createFailingExecutor();
      const manager = new MemoryWorkerManager({}, executor);

      const eventPromise = waitForEvent(manager, "dreamCompleted");
      await manager.startDream(1);
      await eventPromise;

      const state = manager.getGatekeeper().getUserState(1);
      expect(state?.isDreaming).toBe(false);

      manager.stop();
    });
  });

  // ==================== 统计信息 ====================

  describe("统计信息", () => {
    it("应正确统计完成的任务数", async () => {
      const executor = createMockExecutor();
      const manager = new MemoryWorkerManager({}, executor);

      const event1 = waitForEvent(manager, "dreamCompleted");
      await manager.startDream(1);
      await event1;

      const event2 = waitForEvent(manager, "dreamCompleted");
      await manager.startDream(2);
      await event2;

      const stats = manager.getStats();
      expect(stats.completedTasks).toBe(2);
      expect(stats.failedTasks).toBe(0);
      expect(stats.activeWorkers).toBe(0);

      manager.stop();
    });
  });

  // ==================== 停止 ====================

  describe("停止", () => {
    it("stop 应清理所有状态", () => {
      const manager = new MemoryWorkerManager();
      manager.getGatekeeper().recordMessage(1);
      manager.stop();

      const stats = manager.getStats();
      expect(stats.activeWorkers).toBe(0);
    });
  });
});
