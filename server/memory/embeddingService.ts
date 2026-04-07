/**
 * Embedding 生成服务
 *
 * 封装 Embedding API 的调用细节，为记忆系统提供文本向量化能力。
 * 支持阿里云百炼（DashScope）和 OpenAI 兼容接口，通过环境变量配置。
 *
 * 主要职责：
 * - 单条文本向量化（用于记忆写入时的实时生成）
 * - 批量文本向量化（用于历史记忆回填）
 * - 失败时优雅降级（返回 null，不阻塞调用方）
 *
 * @module embeddingService
 */

// ==================== 类型定义 ====================

/** Embedding 服务配置 */
export interface EmbeddingServiceConfig {
  /** API Key（默认读取 DASHSCOPE_API_KEY 环境变量） */
  apiKey?: string;
  /** API Base URL（默认指向阿里云百炼 OpenAI 兼容接口） */
  baseURL?: string;
  /** 模型名称（默认 text-embedding-v3） */
  model?: string;
  /** 向量维度（默认 1024） */
  dimensions?: number;
  /** 单次请求超时时间（毫秒，默认 3000） */
  timeoutMs?: number;
  /** 批量请求中每批的最大条数（默认 20） */
  batchSize?: number;
}

/** 单条 Embedding 生成结果 */
export interface EmbeddingResult {
  /** 生成的向量数组，失败时为 null */
  embedding: number[] | null;
  /** 消耗的 token 数量 */
  tokenUsage: number;
  /** 生成耗时（毫秒） */
  durationMs: number;
}

/** 批量 Embedding 生成结果 */
export interface BatchEmbeddingResult {
  /** 每条文本对应的向量，失败的条目为 null */
  embeddings: (number[] | null)[];
  /** 总消耗的 token 数量 */
  totalTokenUsage: number;
  /** 成功生成的条数 */
  successCount: number;
  /** 失败的条数 */
  failureCount: number;
  /** 总耗时（毫秒） */
  durationMs: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<EmbeddingServiceConfig> = {
  apiKey: process.env.DASHSCOPE_API_KEY ?? "",
  baseURL:
    process.env.EMBEDDING_BASE_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: process.env.EMBEDDING_MODEL ?? "text-embedding-v3",
  dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1024", 10),
  timeoutMs: parseInt(process.env.EMBEDDING_TIMEOUT_MS ?? "3000", 10),
  batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? "20", 10),
};

// ==================== 服务实例（单例） ====================

/** 全局 Embedding 服务实例 */
let serviceInstance: EmbeddingServiceInstance | null = null;

/**
 * Embedding 服务内部实例类
 *
 * 封装 OpenAI 兼容客户端的初始化和调用逻辑。
 */
class EmbeddingServiceInstance {
  private config: Required<EmbeddingServiceConfig>;
  private client: any; // OpenAI 客户端实例，延迟初始化

  constructor(config: Required<EmbeddingServiceConfig>) {
    this.config = config;
    this.client = null;
  }

  /**
   * 延迟初始化 OpenAI 兼容客户端
   *
   * 使用 @langchain/openai 或 openai SDK 创建客户端。
   * 延迟初始化避免在模块加载时就要求 API Key 可用。
   */
  private async getClient(): Promise<any> {
    // TODO: 第4阶段实现 — 初始化 OpenAI 兼容客户端
    throw new Error("Not implemented");
  }

  /**
   * 生成单条文本的 Embedding 向量
   *
   * @param text - 要向量化的文本内容
   * @returns 生成结果，包含向量、token 用量和耗时
   *
   * @example
   * ```typescript
   * const result = await generateEmbedding("用户喜欢打篮球");
   * if (result.embedding) {
   *   console.log(`向量维度: ${result.embedding.length}`); // 1024
   * }
   * ```
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    // TODO: 第4阶段实现
    throw new Error("Not implemented");
  }

  /**
   * 批量生成多条文本的 Embedding 向量
   *
   * 将输入文本按 batchSize 分批发送，避免单次请求过大。
   * 每批内的文本在一次 API 调用中处理。
   *
   * @param texts - 要向量化的文本数组
   * @returns 批量生成结果
   *
   * @example
   * ```typescript
   * const result = await generateEmbeddingBatch([
   *   "用户喜欢打篮球",
   *   "用户住在上海",
   *   "用户对花生过敏"
   * ]);
   * console.log(`成功: ${result.successCount}, 失败: ${result.failureCount}`);
   * ```
   */
  async generateEmbeddingBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    // TODO: 第4阶段实现
    throw new Error("Not implemented");
  }

  /** 获取当前配置（只读） */
  getConfig(): Readonly<Required<EmbeddingServiceConfig>> {
    return { ...this.config };
  }
}

// ==================== 公共 API ====================

/**
 * 初始化 Embedding 服务
 *
 * 在应用启动时调用一次，后续通过 getEmbeddingService() 获取实例。
 * 若不调用此函数，getEmbeddingService() 将使用默认配置自动初始化。
 *
 * @param config - 可选的自定义配置，未提供的字段使用默认值
 */
export function initEmbeddingService(config?: EmbeddingServiceConfig): void {
  const mergedConfig: Required<EmbeddingServiceConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  serviceInstance = new EmbeddingServiceInstance(mergedConfig);
  console.log(
    `[EmbeddingService] Initialized: model=${mergedConfig.model}, ` +
      `dimensions=${mergedConfig.dimensions}, baseURL=${mergedConfig.baseURL}`
  );
}

/**
 * 获取 Embedding 服务实例
 *
 * 若尚未初始化，将使用默认配置自动初始化。
 *
 * @returns Embedding 服务实例
 */
export function getEmbeddingService(): EmbeddingServiceInstance {
  if (!serviceInstance) {
    initEmbeddingService();
  }
  return serviceInstance!;
}

/**
 * 生成单条文本的 Embedding 向量（便捷函数）
 *
 * 等价于 `getEmbeddingService().generateEmbedding(text)`。
 *
 * @param text - 要向量化的文本内容
 * @returns 向量数组，失败时返回 null
 */
export async function generateEmbedding(
  text: string
): Promise<number[] | null> {
  try {
    const service = getEmbeddingService();
    const result = await service.generateEmbedding(text);
    return result.embedding;
  } catch (error) {
    console.warn(
      "[EmbeddingService] generateEmbedding failed:",
      (error as Error).message
    );
    return null;
  }
}

/**
 * 批量生成 Embedding 向量（便捷函数）
 *
 * 等价于 `getEmbeddingService().generateEmbeddingBatch(texts)`。
 *
 * @param texts - 要向量化的文本数组
 * @returns 批量生成结果
 */
export async function generateEmbeddingBatch(
  texts: string[]
): Promise<BatchEmbeddingResult> {
  const service = getEmbeddingService();
  return service.generateEmbeddingBatch(texts);
}
