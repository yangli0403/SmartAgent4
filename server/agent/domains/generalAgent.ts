/**
 * GeneralAgent — 通用对话专员
 *
 * 负责处理不属于特定领域的通用对话、知识问答等任务。
 * 不绑定 MCP 工具，纯 LLM 对话。
 * 内部运行 LangGraph ReACT 循环（继承 BaseAgent，无工具时直接返回 LLM 回复）。
 */

import { BaseAgent } from "./baseAgent";
import type {
  DomainAgentConfig,
  AgentStructuredData,
  GeneralData,
} from "./types";
import type { MCPManager } from "../../mcp/mcpManager";

/** GeneralAgent 默认配置 */
export const GENERAL_AGENT_CONFIG: DomainAgentConfig = {
  name: "generalAgent",
  description: "通用对话专员，负责知识问答、闲聊、建议等通用任务",
  systemPrompt: `你是一个智能助手，擅长回答各种问题、提供建议、进行友好的对话，以及完成创意写作任务。

操作原则：
1. 回答准确、有条理
2. 对于不确定的信息，诚实说明
3. 根据用户的语气和需求调整回复风格
4. 提供有价值的补充信息和建议
5. 保持友好、专业的态度
6. 当用户要求写诗、写故事、写文章等创意写作任务时，必须直接输出完整的创作内容，不要只回复评论性文字`,
  toolNames: [],
  maxIterations: 1,
  temperature: 0.7,
  maxTokens: 4000,
};

/**
 * GeneralAgent 实现
 */
export class GeneralAgent extends BaseAgent {
  readonly name = GENERAL_AGENT_CONFIG.name;
  readonly description = GENERAL_AGENT_CONFIG.description;
  readonly availableTools: string[];

  constructor(mcpManager: MCPManager, config?: Partial<DomainAgentConfig>) {
    const mergedConfig = { ...GENERAL_AGENT_CONFIG, ...config };
    super(mergedConfig, mcpManager);
    this.availableTools = mergedConfig.toolNames;
  }

  /**
   * 获取系统提示词（注入性格和风格）
   */
  getSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.config.systemPrompt;

    if (context?.personality) {
      prompt += `\n\n性格模式: ${context.personality}`;
    }

    if (context?.responseStyle) {
      prompt += `\n回复风格: ${context.responseStyle}`;
    }

    if (context?.currentTime) {
      prompt += `\n当前时间: ${context.currentTime}`;
    }

    return prompt;
  }

  /**
   * 通用数据不需要结构化解析
   */
  protected parseStructuredData(_output: string): AgentStructuredData | undefined {
    return undefined;
  }
}
