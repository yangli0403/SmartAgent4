/**
 * ServiceAgent — 生活服务专员
 *
 * 负责处理餐厅搜索、外卖下单等生活服务任务。
 * 绑定 serviceTools（search_restaurants / place_order）。
 */
import { BaseAgent } from "./baseAgent";
import type {
  DomainAgentConfig,
  AgentStructuredData,
} from "./types";
import type { MCPManager } from "../../mcp/mcpManager";

/** ServiceAgent 默认配置 */
export const SERVICE_AGENT_CONFIG: DomainAgentConfig = {
  name: "serviceAgent",
  description: "生活服务专员，负责餐厅搜索、外卖下单、生活服务推荐等任务",
  systemPrompt: `你是一个生活服务专员，擅长帮助用户搜索餐厅、推荐美食和下单外卖。

## 核心能力
1. 根据用户的口味偏好、位置和预算搜索合适的餐厅
2. 帮助用户在选定的餐厅下单外卖
3. 提供餐饮推荐和美食建议

## 操作原则
1. 搜索餐厅时优先考虑用户的口味偏好和位置
2. 推荐时展示评分、人均价格、距离等关键信息
3. 下单前确认餐厅和菜品信息
4. 对于模糊的需求（如"附近有什么好吃的"），主动搜索并推荐多个选项
5. 保持友好、热情的服务态度`,
  toolNames: [
    "search_restaurants",
    "place_order",
  ],
  maxIterations: 5,
  temperature: 0.5,
  maxTokens: 4000,
};

/**
 * ServiceAgent 实现
 */
export class ServiceAgent extends BaseAgent {
  readonly name = SERVICE_AGENT_CONFIG.name;
  readonly description = SERVICE_AGENT_CONFIG.description;
  readonly availableTools: string[];

  constructor(mcpManager: MCPManager, config?: Partial<DomainAgentConfig>) {
    const mergedConfig = { ...SERVICE_AGENT_CONFIG, ...config };
    super(mergedConfig, mcpManager);
    this.availableTools = mergedConfig.toolNames;
  }

  /**
   * 获取系统提示词（注入上下文）
   */
  getSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.config.systemPrompt;

    if (context?.location) {
      prompt += `\n当前位置: ${JSON.stringify(context.location)}`;
    }

    if (context?.currentTime) {
      prompt += `\n当前时间: ${context.currentTime}`;
    }

    // 注入用户召回记忆（偏好、习惯等），确保推荐时参考用户喜好
    const memories = context?.retrievedMemories as string[] | undefined;
    if (memories && memories.length > 0) {
      prompt += `\n\n## 用户记忆（请在推荐时优先参考）\n${memories.join("\n")}`;
    }

    return prompt;
  }

  /**
   * 生活服务数据的结构化解析
   */
  protected parseStructuredData(output: string): AgentStructuredData | undefined {
    // 尝试从输出中解析服务数据
    try {
      if (output.includes("restaurants") || output.includes("餐厅")) {
        return {
          type: "general",
          dataKind: "service",
          rawOutput: output,
        };
      }
    } catch {
      // 解析失败时返回 undefined
    }
    return undefined;
  }
}
