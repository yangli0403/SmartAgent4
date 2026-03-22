/**
 * LLM服务模块
 * 用于与大语言模型进行交互，集成记忆系统
 */

import { callLLM, type Message } from "../llm/bytedance";

// ==================== 类型定义 ====================

export interface ChatRequest {
  userId: string;
  sessionId?: string;
  message: string;
  conversationHistory?: Message[];
}

export interface ChatResponse {
  response: string;
  memoriesUsed: number;
  tokensUsed?: number;
}

// ==================== 系统提示词模板 ====================

const BASE_SYSTEM_PROMPT = `你是SmartAgent，一个智能、有记忆的AI助手。

你的核心特点：
1. **记忆能力**：你能记住用户的偏好、习惯和过去的对话内容
2. **个性化服务**：根据用户的特点调整你的回答风格
3. **主动关怀**：在适当的时候主动提供帮助和建议
4. **专业可靠**：提供准确、有用的信息

当前时间：{current_time}
`;

// ==================== 辅助函数 ====================

/**
 * 构建系统提示词（不再依赖外部 Python 记忆服务，只带当前时间与基础说明）
 */
function buildSystemPrompt(): string {
  const currentTime = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
  });

  return BASE_SYSTEM_PROMPT.replace('{current_time}', currentTime);
}

// ==================== 主要功能 ====================

/**
 * 发送消息并获取AI回复
 */
export async function chat(request: ChatRequest): Promise<ChatResponse> {
  const { userId, sessionId, message, conversationHistory = [] } = request;

  try {
    // Step 1: 构建系统提示词（不依赖外部记忆服务）
    const systemPrompt = buildSystemPrompt();

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.filter(m => m.role !== 'system'),
      { role: 'user', content: message },
    ];

    // Step 2: 调用LLM
    const response = await callLLM(messages, {
      temperature: 0.7,
      maxTokens: 2000,
    });

    const responseContent = response.content || '抱歉，我无法生成回复。';
    const tokensUsed = response.usage?.totalTokens;

    return {
      response: responseContent,
      memoriesUsed: 0,
      tokensUsed,
    };
  } catch (error) {
    console.error('Chat error:', error);
    throw error;
  }
}

/**
 * 获取对话历史（从数据库）
 */
export async function getConversationHistory(
  userId: string,
  limit: number = 50
): Promise<Message[]> {
  // 这里应该从数据库获取对话历史
  // 暂时返回空数组，实际实现需要连接数据库
  return [];
}

/**
 * 检查LLM服务是否可用
 */
export async function isLLMAvailable(): Promise<boolean> {
  try {
    const testResponse = await callLLM([
      { role: 'user', content: 'test' }
    ], {
      maxTokens: 5,
    });
    return !!testResponse.content;
  } catch {
    return false;
  }
}
