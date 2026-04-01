/**
 * DreamGatekeeper — 做梦触发门控
 *
 * 维护每个用户的会话状态，根据复合条件（时间 + 消息数量）
 * 决定是否应该触发后台记忆整合任务（"做梦"）。
 *
 * 借鉴 Claude Code 的 autoDream 触发逻辑：
 * - 时间门控：距离上次做梦超过阈值
 * - 会话门控：用户消息数量达到阈值
 * - 空闲检测：系统当前没有正在执行的做梦任务
 *
 * 第五轮迭代新增
 */

import type {
  UserSessionState,
  GatekeeperConfig,
} from "./types";
import { DEFAULT_GATEKEEPER_CONFIG } from "./types";

// ==================== DreamGatekeeper 实现 ====================

export class DreamGatekeeper {
  private config: GatekeeperConfig;
  private userStates: Map<number, UserSessionState>;

  constructor(config: Partial<GatekeeperConfig> = {}) {
    this.config = { ...DEFAULT_GATEKEEPER_CONFIG, ...config };
    this.userStates = new Map();
  }

  /**
   * 记录用户消息事件
   *
   * 每当用户发送一条消息时调用，更新该用户的会话状态。
   *
   * @param userId - 用户 ID
   */
  recordMessage(userId: number): void {
    const state = this.getOrCreateState(userId);
    state.messageCountSinceLastDream++;
  }

  /**
   * 检查是否应该触发做梦
   *
   * 复合条件：
   * 1. 用户当前没有正在做梦
   * 2. 满足以下任一条件：
   *    a. 消息数量达到阈值
   *    b. 距离上次做梦时间超过阈值
   *
   * @param userId - 用户 ID
   * @returns 是否应该触发做梦
   */
  shouldDream(userId: number): boolean {
    const state = this.getOrCreateState(userId);

    // 正在做梦，不重复触发
    if (state.isDreaming) {
      return false;
    }

    const now = Date.now();
    const timeSinceLastDream = now - state.lastDreamTime;

    // 条件 a：消息数量达到阈值
    const messageCondition =
      state.messageCountSinceLastDream >= this.config.messageThreshold;

    // 条件 b：时间超过阈值
    const timeCondition = timeSinceLastDream >= this.config.timeThresholdMs;

    return messageCondition || timeCondition;
  }

  /**
   * 标记用户开始做梦
   *
   * @param userId - 用户 ID
   */
  markDreamStarted(userId: number): void {
    const state = this.getOrCreateState(userId);
    state.isDreaming = true;
  }

  /**
   * 标记用户做梦完成
   *
   * 重置消息计数和做梦时间。
   *
   * @param userId - 用户 ID
   */
  markDreamCompleted(userId: number): void {
    const state = this.getOrCreateState(userId);
    state.isDreaming = false;
    state.messageCountSinceLastDream = 0;
    state.lastDreamTime = Date.now();
  }

  /**
   * 获取用户的会话状态
   *
   * @param userId - 用户 ID
   * @returns 用户会话状态，如果不存在则返回 undefined
   */
  getUserState(userId: number): UserSessionState | undefined {
    return this.userStates.get(userId);
  }

  /**
   * 获取所有需要做梦的用户 ID
   *
   * @returns 需要做梦的用户 ID 列表
   */
  getUsersNeedingDream(): number[] {
    const result: number[] = [];
    for (const [userId] of this.userStates) {
      if (this.shouldDream(userId)) {
        result.push(userId);
      }
    }
    return result;
  }

  /**
   * 获取当前正在做梦的用户数量
   */
  getActiveDreamCount(): number {
    let count = 0;
    for (const [, state] of this.userStates) {
      if (state.isDreaming) count++;
    }
    return count;
  }

  /**
   * 检查是否可以启动新的 Worker（未达到并发上限）
   */
  canStartNewWorker(): boolean {
    return this.getActiveDreamCount() < this.config.maxConcurrentWorkers;
  }

  /**
   * 获取当前配置
   */
  getConfig(): GatekeeperConfig {
    return { ...this.config };
  }

  /**
   * 清空所有用户状态
   */
  clear(): void {
    this.userStates.clear();
  }

  // ==================== 私有方法 ====================

  /**
   * 获取或创建用户会话状态
   */
  private getOrCreateState(userId: number): UserSessionState {
    let state = this.userStates.get(userId);
    if (!state) {
      state = {
        userId,
        messageCountSinceLastDream: 0,
        lastDreamTime: 0,
        isDreaming: false,
      };
      this.userStates.set(userId, state);
    }
    return state;
  }
}

// ==================== 单例 ====================

let gatekeeperInstance: DreamGatekeeper | null = null;

/**
 * 获取 DreamGatekeeper 单例
 */
export function getDreamGatekeeper(): DreamGatekeeper {
  if (!gatekeeperInstance) {
    gatekeeperInstance = new DreamGatekeeper();
  }
  return gatekeeperInstance;
}

/**
 * 重置 DreamGatekeeper 单例（用于测试）
 */
export function resetDreamGatekeeper(): void {
  gatekeeperInstance = null;
}
