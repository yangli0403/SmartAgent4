/**
 * 增强版聊天路由模块
 * 集成序列思考和记忆模块的聊天API
 */

import { Router, Request, Response } from 'express';
import { chat, ChatRequest } from '../services/llmService';
import type { Message } from '../llm/bytedance';
import complexityCalculator from '../services/complexityCalculator';
import sequentialThinking from '../services/sequentialThinking';

const router = Router();

// 会话历史缓存（生产环境应使用Redis或数据库）
const sessionHistory: Map<string, Message[]> = new Map();

/**
 * 发送消息（增强版 - 集成序列思考和记忆）
 * POST /api/chat/send-enhanced
 */
router.post('/send-enhanced', async (req: Request, res: Response) => {
  try {
    const { user_id, session_id, message, use_memory = true, use_sequential_thinking = true } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({
        success: false,
        message: 'user_id and message are required',
      });
    }

    // 获取会话历史
    const historyKey = `${user_id}:${session_id || 'default'}`;
    const conversationHistory = sessionHistory.get(historyKey) || [];

    // 第1步：计算复杂度
    const complexity = complexityCalculator.calculate(message);

    // 第2步：获取用户记忆（目前统一使用 MySQL 记忆体系，增强聊天暂不额外检索，传入空数组占位）
    const memories: any[] = [];
    const userProfile: any = null;

    // 第3步：判断是否启动序列思考
    let thinkingResult = null;
    if (use_sequential_thinking && complexity.shouldUseSequentialThinking) {
      try {
        thinkingResult = await sequentialThinking.process({
          userInput: message,
          conversationHistory,
          memories,
          context: {
            userId: user_id,
            sessionId: session_id,
            userProfile,
          },
          requiredTools: complexity.requiredTools,
          outputFormats: complexity.outputFormats,
        });
      } catch (error) {
        console.warn('Sequential thinking failed:', error);
      }
    }

    // 第4步：生成响应
    let response: string;
    if (thinkingResult) {
      // 使用序列思考的结果
      response = thinkingResult.finalConclusion;

      // 添加建议
      if (thinkingResult.recommendations && thinkingResult.recommendations.length > 0) {
        response += '\n\n**建议：**\n' + thinkingResult.recommendations.map(r => `- ${r}`).join('\n');
      }

      // 添加下一步
      if (thinkingResult.nextSteps && thinkingResult.nextSteps.length > 0) {
        response += '\n\n**下一步：**\n' + thinkingResult.nextSteps.map(s => `- ${s}`).join('\n');
      }
    } else {
      // 使用普通聊天
      const chatRequest: ChatRequest = {
        userId: user_id,
        sessionId: session_id,
        message,
        conversationHistory,
      };

      const result = await chat(chatRequest);
      response = result.response;
    }

    // 第5步：更新会话历史
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: response });

    // 限制历史长度
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, conversationHistory.length - 20);
    }

    sessionHistory.set(historyKey, conversationHistory);

    // 第6步：更新记忆（增强聊天暂不直接写入统一记忆，由主聊天负责记忆形成）

    // 返回响应
    res.json({
      success: true,
      response,
      complexity: {
        score: complexity.score,
        level: complexity.level,
        shouldUseSequentialThinking: complexity.shouldUseSequentialThinking,
      },
      thinking: thinkingResult ? {
        taskId: thinkingResult.taskId,
        stages: thinkingResult.stages.map(s => ({
          name: s.name,
          description: s.description,
          duration: s.duration,
        })),
        totalDuration: thinkingResult.totalDuration,
        recommendations: thinkingResult.recommendations,
      } : null,
      userProfile: userProfile ? {
        name: userProfile.basic_info?.name || userProfile.user_id,
        interests: userProfile.interests,
      } : null,
    });
  } catch (error) {
    console.error('Enhanced chat error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * 分析消息复杂度
 * POST /api/chat/analyze
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'message is required',
      });
    }

    const complexity = complexityCalculator.calculate(message);

    res.json({
      success: true,
      complexity,
    });
  } catch (error) {
    console.error('Analyze error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * 获取会话历史
 * GET /api/chat/history
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { user_id, session_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'user_id is required',
      });
    }

    const historyKey = `${user_id}:${session_id || 'default'}`;
    const history = sessionHistory.get(historyKey) || [];

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * 清除会话历史
 * DELETE /api/chat/history
 */
router.delete('/history', async (req: Request, res: Response) => {
  try {
    const { user_id, session_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'user_id is required',
      });
    }

    const historyKey = `${user_id}:${session_id || 'default'}`;
    sessionHistory.delete(historyKey);

    res.json({
      success: true,
      message: 'History cleared',
    });
  } catch (error) {
    console.error('Clear history error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * 流式聊天（SSE）- 增强版
 * POST /api/chat/stream-enhanced
 */
router.post('/stream-enhanced', async (req: Request, res: Response) => {
  try {
    const { user_id, session_id, message, use_memory = true, use_sequential_thinking = true } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({
        success: false,
        message: 'user_id and message are required',
      });
    }

    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 获取会话历史
    const historyKey = `${user_id}:${session_id || 'default'}`;
    const conversationHistory = sessionHistory.get(historyKey) || [];

    // 计算复杂度
    const complexity = complexityCalculator.calculate(message);
    res.write(`data: ${JSON.stringify({ type: 'complexity', complexity })}\n\n`);

    // 获取记忆（增强聊天暂不额外检索记忆，传入空数组占位）
    const memories: any[] = [];

    // 执行序列思考
    let thinkingResult = null;
    if (use_sequential_thinking && complexity.shouldUseSequentialThinking) {
      try {
        thinkingResult = await sequentialThinking.process({
          userInput: message,
          conversationHistory,
          memories,
          requiredTools: complexity.requiredTools,
          outputFormats: complexity.outputFormats,
        });

        // 发送思考过程
        for (const stage of thinkingResult.stages) {
          res.write(`data: ${JSON.stringify({ type: 'thinking_stage', stage: { name: stage.name, duration: stage.duration } })}\n\n`);
        }
      } catch (error) {
        console.warn('Sequential thinking failed:', error);
      }
    }

    // 生成响应
    const response = thinkingResult ? thinkingResult.finalConclusion : (await chat({ userId: user_id, sessionId: session_id, message, conversationHistory })).response;

    // 流式输出响应
    const words = response.split('');
    for (let i = 0; i < words.length; i++) {
      res.write(`data: ${JSON.stringify({ type: 'content', content: words[i], done: false })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'complete', done: true, thinking: thinkingResult ? { taskId: thinkingResult.taskId, totalDuration: thinkingResult.totalDuration } : null })}\n\n`);

    // 更新会话历史
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: response });

    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, conversationHistory.length - 20);
    }

    sessionHistory.set(historyKey, conversationHistory);

    res.end();
  } catch (error) {
    console.error('Stream enhanced chat error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Internal server error', done: true })}\n\n`);
    res.end();
  }
});

export default router;
