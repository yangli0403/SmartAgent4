/**
 * PersonalityEngine 单元测试
 *
 * 测试人格配置加载、System Prompt 构建、问候语生成和 ElizaOS 导入功能。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PersonalityEngine } from "../../server/personality/personalityEngine";
import type {
  AgentCharacter,
  ContextualProfileSnapshot,
  BuildSystemPromptOptions,
} from "../../server/personality/types";

// Mock fs 和 path 模块，避免实际文件系统访问
vi.mock("fs", () => {
  const mockCharacters: Record<string, any> = {
    "xiaozhi.json": {
      id: "xiaozhi",
      name: "小智",
      bio: ["我是小智，一个智能车载助手。", "我擅长导航、音乐和日常对话。"],
      lore: ["我诞生于2026年，由SmartAgent团队打造。"],
      style: {
        all: ["友善", "专业"],
        chat: ["使用简洁的语言", "适当使用表情"],
        voice: ["语速适中"],
        post: [],
      },
      messageExamples: [
        [
          { role: "user", content: "你好" },
          { role: "assistant", content: "你好！我是小智，有什么可以帮你的吗？" },
        ],
      ],
      postExamples: [],
      adjectives: ["友善", "专业", "耐心"],
      topics: ["导航", "音乐", "天气"],
      knowledge: [
        { id: "k1", content: "我可以帮你导航到任何地方", category: "navigation" },
      ],
      clients: ["web", "vehicle"],
      settings: {
        model: "gpt-4.1-mini",
        embeddingModel: "text-embedding-3-small",
        temperature: 0.7,
        maxTokens: 2000,
        topP: 0.9,
      },
      createdAt: "2026-03-03T00:00:00Z",
      updatedAt: "2026-03-03T00:00:00Z",
    },
    "jarvis.json": {
      id: "jarvis",
      name: "贾维斯",
      bio: ["我是贾维斯，一个高效的AI管家。"],
      lore: [],
      style: { all: ["正式", "高效"], chat: [], voice: [], post: [] },
      messageExamples: [],
      postExamples: [],
      adjectives: ["高效", "精准"],
      topics: ["日程管理"],
      knowledge: [],
      clients: ["web"],
      settings: {
        model: "gpt-4.1-mini",
        embeddingModel: "text-embedding-3-small",
        temperature: 0.5,
        maxTokens: 2000,
        topP: 0.9,
      },
      createdAt: "2026-03-03T00:00:00Z",
      updatedAt: "2026-03-03T00:00:00Z",
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

describe("PersonalityEngine", () => {
  let engine: PersonalityEngine;

  beforeEach(() => {
    engine = new PersonalityEngine();
  });

  // ==================== getCharacter ====================

  describe("getCharacter", () => {
    it("应返回已加载的人格配置", () => {
      const character = engine.getCharacter("xiaozhi");
      expect(character).not.toBeNull();
      expect(character!.id).toBe("xiaozhi");
      expect(character!.name).toBe("小智");
    });

    it("应返回 null 当人格不存在时", () => {
      const character = engine.getCharacter("nonexistent");
      expect(character).toBeNull();
    });

    it("应正确加载人格的 bio 数组", () => {
      const character = engine.getCharacter("xiaozhi");
      expect(character!.bio).toHaveLength(2);
      expect(character!.bio[0]).toContain("小智");
    });

    it("应正确加载人格的 style 对象", () => {
      const character = engine.getCharacter("xiaozhi");
      expect(character!.style.all).toContain("友善");
      expect(character!.style.chat).toContain("使用简洁的语言");
    });
  });

  // ==================== listCharacters ====================

  describe("listCharacters", () => {
    it("应返回所有已加载的人格列表", () => {
      const characters = engine.listCharacters();
      expect(characters.length).toBeGreaterThanOrEqual(2);
      const ids = characters.map((c) => c.id);
      expect(ids).toContain("xiaozhi");
      expect(ids).toContain("jarvis");
    });
  });

  // ==================== buildSystemPrompt ====================

  describe("buildSystemPrompt", () => {
    it("应构建包含人格身份的 System Prompt", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
      });

      expect(prompt).toContain("小智");
      expect(prompt).toContain("智能车载助手");
    });

    it("应在 Prompt 中包含用户画像信息", () => {
      const profile: ContextualProfileSnapshot = {
        displayName: "张三",
        activePreferences: [
          { category: "music", key: "genre", value: "古典音乐" },
        ],
        relevantRelationships: [
          { personName: "李四", relationship: "同事" },
        ],
      };

      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        userProfile: profile,
        memoryContext: "",
      });

      expect(prompt).toContain("张三");
      expect(prompt).toContain("古典音乐");
      expect(prompt).toContain("李四");
      expect(prompt).toContain("同事");
    });

    it("应在 Prompt 中包含记忆上下文", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "用户上次提到想去北京旅行",
      });

      expect(prompt).toContain("用户上次提到想去北京旅行");
      expect(prompt).toContain("相关记忆");
    });

    it("应在 Prompt 中包含情感标签指令", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
        emotionTagInstructions: "[expression:smile] 微笑",
      });

      expect(prompt).toContain("[expression:smile]");
    });

    it("应在人格不存在时回退到默认人格", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "nonexistent",
        memoryContext: "",
      });

      // 应回退到 xiaozhi
      expect(prompt).toContain("小智");
    });

    it("应包含性格特征", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
      });

      expect(prompt).toContain("友善");
      expect(prompt).toContain("专业");
      expect(prompt).toContain("耐心");
    });

    it("应包含擅长领域", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
      });

      expect(prompt).toContain("导航");
      expect(prompt).toContain("音乐");
    });

    it("应包含知识库内容", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
      });

      expect(prompt).toContain("帮你导航");
    });

    it("应包含对话风格指令", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
      });

      expect(prompt).toContain("使用简洁的语言");
    });

    it("应包含对话示例", () => {
      const prompt = engine.buildSystemPrompt({
        characterId: "xiaozhi",
        memoryContext: "",
      });

      expect(prompt).toContain("示例");
    });
  });

  // ==================== generateGreeting ====================

  describe("generateGreeting", () => {
    it("应为 xiaozhi 生成包含名字的问候语", () => {
      const greeting = engine.generateGreeting("xiaozhi");
      expect(greeting).toContain("小智");
    });

    it("应为 jarvis 生成管家风格的问候语", () => {
      const greeting = engine.generateGreeting("jarvis");
      expect(greeting).toContain("贾维斯");
    });

    it("应在有用户画像时使用用户名称", () => {
      const profile: ContextualProfileSnapshot = {
        displayName: "张三",
        activePreferences: [],
        relevantRelationships: [],
      };

      const greeting = engine.generateGreeting("xiaozhi", profile);
      expect(greeting).toContain("张三");
    });

    it("应在人格不存在时返回默认问候语", () => {
      // 当 xiaozhi 和 nonexistent 都不存在时
      const engine2 = new PersonalityEngine();
      const greeting = engine2.generateGreeting("nonexistent");
      // 应回退到 xiaozhi 或返回默认问候
      expect(greeting).toBeTruthy();
      expect(greeting.length).toBeGreaterThan(0);
    });
  });

  // ==================== importFromElizaOS ====================

  describe("importFromElizaOS", () => {
    it("应成功导入 ElizaOS 格式的人格配置", () => {
      const elizaData = {
        id: "eliza_test",
        name: "Eliza Test",
        bio: ["A test character from ElizaOS"],
        lore: ["Created for testing"],
        system: "You are a helpful test assistant.",
        style: {
          all: ["friendly"],
          chat: ["concise"],
          voice: [],
          post: [],
        },
        messageExamples: [],
        postExamples: [],
        adjectives: ["helpful"],
        topics: ["testing"],
        knowledge: [],
        clients: [],
        settings: {
          model: "gpt-4.1-mini",
          embeddingModel: "text-embedding-3-small",
          temperature: 0.7,
          maxTokens: 2000,
          topP: 0.9,
        },
      };

      const character = engine.importFromElizaOS(elizaData);

      expect(character.id).toBe("eliza_test");
      expect(character.name).toBe("Eliza Test");
      expect(character.sourceFormat).toBe("elizaos");
      expect(character.system).toBe("You are a helpful test assistant.");

      // 应能通过 getCharacter 获取
      const retrieved = engine.getCharacter("eliza_test");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("eliza_test");
    });

    it("应处理缺少字段的 ElizaOS 数据", () => {
      const minimalData = {
        id: "minimal",
        name: "Minimal",
      };

      const character = engine.importFromElizaOS(minimalData);
      expect(character.id).toBe("minimal");
      expect(character.bio).toEqual([]);
      expect(character.style.all).toEqual([]);
    });
  });
});
