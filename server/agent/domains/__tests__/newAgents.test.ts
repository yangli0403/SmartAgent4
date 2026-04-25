/**
 * 新增 Domain Agents 单元测试
 *
 * 测试 OfficeAgent 和 ServiceAgent 的属性、系统提示词和工具配置。
 * 不涉及 LLM 调用（需要 mock），仅验证配置正确性。
 * 关联用户测试用例：UTC-B2-7, UTC-B3-7, UTC-B3-8, UTC-B3-9
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfficeAgent } from "../officeAgent";
import { ServiceAgent } from "../serviceAgent";

// Mock MCP Manager
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

describe("New Domain Agents", () => {
  // ==================== OfficeAgent ====================
  describe("OfficeAgent", () => {
    let agent: OfficeAgent;

    beforeEach(() => {
      agent = new OfficeAgent(mockMCPManager as any);
    });

    // UTC-B2-7: OfficeAgent 实例化成功，name 为 "officeAgent"
    it("应有正确的名称", () => {
      expect(agent.name).toBe("officeAgent");
    });

    it("应有正确的描述", () => {
      expect(agent.description).toContain("办公");
    });

    it("应有飞书相关的工具列表", () => {
      const tools = agent.availableTools;
      expect(tools).toContain("feishu_send_message");
      expect(tools).toContain("feishu_create_event");
      expect(tools).toContain("feishu_create_group");
    });

    it("系统提示词应包含办公协同指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toContain("办公");
      expect(prompt).toContain("飞书");
    });

    it("系统提示词应包含跨域协同指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toContain("跨域");
    });

    it("系统提示词应支持上下文注入", () => {
      const prompt = agent.getSystemPrompt({
        currentTime: "2026-04-25 10:00:00",
        crossDomainData: { itinerary: { destination: "上海" } },
      });
      expect(prompt).toContain("2026-04-25");
      expect(prompt).toContain("上海");
    });
  });

  // ==================== ServiceAgent ====================
  describe("ServiceAgent", () => {
    let agent: ServiceAgent;

    beforeEach(() => {
      agent = new ServiceAgent(mockMCPManager as any);
    });

    // UTC-B3-7: ServiceAgent 实例化成功，name 为 "serviceAgent"
    it("应有正确的名称", () => {
      expect(agent.name).toBe("serviceAgent");
    });

    it("应有正确的描述", () => {
      expect(agent.description).toContain("生活服务");
    });

    // UTC-B3-8: ServiceAgent 的 availableTools 包含 search_restaurants 和 place_order
    it("应有生活服务相关的工具列表", () => {
      const tools = agent.availableTools;
      expect(tools).toContain("search_restaurants");
      expect(tools).toContain("place_order");
    });

    it("系统提示词应包含餐厅和服务指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toContain("餐厅");
      expect(prompt).toContain("服务");
    });

    // UTC-B3-9: ServiceAgent 系统提示词注入位置上下文
    it("系统提示词应支持位置上下文注入", () => {
      const prompt = agent.getSystemPrompt({
        location: { latitude: 31.23, longitude: 121.47, city: "上海" },
        currentTime: "2026-04-25 12:00:00",
      });
      expect(prompt).toContain("上海");
      expect(prompt).toContain("2026-04-25");
    });
  });
});
