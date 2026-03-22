/**
 * SmartAgent 任务复杂度计算器
 * 
 * 基于Eigent的复杂度判断机制，计算用户输入的复杂度
 * 并决定是否启动序列思考模块
 */

export interface ComplexityFactors {
  descriptionComplexity: number;
  toolComplexity: number;
  outputComplexity: number;
  decompositionComplexity: number;
}

export interface ComplexityResult {
  score: number; // 0-1
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  factors: ComplexityFactors;
  requiredTools: string[];
  outputFormats: string[];
  shouldUseSequentialThinking: boolean;
  recommendedWorkers: number;
  reasoning: string;
}

export class ComplexityCalculator {
  // 复杂度阈值
  private readonly THRESHOLD_LOW = 0.3;
  private readonly THRESHOLD_MEDIUM = 0.6;
  private readonly THRESHOLD_HIGH = 0.8;

  // 权重配置
  private readonly WEIGHTS = {
    description: 0.25,
    tool: 0.25,
    output: 0.20,
    decomposition: 0.30,
  };

  // SmartAgent支持的工具
  private readonly AVAILABLE_TOOLS = [
    'search_files',
    'get_file_info',
    'open_file',
    'list_directory',
    'create_folder',
    'create_file',
    'copy_files',
    'launch_app',
    'browser_control',
    'list_running_apps',
    'close_app',
  ];

  // 复杂关键词及其权重
  private readonly COMPLEX_KEYWORDS = {
    // 中文关键词
    '分析': 0.3,
    '研究': 0.3,
    '规划': 0.25,
    '设计': 0.25,
    '优化': 0.2,
    '评估': 0.2,
    '比较': 0.2,
    '综合': 0.25,
    '报告': 0.15,
    '策略': 0.25,
    '方案': 0.2,
    '统计': 0.2,
    '总结': 0.15,
    '整理': 0.15,
    '转换': 0.15,
    // 英文关键词
    'analyze': 0.3,
    'research': 0.3,
    'plan': 0.25,
    'design': 0.25,
    'optimize': 0.2,
    'evaluate': 0.2,
    'compare': 0.2,
    'synthesize': 0.25,
    'report': 0.15,
    'strategy': 0.25,
    'solution': 0.2,
    'summary': 0.15,
    'organize': 0.15,
    'convert': 0.15,
  };

  // 决策关键词
  private readonly DECISION_KEYWORDS = [
    '建议', '推荐', '选择', '决定', '方案', '对比',
    'suggest', 'recommend', 'choose', 'decide', 'solution', 'compare',
  ];

  // 多步推理关键词
  private readonly MULTI_STEP_KEYWORDS = [
    '然后', '接着', '最后', '步骤', '流程', '过程',
    'then', 'next', 'finally', 'step', 'process', 'procedure',
  ];

  /**
   * 计算任务复杂度
   */
  calculate(userInput: string, context?: any): ComplexityResult {
    // 1. 分析描述复杂度
    const descriptionComplexity = this.analyzeDescriptionComplexity(userInput);

    // 2. 推断所需工具
    const requiredTools = this.inferRequiredTools(userInput);
    const toolComplexity = this.calculateToolComplexity(requiredTools);

    // 3. 推断输出格式
    const outputFormats = this.inferOutputFormats(userInput);
    const outputComplexity = this.calculateOutputComplexity(outputFormats);

    // 4. 分析任务分解复杂度
    const decompositionComplexity = this.analyzeDecompositionComplexity(userInput);

    // 5. 计算总体复杂度
    const totalScore =
      descriptionComplexity * this.WEIGHTS.description +
      toolComplexity * this.WEIGHTS.tool +
      outputComplexity * this.WEIGHTS.output +
      decompositionComplexity * this.WEIGHTS.decomposition;

    // 6. 分类
    const level = this.classifyLevel(totalScore);

    // 7. 判断是否启动序列思考
    const shouldUseSequentialThinking = this.shouldUseSequentialThinking(
      level,
      userInput,
      totalScore
    );

    // 8. 推荐Worker数量
    const recommendedWorkers = this.recommendWorkerCount(level, requiredTools.length);

    // 9. 生成推理说明
    const reasoning = this.generateReasoning(
      totalScore,
      level,
      requiredTools,
      outputFormats,
      shouldUseSequentialThinking
    );

    return {
      score: totalScore,
      level,
      factors: {
        descriptionComplexity,
        toolComplexity,
        outputComplexity,
        decompositionComplexity,
      },
      requiredTools,
      outputFormats,
      shouldUseSequentialThinking,
      recommendedWorkers,
      reasoning,
    };
  }

  /**
   * 分析描述复杂度
   */
  private analyzeDescriptionComplexity(text: string): number {
    // 1. 基础长度分数
    const wordCount = text.split(/\s+/).length;
    const lengthScore = Math.min(wordCount / 100, 1.0);

    // 2. 句子复杂度
    const sentenceCount = (text.match(/[。.!！?？]/g) || []).length;
    const avgSentenceLength = wordCount / Math.max(sentenceCount, 1);
    const complexityScore = Math.min(avgSentenceLength / 20, 1.0);

    // 3. 关键词权重
    let keywordScore = 0;
    let keywordCount = 0;
    for (const [keyword, weight] of Object.entries(this.COMPLEX_KEYWORDS)) {
      if (text.toLowerCase().includes(keyword.toLowerCase())) {
        keywordScore += weight;
        keywordCount++;
      }
    }
    keywordScore = keywordCount > 0 ? Math.min(keywordScore / 5, 1.0) : 0;

    // 综合分数
    return (lengthScore + complexityScore + keywordScore) / 3;
  }

  /**
   * 推断所需工具
   */
  private inferRequiredTools(text: string): string[] {
    const tools: Set<string> = new Set();

    // 文件系统工具
    if (
      /搜索|查找|找|search|find|look for/i.test(text) &&
      /文件|file/i.test(text)
    ) {
      tools.add('search_files');
    }

    if (/文件信息|file info|details/i.test(text)) {
      tools.add('get_file_info');
    }

    if (/打开|open/i.test(text) && /文件|file/i.test(text)) {
      tools.add('open_file');
    }

    // 应用控制工具
    if (/启动|打开|launch|open|start/i.test(text) && /应用|程序|app/i.test(text)) {
      tools.add('launch_app');
    }

    if (/浏览器|chrome|edge|firefox|browser/i.test(text)) {
      tools.add('browser_control');
    }

    if (/运行|running|进程|process/i.test(text)) {
      tools.add('list_running_apps');
    }

    if (/关闭|close|quit/i.test(text)) {
      tools.add('close_app');
    }

    return Array.from(tools);
  }

  /**
   * 计算工具复杂度
   */
  private calculateToolComplexity(tools: string[]): number {
    if (tools.length === 0) {
      return 0.0;
    }

    // 工具数量权重
    let toolCountScore: number;
    if (tools.length === 1) {
      toolCountScore = 0.2;
    } else if (tools.length === 2) {
      toolCountScore = 0.4;
    } else if (tools.length === 3) {
      toolCountScore = 0.6;
    } else if (tools.length === 4) {
      toolCountScore = 0.8;
    } else {
      toolCountScore = 1.0;
    }

    // 工具类型多样性
    const toolCategories = this.categorizeTools(tools);
    const diversityScore = Math.min(toolCategories.size / 2, 1.0);

    return (toolCountScore + diversityScore) / 2;
  }

  /**
   * 工具分类
   */
  private categorizeTools(tools: string[]): Set<string> {
    const categories = new Set<string>();

    for (const tool of tools) {
      if (['search_files', 'get_file_info', 'open_file', 'list_directory', 'create_folder', 'create_file', 'copy_files'].includes(tool)) {
        categories.add('file_system');
      } else if (
        ['launch_app', 'browser_control', 'list_running_apps', 'close_app'].includes(tool)
      ) {
        categories.add('app_control');
      }
    }

    return categories;
  }

  /**
   * 推断输出格式
   */
  private inferOutputFormats(text: string): string[] {
    const formats: Set<string> = new Set();

    if (/报告|report|summary|总结/i.test(text)) {
      formats.add('report');
    }

    if (/列表|list|列出/i.test(text)) {
      formats.add('list');
    }

    if (/表格|table|统计/i.test(text)) {
      formats.add('table');
    }

    if (/图表|chart|graph|可视化/i.test(text)) {
      formats.add('chart');
    }

    if (/json|structured|结构化/i.test(text)) {
      formats.add('json');
    }

    if (/html|web|网页/i.test(text)) {
      formats.add('html');
    }

    if (/pdf|文档/i.test(text)) {
      formats.add('pdf');
    }

    // 如果没有推断出格式，默认为文本
    if (formats.size === 0) {
      formats.add('text');
    }

    return Array.from(formats);
  }

  /**
   * 计算输出复杂度
   */
  private calculateOutputComplexity(formats: string[]): number {
    const formatComplexity: Record<string, number> = {
      text: 0.1,
      list: 0.2,
      table: 0.3,
      json: 0.2,
      html: 0.4,
      pdf: 0.5,
      chart: 0.3,
      report: 0.6,
    };

    if (formats.length === 0) {
      return 0.0;
    }

    const avgComplexity =
      formats.reduce((sum, fmt) => sum + (formatComplexity[fmt] || 0.3), 0) / formats.length;

    // 多格式输出加权
    const formatCountBonus = Math.min(formats.length / 3, 0.3);

    return Math.min(avgComplexity + formatCountBonus, 1.0);
  }

  /**
   * 分析任务分解复杂度
   */
  private analyzeDecompositionComplexity(text: string): number {
    // 1. 检查是否包含多步骤指示
    let stepScore = 0;
    if (/步骤|流程|过程|阶段|阶段|然后|接着|最后/i.test(text)) {
      stepScore = 0.4;
    }

    // 2. 检查是否包含条件逻辑
    let conditionScore = 0;
    if (/如果|当|假如|根据|基于|depending on|if|when/i.test(text)) {
      conditionScore = 0.3;
    }

    // 3. 检查是否包含迭代/循环
    let iterationScore = 0;
    if (/每个|所有|全部|所有的|for each|all|every/i.test(text)) {
      iterationScore = 0.3;
    }

    // 4. 检查是否包含聚合操作
    let aggregationScore = 0;
    if (/统计|汇总|合并|总计|aggregate|combine|sum/i.test(text)) {
      aggregationScore = 0.2;
    }

    return Math.min((stepScore + conditionScore + iterationScore + aggregationScore) / 4, 1.0);
  }

  /**
   * 分类复杂度级别
   */
  private classifyLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
    if (score < this.THRESHOLD_LOW) {
      return 'LOW';
    } else if (score < this.THRESHOLD_MEDIUM) {
      return 'MEDIUM';
    } else if (score < this.THRESHOLD_HIGH) {
      return 'HIGH';
    } else {
      return 'VERY_HIGH';
    }
  }

  /**
   * 判断是否启动序列思考
   */
  private shouldUseSequentialThinking(level: string, text: string, score: number): boolean {
    // 高复杂度任务直接启动
    if (level === 'HIGH' || level === 'VERY_HIGH') {
      return true;
    }

    // 中等复杂度任务，检查特殊条件
    if (level === 'MEDIUM') {
      // 检查是否涉及决策
      if (this.hasDecisionMaking(text)) {
        return true;
      }

      // 检查是否需要多步推理
      if (this.requiresMultiStepReasoning(text)) {
        return true;
      }

      // 检查是否涉及分析
      if (this.hasAnalysisKeywords(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查是否涉及决策
   */
  private hasDecisionMaking(text: string): boolean {
    return this.DECISION_KEYWORDS.some((keyword) =>
      text.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 检查是否需要多步推理
   */
  private requiresMultiStepReasoning(text: string): boolean {
    return this.MULTI_STEP_KEYWORDS.some((keyword) =>
      text.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 检查是否涉及分析
   */
  private hasAnalysisKeywords(text: string): boolean {
    return /分析|analyze|analysis/i.test(text);
  }

  /**
   * 推荐Worker数量
   */
  private recommendWorkerCount(level: string, toolCount: number): number {
    let baseWorkers = 1;

    if (level === 'LOW') {
      baseWorkers = 1;
    } else if (level === 'MEDIUM') {
      baseWorkers = 2;
    } else if (level === 'HIGH') {
      baseWorkers = 3;
    } else if (level === 'VERY_HIGH') {
      baseWorkers = 4;
    }

    // 根据工具数量调整
    const toolBonus = Math.ceil(toolCount / 2);
    return Math.min(baseWorkers + toolBonus, 6);
  }

  /**
   * 生成推理说明
   */
  private generateReasoning(
    score: number,
    level: string,
    tools: string[],
    formats: string[],
    shouldThink: boolean
  ): string {
    const parts: string[] = [];

    parts.push(`复杂度评分: ${(score * 100).toFixed(1)}% (${level})`);

    if (tools.length > 0) {
      parts.push(`所需工具: ${tools.join(', ')}`);
    }

    if (formats.length > 0) {
      parts.push(`输出格式: ${formats.join(', ')}`);
    }

    if (shouldThink) {
      parts.push(`✅ 启动序列思考模块进行深度分析`);
    } else {
      parts.push(`⚡ 直接处理，无需序列思考`);
    }

    return parts.join(' | ');
  }
}

export default new ComplexityCalculator();
