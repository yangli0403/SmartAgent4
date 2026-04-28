/**
 * OfficeAgent — 办公协同专员
 *
 * 负责处理飞书消息发送、日程创建、群组管理等办公协同任务。
 * 通过飞书 MCP Server 调用真实的飞书 API。
 *
 * 跨域协同：
 * - 当 Supervisor 的 planNode 生成跨域计划时，OfficeAgent 可接收前置步骤
 *   （如 NavigationAgent 的行程规划结果）作为 resolvedInputs，
 *   并将其格式化后通过飞书发送给指定群组或用户。
 */
import { BaseAgent } from "./baseAgent";
import type {
  DomainAgentConfig,
  AgentStructuredData,
} from "./types";
import type { MCPManager } from "../../mcp/mcpManager";

/** OfficeAgent 默认配置 */
export const OFFICE_AGENT_CONFIG: DomainAgentConfig = {
  name: "officeAgent",
  description: "办公协同专员，负责飞书消息发送、日程创建、群组管理等办公任务",
  systemPrompt: `你是一个办公协同专员，擅长使用飞书相关工具完成办公任务。

## 核心能力
1. 通过通讯录查询用户 ID（邮箱/手机号 → open_id）
2. 发送飞书消息（文本、富文本）到指定群组或用户
3. 创建飞书日程事件
4. 创建飞书群组并邀请成员
5. 查询群列表、群成员、会话历史消息
6. 查询日程忙闲信息

## 发送消息的标准流程（必须严格遵守）
当用户要求给某人发消息时，按以下步骤执行：

**步骤1：获取收件人的 open_id**
- 如果已有邮箱，调用 contact_v3_user_batchGetId 查询，将邮箱放入 emails 字段
- 如果已有手机号，调用 contact_v3_user_batchGetId 查询，将手机号放入 mobiles 字段
- 从返回结果中提取 user_id 字段，这就是 open_id

**步骤2：使用 open_id 发送消息**
- 调用 im_v1_message_create，将步骤1获取的 open_id 作为 receive_id 发送消息

**重要**：必须先完成步骤1拿到 open_id，才能执行步骤2。不要跳过任何步骤。
如果用户只提供了姓名没有邮箱或手机号，先礼貌地询问。

## 创建日程的流程
1. 如果需要邀请参与者，先通过 contact_v3_user_batchGetId 获取其 open_id
2. 查询主日历 calendar_v4_calendar_primary，获取 calendar_id
3. 调用 calendar_v4_calendarEvent_create 创建日程

## 创建群组的流程
1. 先通过 contact_v3_user_batchGetId 获取所有成员的 open_id
2. 调用 im_v1_chat_create 创建群组

## 操作原则
1. 所有工具的参数格式请严格参照下方“工具参数格式指引”，不要自行猜测或简化参数结构
2. 所有操作完成后给出明确的执行结果反馈
3. 当接收到来自其他 Agent 的数据（如行程规划），应将其格式化为易读的消息内容
4. 遇到错误时，向用户清晰说明原因并建议解决方案

## 跨域协同指引
- 当 resolvedInputs 中包含行程数据时，将其格式化为飞书消息发送
- 当 resolvedInputs 中包含餐厅信息时，整理为推荐列表发送
- 始终保持数据的完整性，不要遗漏关键信息`,
  toolNames: [
    "contact_v3_user_batchGetId",
    "im_v1_message_create",
    "im_v1_message_list",
    "im_v1_chat_create",
    "im_v1_chat_list",
    "im_v1_chatMembers_get",
    "calendar_v4_calendarEvent_create",
    "calendar_v4_calendarEvent_get",
    "calendar_v4_calendarEvent_patch",
    "calendar_v4_freebusy_list",
    "calendar_v4_calendar_primary",
  ],
  maxIterations: 8,
  temperature: 0.3,
  maxTokens: 4000,
};

/**
 * OfficeAgent 实现
 */
export class OfficeAgent extends BaseAgent {
  readonly name = OFFICE_AGENT_CONFIG.name;
  readonly description = OFFICE_AGENT_CONFIG.description;
  readonly availableTools: string[];

  constructor(mcpManager: MCPManager, config?: Partial<DomainAgentConfig>) {
    const mergedConfig = { ...OFFICE_AGENT_CONFIG, ...config };
    super(mergedConfig, mcpManager);
    this.availableTools = mergedConfig.toolNames;
  }

  /**
   * 获取系统提示词（注入上下文）
   */
  getSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.config.systemPrompt;

    if (context?.currentTime) {
      prompt += `\n当前时间: ${context.currentTime}`;
    }

    if (context?.crossDomainData) {
      prompt += `\n\n## 跨域数据\n以下是来自其他 Agent 的数据，请根据用户指令进行处理：\n${JSON.stringify(context.crossDomainData, null, 2)}`;
    }

    return prompt;
  }

  /**
   * 办公数据不需要结构化解析
   */
  protected parseStructuredData(_output: string): AgentStructuredData | undefined {
    return undefined;
  }
}
