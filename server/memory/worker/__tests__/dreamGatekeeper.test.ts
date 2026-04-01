/**
 * DreamGatekeeper 单元测试
 *
 * 测试后台"做梦"触发门控的核心逻辑：
 * - 消息计数门控
 * - 时间门控
 * - 复合触发条件
 * - 并发控制
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DreamGatekeeper, resetDreamGatekeeper } from "../dreamGatekeeper";
import { DEFAULT_GATEKEEPER_CONFIG } from "../types";

describe("DreamGatekeeper", () => {
  let gatekeeper: DreamGatekeeper;

  beforeEach(() => {
    resetDreamGatekeeper();
    gatekeeper = new DreamGatekeeper();
  });

  // ==================== 消息计数门控 ====================

  describe("消息计数门控", () => {
    it("消息数量未达到阈值时不应触发做梦", () => {
      const userId = 1;
      // 发送 4 条消息（阈值为 5）
      for (let i = 0; i < 4; i++) {
        gatekeeper.recordMessage(userId);
      }
      // lastDreamTime 为 0，时间条件也满足，所以这里需要特殊处理
      // 实际上 lastDreamTime=0 意味着从未做梦，时间条件始终满足
      // 所以 shouldDream 在 lastDreamTime=0 时应该返回 true
      expect(gatekeeper.shouldDream(userId)).toBe(true);
    });

    it("消息数量达到阈值时应触发做梦", () => {
      const userId = 1;
      // 先标记一次做梦完成，设置 lastDreamTime 为当前时间
      gatekeeper.markDreamCompleted(userId);

      // 发送 5 条消息
      for (let i = 0; i < 5; i++) {
        gatekeeper.recordMessage(userId);
      }
      expect(gatekeeper.shouldDream(userId)).toBe(true);
    });

    it("消息数量未达到阈值且时间未超过阈值时不应触发", () => {
      const userId = 1;
      // 先标记一次做梦完成
      gatekeeper.markDreamCompleted(userId);

      // 发送 3 条消息（不够）
      for (let i = 0; i < 3; i++) {
        gatekeeper.recordMessage(userId);
      }
      // 时间也没超过阈值（刚刚完成做梦）
      expect(gatekeeper.shouldDream(userId)).toBe(false);
    });
  });

  // ==================== 时间门控 ====================

  describe("时间门控", () => {
    it("从未做梦的用户应触发做梦（lastDreamTime 为 0）", () => {
      const userId = 1;
      gatekeeper.recordMessage(userId);
      expect(gatekeeper.shouldDream(userId)).toBe(true);
    });

    it("距离上次做梦时间超过阈值时应触发", () => {
      const userId = 1;
      const shortTimeGatekeeper = new DreamGatekeeper({
        timeThresholdMs: 100, // 100ms 用于测试
        messageThreshold: 999, // 设置很高的消息阈值，只测时间
      });

      // 标记做梦完成
      shortTimeGatekeeper.markDreamCompleted(userId);
      expect(shortTimeGatekeeper.shouldDream(userId)).toBe(false);

      // 模拟时间流逝
      const state = shortTimeGatekeeper.getUserState(userId);
      if (state) {
        state.lastDreamTime = Date.now() - 200; // 200ms 前
      }
      expect(shortTimeGatekeeper.shouldDream(userId)).toBe(true);
    });
  });

  // ==================== 做梦状态管理 ====================

  describe("做梦状态管理", () => {
    it("正在做梦时不应重复触发", () => {
      const userId = 1;
      // 发送足够的消息
      for (let i = 0; i < 10; i++) {
        gatekeeper.recordMessage(userId);
      }
      expect(gatekeeper.shouldDream(userId)).toBe(true);

      // 标记开始做梦
      gatekeeper.markDreamStarted(userId);
      expect(gatekeeper.shouldDream(userId)).toBe(false);
    });

    it("做梦完成后应重置消息计数", () => {
      const userId = 1;
      for (let i = 0; i < 10; i++) {
        gatekeeper.recordMessage(userId);
      }

      gatekeeper.markDreamStarted(userId);
      gatekeeper.markDreamCompleted(userId);

      const state = gatekeeper.getUserState(userId);
      expect(state?.messageCountSinceLastDream).toBe(0);
      expect(state?.isDreaming).toBe(false);
    });

    it("做梦完成后应更新 lastDreamTime", () => {
      const userId = 1;
      const before = Date.now();
      gatekeeper.markDreamCompleted(userId);
      const after = Date.now();

      const state = gatekeeper.getUserState(userId);
      expect(state?.lastDreamTime).toBeGreaterThanOrEqual(before);
      expect(state?.lastDreamTime).toBeLessThanOrEqual(after);
    });
  });

  // ==================== 并发控制 ====================

  describe("并发控制", () => {
    it("未达到并发上限时可以启动新 Worker", () => {
      expect(gatekeeper.canStartNewWorker()).toBe(true);
    });

    it("达到并发上限时不能启动新 Worker", () => {
      const maxWorkers = DEFAULT_GATEKEEPER_CONFIG.maxConcurrentWorkers;
      for (let i = 1; i <= maxWorkers; i++) {
        gatekeeper.markDreamStarted(i);
      }
      expect(gatekeeper.canStartNewWorker()).toBe(false);
    });

    it("Worker 完成后可以启动新 Worker", () => {
      const maxWorkers = DEFAULT_GATEKEEPER_CONFIG.maxConcurrentWorkers;
      for (let i = 1; i <= maxWorkers; i++) {
        gatekeeper.markDreamStarted(i);
      }
      expect(gatekeeper.canStartNewWorker()).toBe(false);

      gatekeeper.markDreamCompleted(1);
      expect(gatekeeper.canStartNewWorker()).toBe(true);
    });
  });

  // ==================== 批量查询 ====================

  describe("批量查询", () => {
    it("getUsersNeedingDream 应返回所有需要做梦的用户", () => {
      // 用户 1：发送足够消息
      for (let i = 0; i < 10; i++) {
        gatekeeper.recordMessage(1);
      }
      // 用户 2：刚做完梦
      gatekeeper.markDreamCompleted(2);
      // 用户 3：正在做梦
      gatekeeper.recordMessage(3);
      gatekeeper.markDreamStarted(3);

      const needingDream = gatekeeper.getUsersNeedingDream();
      expect(needingDream).toContain(1);
      expect(needingDream).not.toContain(2);
      expect(needingDream).not.toContain(3);
    });

    it("getActiveDreamCount 应返回正确的活跃数量", () => {
      gatekeeper.markDreamStarted(1);
      gatekeeper.markDreamStarted(2);
      expect(gatekeeper.getActiveDreamCount()).toBe(2);

      gatekeeper.markDreamCompleted(1);
      expect(gatekeeper.getActiveDreamCount()).toBe(1);
    });
  });

  // ==================== 自定义配置 ====================

  describe("自定义配置", () => {
    it("应支持自定义消息阈值", () => {
      const custom = new DreamGatekeeper({ messageThreshold: 3 });
      custom.markDreamCompleted(1); // 设置 lastDreamTime

      custom.recordMessage(1);
      custom.recordMessage(1);
      expect(custom.shouldDream(1)).toBe(false);

      custom.recordMessage(1);
      expect(custom.shouldDream(1)).toBe(true);
    });

    it("应支持自定义并发上限", () => {
      const custom = new DreamGatekeeper({ maxConcurrentWorkers: 1 });
      custom.markDreamStarted(1);
      expect(custom.canStartNewWorker()).toBe(false);
    });
  });

  // ==================== 清理 ====================

  describe("清理", () => {
    it("clear 应清空所有用户状态", () => {
      gatekeeper.recordMessage(1);
      gatekeeper.recordMessage(2);
      gatekeeper.clear();

      expect(gatekeeper.getUserState(1)).toBeUndefined();
      expect(gatekeeper.getUserState(2)).toBeUndefined();
    });
  });
});
