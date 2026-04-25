/**
 * Omni Token Router 单元测试
 *
 * 测试 GET /api/omni/token 端点的行为。
 * 关联用户测试用例：UTC-B6-1 ~ UTC-B6-4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createOmniTokenRouter } from "../omniTokenRouter";

describe("OmniTokenRouter", () => {
  let app: express.Application;
  const originalEnv = process.env.DASHSCOPE_API_KEY;

  beforeEach(() => {
    app = express();
    app.use(createOmniTokenRouter());
  });

  afterEach(() => {
    // 恢复环境变量
    if (originalEnv !== undefined) {
      process.env.DASHSCOPE_API_KEY = originalEnv;
    } else {
      delete process.env.DASHSCOPE_API_KEY;
    }
  });

  // UTC-B6-1: 配置了 DASHSCOPE_API_KEY 时返回 200 和 token
  it("配置了 DASHSCOPE_API_KEY 时应返回 200 和 token", async () => {
    process.env.DASHSCOPE_API_KEY = "sk-test-dashscope-key-12345";

    const res = await request(app).get("/api/omni/token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe("sk-test-dashscope-key-12345");
    expect(res.body.expireAt).toBeDefined();
  });

  // UTC-B6-2: 返回的 expireAt 在当前时间之后
  it("返回的 expireAt 应在当前时间之后", async () => {
    process.env.DASHSCOPE_API_KEY = "sk-test-key";

    const res = await request(app).get("/api/omni/token");

    expect(res.status).toBe(200);
    const expireAt = new Date(res.body.expireAt).getTime();
    const now = Date.now();
    expect(expireAt).toBeGreaterThan(now);
  });

  // UTC-B6-3: 未配置 DASHSCOPE_API_KEY 时返回 501
  it("未配置 DASHSCOPE_API_KEY 时应返回 501", async () => {
    delete process.env.DASHSCOPE_API_KEY;

    const res = await request(app).get("/api/omni/token");

    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("DASHSCOPE_API_KEY");
  });

  // UTC-B6-4: 返回的 JSON 结构正确
  it("返回的 JSON 应包含 success/token/expireAt 字段", async () => {
    process.env.DASHSCOPE_API_KEY = "sk-test-key";

    const res = await request(app).get("/api/omni/token");

    expect(res.body).toHaveProperty("success");
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("expireAt");
  });
});
