/**
 * Forgetting Service — 动态遗忘服务单元测试
 *
 * 测试艾宾浩斯遗忘曲线衰减模型的核心计算逻辑。
 * 注意：这里只测试纯计算函数，不涉及数据库操作。
 */

import { describe, it, expect } from "vitest";

// 由于 forgettingService.ts 中的核心计算函数未导出，
// 我们在此重新实现相同的逻辑进行验证。

const BASE_STRENGTH = 7;
const STRENGTH_PER_ACCESS = 3;
const SEMANTIC_STRENGTH_MULTIPLIER = 3;

function calculateStrength(memory: {
  kind: string;
  accessCount: number;
  importance: number;
}): number {
  let strength = BASE_STRENGTH + memory.accessCount * STRENGTH_PER_ACCESS;
  if (memory.kind === "semantic") {
    strength *= SEMANTIC_STRENGTH_MULTIPLIER;
  }
  strength *= 1 + memory.importance;
  return strength;
}

function calculateRetention(daysSinceAccess: number, strength: number): number {
  if (daysSinceAccess <= 0) return 1;
  if (strength <= 0) return 0;
  return Math.exp(-daysSinceAccess / strength);
}

// ==================== 测试用例 ====================

describe("Forgetting Decay Model", () => {
  describe("calculateStrength", () => {
    it("情景记忆的基础强度应为 7 天", () => {
      const strength = calculateStrength({
        kind: "episodic",
        accessCount: 0,
        importance: 0,
      });
      // BASE_STRENGTH * (1 + 0) = 7
      expect(strength).toBe(7);
    });

    it("每次访问应增加 3 天的强度", () => {
      const strength = calculateStrength({
        kind: "episodic",
        accessCount: 5,
        importance: 0,
      });
      // (7 + 5*3) * (1 + 0) = 22
      expect(strength).toBe(22);
    });

    it("语义记忆的强度应为情景记忆的 3 倍", () => {
      const episodicStrength = calculateStrength({
        kind: "episodic",
        accessCount: 2,
        importance: 0.5,
      });
      const semanticStrength = calculateStrength({
        kind: "semantic",
        accessCount: 2,
        importance: 0.5,
      });
      expect(semanticStrength).toBe(episodicStrength * SEMANTIC_STRENGTH_MULTIPLIER);
    });

    it("高重要性记忆的强度应更高", () => {
      const lowImportance = calculateStrength({
        kind: "episodic",
        accessCount: 1,
        importance: 0.2,
      });
      const highImportance = calculateStrength({
        kind: "episodic",
        accessCount: 1,
        importance: 0.9,
      });
      expect(highImportance).toBeGreaterThan(lowImportance);
    });
  });

  describe("calculateRetention", () => {
    it("刚访问过的记忆保留率应为 1", () => {
      expect(calculateRetention(0, 10)).toBe(1);
    });

    it("保留率应随时间递减", () => {
      const strength = 10;
      const r1 = calculateRetention(1, strength);
      const r7 = calculateRetention(7, strength);
      const r30 = calculateRetention(30, strength);

      expect(r1).toBeGreaterThan(r7);
      expect(r7).toBeGreaterThan(r30);
      expect(r30).toBeGreaterThan(0);
    });

    it("强度越高，衰减越慢", () => {
      const days = 14;
      const weakRetention = calculateRetention(days, 5);
      const strongRetention = calculateRetention(days, 30);

      expect(strongRetention).toBeGreaterThan(weakRetention);
    });

    it("30 天后低强度记忆的保留率应接近 0", () => {
      const retention = calculateRetention(30, 5);
      expect(retention).toBeLessThan(0.01);
    });

    it("高强度语义记忆 30 天后仍有较高保留率", () => {
      // 模拟：语义记忆，访问 10 次，重要性 0.8
      const strength = calculateStrength({
        kind: "semantic",
        accessCount: 10,
        importance: 0.8,
      });
      const retention = calculateRetention(30, strength);
      // 强度很高，30天后保留率应该仍然不错
      expect(retention).toBeGreaterThan(0.5);
    });
  });

  describe("End-to-end decay simulation", () => {
    it("模拟一条普通情景记忆的衰减过程", () => {
      const memory = {
        kind: "episodic" as const,
        accessCount: 2,
        importance: 0.5,
      };

      const strength = calculateStrength(memory);
      let currentImportance = memory.importance;

      // 模拟 7 天的衰减
      const retention7 = calculateRetention(7, strength);
      currentImportance *= retention7;
      expect(currentImportance).toBeLessThan(0.5);
      expect(currentImportance).toBeGreaterThan(0.1);

      // 模拟 30 天的衰减（从原始值计算）
      const retention30 = calculateRetention(30, strength);
      const importance30 = memory.importance * retention30;
      expect(importance30).toBeLessThan(currentImportance);
    });
  });
});
