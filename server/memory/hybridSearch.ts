/**
 * Hybrid Search — 混合检索模块 (SmartMem)
 *
 * 实现 BM25 文本检索 + 向量余弦相似度检索的双路召回，
 * 并支持通过 LLM 进行二次综合推理（Reflect）。
 *
 * 来源：SmartMem/src/core/retrievalOrchestrator.ts
 */

import type { Memory } from "../../drizzle/schema";
import { callLLMText } from "../llm/langchainAdapter";

// ==================== BM25 文本检索 ====================

/**
 * 简化版 BM25 评分
 *
 * 对每条记忆的 content 进行分词，计算与查询的 BM25 相关性分数。
 * 参数 k1=1.5, b=0.75 为经典默认值。
 */
function bm25Score(
  query: string,
  documents: Memory[],
  k1 = 1.5,
  b = 0.75
): Map<number, number> {
  const scores = new Map<number, number>();
  if (documents.length === 0 || !query.trim()) return scores;

  // 简单分词：按空格和标点拆分
  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return scores;

  // 计算文档频率 (DF)
  const docFreq = new Map<string, number>();
  const docTokensList: string[][] = [];
  let totalLength = 0;

  for (const doc of documents) {
    const tokens = tokenize(doc.content);
    docTokensList.push(tokens);
    totalLength += tokens.length;

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const avgDl = totalLength / documents.length;
  const N = documents.length;

  // 计算每个文档的 BM25 分数
  for (let i = 0; i < documents.length; i++) {
    const docTokens = docTokensList[i];
    const dl = docTokens.length;

    // 统计词频 (TF)
    const tf = new Map<string, number>();
    for (const token of docTokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    let score = 0;
    for (const qToken of queryTokens) {
      const df = docFreq.get(qToken) || 0;
      if (df === 0) continue;

      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const termFreq = tf.get(qToken) || 0;
      const tfNorm =
        (termFreq * (k1 + 1)) /
        (termFreq + k1 * (1 - b + b * (dl / avgDl)));

      score += idf * tfNorm;
    }

    scores.set(documents[i].id, score);
  }

  return scores;
}

// ==================== 向量余弦相似度 ====================

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * 向量检索评分
 *
 * 计算查询向量与每条记忆 embedding 的余弦相似度。
 */
function vectorScore(
  queryEmbedding: number[] | null,
  documents: Memory[]
): Map<number, number> {
  const scores = new Map<number, number>();
  if (!queryEmbedding || queryEmbedding.length === 0) return scores;

  for (const doc of documents) {
    const docEmbedding = (doc as any).embedding as number[] | null;
    if (docEmbedding && docEmbedding.length > 0) {
      scores.set(doc.id, cosineSimilarity(queryEmbedding, docEmbedding));
    } else {
      scores.set(doc.id, 0);
    }
  }

  return scores;
}

// ==================== 混合检索 ====================

export interface HybridSearchOptions {
  query: string;
  queryEmbedding?: number[] | null;
  candidates: Memory[];
  limit?: number;
  /** BM25 权重 (0-1)，默认 0.5；向量权重为 1 - alpha */
  alpha?: number;
}

export interface HybridSearchResult {
  memory: Memory;
  score: number;
  bm25Score: number;
  vectorScore: number;
}

/**
 * 执行混合检索（带优雅降级）
 *
 * 将 BM25 和向量检索的分数进行归一化后加权融合，
 * 返回按综合分数排序的结果。
 *
 * 优雅降级策略：
 * - 有 queryEmbedding 且候选文档有 embedding：混合检索（BM25 + 向量）
 * - 无 queryEmbedding 或候选文档无 embedding：纯 BM25 检索
 * - 无查询词：按重要度排序返回
 */
export function hybridSearch(
  options: HybridSearchOptions
): HybridSearchResult[] {
  const { query, queryEmbedding, candidates, limit = 10, alpha = 0.5 } = options;

  if (candidates.length === 0) return [];

  // 计算 BM25 分数
  const bm25Scores = bm25Score(query, candidates);

  // 计算向量分数
  const vecScores = vectorScore(queryEmbedding || null, candidates);

  // 检测向量检索是否可用（查询向量存在 且 至少有一个候选文档有有效向量分数）
  const hasVectorScores = vecScores.size > 0 &&
    Array.from(vecScores.values()).some((v) => v > 0);

  // 动态调整权重：向量不可用时自动回退到纯 BM25
  const effectiveAlpha = hasVectorScores ? alpha : 1.0;

  if (!hasVectorScores && queryEmbedding) {
    console.log(
      "[HybridSearch] 向量检索降级：候选文档无有效 embedding，回退到纯 BM25 模式"
    );
  } else if (!queryEmbedding) {
    console.log(
      "[HybridSearch] 向量检索降级：无查询向量，回退到纯 BM25 模式"
    );
  }

  // 归一化函数
  const normalize = (scores: Map<number, number>): Map<number, number> => {
    const values = Array.from(scores.values());
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min;

    const normalized = new Map<number, number>();
    for (const [id, score] of scores) {
      normalized.set(id, range === 0 ? 0 : (score - min) / range);
    }
    return normalized;
  };

  const normBm25 = normalize(bm25Scores);
  const normVec = hasVectorScores ? normalize(vecScores) : new Map<number, number>();

  // 加权融合
  const results: HybridSearchResult[] = candidates.map((memory) => {
    const b = normBm25.get(memory.id) || 0;
    const v = normVec.get(memory.id) || 0;
    const combinedScore = effectiveAlpha * b + (1 - effectiveAlpha) * v;

    return {
      memory,
      score: combinedScore,
      bm25Score: bm25Scores.get(memory.id) || 0,
      vectorScore: vecScores.get(memory.id) || 0,
    };
  });

  // 按综合分数降序排列
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// ==================== Reflect 推理 ====================

/**
 * 使用 LLM 对检索结果进行二次综合推理
 *
 * 来源：SmartMem/src/services/reflectService.ts
 */
export async function reflectOnMemories(
  query: string,
  searchResults: HybridSearchResult[]
): Promise<string> {
  if (searchResults.length === 0) return "";

  const memoriesText = searchResults
    .map(
      (r, i) =>
        `[${i + 1}] (相关度: ${r.score.toFixed(2)}) ${r.memory.content}`
    )
    .join("\n");

  const systemPrompt = `你是一个记忆分析专家。根据用户的查询和检索到的记忆片段，综合推理出最相关的信息摘要。
要求：
- 只输出与查询直接相关的信息
- 如果记忆之间有矛盾，以最近的记忆为准
- 输出简洁的自然语言摘要，不超过 200 字`;

  const userMessage = `查询：${query}\n\n检索到的记忆：\n${memoriesText}\n\n请综合推理：`;

  try {
    return await callLLMText(systemPrompt, userMessage, { temperature: 0.1 });
  } catch (error) {
    console.error("[HybridSearch] Reflect failed:", error);
    // 降级：返回最相关的记忆内容
    return searchResults
      .slice(0, 3)
      .map((r) => r.memory.content)
      .join("；");
  }
}
