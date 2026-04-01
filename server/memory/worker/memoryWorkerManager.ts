/**
 * MemoryWorkerManager — 记忆 Worker 管理器
 *
 * 管理后台"做梦"Worker 的生命周期。
 * 接收来自 DreamGatekeeper 的触发信号，
 * 将记忆整合和预测任务分发到独立的异步执行环境。
 *
 * 当前实现采用 Promise + setTimeout 的异步隔离模式，
 * 将耗时任务从主请求流程中剥离。未来可升级为 worker_threads。
 *
 * 第五轮迭代新增：借鉴 Claude Code 的 autoDream 机制
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type {
  MemoryWorkerRequest,
  MemoryWorkerResponse,
  MemoryWorkerTaskType,
  WorkerManagerStats,
  GatekeeperConfig,
} from "./types";
import { DEFAULT_GATEKEEPER_CONFIG } from "./types";
import { DreamGatekeeper } from "./dreamGatekeeper";

// ==================== MemoryWorkerManager 实现 ====================

export class MemoryWorkerManager extends EventEmitter {
  private gatekeeper: DreamGatekeeper;
  private activeTasks: Map<string, MemoryWorkerRequest>;
  private completedCount: number;
  private failedCount: number;
  private taskExecutor: TaskExecutor;

  constructor(
    config: Partial<GatekeeperConfig> = {},
    executor?: TaskExecutor
  ) {
    super();
    this.gatekeeper = new DreamGatekeeper(config);
    this.activeTasks = new Map();
    this.completedCount = 0;
    this.failedCount = 0;
    this.taskExecutor = executor || defaultTaskExecutor;
  }

  /**
   * 记录用户消息并检查是否需要触发做梦
   *
   * 在用户每次发送消息时调用。如果触发条件满足，
   * 自动启动后台任务。
   *
   * @param userId - 用户 ID
   */
  async onUserMessage(userId: number): Promise<void> {
    this.gatekeeper.recordMessage(userId);

    if (
      this.gatekeeper.shouldDream(userId) &&
      this.gatekeeper.canStartNewWorker()
    ) {
      await this.startDream(userId);
    }
  }

  /**
   * 启动做梦任务
   *
   * 将记忆整合任务提交到异步执行环境。
   *
   * @param userId - 用户 ID
   * @param type - 任务类型，默认为 consolidate
   */
  async startDream(
    userId: number,
    type: MemoryWorkerTaskType = "consolidate"
  ): Promise<string> {
    const taskId = uuidv4();

    const request: MemoryWorkerRequest = {
      taskId,
      type,
      userId,
    };

    this.gatekeeper.markDreamStarted(userId);
    this.activeTasks.set(taskId, request);

    console.log(
      `[MemoryWorkerManager] Starting dream task ${taskId} for user ${userId} (type: ${type})`
    );

    // 异步执行，不阻塞主流程
    this.executeTaskAsync(request);

    return taskId;
  }

  /**
   * 获取管理器统计信息
   */
  getStats(): WorkerManagerStats {
    return {
      activeWorkers: this.activeTasks.size,
      completedTasks: this.completedCount,
      failedTasks: this.failedCount,
      trackedUsers: this.gatekeeper.getUsersNeedingDream().length +
        this.gatekeeper.getActiveDreamCount(),
    };
  }

  /**
   * 获取门控实例（用于外部查询状态）
   */
  getGatekeeper(): DreamGatekeeper {
    return this.gatekeeper;
  }

  /**
   * 停止所有活跃任务
   */
  stop(): void {
    this.activeTasks.clear();
    this.gatekeeper.clear();
    this.removeAllListeners();
    console.log("[MemoryWorkerManager] Stopped.");
  }

  // ==================== 私有方法 ====================

  /**
   * 异步执行任务（不阻塞主流程）
   */
  private executeTaskAsync(request: MemoryWorkerRequest): void {
    // 使用 setTimeout(0) 将任务推入下一个事件循环
    setTimeout(async () => {
      const startTime = Date.now();

      try {
        const result = await this.taskExecutor(request);

        const response: MemoryWorkerResponse = {
          taskId: request.taskId,
          success: true,
          result,
          durationMs: Date.now() - startTime,
        };

        this.onTaskCompleted(request, response);
      } catch (error) {
        const response: MemoryWorkerResponse = {
          taskId: request.taskId,
          success: false,
          error: (error as Error).message,
          durationMs: Date.now() - startTime,
        };

        this.onTaskCompleted(request, response);
      }
    }, 0);
  }

  /**
   * 任务完成回调
   */
  private onTaskCompleted(
    request: MemoryWorkerRequest,
    response: MemoryWorkerResponse
  ): void {
    this.activeTasks.delete(request.taskId);

    if (response.success) {
      this.completedCount++;
      this.gatekeeper.markDreamCompleted(request.userId);
      console.log(
        `[MemoryWorkerManager] Dream task ${request.taskId} completed for user ${request.userId} in ${response.durationMs}ms`
      );
    } else {
      this.failedCount++;
      this.gatekeeper.markDreamCompleted(request.userId); // 即使失败也重置状态
      console.error(
        `[MemoryWorkerManager] Dream task ${request.taskId} failed for user ${request.userId}: ${response.error}`
      );
    }

    // 触发事件通知
    this.emit("dreamCompleted", response);
  }
}

// ==================== 任务执行器类型 ====================

/**
 * 任务执行器函数类型
 *
 * 可以被替换为实际的 consolidateMemories / runPredictionCycle 调用。
 * 在测试中可以注入 mock 执行器。
 */
export type TaskExecutor = (
  request: MemoryWorkerRequest
) => Promise<any>;

/**
 * 默认任务执行器（占位，实际使用时需要注入真实实现）
 */
const defaultTaskExecutor: TaskExecutor = async (request) => {
  console.warn(
    `[MemoryWorkerManager] Default executor called for task ${request.taskId}. ` +
      `Inject a real executor for production use.`
  );
  return { type: request.type };
};

// ==================== 单例 ====================

let managerInstance: MemoryWorkerManager | null = null;

/**
 * 获取 MemoryWorkerManager 单例
 */
export function getMemoryWorkerManager(): MemoryWorkerManager {
  if (!managerInstance) {
    managerInstance = new MemoryWorkerManager();
  }
  return managerInstance;
}

/**
 * 初始化 MemoryWorkerManager 单例（带自定义配置和执行器）
 */
export function initMemoryWorkerManager(
  config?: Partial<GatekeeperConfig>,
  executor?: TaskExecutor
): MemoryWorkerManager {
  managerInstance = new MemoryWorkerManager(config, executor);
  return managerInstance;
}

/**
 * 重置 MemoryWorkerManager 单例（用于测试）
 */
export function resetMemoryWorkerManager(): void {
  if (managerInstance) {
    managerInstance.stop();
  }
  managerInstance = null;
}
