/**
 * OfficeAgent — 办公协同专员
 *
 * 负责处理飞书消息发送、日程创建、群组管理等办公协同任务。
 * 当前绑定 Mock 飞书工具（feishu_send_message / feishu_create_event / feishu_create_group），
 * 后续可平滑迁移为真实的飞书 MCP Server。
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
1. 发送飞书消息（文本、富文本）到指定群组或用户
2. 创建飞书日程事件
3. 创建飞书群组并邀请成员

## 操作原则
1. 发送消息前确认接收方信息（群组 ID 或用户 ID）
2. 日程创建时确保时间格式正确
3. 群组操作时确认成员列表
4. 当接收到来自其他 Agent 的数据（如行程规划），应将其格式化为易读的消息内容
5. 所有操作完成后给出明确的执行结果反馈

## 跨域协同指引
- 当 resolvedInputs 中包含行程数据时，将其格式化为飞书消息发送
- 当 resolvedInputs 中包含餐厅信息时，整理为推荐列表发送
- 始终保持数据的完整性，不要遗漏关键信息`,
  toolNames: [
    "feishu_send_message",
    "feishu_create_event",
    "feishu_create_group",
  ],
  maxIterations: 5,
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
