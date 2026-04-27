/**
 * GeneralAgent — 通用对话专员
 *
 * 负责处理不属于特定领域的通用对话、知识问答等任务。
 * 记忆系统技能化改造后，绑定记忆管理工具，具备主动记忆调度能力。
 * 内部运行 LangGraph ReACT 循环（继承 BaseAgent）。
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
  description: "通用对话专员，负责知识问答、闲聊、建议等通用任务，具备记忆管理能力",
  systemPrompt: `你是一个智能助手，擅长回答各种问题、提供建议、进行友好的对话，以及完成创意写作任务。
操作原则：
1. 回答准确、有条理
2. 对于不确定的信息，诚实说明
3. 根据用户的语气和需求调整回复风格
4. 提供有价值的补充信息和建议
5. 保持友好、专业的态度
6. 当用户要求写诗、写故事、写文章等创意写作任务时，必须直接输出完整的创作内容，不要只回复评论性文字
7. 你具备记忆管理能力，必须主动使用记忆工具：
   - 当用户表达个人偏好、习惯、身份信息（如"我喜欢…""我是…""我常常…"）时，必须立即调用 memory_store 存储该信息
   - 当用户说"不再喜欢…""换成…""不要…了"等修正偏好时，必须先调用 memory_search 找到旧记忆，再调用 memory_update 更新
   - 当需要个性化回复时，先调用 memory_search 查找用户相关记忆
   - 调用示例：memory_store({"content": "用户喜欢科技和AI领域的新闻", "category": "preference"})
8. 当用户询问"新闻""资讯""最近发生了什么"等时效信息时，必须调用 get_latest_news 工具获取实时内容，不要凭记忆估答。如果已从记忆中召回了用户偏好（如"喜欢 AI/体育新闻"），则在调用时将偏好作为 category 或 q 参数传入，后续答复只从工具返回的条目中挑选，并为每条附上“来源 + 发布时间”。`,
  toolNames: [
    "memory_store",
    "memory_search",
    "memory_update",
    "memory_forget",
    "get_latest_news",
  ],
  maxIterations: 5,
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
