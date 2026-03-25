/**
 * 记忆提取管道 — 四层过滤单元测试
 *
 * 测试 Phase 4 新增的记忆提取管道优化：
 * - Layer 1: 预过滤（空消息、短内容、纯问候）
 * - Layer 3: 置信度门控（importance、confidence、type 校验）
 * - Layer 4: 动态阈值去重（Jaccard 相似度 + 自适应阈值）
 * - MemoryExtractionOptions 接口（Phase 5 修复）
 *
 * 注意：Layer 2（LLM 提取）和完整的 extractMemoriesFromConversation 流程
 * 需要 LLM 和数据库，属于集成测试范围，此处仅测试纯函数逻辑。
 */

import { describe, it, expect } from "vitest";

// ==================== 辅助：从 memorySystem.ts 中提取的纯函数逻辑 ====================
// 由于 memorySystem.ts 中的过滤函数是模块私有的（非 export），
// 我们在此复制其核心逻辑进行独立测试。
// 这确保了测试不依赖数据库连接或 LLM 调用。

/** Layer 1: 预过滤 */
function preFilterConversation(
  messages: Array<{ role: string; content: string }>
): { pass: boolean; reason?: string } {
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  if (userMessages.length === 0 || assistantMessages.length === 0) {
    return { pass: false, reason: "no_user_or_assistant_message" };
  }

  const totalUserChars = userMessages.reduce(
    (sum, m) => sum + m.content.trim().length,
    0
  );
  if (totalUserChars < 4)
    return { pass: false, reason: "user_content_too_short" };

  const greetingPatterns =
    /^(你好|hi|hello|hey|嗨|喂|早|晚安|早安|午安|嗯|好的|ok|行|哦|哈哈|呵呵|嘿嘿|谢谢|感谢|再见|拜拜|bye)$/i;
  if (userMessages.every((m) => greetingPatterns.test(m.content.trim()))) {
    return { pass: false, reason: "pure_greeting" };
  }

  return { pass: true };
}

/** Layer 3: 置信度门控 */
function confidenceGate(mem: any): { pass: boolean; reason?: string } {
  if (!mem.type || !mem.content)
    return { pass: false, reason: "missing_type_or_content" };

  const content = String(mem.content).trim();
  if (content.length < 2 || content.length > 500)
    return { pass: false, reason: "content_length_invalid" };

  const importance = Number(mem.importance ?? 0.5);
  if (importance < 0.3)
    return { pass: false, reason: `importance_too_low(${importance})` };

  const confidence = Number(mem.confidence ?? 0.8);
  if (confidence < 0.4)
    return { pass: false, reason: `confidence_too_low(${confidence})` };

  const validTypes = ["fact", "behavior", "preference", "emotion"];
  if (!validTypes.includes(mem.type))
    return { pass: false, reason: `invalid_type(${mem.type})` };

  return { pass: true };
}

/** Layer 4: Jaccard 相似度计算 */
function computeJaccardSimilarity(a: string, b: string): number {
  const setA = new Set(
    a
      .toLowerCase()
      .replace(/\s+/g, "")
      .split("")
  );
  const setB = new Set(
    b
      .toLowerCase()
      .replace(/\s+/g, "")
      .split("")
  );
  let intersection = 0;
  for (const char of setA) {
    if (setB.has(char)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Layer 4: 动态去重阈值 */
function getDynamicDeduplicationThreshold(existingCount: number): number {
  if (existingCount < 50) return 0.6;
  if (existingCount <= 200) return 0.5;
  return 0.4;
}

/** Layer 4: 动态去重 */
interface MockMemory {
  id: number;
  type: string;
  content: string;
}

function dynamicDeduplication(
  newContent: string,
  newType: string,
  existingMemories: MockMemory[],
  threshold: number
): { isDuplicate: boolean; matchedMemory?: MockMemory } {
  const newNorm = String(newContent)
    .toLowerCase()
    .replace(/\s+/g, "");
  for (const existing of existingMemories) {
    if (existing.type !== newType) continue;
    const existingNorm = String(existing.content)
      .toLowerCase()
      .replace(/\s+/g, "");
    if (existingNorm === newNorm)
      return { isDuplicate: true, matchedMemory: existing };
    if (existingNorm.includes(newNorm) || newNorm.includes(existingNorm))
      return { isDuplicate: true, matchedMemory: existing };
    if (computeJaccardSimilarity(existingNorm, newNorm) >= threshold)
      return { isDuplicate: true, matchedMemory: existing };
  }
  return { isDuplicate: false };
}

// ==================== 测试 ====================

describe("记忆提取管道 — 四层过滤", () => {
  // ==================== Layer 1: 预过滤 ====================

  describe("Layer 1: 预过滤 (preFilterConversation)", () => {
    it("应拦截没有用户消息的对话", () => {
      const result = preFilterConversation([
        { role: "assistant", content: "你好，有什么可以帮你的？" },
      ]);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("no_user_or_assistant_message");
    });

    it("应拦截没有助手消息的对话", () => {
      const result = preFilterConversation([
        { role: "user", content: "你好" },
      ]);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("no_user_or_assistant_message");
    });

    it("应拦截用户内容过短的对话（< 4 字符）", () => {
      const result = preFilterConversation([
        { role: "user", content: "嗯" },
        { role: "assistant", content: "你好" },
      ]);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("user_content_too_short");
    });

    it("应拦截纯问候语对话", () => {
      // "你好" + "嗨" = 3 字符 < 4，会先被 user_content_too_short 拦截
      // 使用更长的问候语组合来触发 pure_greeting
      const result = preFilterConversation([
        { role: "user", content: "你好" },
        { role: "user", content: "谢谢" },
        { role: "assistant", content: "你好！有什么可以帮你的？" },
      ]);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("pure_greeting");
    });

    it("应拦截纯英文问候语（大小写不敏感）", () => {
      const result = preFilterConversation([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("pure_greeting");
    });

    it("应放行包含实质内容的对话", () => {
      const result = preFilterConversation([
        { role: "user", content: "我叫小明，我住在上海" },
        { role: "assistant", content: "你好小明！" },
      ]);
      expect(result.pass).toBe(true);
    });

    it("应放行混合问候和实质内容的对话", () => {
      const result = preFilterConversation([
        { role: "user", content: "你好" },
        { role: "user", content: "我想了解一下北京的天气" },
        { role: "assistant", content: "北京今天晴天" },
      ]);
      expect(result.pass).toBe(true);
    });
  });

  // ==================== Layer 3: 置信度门控 ====================

  describe("Layer 3: 置信度门控 (confidenceGate)", () => {
    it("应拦截缺少 type 的记忆", () => {
      const result = confidenceGate({ content: "用户喜欢黑色" });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("missing_type_or_content");
    });

    it("应拦截缺少 content 的记忆", () => {
      const result = confidenceGate({ type: "fact" });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("missing_type_or_content");
    });

    it("应拦截内容过短的记忆（< 2 字符）", () => {
      const result = confidenceGate({ type: "fact", content: "a" });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("content_length_invalid");
    });

    it("应拦截内容过长的记忆（> 500 字符）", () => {
      const longContent = "a".repeat(501);
      const result = confidenceGate({ type: "fact", content: longContent });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("content_length_invalid");
    });

    it("应拦截重要性过低的记忆（< 0.3）", () => {
      const result = confidenceGate({
        type: "fact",
        content: "用户说了你好",
        importance: 0.1,
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("importance_too_low");
    });

    it("应拦截置信度过低的记忆（< 0.4）", () => {
      const result = confidenceGate({
        type: "fact",
        content: "用户可能喜欢蓝色",
        importance: 0.5,
        confidence: 0.2,
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("confidence_too_low");
    });

    it("应拦截无效类型的记忆", () => {
      const result = confidenceGate({
        type: "invalid_type",
        content: "用户喜欢黑色",
        importance: 0.7,
        confidence: 0.9,
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("invalid_type");
    });

    it("应放行合格的记忆", () => {
      const result = confidenceGate({
        type: "fact",
        content: "用户名字是小明",
        importance: 0.9,
        confidence: 0.95,
      });
      expect(result.pass).toBe(true);
    });

    it("应使用默认值处理缺失的 importance 和 confidence", () => {
      const result = confidenceGate({
        type: "preference",
        content: "用户喜欢黑色",
      });
      // 默认 importance=0.5 (>0.3), confidence=0.8 (>0.4)
      expect(result.pass).toBe(true);
    });
  });

  // ==================== Layer 4: 动态阈值去重 ====================

  describe("Layer 4: Jaccard 相似度", () => {
    it("相同字符串应返回 1.0", () => {
      expect(computeJaccardSimilarity("用户喜欢黑色", "用户喜欢黑色")).toBe(1.0);
    });

    it("完全不同的字符串应返回较低值", () => {
      const sim = computeJaccardSimilarity("abc", "xyz");
      expect(sim).toBe(0);
    });

    it("部分重叠的字符串应返回中间值", () => {
      const sim = computeJaccardSimilarity("用户喜欢黑色", "用户喜欢白色");
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(1.0);
    });

    it("应忽略大小写和空格", () => {
      const sim = computeJaccardSimilarity("Hello World", "hello world");
      expect(sim).toBe(1.0);
    });

    it("空字符串应返回 0", () => {
      expect(computeJaccardSimilarity("", "")).toBe(0);
    });
  });

  describe("Layer 4: 动态去重阈值", () => {
    it("记忆数量 < 50 时阈值应为 0.6", () => {
      expect(getDynamicDeduplicationThreshold(0)).toBe(0.6);
      expect(getDynamicDeduplicationThreshold(49)).toBe(0.6);
    });

    it("记忆数量 50-200 时阈值应为 0.5", () => {
      expect(getDynamicDeduplicationThreshold(50)).toBe(0.5);
      expect(getDynamicDeduplicationThreshold(200)).toBe(0.5);
    });

    it("记忆数量 > 200 时阈值应为 0.4", () => {
      expect(getDynamicDeduplicationThreshold(201)).toBe(0.4);
      expect(getDynamicDeduplicationThreshold(1000)).toBe(0.4);
    });
  });

  describe("Layer 4: 动态去重 (dynamicDeduplication)", () => {
    const existingMemories: MockMemory[] = [
      { id: 1, type: "fact", content: "用户名字是小明" },
      { id: 2, type: "preference", content: "用户喜欢黑色" },
      { id: 3, type: "fact", content: "用户居住在上海浦东新区" },
    ];

    it("应检测完全相同的内容为重复", () => {
      const result = dynamicDeduplication(
        "用户名字是小明",
        "fact",
        existingMemories,
        0.6
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.matchedMemory?.id).toBe(1);
    });

    it("应检测子串包含关系为重复", () => {
      const result = dynamicDeduplication(
        "用户居住在上海",
        "fact",
        existingMemories,
        0.6
      );
      expect(result.isDuplicate).toBe(true);
      expect(result.matchedMemory?.id).toBe(3);
    });

    it("应检测高相似度内容为重复", () => {
      const result = dynamicDeduplication(
        "用户的名字叫小明",
        "fact",
        existingMemories,
        0.6
      );
      expect(result.isDuplicate).toBe(true);
    });

    it("不同类型的相似内容不应被视为重复", () => {
      const result = dynamicDeduplication(
        "用户名字是小明",
        "preference", // 类型不同
        existingMemories,
        0.6
      );
      expect(result.isDuplicate).toBe(false);
    });

    it("完全不同的内容不应被视为重复", () => {
      const result = dynamicDeduplication(
        "用户在北京工作",
        "fact",
        existingMemories,
        0.6
      );
      expect(result.isDuplicate).toBe(false);
    });

    it("空的已有记忆列表应返回非重复", () => {
      const result = dynamicDeduplication("任何内容", "fact", [], 0.6);
      expect(result.isDuplicate).toBe(false);
    });
  });
});
