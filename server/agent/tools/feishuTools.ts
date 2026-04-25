/**
 * Feishu Tools — 飞书办公协同工具集（Mock 实现）
 *
 * 提供 feishu_send_message、feishu_create_event、feishu_create_group 三个内置工具，
 * 模拟飞书 API 的核心功能。
 * 当前为 Mock 实现，返回预设的成功响应，确保 Demo 演示稳定性。
 * 后续可平滑迁移为真实的飞书 MCP Server。
 *
 * 注册方式：内置工具（builtin），与 freeWeatherTools / memoryTools 模式一致。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";

// ==================== 常量 ====================

/** 内置飞书工具的 serverId */
export const FEISHU_TOOLS_SERVER_ID = "builtin-feishu-tools";

// ==================== 工具实现 ====================

/**
 * feishu_send_message — 发送飞书消息
 */
export function feishuSendMessageImpl(args: Record<string, unknown>): string {
  const chatId = args.chatId as string | undefined;
  const userId = args.userId as string | undefined;
  const content = args.content as string | undefined;
  const msgType = (args.msgType as string) || "text";

  // 参数校验
  if (!chatId && !userId) {
    return JSON.stringify({
      success: false,
      error: "chatId 或 userId 至少需要提供一个，用于指定消息接收方",
    });
  }

  if (!content || content.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "content 不能为空，请提供消息内容",
    });
  }

  // Mock 成功响应
  return JSON.stringify({
    success: true,
    messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    chatId: chatId || undefined,
    userId: userId || undefined,
    msgType,
    contentPreview: content.substring(0, 100),
    sentAt: new Date().toISOString(),
  });
}

/**
 * feishu_create_event — 创建飞书日程
 */
export function feishuCreateEventImpl(args: Record<string, unknown>): string {
  const title = args.title as string | undefined;
  const startTime = args.startTime as string | undefined;
  const endTime = args.endTime as string | undefined;
  const attendees = args.attendees as string[] | undefined;

  // 参数校验
  if (!title || title.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "title 不能为空，请提供日程标题",
    });
  }

  if (!startTime) {
    return JSON.stringify({
      success: false,
      error: "startTime 不能为空，请提供开始时间",
    });
  }

  // Mock 成功响应
  return JSON.stringify({
    success: true,
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    title,
    startTime,
    endTime: endTime || "未指定",
    attendees: attendees || [],
    createdAt: new Date().toISOString(),
  });
}

/**
 * feishu_create_group — 创建飞书群组
 */
export function feishuCreateGroupImpl(args: Record<string, unknown>): string {
  const name = args.name as string | undefined;
  const members = args.members as string[] | undefined;
  const description = args.description as string | undefined;

  // 参数校验
  if (!name || name.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "name 不能为空，请提供群组名称",
    });
  }

  // Mock 成功响应
  return JSON.stringify({
    success: true,
    chatId: `oc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name,
    description: description || "",
    members: members || [],
    memberCount: (members || []).length,
    createdAt: new Date().toISOString(),
  });
}

// ==================== 注册函数 ====================

/**
 * 将飞书工具注册到 ToolRegistry
 */
export function registerFeishuTools(registry: ToolRegistry): void {
  // 1. 发送消息
  registry.register({
    name: "feishu_send_message",
    description:
      "发送飞书消息。支持发送文本或富文本消息到指定群组（chatId）或用户（userId）。",
    inputSchema: {
      type: "object",
      properties: {
        chatId: {
          type: "string",
          description: "群组 ID（与 userId 二选一）",
        },
        userId: {
          type: "string",
          description: "用户 ID（与 chatId 二选一）",
        },
        content: {
          type: "string",
          description: "消息内容，支持文本和 Markdown 格式",
        },
        msgType: {
          type: "string",
          description: "消息类型：text（纯文本）或 interactive（富文本卡片），默认 text",
          enum: ["text", "interactive"],
        },
      },
      required: ["content"],
    },
    serverId: FEISHU_TOOLS_SERVER_ID,
    category: "office",
    registeredAt: new Date(),
  });

  // 2. 创建日程
  registry.register({
    name: "feishu_create_event",
    description:
      "创建飞书日程事件。支持设置标题、时间、参与者等。",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "日程标题",
        },
        startTime: {
          type: "string",
          description: "开始时间，ISO 8601 格式，如 2026-04-26T09:00:00+08:00",
        },
        endTime: {
          type: "string",
          description: "结束时间，ISO 8601 格式",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "参与者用户 ID 列表",
        },
        description: {
          type: "string",
          description: "日程描述",
        },
      },
      required: ["title", "startTime"],
    },
    serverId: FEISHU_TOOLS_SERVER_ID,
    category: "office",
    registeredAt: new Date(),
  });

  // 3. 创建群组
  registry.register({
    name: "feishu_create_group",
    description:
      "创建飞书群组并邀请成员。返回群组 ID，可用于后续发送消息。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "群组名称",
        },
        members: {
          type: "array",
          items: { type: "string" },
          description: "初始成员用户 ID 列表",
        },
        description: {
          type: "string",
          description: "群组描述",
        },
      },
      required: ["name"],
    },
    serverId: FEISHU_TOOLS_SERVER_ID,
    category: "office",
    registeredAt: new Date(),
  });
}

/**
 * 调用飞书工具（供 ToolRegistry 的 callTool 使用）
 */
export async function callFeishuTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "feishu_send_message":
      return feishuSendMessageImpl(args);
    case "feishu_create_event":
      return feishuCreateEventImpl(args);
    case "feishu_create_group":
      return feishuCreateGroupImpl(args);
    default:
      return JSON.stringify({ error: `未知的飞书工具: ${toolName}` });
  }
}
