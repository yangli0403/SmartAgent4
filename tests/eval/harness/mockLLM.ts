/**
 * tests/eval/harness/mockLLM.ts
 *
 * 评测用 mock LLM。
 *
 * 设计目标：
 * 1. 不依赖任何外部 API（CI 友好）
 * 2. 三种模式：groundTruth（默认）/ wrongDomain / throwError / scripted
 * 3. 通过 vi.mock 注入到 langchainAdapter（vitest 上下文）
 * 4. ≥ 10 个单测覆盖各种分类结果
 */

import type { TaskClassification } from "../../../server/agent/supervisor/state";

// ===================================================================
// 类型定义
// ===================================================================

export type MockMode = "groundTruth" | "wrongDomain" | "throwError" | "scripted";

export interface MockLLMOptions {
  mode?: MockMode;
  /** scripted 模式：query → label 映射 */
  scripted?: Map<string, TaskClassification>;
  /** wrongDomain 模式的随机种子（保证可复现） */
  seed?: number;
}

export interface MockLLMResponse {
  classification: TaskClassification;
  /** 用于 metrics 的来源标记 */
  _mockSource: "groundTruth" | "wrongDomain" | "throwError" | "scripted";
}

// ===================================================================
// 简易可复现伪随机
// ===================================================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===================================================================
// 默认 fallback label
// ===================================================================

const FALLBACK_LABEL: TaskClassification = {
  domain: "general",
  complexity: "simple",
  reasoning: "[mock] fallback label",
  requiredAgents: ["generalAgent"],
};

// ===================================================================
// 所有候选域（与 state.ts 对齐）
// ===================================================================

const ALL_DOMAINS = [
  "navigation",
  "multimedia",
  "file_system",
  "office",
  "service",
  "general",
  "cross_domain",
] as const;

// ===================================================================
// MockLLM 主类
// ===================================================================

/**
 * MockLLM — 模拟 callLightLLMStructured 的行为
 *
 * 用法：
 *   const mock = new MockLLM({ mode: "groundTruth" });
 *   const label = mock.classify(prompt, query, groundTruthLabel);
 */
export class MockLLM {
  mode: MockMode;
  scripted?: Map<string, TaskClassification>;
  readonly seed: number;
  private rand: () => number;

  constructor(options: MockLLMOptions = {}) {
    this.mode = options.mode ?? "groundTruth";
    this.scripted = options.scripted;
    this.seed = options.seed ?? 42;
    this.rand = mulberry32(this.seed);
  }

  /**
   * 模拟 callLightLLMStructured —— 评测的主入口
   *
   * @param prompt  system prompt（不读）
   * @param query   user message
   * @param groundTruth  期望的"真值"，mock 模式会用到
   */
  async classify(
    _prompt: string,
    query: string,
    groundTruth?: TaskClassification
  ): Promise<TaskClassification> {
    // 1. scripted 模式优先（query 命中时）
    if (this.mode === "scripted" && this.scripted) {
      const exact = this.scripted.get(query.trim());
      if (exact) {
        return { ...exact, reasoning: `[scripted] ${exact.reasoning ?? ""}` };
      }
      // scripted miss → fallback
      return FALLBACK_LABEL;
    }

    // 2. throwError 模式
    if (this.mode === "throwError") {
      throw new Error("[mock] LLM call failed (throwError mode)");
    }

    // 3. wrongDomain 模式
    if (this.mode === "wrongDomain") {
      if (!groundTruth) return FALLBACK_LABEL;
      return this.makeWrongLabel(groundTruth);
    }

    // 4. groundTruth 模式（默认）
    if (groundTruth) {
      return {
        ...groundTruth,
        reasoning: `[mock] ${groundTruth.reasoning ?? ""}`,
      };
    }
    return FALLBACK_LABEL;
  }

  /**
   * 模拟 callLLMStructured（备用，给不调 light 路径的代码用）
   */
  async classifyHeavy(
    prompt: string,
    query: string,
    groundTruth?: TaskClassification
  ): Promise<TaskClassification> {
    return this.classify(prompt, query, groundTruth);
  }

  /**
   * wrongDomain 模式：根据 groundTruth 故意返回错的 domain
   * 保持 complexity 和 requiredAgents 不变（让 refine 函数能纠偏）
   */
  private makeWrongLabel(gt: TaskClassification): TaskClassification {
    // 80% 概率把 domain 改成"general"（最容易触发 refine 纠偏链）
    // 20% 概率随机挑一个其他域
    let wrongDomain: string;
    if (this.rand() < 0.8) {
      wrongDomain = "general";
    } else {
      const others = ALL_DOMAINS.filter((d) => d !== gt.domain);
      wrongDomain = others[Math.floor(this.rand() * others.length)];
    }

    return {
      ...gt,
      domain: wrongDomain,
      requiredAgents:
        wrongDomain === "general"
          ? ["generalAgent"]
          : this.agentForDomain(wrongDomain, gt.requiredAgents),
      reasoning: `[mock:wrongDomain] ${wrongDomain} (was ${gt.domain})`,
    };
  }

  private agentForDomain(domain: string, originalAgents: string[]): string[] {
    const map: Record<string, string> = {
      navigation: "navigationAgent",
      multimedia: "multimediaAgent",
      file_system: "fileAgent",
      office: "officeAgent",
      service: "serviceAgent",
      general: "generalAgent",
    };
    const agent = map[domain] ?? originalAgents[0] ?? "generalAgent";
    return [agent];
  }

  /**
   * 切换 mode（不丢失 scripted 映射）
   */
  setMode(mode: MockMode): void {
    this.mode = mode;
  }

  /**
   * 注入 scripted 映射
   */
  setScripted(map: Map<string, TaskClassification>): void {
    this.scripted = map;
  }
}

// ===================================================================
// 全局单例
// ===================================================================

let _instance: MockLLM | null = null;

export function getMockLLM(): MockLLM {
  if (!_instance) {
    _instance = new MockLLM({ mode: "groundTruth", seed: 42 });
  }
  return _instance;
}

export function resetMockLLM(): void {
  _instance = null;
}

// ===================================================================
// 辅助：把 groundTruth 注入到 userMessage
// ===================================================================

/**
 * 给 userMessage 追加 [GT_JSON]...[/GT_JSON] 块（mock 解析用）
 */
export function injectGroundTruth(
  userMessage: string,
  gt: TaskClassification
): string {
  return `${userMessage}\n\n[GT_JSON]${JSON.stringify(gt)}[/GT_JSON]`;
}

/**
 * 从 userMessage 中解析 ground truth 注释块
 */
export function parseGroundTruthFromMessage(
  message: string
): TaskClassification | undefined {
  const match = message.match(/\[GT_JSON\]([\s\S]*?)\[\/GT_JSON\]/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as TaskClassification;
  } catch {
    return undefined;
  }
}
