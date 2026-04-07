/**
 * confidenceEvolution 单元测试
 *
 * 验证 Confidence 演化的核心逻辑：
 * - 内容关系判断
 * - 置信度提升计算
 * - 完整演化流程（BOOST / SUPERSEDE / NO_MATCH / SKIP）
 */
import { describe, it, expect } from "vitest";

import {
  judgeContentRelation,
  calculateBoostIncrement,
  evolveConfidence,
} from "../confidenceEvolution";
import type { Memory } from "../../../drizzle/schema";

/** 创建一条假的 Memory 记录 */
function fakeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 1,
    userId: 1,
    kind: "semantic",
    type: "fact",
    content: "用户在上海工作",
    importance: 0.7,
    confidence: 0.6,
    accessCount: 2,
    clusterId: null,
    embedding: null,
    validFrom: null,
    validUntil: null,
    tags: null,
    source: "agent_skill",
    versionGroup: "user_work_location",
    metadata: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Memory;
}

describe("confidenceEvolution", () => {
  // ==================== 内容关系判断 ====================

  describe("judgeContentRelation", () => {
    it("完全相同的内容应判定为一致", () => {
      expect(
        judgeContentRelation("用户在上海工作", "用户在上海工作")
      ).toBe("consistent");
    });

    it("完全不同的内容应判定为矛盾", () => {
      expect(
        judgeContentRelation("用户喜欢打篮球", "用户住在北京海淀区")
      ).toBe("contradictory");
    });

    it("自定义阈值应生效", () => {
      // 使用极高阈值，大部分都会被判定为矛盾
      expect(
        judgeContentRelation("用户在上海上班", "用户在上海工作", 0.99)
      ).toBe("contradictory");

      // 使用极低阈值，大部分都会被判定为一致
      expect(
        judgeContentRelation("用户在上海上班", "用户在上海工作", 0.1)
      ).toBe("consistent");
    });
  });

  // ==================== 置信度提升计算 ====================

  describe("calculateBoostIncrement", () => {
    it("低置信度记忆应获得较大提升", () => {
      const increment = calculateBoostIncrement(0.3, 0);
      expect(increment).toBeGreaterThan(0);
      expect(increment).toBeLessThanOrEqual(0.15);
    });

    it("高置信度记忆应获得较小提升", () => {
      const lowIncrement = calculateBoostIncrement(0.9, 0);
      const highIncrement = calculateBoostIncrement(0.3, 0);
      expect(lowIncrement).toBeLessThan(highIncrement);
    });

    it("置信度为 1.0 时提升应为 0", () => {
      expect(calculateBoostIncrement(1.0, 0)).toBe(0);
    });

    it("确认次数越多提升越小", () => {
      const first = calculateBoostIncrement(0.5, 0);
      const tenth = calculateBoostIncrement(0.5, 10);
      expect(tenth).toBeLessThan(first);
    });

    it("提升值不应超过 boostIncrement 上限", () => {
      const increment = calculateBoostIncrement(0.1, 0, {
        boostIncrement: 0.1,
      });
      expect(increment).toBeLessThanOrEqual(0.1);
    });
  });

  // ==================== 完整演化流程 ====================

  describe("evolveConfidence", () => {
    it("人格记忆应返回 SKIP", async () => {
      const result = await evolveConfidence(
        {
          content: "用户是一个开朗的人",
          kind: "persona",
          versionGroup: "personality_trait",
          userId: 1,
        },
        [fakeMemory()]
      );

      expect(result.action).toBe("SKIP");
      expect(result.reason).toContain("人格类型");
    });

    it("无 versionGroup 应返回 NO_MATCH", async () => {
      const result = await evolveConfidence(
        {
          content: "用户喜欢打篮球",
          kind: "semantic",
          userId: 1,
        },
        [fakeMemory()]
      );

      expect(result.action).toBe("NO_MATCH");
      expect(result.reason).toContain("未指定 versionGroup");
    });

    it("无已有记忆应返回 NO_MATCH", async () => {
      const result = await evolveConfidence(
        {
          content: "用户在上海工作",
          kind: "semantic",
          versionGroup: "user_work_location",
          userId: 1,
        },
        []
      );

      expect(result.action).toBe("NO_MATCH");
    });

    it("内容一致时应返回 BOOST（UTC-016）", async () => {
      const existing = fakeMemory({
        content: "用户在上海工作",
        confidence: 0.6,
        accessCount: 2,
      });

      const result = await evolveConfidence(
        {
          content: "用户在上海工作",
          kind: "semantic",
          versionGroup: "user_work_location",
          userId: 1,
        },
        [existing]
      );

      expect(result.action).toBe("BOOST");
      expect(result.affectedMemory?.id).toBe(existing.id);
      expect(result.previousConfidence).toBe(0.6);
      expect(result.newConfidence).toBeGreaterThan(0.6);
      expect(result.newConfidence).toBeLessThanOrEqual(1.0);
    });

    it("内容矛盾时应返回 SUPERSEDE（UTC-017）", async () => {
      const existing = fakeMemory({
        content: "用户在上海工作",
        confidence: 0.6,
        accessCount: 2,
      });

      const result = await evolveConfidence(
        {
          content: "用户搬到北京工作了",
          kind: "semantic",
          versionGroup: "user_work_location",
          userId: 1,
        },
        [existing]
      );

      expect(result.action).toBe("SUPERSEDE");
      expect(result.affectedMemory?.id).toBe(existing.id);
      expect(result.previousConfidence).toBe(0.6);
      expect(result.newConfidence).toBeLessThan(0.6);
      expect(result.newConfidence).toBeGreaterThanOrEqual(0.1);
    });

    it("BOOST 不应超过 maxConfidence", async () => {
      const existing = fakeMemory({
        content: "用户在上海工作",
        confidence: 0.95,
        accessCount: 0,
      });

      const result = await evolveConfidence(
        {
          content: "用户在上海工作",
          kind: "semantic",
          versionGroup: "user_work_location",
          userId: 1,
        },
        [existing],
        { maxConfidence: 1.0 }
      );

      expect(result.action).toBe("BOOST");
      expect(result.newConfidence).toBeLessThanOrEqual(1.0);
    });

    it("SUPERSEDE 不应低于 minConfidence", async () => {
      const existing = fakeMemory({
        content: "用户在上海工作",
        confidence: 0.15,
        accessCount: 0,
      });

      const result = await evolveConfidence(
        {
          content: "用户搬到北京工作了",
          kind: "semantic",
          versionGroup: "user_work_location",
          userId: 1,
        },
        [existing],
        { minConfidence: 0.1, supersedePenalty: 0.2 }
      );

      expect(result.action).toBe("SUPERSEDE");
      expect(result.newConfidence).toBeGreaterThanOrEqual(0.1);
    });

    it("多条已有记忆时应选择置信度最高的", async () => {
      const lowConfidence = fakeMemory({
        id: 1,
        content: "用户在上海工作",
        confidence: 0.3,
      });
      const highConfidence = fakeMemory({
        id: 2,
        content: "用户在上海工作",
        confidence: 0.8,
      });

      const result = await evolveConfidence(
        {
          content: "用户在上海工作",
          kind: "semantic",
          versionGroup: "user_work_location",
          userId: 1,
        },
        [lowConfidence, highConfidence]
      );

      expect(result.action).toBe("BOOST");
      expect(result.affectedMemory?.id).toBe(2);
      expect(result.previousConfidence).toBe(0.8);
    });
  });
});
