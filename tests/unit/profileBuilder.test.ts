/**
 * ProfileBuilder 单元测试
 *
 * 测试用户画像构建器的核心功能：
 * - 从记忆中提取用户名称
 * - 解析偏好记忆
 * - 解析关系信息
 * - 格式化记忆为上下文文本
 */

import { describe, it, expect } from "vitest";
import {
  buildProfileFromMemories,
  formatMemoriesForContext,
} from "../../server/memory/profileBuilder";
import type { Memory } from "../../drizzle/schema";

// 创建 Mock Memory 的辅助函数
function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 1,
    userId: 1,
    type: "fact",
    kind: "semantic",
    content: "测试记忆",
    importance: 0.5,
    confidence: 0.8,
    source: "conversation",
    tags: null,
    metadata: null,
    embedding: null,
    accessCount: 0,
    lastAccessedAt: new Date(),
    versionGroup: null,
    versionNumber: 1,
    isLatest: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("buildProfileFromMemories", () => {
  // ==================== 名称提取 ====================

  describe("名称提取", () => {
    it("应从'名字是XXX'格式中提取显示名称", () => {
      const memories = [
        createMockMemory({
          type: "fact",
          kind: "persona",
          content: "用户的名字是张三。",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.displayName).toBe("张三");
    });

    it("应从'名叫XXX'格式中提取显示名称", () => {
      const memories = [
        createMockMemory({
          type: "fact",
          kind: "persona",
          content: "用户名叫：李四，是一名工程师。",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.displayName).toBe("李四");
    });

    it("应从'称呼为XXX'格式中提取显示名称", () => {
      const memories = [
        createMockMemory({
          type: "fact",
          kind: "persona",
          content: "用户希望被称呼为小王。",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.displayName).toBe("小王");
    });

    it("应在没有名称信息时返回 undefined", () => {
      const memories = [
        createMockMemory({
          type: "fact",
          content: "用户喜欢古典音乐。",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.displayName).toBeUndefined();
    });
  });

  // ==================== 偏好解析 ====================

  describe("偏好解析", () => {
    it("应正确解析 preference 类型的记忆", () => {
      const memories = [
        createMockMemory({
          type: "preference",
          content: "喜欢的音乐类型是古典音乐",
          tags: ["music"],
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.activePreferences).toHaveLength(1);
      expect(profile.activePreferences[0].category).toBe("music");
      expect(profile.activePreferences[0].value).toContain("古典音乐");
    });

    it("应从标签中推断偏好分类", () => {
      const memories = [
        createMockMemory({
          type: "preference",
          content: "喜欢喝咖啡",
          tags: null,
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.activePreferences).toHaveLength(1);
      expect(profile.activePreferences[0].category).toBe("food");
    });

    it("应将 behavior 类型记忆作为偏好", () => {
      const memories = [
        createMockMemory({
          type: "behavior",
          content: "每天早上7点起床",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.activePreferences).toHaveLength(1);
      expect(profile.activePreferences[0].category).toBe("behavior");
      expect(profile.activePreferences[0].value).toContain("7点起床");
    });
  });

  // ==================== 关系解析 ====================

  describe("关系解析", () => {
    it("应从'XXX是用户的YYY'格式中提取关系", () => {
      const memories = [
        createMockMemory({
          type: "fact",
          content: "小明是用户的同事。",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.relevantRelationships).toHaveLength(1);
      expect(profile.relevantRelationships[0].personName).toBe("小明");
      expect(profile.relevantRelationships[0].relationship).toBe("同事");
    });

    it("应在没有关系信息时返回空数组", () => {
      const memories = [
        createMockMemory({
          type: "fact",
          content: "今天天气很好。",
        }),
      ];

      const profile = buildProfileFromMemories(memories);
      expect(profile.relevantRelationships).toHaveLength(0);
    });
  });

  // ==================== 空输入 ====================

  describe("空输入", () => {
    it("应处理空记忆列表", () => {
      const profile = buildProfileFromMemories([]);
      expect(profile.displayName).toBeUndefined();
      expect(profile.activePreferences).toHaveLength(0);
      expect(profile.relevantRelationships).toHaveLength(0);
    });
  });
});

describe("formatMemoriesForContext", () => {
  it("应按重要性排序格式化记忆", () => {
    const memories = [
      createMockMemory({ content: "低重要性", importance: 0.3, type: "fact" }),
      createMockMemory({ content: "高重要性", importance: 0.9, type: "preference" }),
      createMockMemory({ content: "中重要性", importance: 0.6, type: "behavior" }),
    ];

    const result = formatMemoriesForContext(memories);

    // 高重要性应排在前面
    const lines = result.split("\n");
    expect(lines[0]).toContain("高重要性");
    expect(lines[1]).toContain("中重要性");
    expect(lines[2]).toContain("低重要性");
  });

  it("应包含记忆类型标签", () => {
    const memories = [
      createMockMemory({ content: "用户喜欢咖啡", importance: 0.5, type: "preference" }),
    ];

    const result = formatMemoriesForContext(memories);
    expect(result).toContain("[preference]");
    expect(result).toContain("用户喜欢咖啡");
  });

  it("应在超过最大长度时截断", () => {
    const memories = Array.from({ length: 100 }, (_, i) =>
      createMockMemory({
        id: i,
        content: `这是第${i}条很长的记忆内容，包含了很多详细的信息`,
        importance: 0.5,
      })
    );

    const result = formatMemoriesForContext(memories, 200);
    expect(result.length).toBeLessThanOrEqual(250); // 允许一些余量
  });

  it("应处理空记忆列表", () => {
    const result = formatMemoriesForContext([]);
    expect(result).toBe("");
  });
});
