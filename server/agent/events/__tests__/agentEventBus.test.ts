/**
 * AgentEventBus 单元测试
 *
 * 测试事件总线的核心功能：
 * - 事件发布与订阅
 * - waitForTask 等待机制
 * - 历史记录查询
 * - 超时处理
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AgentEventBus,
  resetAgentEventBus,
} from "../agentEventBus";
import type { TaskCompletedEvent, TaskProgressEvent } from "../types";

// ==================== 辅助函数 ====================

function createCompletedEvent(
  overrides: Partial<TaskCompletedEvent> = {}
): TaskCompletedEvent {
  return {
    taskId: "task-1",
    agentId: "fileAgent",
    parentAgentId: "supervisor",
    success: true,
    output: "Task completed successfully",
    toolCalls: [],
    durationMs: 100,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createProgressEvent(
  overrides: Partial<TaskProgressEvent> = {}
): TaskProgressEvent {
  return {
    taskId: "task-1",
    agentId: "fileAgent",
    message: "Processing...",
    progress: 50,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ==================== 测试套件 ====================

describe("AgentEventBus", () => {
  let eventBus: AgentEventBus;

  beforeEach(() => {
    resetAgentEventBus();
    eventBus = new AgentEventBus();
  });

  // ==================== 事件发布与订阅 ====================

  describe("事件发布与订阅", () => {
    it("onTaskCompleted 应接收到发布的事件", () => {
      const listener = vi.fn();
      eventBus.onTaskCompleted(listener);

      const event = createCompletedEvent();
      eventBus.publishTaskCompleted(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it("onTaskProgress 应接收到进度事件", () => {
      const listener = vi.fn();
      eventBus.onTaskProgress(listener);

      const event = createProgressEvent();
      eventBus.publishTaskProgress(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it("多个监听器应都能接收到事件", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      eventBus.onTaskCompleted(listener1);
      eventBus.onTaskCompleted(listener2);

      eventBus.publishTaskCompleted(createCompletedEvent());

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== waitForTask ====================

  describe("waitForTask", () => {
    it("应在任务完成时 resolve", async () => {
      const taskId = "task-wait-1";
      const waitPromise = eventBus.waitForTask(taskId, 2000);

      // 异步发布事件
      setTimeout(() => {
        eventBus.publishTaskCompleted(
          createCompletedEvent({ taskId })
        );
      }, 50);

      const result = await waitPromise;
      expect(result.taskId).toBe(taskId);
      expect(result.success).toBe(true);
    });

    it("如果任务已完成，应立即 resolve", async () => {
      const taskId = "task-already-done";
      const event = createCompletedEvent({ taskId });
      eventBus.publishTaskCompleted(event);

      const result = await eventBus.waitForTask(taskId);
      expect(result.taskId).toBe(taskId);
    });

    it("超时时应 reject", async () => {
      const taskId = "task-timeout";

      await expect(
        eventBus.waitForTask(taskId, 100)
      ).rejects.toThrow("Timeout");
    });
  });

  // ==================== waitForAllTasks ====================

  describe("waitForAllTasks", () => {
    it("应等待所有任务完成", async () => {
      const taskIds = ["task-a", "task-b", "task-c"];
      const waitPromise = eventBus.waitForAllTasks(taskIds, 2000);

      // 异步发布所有事件
      setTimeout(() => {
        for (const taskId of taskIds) {
          eventBus.publishTaskCompleted(
            createCompletedEvent({ taskId })
          );
        }
      }, 50);

      const results = await waitPromise;
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.taskId).sort()).toEqual(taskIds.sort());
    });
  });

  // ==================== 历史记录 ====================

  describe("历史记录", () => {
    it("getCompletedTask 应返回已完成的任务", () => {
      const event = createCompletedEvent({ taskId: "task-history" });
      eventBus.publishTaskCompleted(event);

      const result = eventBus.getCompletedTask("task-history");
      expect(result).toBeDefined();
      expect(result?.taskId).toBe("task-history");
    });

    it("getCompletedTask 对未完成的任务应返回 undefined", () => {
      expect(eventBus.getCompletedTask("nonexistent")).toBeUndefined();
    });

    it("getCompletedCount 应返回正确的数量", () => {
      eventBus.publishTaskCompleted(createCompletedEvent({ taskId: "t1" }));
      eventBus.publishTaskCompleted(createCompletedEvent({ taskId: "t2" }));
      expect(eventBus.getCompletedCount()).toBe(2);
    });

    it("应在超过最大历史数量时清理旧记录", () => {
      const smallBus = new AgentEventBus(3);

      for (let i = 1; i <= 5; i++) {
        smallBus.publishTaskCompleted(
          createCompletedEvent({
            taskId: `task-${i}`,
            timestamp: i * 1000,
          })
        );
      }

      expect(smallBus.getCompletedCount()).toBe(3);
      // 最旧的应该被清理
      expect(smallBus.getCompletedTask("task-1")).toBeUndefined();
      expect(smallBus.getCompletedTask("task-2")).toBeUndefined();
      // 最新的应该保留
      expect(smallBus.getCompletedTask("task-5")).toBeDefined();
    });
  });

  // ==================== 清理 ====================

  describe("清理", () => {
    it("clear 应清空所有状态", () => {
      eventBus.publishTaskCompleted(createCompletedEvent());
      eventBus.clear();

      expect(eventBus.getCompletedCount()).toBe(0);
    });
  });
});
