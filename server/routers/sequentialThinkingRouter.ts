/**
 * SmartAgent 序列思考路由
 * 
 * 提供序列思考的API端点，集成复杂度计算和序列思考模块
 */

import { Router, Request, Response } from 'express';
import complexityCalculator, { ComplexityResult } from '../services/complexityCalculator';
import sequentialThinking, { SequentialThinkingOutput } from '../services/sequentialThinking';

const router = Router();

/**
 * POST /api/sequential-thinking/analyze
 * 
 * 分析用户输入的复杂度，判断是否需要启动序列思考
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { userInput, context } = req.body;

    if (!userInput) {
      return res.status(400).json({
        error: '缺少必要参数: userInput',
      });
    }

    console.log(`[SequentialThinkingRouter] 分析复杂度: ${userInput}`);

    // 计算复杂度
    const complexity: ComplexityResult = complexityCalculator.calculate(userInput, context);

    console.log(`[SequentialThinkingRouter] 复杂度结果:`, complexity);

    return res.json({
      success: true,
      complexity,
    });
  } catch (error) {
    console.error('[SequentialThinkingRouter] 错误:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '分析失败',
    });
  }
});

/**
 * POST /api/sequential-thinking/process
 * 
 * 执行序列思考，返回多阶段思考结果
 */
router.post('/process', async (req: Request, res: Response) => {
  try {
    const {
      userInput,
      conversationHistory,
      memories,
      context,
      requiredTools,
      outputFormats,
    } = req.body;

    if (!userInput) {
      return res.status(400).json({
        error: '缺少必要参数: userInput',
      });
    }

    console.log(`[SequentialThinkingRouter] 启动序列思考: ${userInput}`);

    // 执行序列思考
    const result: SequentialThinkingOutput = await sequentialThinking.process({
      userInput,
      conversationHistory,
      memories,
      context,
      requiredTools,
      outputFormats,
    });

    console.log(`[SequentialThinkingRouter] 序列思考完成: ${result.taskId}`);

    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('[SequentialThinkingRouter] 错误:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '序列思考失败',
    });
  }
});

/**
 * POST /api/sequential-thinking/auto
 * 
 * 自动判断是否需要序列思考，如果需要则执行
 */
router.post('/auto', async (req: Request, res: Response) => {
  try {
    const {
      userInput,
      conversationHistory,
      memories,
      context,
      requiredTools,
      outputFormats,
    } = req.body;

    if (!userInput) {
      return res.status(400).json({
        error: '缺少必要参数: userInput',
      });
    }

    console.log(`[SequentialThinkingRouter] 自动判断: ${userInput}`);

    // 1. 分析复杂度
    const complexity: ComplexityResult = complexityCalculator.calculate(userInput, context);

    console.log(`[SequentialThinkingRouter] 复杂度: ${complexity.level}`);

    // 2. 如果需要序列思考，则执行
    if (complexity.shouldUseSequentialThinking) {
      console.log(`[SequentialThinkingRouter] 启动序列思考`);

      const result: SequentialThinkingOutput = await sequentialThinking.process({
        userInput,
        conversationHistory,
        memories,
        context,
        requiredTools: requiredTools || complexity.requiredTools,
        outputFormats: outputFormats || complexity.outputFormats,
      });

      return res.json({
        success: true,
        useSequentialThinking: true,
        complexity,
        result,
      });
    } else {
      console.log(`[SequentialThinkingRouter] 无需序列思考，直接处理`);

      return res.json({
        success: true,
        useSequentialThinking: false,
        complexity,
        message: '任务复杂度较低，建议直接处理',
      });
    }
  } catch (error) {
    console.error('[SequentialThinkingRouter] 错误:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '自动判断失败',
    });
  }
});

/**
 * GET /api/sequential-thinking/stages
 * 
 * 获取可用的思考阶段列表
 */
router.get('/stages', (req: Request, res: Response) => {
  const stages = [
    {
      id: 'problem_definition',
      name: '问题定义',
      description: '理解和分解用户需求，明确目标和约束',
      order: 1,
    },
    {
      id: 'information_gathering',
      name: '信息收集',
      description: '收集相关信息和上下文，利用可用工具',
      order: 2,
    },
    {
      id: 'analysis',
      name: '分析',
      description: '分析收集的信息，识别关键要素和模式',
      order: 3,
    },
    {
      id: 'synthesis',
      name: '综合',
      description: '综合分析结果，形成初步方案',
      order: 4,
    },
    {
      id: 'conclusion',
      name: '结论',
      description: '得出最终结论，提出建议和下一步行动',
      order: 5,
    },
  ];

  return res.json({
    success: true,
    stages,
  });
});

/**
 * GET /api/sequential-thinking/complexity-levels
 * 
 * 获取复杂度级别定义
 */
router.get('/complexity-levels', (req: Request, res: Response) => {
  const levels = [
    {
      level: 'LOW',
      score: '< 0.3',
      description: '简单任务',
      recommendation: '直接处理，无需序列思考',
      examples: ['查找文件', '打开应用', '列出文件'],
    },
    {
      level: 'MEDIUM',
      score: '0.3 - 0.6',
      description: '中等复杂度任务',
      recommendation: '如果涉及决策或分析，启动序列思考',
      examples: ['分析工作流程', '比较方案', '制定计划'],
    },
    {
      level: 'HIGH',
      score: '0.6 - 0.8',
      description: '复杂任务',
      recommendation: '启动序列思考',
      examples: ['深度分析', '生成报告', '制定策略'],
    },
    {
      level: 'VERY_HIGH',
      score: '> 0.8',
      description: '非常复杂任务',
      recommendation: '启动序列思考，可能需要并行处理',
      examples: ['综合研究', '多维度分析', '战略规划'],
    },
  ];

  return res.json({
    success: true,
    levels,
  });
});

/**
 * POST /api/sequential-thinking/test
 * 
 * 测试序列思考功能
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const testCases = [
      {
        name: '简单查询',
        input: '帮我找一下最近下载的PDF文件',
        expectedLevel: 'LOW',
      },
      {
        name: '中等复杂度',
        input: '分析一下我最近的工作流程，有哪些可以优化的地方',
        expectedLevel: 'MEDIUM',
      },
      {
        name: '高复杂度',
        input: '请深入分析我的工作习惯，包括时间分配、工具使用、效率指标，然后提出一个完整的优化方案',
        expectedLevel: 'HIGH',
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      const complexity = complexityCalculator.calculate(testCase.input);
      results.push({
        name: testCase.name,
        input: testCase.input,
        expectedLevel: testCase.expectedLevel,
        actualLevel: complexity.level,
        score: complexity.score,
        shouldUseThinking: complexity.shouldUseSequentialThinking,
        passed: complexity.level === testCase.expectedLevel,
      });
    }

    return res.json({
      success: true,
      testResults: results,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
      },
    });
  } catch (error) {
    console.error('[SequentialThinkingRouter] 测试错误:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '测试失败',
    });
  }
});

export default router;
