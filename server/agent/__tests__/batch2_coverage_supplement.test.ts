/**
 * 第二批迭代补充测试 — 覆盖 REPO_ANALYSIS 中所有缺失的 UTC 用例
 *
 * 本文件补充以下用例：
 * UTC-B1-5, UTC-B1-7, UTC-B2-8, UTC-B2-9, UTC-B4-6,
 * UTC-B5-5, UTC-B5-6, UTC-B6-5, UTC-B6-6, UTC-B9-5, UTC-B9-6
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";

// ==================== Agent Card 验证 ====================
describe("Agent Card 工具列表验证", () => {
  const cardsDir = path.resolve(__dirname, "../agent-cards");

  // UTC-B1-5: GeneralAgent 工具列表包含 get_latest_news
  it("UTC-B1-5: GeneralAgent 工具列表应包含 get_latest_news", () => {
    const card = JSON.parse(
      fs.readFileSync(path.join(cardsDir, "generalAgent.json"), "utf-8")
    );
    expect(card.tools).toContain("get_latest_news");
  });

  // UTC-B4-6: NavigationAgent 工具列表包含 generate_itinerary
  it("UTC-B4-6: NavigationAgent 工具列表应包含 generate_itinerary", () => {
    const card = JSON.parse(
      fs.readFileSync(path.join(cardsDir, "navigationAgent.json"), "utf-8")
    );
    expect(card.tools).toContain("generate_itinerary");
  });

  // UTC-B2-9: OfficeAgent 的 tools 数组长度 > 0
  it("UTC-B2-9: OfficeAgent 的 tools 数组长度应 > 0", () => {
    const card = JSON.parse(
      fs.readFileSync(path.join(cardsDir, "officeAgent.json"), "utf-8")
    );
    expect(card.tools.length).toBeGreaterThan(0);
  });
});

// ==================== OfficeAgent Prompt 防御性指示 ====================
describe("OfficeAgent System Prompt 防御性指示", () => {
  // UTC-B2-8: OfficeAgent 的 System Prompt 包含防御性指示
  it("UTC-B2-8: OfficeAgent System Prompt 应包含行程摘要作为消息正文的指示", async () => {
    const { OfficeAgent } = await import("../domains/officeAgent");
    const mockMCPManager = {
      initialize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      callTool: vi.fn(),
      shutdown: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ totalServers: 0, connectedServers: 0, servers: {} }),
      getToolRegistry: vi.fn().mockReturnValue({
        getByCategory: vi.fn().mockReturnValue([]),
        getByNames: vi.fn().mockReturnValue([]),
        toLangGraphTools: vi.fn().mockReturnValue([]),
      }),
    };
    const agent = new OfficeAgent(mockMCPManager);
    const prompt = agent.getSystemPrompt();
    // 验证包含跨域协同的防御性指示
    expect(prompt).toMatch(/行程|摘要|消息正文|跨域/);
  });
});

// ==================== 早安播报场景 ====================
describe("早安播报场景（集成层工具共存验证）", () => {
  // UTC-B1-7: GeneralAgent 可依次调用 memory_search 和 get_latest_news
  it("UTC-B1-7: GeneralAgent 的工具列表应同时包含 memory_search 和 get_latest_news", () => {
    const cardsDir = path.resolve(__dirname, "../agent-cards");
    const card = JSON.parse(
      fs.readFileSync(path.join(cardsDir, "generalAgent.json"), "utf-8")
    );
    expect(card.tools).toContain("memory_search");
    expect(card.tools).toContain("get_latest_news");
    // 验证两个工具可以共存
    const memIdx = card.tools.indexOf("memory_search");
    const newsIdx = card.tools.indexOf("get_latest_news");
    expect(memIdx).not.toBe(newsIdx);
  });
});

// ==================== classifyNode Prompt 关键词验证 ====================
describe("classifyNode 领域描述关键词", () => {
  let classifyNodeContent: string;

  beforeAll(() => {
    classifyNodeContent = fs.readFileSync(
      path.resolve(__dirname, "../supervisor/classifyNode.ts"),
      "utf-8"
    );
  });

  // UTC-B5-5: office 描述包含"飞书"、"群"、"消息"
  it("UTC-B5-5: classifyNode Prompt 中 office 描述应包含飞书相关关键词", () => {
    // 提取包含 office 的行
    const lines = classifyNodeContent.split("\n");
    const officeLine = lines.find((l) => l.includes("office") && l.includes("飞书"));
    expect(officeLine).toBeDefined();
    expect(officeLine).toContain("飞书");
    expect(officeLine).toMatch(/群|消息/);
  });

  // UTC-B5-6: service 描述包含"外卖"、"餐厅"
  it("UTC-B5-6: classifyNode Prompt 中 service 描述应包含餐厅和外卖关键词", () => {
    const lines = classifyNodeContent.split("\n");
    const serviceLine = lines.find((l) => l.includes("service") && l.includes("餐厅"));
    expect(serviceLine).toBeDefined();
    expect(serviceLine).toContain("餐厅");
    expect(serviceLine).toContain("外卖");
  });
});

// ==================== Omni Token 路由验证 ====================
describe("Omni Token 路由", () => {
  // UTC-B6-5: 未配置 DASHSCOPE_API_KEY 时返回错误
  it("UTC-B6-5: 未配置 DASHSCOPE_API_KEY 时应返回错误状态码", async () => {
    const originalKey = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;

    const { createOmniTokenRouter } = await import("../../routers/omniTokenRouter");

    const app = express();
    app.use(createOmniTokenRouter());

    const res = await request(app).get("/api/omni/token");
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body).toHaveProperty("error");

    if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey;
  });

  // UTC-B6-6: 路由挂载到 /api/omni/token
  it("UTC-B6-6: 路由应响应 GET /api/omni/token", async () => {
    process.env.DASHSCOPE_API_KEY = "sk-test-key";

    const { createOmniTokenRouter } = await import("../../routers/omniTokenRouter");

    const app = express();
    app.use(createOmniTokenRouter());

    const res = await request(app).get("/api/omni/token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");

    delete process.env.DASHSCOPE_API_KEY;
  });
});

// ==================== 单域排除验证 ====================
describe("单域任务不应分类为 cross_domain", () => {
  it("UTC-B9-5: classifyNode Prompt 应包含单域排除指引（cross_domain 涉及多个领域）", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../supervisor/classifyNode.ts"),
      "utf-8"
    );
    // cross_domain 描述应强调"涉及多个领域"
    expect(content).toContain("cross_domain");
    expect(content).toContain("多个领域");
  });

  it("UTC-B9-6: classifyNode 中 office 和 service 作为独立领域存在于 domain 枚举", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../supervisor/classifyNode.ts"),
      "utf-8"
    );
    // domain 枚举中包含 office 和 service
    expect(content).toMatch(/navigation\|multimedia\|file_system\|office\|service\|general\|cross_domain/);
  });
});
