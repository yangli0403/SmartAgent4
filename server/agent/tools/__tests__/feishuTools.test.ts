/**
 * Feishu Tools 单元测试
 *
 * 测试飞书消息发送、日程创建、群组管理工具的参数校验和返回结构。
 * 关联用户测试用例：UTC-B2-1 ~ UTC-B2-7
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  feishuSendMessageImpl,
  feishuCreateEventImpl,
  feishuCreateGroupImpl,
  registerFeishuTools,
  callFeishuTool,
  FEISHU_TOOLS_SERVER_ID,
} from "../feishuTools";

// ==================== Mock ToolRegistry ====================
const mockRegister = vi.fn();
const mockToolRegistry = {
  register: mockRegister,
};

// ==================== 测试 ====================
describe("FeishuTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== registerFeishuTools ====================
  describe("registerFeishuTools", () => {
    // UTC-B2-6: feishuTools 注册函数被调用后，ToolRegistry 中存在 3 个飞书工具
    it("应注册 3 个飞书工具到 ToolRegistry", () => {
      registerFeishuTools(mockToolRegistry as any);
      expect(mockRegister).toHaveBeenCalledTimes(3);
    });

    it("注册的工具名称应正确", () => {
      registerFeishuTools(mockToolRegistry as any);
      const registeredNames = mockRegister.mock.calls.map(
        (call: any[]) => call[0].name
      );
      expect(registeredNames).toContain("feishu_send_message");
      expect(registeredNames).toContain("feishu_create_event");
      expect(registeredNames).toContain("feishu_create_group");
    });

    it("所有工具的 serverId 应为 FEISHU_TOOLS_SERVER_ID", () => {
      registerFeishuTools(mockToolRegistry as any);
      for (const call of mockRegister.mock.calls) {
        expect(call[0].serverId).toBe(FEISHU_TOOLS_SERVER_ID);
      }
    });
  });

  // ==================== feishu_send_message ====================
  describe("feishuSendMessageImpl", () => {
    // UTC-B2-1: 发送消息到群组成功
    it("指定 chatId 和 content 应返回成功", () => {
      const result = JSON.parse(
        feishuSendMessageImpl({
          chatId: "oc_test_group",
          content: "Hello, 这是一条测试消息",
        })
      );
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
      expect(result.chatId).toBe("oc_test_group");
      expect(result.sentAt).toBeDefined();
    });

    // UTC-B2-2: 发送消息到用户成功
    it("指定 userId 和 content 应返回成功", () => {
      const result = JSON.parse(
        feishuSendMessageImpl({
          userId: "user_123",
          content: "私信测试",
        })
      );
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.userId).toBe("user_123");
    });

    // UTC-B2-3: 缺少接收方应返回错误
    it("缺少 chatId 和 userId 应返回校验错误", () => {
      const result = JSON.parse(
        feishuSendMessageImpl({ content: "无接收方" })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("chatId");
    });

    it("缺少 content 应返回校验错误", () => {
      const result = JSON.parse(
        feishuSendMessageImpl({ chatId: "oc_test" })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("content");
    });

    it("content 为空字符串应返回校验错误", () => {
      const result = JSON.parse(
        feishuSendMessageImpl({ chatId: "oc_test", content: "  " })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("content");
    });
  });

  // ==================== feishu_create_event ====================
  describe("feishuCreateEventImpl", () => {
    // UTC-B2-4: 创建日程成功
    it("正常参数应返回创建成功", () => {
      const result = JSON.parse(
        feishuCreateEventImpl({
          title: "团队周会",
          startTime: "2026-04-26T09:00:00+08:00",
          endTime: "2026-04-26T10:00:00+08:00",
          attendees: ["user_1", "user_2"],
        })
      );
      expect(result.success).toBe(true);
      expect(result.eventId).toBeDefined();
      expect(result.title).toBe("团队周会");
      expect(result.attendees).toEqual(["user_1", "user_2"]);
    });

    it("缺少 title 应返回校验错误", () => {
      const result = JSON.parse(
        feishuCreateEventImpl({
          startTime: "2026-04-26T09:00:00+08:00",
        })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("title");
    });

    it("缺少 startTime 应返回校验错误", () => {
      const result = JSON.parse(
        feishuCreateEventImpl({ title: "测试日程" })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("startTime");
    });
  });

  // ==================== feishu_create_group ====================
  describe("feishuCreateGroupImpl", () => {
    // UTC-B2-5: 创建群组成功
    it("正常参数应返回创建成功", () => {
      const result = JSON.parse(
        feishuCreateGroupImpl({
          name: "上海出差群",
          members: ["user_1", "user_2", "user_3"],
          description: "上海出差行程协调群",
        })
      );
      expect(result.success).toBe(true);
      expect(result.chatId).toBeDefined();
      expect(result.name).toBe("上海出差群");
      expect(result.members).toEqual(["user_1", "user_2", "user_3"]);
      expect(result.memberCount).toBe(3);
    });

    it("缺少 name 应返回校验错误", () => {
      const result = JSON.parse(
        feishuCreateGroupImpl({ members: ["user_1"] })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("name");
    });

    it("无成员时应返回空成员列表", () => {
      const result = JSON.parse(
        feishuCreateGroupImpl({ name: "空群组" })
      );
      expect(result.success).toBe(true);
      expect(result.members).toEqual([]);
      expect(result.memberCount).toBe(0);
    });
  });

  // ==================== callFeishuTool ====================
  describe("callFeishuTool", () => {
    it("调用 feishu_send_message 应返回有效 JSON", async () => {
      const result = await callFeishuTool("feishu_send_message", {
        chatId: "oc_test",
        content: "测试",
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("调用 feishu_create_event 应返回有效 JSON", async () => {
      const result = await callFeishuTool("feishu_create_event", {
        title: "测试日程",
        startTime: "2026-04-26T09:00:00+08:00",
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("调用 feishu_create_group 应返回有效 JSON", async () => {
      const result = await callFeishuTool("feishu_create_group", {
        name: "测试群",
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("调用未知工具应返回错误", async () => {
      const result = await callFeishuTool("unknown_tool", {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });
});
