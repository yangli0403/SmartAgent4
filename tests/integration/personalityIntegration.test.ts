/**
 * Personality + Memory 集成测试
 *
 * 测试 PersonalityEngine 与 ProfileBuilder 的协作：
 * - 从记忆构建用户画像
 * - 将用户画像注入 System Prompt
 * - 完整的 Prompt 构建流程
 */

import { describe, it, expect, vi } from "vitest";
import { PersonalityEngine } from "../../server/personality/personalityEngine";
import {
  buildProfileFromMemories,
  formatMemoriesForContext,
} from "../../server/memory/profileBuilder";
import {
  getEmotionTagInstructions,
  getCompactEmotionTagInstructions,
} from "../../server/emotions/emotionTagInstructions";
import type { Memory } from "../../drizzle/schema";

// Mock fs 模块
vi.mock("fs", () => {
  const mockCharacters: Record<string, any> = {
    "xiaozhi.json": {
      id: "xiaozhi",
      name: "小智",
      bio: ["我是小智，一个智能车载助手。"],
      lore: [],
      style: {
        all: ["友善", "专业"],
        chat: ["使用简洁的语言"],
        voice: [],
        post: [],
      },
      messageExamples: [
        [
          { role: "user", content: "你好" },
          { role: "assistant", content: "你好！有什么可以帮你的吗？" },
        ],
      ],
      postExamples: [],
      adjectives: ["友善", "耐心"],
      topics: ["导航", "音乐"],
      knowledge: [],
      clients: ["web"],
      settings: {
        model: "gpt-4.1-mini",
        embeddingModel: "text-embedding-3-small",
        temperature: 0.7,
        maxTokens: 2000,
        topP: 0.9,
      },
    },
  };

  return {
    existsSync: vi.fn(() => true),
    readdirSync: vi.fn(() => Object.keys(mockCharacters)),
    readFileSync: vi.fn((filePath: string) => {
      const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || "";
      if (mockCharacters[fileName]) {
        return JSON.stringify(mockCharacters[fileName]);
      }
      throw new Error(`File not found: ${filePath}`);
    }),
  };
});

vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return {
    ...(actual as any),
    join: vi.fn((...args: string[]) => args.join("/")),
  };
});

// 辅助函数
function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 1,
    userId: 1,
    type: "fact",
    kind: "semantic",
    content: "测试记忆",
    importance: 0.5,
    confidence: 0.8,
    source: "conversation",
    tags: null,
    metadata: null,
    embedding: null,
    accessCount: 0,
    lastAccessedAt: new Date(),
    versionGroup: null,
    versionNumber: 1,
    isLatest: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("PersonalityEngine + ProfileBuilder 集成", () => {
  it("应完成从记忆到 System Prompt 的完整流程", () => {
    const engine = new PersonalityEngine();

    // 1. 创建模拟记忆
    const memories: Memory[] = [
      createMockMemory({
        id: 1,
        type: "fact",
        kind: "persona",
        content: "用户的名字是张三。",
        importance: 0.9,
      }),
      createMockMemory({
        id: 2,
        type: "preference",
        kind: "persona",
        content: "喜欢的音乐类型是古典音乐",
        importance: 0.7,
        tags: ["music"],
      }),
      createMockMemory({
        id: 3,
        type: "fact",
        kind: "semantic",
        content: "用户上次提到想去北京旅行",
        importance: 0.6,
      }),
      createMockMemory({
        id: 4,
        type: "fact",
        kind: "persona",
        content: "小明是用户的同事。",
        importance: 0.5,
      }),
    ];

    // 2. 构建用户画像
    const profile = buildProfileFromMemories(memories);
    expect(profile.displayName).toBe("张三");
    expect(profile.activePreferences.length).toBeGreaterThan(0);
    expect(profile.relevantRelationships.length).toBeGreaterThan(0);

    // 3. 格式化记忆上下文
    const memoryContext = formatMemoriesForContext(memories);
    expect(memoryContext).toContain("北京旅行");

    // 4. 获取情感标签指令
    const emotionInstructions = getEmotionTagInstructions();

    // 5. 构建完整的 System Prompt
    const prompt = engine.buildSystemPrompt({
      characterId: "xiaozhi",
      userProfile: profile,
      memoryContext,
      emotionTagInstructions: emotionInstructions,
    });

    // 验证 Prompt 包含所有关键信息
    expect(prompt).toContain("小智"); // 人格名称
    expect(prompt).toContain("张三"); // 用户名称
    expect(prompt).toContain("古典音乐"); // 用户偏好
    expect(prompt).toContain("小明"); // 用户关系
    expect(prompt).toContain("同事"); // 关系类型
    expect(prompt).toContain("北京旅行"); // 记忆上下文
    expect(prompt).toContain("[expression:smile]"); // 情感标签
    expect(prompt).toContain("友善"); // 对话风格
  });

  it("应在没有用户画像和记忆时也能构建有效的 Prompt", () => {
    const engine = new PersonalityEngine();

    const prompt = engine.buildSystemPrompt({
      characterId: "xiaozhi",
      memoryContext: "",
    });

    expect(prompt).toContain("小智");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("应使用简化版情感标签指令以节省 token", () => {
    const engine = new PersonalityEngine();
    const compactInstructions = getCompactEmotionTagInstructions();

    const prompt = engine.buildSystemPrompt({
      characterId: "xiaozhi",
      memoryContext: "",
      emotionTagInstructions: compactInstructions,
    });

    expect(prompt).toContain("expression:");
    // 简化版不应包含详细描述
    expect(prompt.length).toBeLessThan(
      engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
        emotionTagInstructions: getEmotionTagInstructions(),
      }).length
    );
  });
});
