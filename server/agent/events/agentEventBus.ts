/**
 * AgentEventBus — Agent 事件总线
 *
 * 基于 Node.js EventEmitter 的事件总线，
 * 用于多智能体协同中的异步通知。
 *
 * 核心功能：
 * - 子代理完成任务后发布 TaskCompleted 事件
 * - Supervisor 或父代理订阅事件并处理结果
 * - 支持一次性等待（waitForTask）和持续监听
 *
 * 第五轮迭代新增：借鉴 Claude Code 的 task-notification 机制
 */

import { EventEmitter } from "events";
import type {
  TaskCompletedEvent,
  TaskProgressEvent,
  TaskCompletedListener,
  TaskProgressListener,
} from "./types";

// ==================== AgentEventBus 实现 ====================

export class AgentEventBus extends EventEmitter {
  /** 已完成的任务记录（用于延迟订阅场景） */
  private completedTasks: Map<string, TaskCompletedEvent>;
  /** 最大保留的已完成任务数量 */
  private maxCompletedHistory: number;

  constructor(maxCompletedHistory: number = 100) {
    super();
    this.completedTasks = new Map();
    this.maxCompletedHistory = maxCompletedHistory;
    // 提高默认监听器上限
    this.setMaxListeners(50);
  }

  /**
   * 发布任务完成事件
   *
   * @param event - 任务完成事件
   */
  publishTaskCompleted(event: TaskCompletedEvent): void {
    // 记录到历史
    this.completedTasks.set(event.taskId, event);
    this.evictOldHistory();

    console.log(
      `[AgentEventBus] Task ${event.taskId} completed by ${event.agentId}: ` +
        `success=${event.success}, duration=${event.durationMs}ms`
    );

    this.emit("taskCompleted", event);
    this.emit(`taskCompleted:${event.taskId}`, event);
  }

  /**
   * 发布任务进度事件
   *
   * @param event - 任务进度事件
   */
  publishTaskProgress(event: TaskProgressEvent): void {
    this.emit("taskProgress", event);
    this.emit(`taskProgress:${event.taskId}`, event);
  }

  /**
   * 订阅所有任务完成事件
   *
   * @param listener - 事件监听器
   */
  onTaskCompleted(listener: TaskCompletedListener): void {
    this.on("taskCompleted", listener);
  }

  /**
   * 订阅所有任务进度事件
   *
   * @param listener - 事件监听器
   */
  onTaskProgress(listener: TaskProgressListener): void {
    this.on("taskProgress", listener);
  }

  /**
   * 等待特定任务完成
   *
   * 返回一个 Promise，在目标任务完成时 resolve。
   * 如果任务已经完成（在历史记录中），立即 resolve。
   *
   * @param taskId - 任务 ID
   * @param timeoutMs - 超时时间（毫秒），默认 5 分钟
   * @returns 任务完成事件
   */
  waitForTask(
    taskId: string,
    timeoutMs: number = 5 * 60 * 1000
  ): Promise<TaskCompletedEvent> {
    // 检查历史记录
    const existing = this.completedTasks.get(taskId);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeAllListeners(`taskCompleted:${taskId}`);
        reject(new Error(`Timeout waiting for task ${taskId} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.once(`taskCompleted:${taskId}`, (event: TaskCompletedEvent) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  /**
   * 等待多个任务全部完成
   *
   * @param taskIds - 任务 ID 列表
   * @param timeoutMs - 超时时间
   * @returns 所有任务的完成事件
   */
  waitForAllTasks(
    taskIds: string[],
    timeoutMs: number = 5 * 60 * 1000
  ): Promise<TaskCompletedEvent[]> {
    return Promise.all(
      taskIds.map((id) => this.waitForTask(id, timeoutMs))
    );
  }

  /**
   * 查询任务是否已完成
   *
   * @param taskId - 任务 ID
   * @returns 任务完成事件，如果未完成则返回 undefined
   */
  getCompletedTask(taskId: string): TaskCompletedEvent | undefined {
    return this.completedTasks.get(taskId);
  }

  /**
   * 获取已完成任务的数量
   */
  getCompletedCount(): number {
    return this.completedTasks.size;
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.completedTasks.clear();
    this.removeAllListeners();
  }

  // ==================== 私有方法 ====================

  /**
   * 清理过旧的历史记录
   */
  private evictOldHistory(): void {
    if (this.completedTasks.size <= this.maxCompletedHistory) return;

    // 按时间排序，删除最旧的
    const entries = Array.from(this.completedTasks.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.length - this.maxCompletedHistory;
    for (let i = 0; i < toRemove; i++) {
      this.completedTasks.delete(entries[i][0]);
    }
  }
}

// ==================== 单例 ====================

let eventBusInstance: AgentEventBus | null = null;

/**
 * 获取 AgentEventBus 单例
 */
export function getAgentEventBus(): AgentEventBus {
  if (!eventBusInstance) {
    eventBusInstance = new AgentEventBus();
  }
  return eventBusInstance;
}

/**
 * 重置 AgentEventBus 单例（用于测试）
 */
export function resetAgentEventBus(): void {
  if (eventBusInstance) {
    eventBusInstance.clear();
  }
  eventBusInstance = null;
}
