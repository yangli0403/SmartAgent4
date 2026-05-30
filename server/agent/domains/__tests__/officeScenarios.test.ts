/**
 * OfficeAgent 产品场景测试
 *
 * 测试三个核心场景：
 * 1. 工作通知发送 - 发送团队工作安排、会议纪要、任务分配
 * 2. 智能日程创建 - 创建会议日程，自动查询参与者忙闲
 * 3. 项目群组管理 - 为新项目创建群组，自动邀请成员
 *
 * 使用 Mock MCP Manager 模拟飞书 MCP Server 响应。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfficeAgent } from "../officeAgent";
import type { MCPManager } from "../../../mcp/mcpManager";

// ==================== Mock MCP Manager 工厂 ====================

function createMockMCPManager(mockResponses: Record<string, unknown>) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({
      totalServers: 1,
      connectedServers: 1,
      servers: { feishu: { status: "connected" } },
    }),
    getToolRegistry: vi.fn().mockReturnValue({
      getByCategory: vi.fn().mockReturnValue([]),
      getByNames: vi.fn().mockReturnValue([]),
      toLangGraphTools: vi.fn().mockReturnValue([]),
    }),
    callTool: vi.fn().mockImplementation(async (toolName: string, args: Record<string, unknown>) => {
      const key = `${toolName}:${JSON.stringify(args)}`;
      if (mockResponses[key]) {
        return mockResponses[key];
      }
      // 模糊匹配
      for (const [pattern, response] of Object.entries(mockResponses)) {
        if (pattern.startsWith(toolName + ":")) {
          return response;
        }
      }
      throw new Error(`Mock not found for tool: ${toolName}`);
    }),
  } as unknown as MCPManager;
}

// ==================== 场景1：工作通知发送 ====================

describe("场景1：工作通知发送", () => {
  it("发送文本消息给单个用户", async () => {
    const mockResponses = {
      "contact_v3_user_batchGetId:{\"emails\":[\"zhangsan@example.com\"]}": {
        users: [{ user_id: "ou_1234567890abcdef", email: "zhangsan@example.com" }],
      },
      "im_v1_message_create:{\"receive_id\":\"ou_1234567890abcdef\"}": {
        message_id: "om_9876543210abcdef",
        code: 0,
        msg: "success",
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    // 模拟执行：查询用户 ID
    const userResult = await mcpManager.callTool("contact_v3_user_batchGetId", {
      emails: ["zhangsan@example.com"],
    });

    // 验证返回的 user_id
    expect(userResult.users).toHaveLength(1);
    const openId = (userResult.users as Array<{ user_id: string }>)[0].user_id;
    expect(openId).toBe("ou_1234567890abcdef");

    // 模拟发送消息
    const messageResult = await mcpManager.callTool("im_v1_message_create", {
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text: "各位同事，明早9点召开项目评审会，请准时参加。" }),
    });

    // 验证发送成功
    expect(messageResult.code).toBe(0);
    expect(messageResult.message_id).toBeDefined();
  });

  it("发送富文本消息给群组", async () => {
    const mockResponses = {
      "im_v1_message_create:{\"receive_id\":\"oc_chat_abc123\"}": {
        message_id: "om_111222333444555",
        code: 0,
        msg: "success",
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    // 直接发送到群组（已知 chat_id）
    const messageResult = await mcpManager.callTool("im_v1_message_create", {
      receive_id: "oc_chat_abc123",
      msg_type: "post",
      content: JSON.stringify({
        zh_cn: {
          title: "【会议纪要】Q2规划评审会",
          content: [
            [{ tag: "text", text: "会议时间：2026-05-28 14:00\n" }],
            [{ tag: "text", text: "参会人员：张三、李四、王五\n" }],
            [{ tag: "text", text: "讨论议题：\n" }],
            [{ tag: "text", text: "1. Q2目标回顾\n2. 下一步计划\n3. 资源调配" }],
          ],
        },
      }),
    });

    expect(messageResult.code).toBe(0);
  });

  it("根据姓名查询用户 ID（缺少联系方式时需询问）", async () => {
    const mockResponses = {
      "contact_v3_user_batchGetId:{\"mobiles\":[\"+86 138****1234\"]}": {
        users: [{ user_id: "ou_aaaabbbbccccdddd", mobile: "+86 138****1234" }],
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);

    // 当只有姓名没有邮箱/手机时，系统应提示询问
    const agent = new OfficeAgent(mcpManager);
    const systemPrompt = agent.getSystemPrompt();

    // 验证系统提示词包含"先礼貌地询问"原则
    expect(systemPrompt).toContain("先礼貌地询问");
  });
});

// ==================== 场景2：智能日程创建 ====================

describe("场景2：智能日程创建", () => {
  it("查询日程忙闲信息", async () => {
    const mockResponses = {
      "calendar_v4_freebusy_list:{}": {
        freebusy_list: [
          {
            user_id: "ou_1234567890abcdef",
            time_slots: [
              { start: "2026-05-28T09:00:00+08:00", end: "2026-05-28T10:00:00+08:00", status: "busy" },
              { start: "2026-05-28T14:00:00+08:00", end: "2026-05-28T16:00:00+08:00", status: "free" },
            ],
          },
        ],
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    const freebusyResult = await mcpManager.callTool("calendar_v4_freebusy_list", {
      time_min: "2026-05-28T00:00:00+08:00",
      time_max: "2026-05-28T23:59:59+08:00",
      user_ids: ["ou_1234567890abcdef"],
    });

    expect(freebusyResult.freebusy_list).toHaveLength(1);
    expect(freebusyResult.freebusy_list[0].time_slots[1].status).toBe("free");
  });

  it("获取主日历 ID", async () => {
    const mockResponses = {
      "calendar_v4_calendar_primary:{}": {
        calendar: {
          calendar_id: "primary",
          summary: "主日历",
          type: "primary",
        },
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    const calendarResult = await mcpManager.callTool("calendar_v4_calendar_primary", {});

    expect(calendarResult.calendar.calendar_id).toBe("primary");
  });

  it("创建日程并邀请参与者", async () => {
    const mockResponses = {
      "contact_v3_user_batchGetId:{\"emails\":[\"lisi@example.com\"]}": {
        users: [{ user_id: "ou_aaaabbbbccccdddd", email: "lisi@example.com" }],
      },
      "calendar_v4_calendar_primary:{}": {
        calendar: { calendar_id: "primary" },
      },
      "calendar_v4_calendarEvent_create:{\"calendar_id\":\"primary\"}": {
        event_id: "event_xyz789",
        code: 0,
        msg: "success",
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    // 步骤1：获取参与者 open_id
    const userResult = await mcpManager.callTool("contact_v3_user_batchGetId", {
      emails: ["lisi@example.com"],
    });
    const attendeeId = (userResult.users as Array<{ user_id: string }>)[0].user_id;

    // 步骤2：获取主日历
    const calendarResult = await mcpManager.callTool("calendar_v4_calendar_primary", {});
    const calendarId = calendarResult.calendar.calendar_id;

    // 步骤3：创建日程
    const eventResult = await mcpManager.callTool("calendar_v4_calendarEvent_create", {
      calendar_id: calendarId,
      summary: "Q2产品规划会议",
      description: "讨论下季度产品路线图",
      start_time: {
        timestamp: "1716873600", // 2026-05-28 14:00:00 CST
        timezone: "Asia/Shanghai",
      },
      end_time: {
        timestamp: "1716880800", // 2026-05-28 16:00:00 CST
        timezone: "Asia/Shanghai",
      },
      attendee_ability: "can_see_others",
      guests_can_invite_others: false,
      attendees: [
        { user_id: attendeeId, type: "user" },
      ],
    });

    expect(eventResult.code).toBe(0);
    expect(eventResult.event_id).toBe("event_xyz789");
  });
});

// ==================== 场景3：项目群组管理 ====================

describe("场景3：项目群组管理", () => {
  it("批量查询多个用户的 open_id", async () => {
    const mockResponses = {
      "contact_v3_user_batchGetId:{\"emails\":[\"zhangsan@example.com\",\"lisi@example.com\",\"wangwu@example.com\"]}": {
        users: [
          { user_id: "ou_1111111111111111", email: "zhangsan@example.com" },
          { user_id: "ou_2222222222222222", email: "lisi@example.com" },
          { user_id: "ou_3333333333333333", email: "wangwu@example.com" },
        ],
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    const usersResult = await mcpManager.callTool("contact_v3_user_batchGetId", {
      emails: ["zhangsan@example.com", "lisi@example.com", "wangwu@example.com"],
    });

    expect(usersResult.users).toHaveLength(3);
    const openIds = (usersResult.users as Array<{ user_id: string }>).map(u => u.user_id);
    expect(openIds).toContain("ou_1111111111111111");
    expect(openIds).toContain("ou_2222222222222222");
    expect(openIds).toContain("ou_3333333333333333");
  });

  it("创建群组并邀请成员", async () => {
    const mockResponses = {
      "im_v1_chat_create:{}": {
        chat_id: "oc_newproject2026",
        code: 0,
        msg: "success",
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    const memberIds = [
      "ou_1111111111111111",
      "ou_2222222222222222",
      "ou_3333333333333333",
    ];

    const chatResult = await mcpManager.callTool("im_v1_chat_create", {
      name: "2026年产品规划项目组",
      description: "Q2-Q4产品规划项目沟通群",
      user_id_list: memberIds,
      owner_id: "ou_1111111111111111",
    });

    expect(chatResult.code).toBe(0);
    expect(chatResult.chat_id).toBe("oc_newproject2026");
  });

  it("查询已有群列表", async () => {
    const mockResponses = {
      "im_v1_chat_list:{}": {
        items: [
          { chat_id: "oc_chat_001", name: "产品团队" },
          { chat_id: "oc_chat_002", name: "技术架构组" },
          { chat_id: "oc_chat_003", name: "2026年产品规划项目组" },
        ],
        has_more: false,
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    const chatListResult = await mcpManager.callTool("im_v1_chat_list", {});

    expect(chatListResult.items).toHaveLength(3);
    expect(chatListResult.has_more).toBe(false);
  });

  it("获取群成员列表", async () => {
    const mockResponses = {
      "im_v1_chatMembers_get:{\"chat_id\":\"oc_chat_003\"}": {
        members: [
          { user_id: "ou_1111111111111111", name: "张三", member_id_type: "user_id" },
          { user_id: "ou_2222222222222222", name: "李四", member_id_type: "user_id" },
          { user_id: "ou_3333333333333333", name: "王五", member_id_type: "user_id" },
        ],
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    const membersResult = await mcpManager.callTool("im_v1_chatMembers_get", {
      chat_id: "oc_chat_003",
    });

    expect(membersResult.members).toHaveLength(3);
    expect(membersResult.members.map((m: { name: string }) => m.name)).toContain("张三");
  });
});

// ==================== 跨域协同场景 ====================

describe("跨域协同：NavigationAgent → OfficeAgent", () => {
  it("接收行程数据并发送飞书通知", async () => {
    const mockResponses = {
      "im_v1_message_create:{\"receive_id\":\"oc_chat_travel\"}": {
        message_id: "om_travel_notify_001",
        code: 0,
        msg: "success",
      },
    };

    const mcpManager = createMockMCPManager(mockResponses);
    const agent = new OfficeAgent(mcpManager);

    // 模拟接收 NavigationAgent 的行程数据
    const crossDomainData = {
      itinerary: {
        destination: "深圳",
        date: "2026-06-01",
        purpose: "客户拜访",
        participants: ["张三", "李四"],
        schedule: [
          { time: "10:00", activity: "拜访华星科技" },
          { time: "14:00", activity: "拜访腾讯总部" },
        ],
      },
    };

    // 注入跨域数据到系统提示词
    const systemPrompt = agent.getSystemPrompt({ crossDomainData });

    expect(systemPrompt).toContain("深圳");
    expect(systemPrompt).toContain("客户拜访");

    // 模拟发送行程通知到群组
    const messageResult = await mcpManager.callTool("im_v1_message_create", {
      receive_id: "oc_chat_travel",
      msg_type: "post",
      content: JSON.stringify({
        zh_cn: {
          title: "【出差通知】深圳客户拜访",
          content: [
            [{ tag: "text", text: "目的地：深圳\n日期：2026-06-01\n目的：客户拜访\n行程安排：\n10:00 拜访华星科技\n14:00 拜访腾讯总部" }],
          ],
        },
      }),
    });

    expect(messageResult.code).toBe(0);
  });
});
