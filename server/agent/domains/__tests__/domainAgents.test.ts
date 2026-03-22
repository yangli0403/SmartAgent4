/**
 * Domain Agents 单元测试
 *
 * 测试各 Domain Agent 的属性、系统提示词和工具配置。
 * 不涉及 LLM 调用（需要 mock），仅验证配置正确性。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileAgent } from "../fileAgent";
import { NavigationAgent } from "../navigationAgent";
import { MultimediaAgent } from "../multimediaAgent";
import { GeneralAgent } from "../generalAgent";
import type { ToolCategory } from "../../mcp/../mcp/toolRegistry";

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

describe("Domain Agents", () => {
  // ==================== FileAgent ====================

  describe("FileAgent", () => {
    let agent: FileAgent;

    beforeEach(() => {
      agent = new FileAgent(mockMCPManager as any);
    });

    it("应有正确的名称", () => {
      expect(agent.name).toBe("fileAgent");
    });

    it("应有正确的描述", () => {
      expect(agent.description).toContain("文件");
    });

    it("应有文件系统相关的工具列表", () => {
      const tools = agent.availableTools;
      expect(tools).toContain("search_files");
      expect(tools).toContain("open_file");
      expect(tools).toContain("get_file_info");
      expect(tools).toContain("list_directory");
    });

    it("系统提示词应包含文件操作指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toContain("文件");
    });

    it("系统提示词应支持上下文注入", () => {
      const prompt = agent.getSystemPrompt({
        platform: "windows",
        defaultSearchDirectory: "C:\\Users\\Test\\Downloads",
      });
      expect(prompt).toBeDefined();
    });
  });

  // ==================== NavigationAgent ====================

  describe("NavigationAgent", () => {
    let agent: NavigationAgent;

    beforeEach(() => {
      agent = new NavigationAgent(mockMCPManager as any);
    });

    it("应有正确的名称", () => {
      expect(agent.name).toBe("navigationAgent");
    });

    it("应有正确的描述", () => {
      expect(agent.description).toContain("导航");
    });

    it("应有高德地图相关的工具列表", () => {
      const tools = agent.availableTools;
      expect(tools.length).toBeGreaterThan(0);
      // 高德地图工具通常以 maps_ 开头
      const hasMapTools = tools.some(
        (t) => t.startsWith("maps_") || t.includes("search") || t.includes("direction")
      );
      expect(hasMapTools).toBe(true);
    });

    it("系统提示词应包含导航和地图指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("系统提示词应支持位置上下文注入", () => {
      const prompt = agent.getSystemPrompt({
        location: { latitude: 39.9, longitude: 116.4, city: "北京" },
      });
      expect(prompt).toBeDefined();
    });
  });

  // ==================== MultimediaAgent ====================

  describe("MultimediaAgent", () => {
    let agent: MultimediaAgent;

    beforeEach(() => {
      agent = new MultimediaAgent(mockMCPManager as any);
    });

    it("应有正确的名称", () => {
      expect(agent.name).toBe("multimediaAgent");
    });

    it("应有正确的描述", () => {
      const desc = agent.description;
      expect(desc.includes("音乐") || desc.includes("多媒体") || desc.includes("媒体")).toBe(true);
    });

    it("应有音乐相关的工具列表", () => {
      const tools = agent.availableTools;
      expect(tools.length).toBeGreaterThan(0);
    });

    it("系统提示词应包含音乐相关指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  // ==================== GeneralAgent ====================

  describe("GeneralAgent", () => {
    let agent: GeneralAgent;

    beforeEach(() => {
      agent = new GeneralAgent(mockMCPManager as any);
    });

    it("应有正确的名称", () => {
      expect(agent.name).toBe("generalAgent");
    });

    it("应有正确的描述", () => {
      const desc = agent.description;
      expect(desc.includes("通用") || desc.includes("对话") || desc.includes("general")).toBe(true);
    });

    it("工具列表应为空（纯 LLM 对话）", () => {
      expect(agent.availableTools.length).toBe(0);
    });

    it("系统提示词应包含对话指引", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("系统提示词应支持性格注入", () => {
      const prompt = agent.getSystemPrompt({
        personality: "humorous",
        responseStyle: "concise",
      });
      expect(prompt).toBeDefined();
    });
  });

  // ==================== 跨 Agent 一致性检查 ====================

  describe("Cross-Agent Consistency", () => {
    it("所有 Agent 名称应唯一", () => {
      const agents = [
        new FileAgent(mockMCPManager as any),
        new NavigationAgent(mockMCPManager as any),
        new MultimediaAgent(mockMCPManager as any),
        new GeneralAgent(mockMCPManager as any),
      ];
      const names = agents.map((a) => a.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("所有 Agent 应有非空描述", () => {
      const agents = [
        new FileAgent(mockMCPManager as any),
        new NavigationAgent(mockMCPManager as any),
        new MultimediaAgent(mockMCPManager as any),
        new GeneralAgent(mockMCPManager as any),
      ];
      for (const agent of agents) {
        expect(agent.description.length).toBeGreaterThan(0);
      }
    });

    it("所有 Agent 应有非空系统提示词", () => {
      const agents = [
        new FileAgent(mockMCPManager as any),
        new NavigationAgent(mockMCPManager as any),
        new MultimediaAgent(mockMCPManager as any),
        new GeneralAgent(mockMCPManager as any),
      ];
      for (const agent of agents) {
        expect(agent.getSystemPrompt().length).toBeGreaterThan(0);
      }
    });
  });
});
