/**
 * SmartAgent 序列思考模块
 * 
 * 基于Eigent的序列思考工具，为复杂任务提供结构化的多阶段思考能力
 * 支持思考过程记录、中间结果保存和最终综合
 */

import { callLLM, type Message } from "../llm/bytedance";

export interface ThinkingStage {
  name: string;
  description: string;
  prompt: string;
  result?: string;
  timestamp?: string;
  duration?: number;
}

export interface SequentialThinkingInput {
  userInput: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  memories?: any[];
  context?: Record<string, any>;
  requiredTools?: string[];
  outputFormats?: string[];
}

export interface SequentialThinkingOutput {
  taskId: string;
  userInput: string;
  stages: ThinkingStage[];
  finalConclusion: string;
  recommendations: string[];
  nextSteps: string[];
  totalDuration: number;
  memoryUpdates: Record<string, any>;
}

export class SequentialThinkingModule {
  // 思考阶段定义
  private readonly THINKING_STAGES = [
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

  /**
   * 执行序列思考
   */
  async process(input: SequentialThinkingInput): Promise<SequentialThinkingOutput> {
    const taskId = this.generateTaskId();
    const startTime = Date.now();
    const stages: ThinkingStage[] = [];

    console.log(`[SequentialThinking] 启动序列思考任务: ${taskId}`);
    console.log(`[SequentialThinking] 用户输入: ${input.userInput}`);

    try {
      // 1. 问题定义阶段
      const problemStage = await this.executeProblemDefinition(input);
      stages.push(problemStage);

      // 2. 信息收集阶段
      const infoStage = await this.executeInformationGathering(input, problemStage);
      stages.push(infoStage);

      // 3. 分析阶段
      const analysisStage = await this.executeAnalysis(input, stages);
      stages.push(analysisStage);

      // 4. 综合阶段
      const synthesisStage = await this.executeSynthesis(input, stages);
      stages.push(synthesisStage);

      // 5. 结论阶段
      const conclusionStage = await this.executeConclusion(input, stages);
      stages.push(conclusionStage);

      // 生成最终输出
      const finalConclusion = conclusionStage.result || '';
      const recommendations = this.extractRecommendations(finalConclusion);
      const nextSteps = this.extractNextSteps(finalConclusion);
      const memoryUpdates = this.generateMemoryUpdates(input, stages);

      const totalDuration = Date.now() - startTime;

      console.log(`[SequentialThinking] 任务完成: ${taskId} (耗时: ${totalDuration}ms)`);

      return {
        taskId,
        userInput: input.userInput,
        stages,
        finalConclusion,
        recommendations,
        nextSteps,
        totalDuration,
        memoryUpdates,
      };
    } catch (error) {
      console.error(`[SequentialThinking] 错误: ${error}`);
      throw error;
    }
  }

  /**
   * 问题定义阶段
   */
  private async executeProblemDefinition(input: SequentialThinkingInput): Promise<ThinkingStage> {
    const startTime = Date.now();

    const prompt = `
请分析以下用户需求，并提供清晰的问题定义：

用户输入: "${input.userInput}"

请回答以下问题：
1. 用户的核心需求是什么？
2. 任务的主要目标是什么？
3. 有哪些关键的约束或限制？
4. 需要哪些信息来完成这个任务？
5. 预期的输出形式是什么？

请以结构化的方式组织你的回答。
    `;

    const result = await this.generateThinkingResult(prompt, input);

    return {
      name: '问题定义',
      description: '理解和分解用户需求，明确目标和约束',
      prompt,
      result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * 信息收集阶段
   */
  private async executeInformationGathering(
    input: SequentialThinkingInput,
    problemStage: ThinkingStage
  ): Promise<ThinkingStage> {
    const startTime = Date.now();

    const toolsInfo = input.requiredTools
      ? `可用工具: ${input.requiredTools.join(', ')}`
      : '暂无可用工具';

    const memoriesInfo = input.memories
      ? `相关记忆: ${JSON.stringify(input.memories.slice(0, 3))}`
      : '暂无相关记忆';

    const prompt = `
基于以下问题定义，请规划信息收集策略：

问题定义:
${problemStage.result}

${toolsInfo}
${memoriesInfo}

请回答以下问题：
1. 需要收集哪些关键信息？
2. 如何利用可用工具来收集这些信息？
3. 从对话历史和记忆中可以获得哪些有用信息？
4. 还需要哪些额外的信息？
5. 信息收集的优先级是什么？

请提供具体的收集计划。
    `;

    const result = await this.generateThinkingResult(prompt, input);

    return {
      name: '信息收集',
      description: '收集相关信息和上下文，利用可用工具',
      prompt,
      result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * 分析阶段
   */
  private async executeAnalysis(
    input: SequentialThinkingInput,
    previousStages: ThinkingStage[]
  ): Promise<ThinkingStage> {
    const startTime = Date.now();

    const previousResults = previousStages
      .map((stage) => `${stage.name}:\n${stage.result}`)
      .join('\n\n');

    const prompt = `
基于以下信息收集结果，请进行深度分析：

${previousResults}

用户原始需求: "${input.userInput}"

请进行以下分析：
1. 信息中的关键要素是什么？
2. 有哪些模式或趋势可以识别？
3. 信息之间有什么关联性？
4. 有哪些潜在的问题或风险？
5. 有哪些机会或优势？

请提供结构化的分析结果。
    `;

    const result = await this.generateThinkingResult(prompt, input);

    return {
      name: '分析',
      description: '分析收集的信息，识别关键要素和模式',
      prompt,
      result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * 综合阶段
   */
  private async executeSynthesis(
    input: SequentialThinkingInput,
    previousStages: ThinkingStage[]
  ): Promise<ThinkingStage> {
    const startTime = Date.now();

    const previousResults = previousStages
      .map((stage) => `${stage.name}:\n${stage.result}`)
      .join('\n\n');

    const prompt = `
基于以下分析结果，请综合形成方案：

${previousResults}

用户原始需求: "${input.userInput}"

请进行以下综合：
1. 基于分析结果，最佳的解决方案是什么？
2. 有哪些可选方案？各有什么优缺点？
3. 推荐哪个方案？为什么？
4. 实施这个方案需要哪些步骤？
5. 预期的结果和收益是什么？

请提供清晰的综合方案。
    `;

    const result = await this.generateThinkingResult(prompt, input);

    return {
      name: '综合',
      description: '综合分析结果，形成初步方案',
      prompt,
      result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * 结论阶段
   */
  private async executeConclusion(
    input: SequentialThinkingInput,
    previousStages: ThinkingStage[]
  ): Promise<ThinkingStage> {
    const startTime = Date.now();

    const previousResults = previousStages
      .map((stage) => `${stage.name}:\n${stage.result}`)
      .join('\n\n');

    const prompt = `
基于以上所有分析和综合，请得出最终结论：

${previousResults}

用户原始需求: "${input.userInput}"

请提供以下内容：
1. 最终结论和建议
2. 关键要点总结（3-5个）
3. 具体的行动建议（3-5个）
4. 下一步应该做什么？
5. 有哪些需要注意的事项？

请以清晰、可执行的方式组织你的回答。
    `;

    const result = await this.generateThinkingResult(prompt, input);

    return {
      name: '结论',
      description: '得出最终结论，提出建议和下一步行动',
      prompt,
      result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * 生成思考结果（调用LLM）
   */
  private async generateThinkingResult(
    prompt: string,
    input: SequentialThinkingInput
  ): Promise<string> {
    try {
      const messages: Message[] = [
        {
          role: 'system',
          content: '你是一个专业的分析助手，擅长结构化思考和深度分析。请根据用户的需求，提供清晰、有条理的回答。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      // 如果有对话历史，添加到上下文中
      if (input.conversationHistory && input.conversationHistory.length > 0) {
        const recentHistory = input.conversationHistory.slice(-5); // 只使用最近5条
        for (const msg of recentHistory) {
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      }

      const response = await callLLM(messages, {
        temperature: 0.7,
        maxTokens: 2000,
      });

      return response.content || '无法生成思考结果';
    } catch (error) {
      console.error('[SequentialThinking] LLM调用失败:', error);
      // 返回一个基本的错误提示
      return '思考过程遇到错误，请稍后重试。';
    }
  }

  /**
   * 提取建议
   */
  private extractRecommendations(conclusion: string): string[] {
    const recommendations: string[] = [];

    // 简单的正则表达式提取
    const lines = conclusion.split('\n');
    let inRecommendations = false;

    for (const line of lines) {
      if (line.includes('建议') || line.includes('Recommendation') || line.includes('行动建议')) {
        inRecommendations = true;
        continue;
      }

      if (inRecommendations && (line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim()))) {
        const cleaned = line.trim().replace(/^[-•\d.]+\s*/, '').trim();
        if (cleaned) {
          recommendations.push(cleaned);
        }
      }

      if (inRecommendations && line.trim() === '' && recommendations.length > 0) {
        inRecommendations = false;
      }
    }

    // 如果没有提取到，返回默认建议
    if (recommendations.length === 0) {
      recommendations.push('根据分析结果，建议采用系统化方法优化工作流程');
      recommendations.push('充分利用现有工具的功能');
      recommendations.push('定期评估和调整策略');
    }

    return recommendations.slice(0, 5); // 最多返回5条
  }

  /**
   * 提取下一步行动
   */
  private extractNextSteps(conclusion: string): string[] {
    const nextSteps: string[] = [];

    // 简单的正则表达式提取
    const lines = conclusion.split('\n');
    let inNextSteps = false;

    for (const line of lines) {
      if (line.includes('下一步') || line.includes('Next Steps') || line.includes('应该做什么')) {
        inNextSteps = true;
        continue;
      }

      if (inNextSteps && (line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim()))) {
        const cleaned = line.trim().replace(/^[-•\d.]+\s*/, '').trim();
        if (cleaned) {
          nextSteps.push(cleaned);
        }
      }

      if (inNextSteps && line.trim() === '' && nextSteps.length > 0) {
        inNextSteps = false;
      }
    }

    // 如果没有提取到，返回默认步骤
    if (nextSteps.length === 0) {
      nextSteps.push('审视当前工作流程和工具使用情况');
      nextSteps.push('制定详细的优化计划');
      nextSteps.push('实施第一阶段改进');
    }

    return nextSteps.slice(0, 5); // 最多返回5条
  }

  /**
   * 生成记忆更新
   */
  private generateMemoryUpdates(
    input: SequentialThinkingInput,
    stages: ThinkingStage[]
  ): Record<string, any> {
    return {
      thinking_process: {
        input: input.userInput,
        stages: stages.map((s) => ({
          name: s.name,
          timestamp: s.timestamp,
          duration: s.duration,
        })),
      },
      analysis_results: {
        key_findings: this.extractKeyFindings(stages),
        recommendations: this.extractRecommendations(stages[stages.length - 1].result || ''),
      },
      user_profile_updates: {
        thinking_capability: 'advanced',
        last_thinking_time: new Date().toISOString(),
      },
    };
  }

  /**
   * 提取关键发现
   */
  private extractKeyFindings(stages: ThinkingStage[]): string[] {
    const findings: string[] = [];

    // 从分析阶段提取关键发现
    const analysisStage = stages.find((s) => s.name === '分析');
    if (analysisStage && analysisStage.result) {
      const lines = analysisStage.result.split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
          findings.push(line.trim().substring(1).trim());
        }
      }
    }

    return findings.slice(0, 5);
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `thinking_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

export default new SequentialThinkingModule();
