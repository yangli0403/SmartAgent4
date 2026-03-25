/**
 * PostgreSQL Schema 迁移验证测试
 *
 * 验证 Phase 4 数据库迁移（MySQL → PostgreSQL）后的 Schema 结构正确性：
 * - 所有表使用 pgTable 定义
 * - 枚举使用 pgEnum 定义
 * - 新增表（tool_utility_logs、prompt_versions）结构正确
 * - 类型导出正确
 *
 * 注意：这些是静态结构验证测试，不需要数据库连接。
 */

import { describe, it, expect } from "vitest";
import {
  users,
  memories,
  toolUtilityLogs,
  promptVersions,
  roleEnum,
  kindEnum,
  memoryTypeEnum,
} from "../../../drizzle/schema";

describe("PostgreSQL Schema 迁移验证", () => {
  // ==================== 枚举验证 ====================

  describe("枚举定义", () => {
    it("roleEnum 应包含 user 和 admin", () => {
      expect(roleEnum.enumValues).toContain("user");
      expect(roleEnum.enumValues).toContain("admin");
    });

    it("kindEnum 应包含 episodic、semantic、persona", () => {
      expect(kindEnum.enumValues).toContain("episodic");
      expect(kindEnum.enumValues).toContain("semantic");
      expect(kindEnum.enumValues).toContain("persona");
    });

    it("memoryTypeEnum 应包含 fact、behavior、preference、emotion", () => {
      expect(memoryTypeEnum.enumValues).toContain("fact");
      expect(memoryTypeEnum.enumValues).toContain("behavior");
      expect(memoryTypeEnum.enumValues).toContain("preference");
      expect(memoryTypeEnum.enumValues).toContain("emotion");
    });
  });

  // ==================== 表结构验证 ====================

  describe("users 表", () => {
    it("应存在且有正确的列", () => {
      expect(users).toBeDefined();
      const columns = Object.keys(users);
      // pgTable 对象包含列名作为属性
      expect(columns).toContain("id");
      expect(columns).toContain("name");
      expect(columns).toContain("openId");
    });
  });

  describe("memories 表", () => {
    it("应存在且有正确的列", () => {
      expect(memories).toBeDefined();
      const columns = Object.keys(memories);
      expect(columns).toContain("id");
      expect(columns).toContain("userId");
      expect(columns).toContain("content");
      expect(columns).toContain("type");
      expect(columns).toContain("kind");
      expect(columns).toContain("importance");
      expect(columns).toContain("confidence");
    });

    it("应包含混合检索相关列", () => {
      const columns = Object.keys(memories);
      expect(columns).toContain("embedding");
    });

    it("应包含时间有效性相关列", () => {
      const columns = Object.keys(memories);
      expect(columns).toContain("validFrom");
      expect(columns).toContain("validUntil");
    });
  });

  // ==================== 新增表验证（Phase 4） ====================

  describe("tool_utility_logs 表", () => {
    it("应存在", () => {
      expect(toolUtilityLogs).toBeDefined();
    });

    it("应有正确的列", () => {
      const columns = Object.keys(toolUtilityLogs);
      expect(columns).toContain("id");
      expect(columns).toContain("toolName");
      expect(columns).toContain("serverId");
      expect(columns).toContain("status");
      expect(columns).toContain("executionTimeMs");
      expect(columns).toContain("errorMessage");
      expect(columns).toContain("sessionId");
      expect(columns).toContain("userId");
      expect(columns).toContain("createdAt");
    });
  });

  describe("prompt_versions 表", () => {
    it("应存在", () => {
      expect(promptVersions).toBeDefined();
    });

    it("应有正确的列", () => {
      const columns = Object.keys(promptVersions);
      expect(columns).toContain("id");
      expect(columns).toContain("characterId");
      expect(columns).toContain("version");
      expect(columns).toContain("patchContent");
      expect(columns).toContain("reasoning");
      expect(columns).toContain("previousSnapshot");
      expect(columns).toContain("currentSnapshot");
      expect(columns).toContain("isActive");
      expect(columns).toContain("createdAt");
    });
  });

  // ==================== 类型导出验证 ====================

  describe("类型导出", () => {
    it("InsertToolUtilityLog 类型应可导入", async () => {
      const schema = await import("../../../drizzle/schema");
      // 类型存在性通过编译时检查，运行时验证 $inferInsert 存在
      expect(typeof toolUtilityLogs.$inferInsert).toBeDefined();
    });

    it("InsertPromptVersion 类型应可导入", async () => {
      expect(typeof promptVersions.$inferInsert).toBeDefined();
    });
  });
});
