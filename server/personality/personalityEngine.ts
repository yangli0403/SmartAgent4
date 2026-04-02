/**
 * Personality Engine — 增强版个性引擎
 *
 * 负责管理 AI 人格配置和构建动态 System Prompt。
 * 整合了 SmartAgent2 的 CharacterManager 和 characters.ts 的能力，
 * 同时支持 ElizaOS Characterfile 格式的导入。
 *
 * 核心功能：
 * 1. 加载和管理多个人格配置（JSON 文件）
 * 2. 构建融合人格+用户画像+记忆+情感指令的动态 System Prompt
 * 3. 生成个性化问候语
 * 4. 支持 ElizaOS Characterfile 格式导入
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type {
  AgentCharacter,
  BuildSystemPromptOptions,
  ContextualProfileSnapshot,
  DialogueStyle,
  KnowledgeItem,
  MessageExample,
  ModelSettings,
} from "./types";

// ==================== 接口定义 ====================

export interface IPersonalityEngine {
  getCharacter(characterId: string): AgentCharacter | null;
  listCharacters(): AgentCharacter[];
  buildSystemPrompt(options: BuildSystemPromptOptions): string;
  generateGreeting(
    characterId: string,
    userProfile?: ContextualProfileSnapshot
  ): string;
  importFromElizaOS(data: Record<string, unknown>): AgentCharacter;
}

// ==================== 实现 ====================

export class PersonalityEngine implements IPersonalityEngine {
  private characters: Map<string, AgentCharacter> = new Map();
  private defaultCharacterId: string = "xiaozhi";

  constructor() {
    this.loadCharacters();
  }

  /**
   * 从 characters 目录加载所有人格配置 JSON 文件
   */
  private loadCharacters(): void {
    const charactersDir = path.join(__dirname, "characters");

    try {
      if (!fs.existsSync(charactersDir)) {
        console.warn(
          `[PersonalityEngine] Characters directory not found: ${charactersDir}`
        );
        return;
      }

      const files = fs.readdirSync(charactersDir).filter((f) => f.endsWith(".json"));

      for (const file of files) {
        try {
          const filePath = path.join(charactersDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          const character = this.validateCharacter(data);
          this.characters.set(character.id, character);
          console.log(
            `[PersonalityEngine] Loaded character: ${character.id} (${character.name})`
          );
        } catch (error) {
          console.error(
            `[PersonalityEngine] Failed to load character file ${file}:`,
            (error as Error).message
          );
        }
      }

      console.log(
        `[PersonalityEngine] Total characters loaded: ${this.characters.size}`
      );
    } catch (error) {
      console.error(
        "[PersonalityEngine] Failed to load characters directory:",
        (error as Error).message
      );
    }
  }

  /**
   * 验证并补全人格配置
   */
  private validateCharacter(data: Record<string, unknown>): AgentCharacter {
    const now = new Date().toISOString();

    return {
      id: String(data.id || "unknown"),
      name: String(data.name || "未命名"),
      bio: Array.isArray(data.bio) ? data.bio.map(String) : [],
      lore: Array.isArray(data.lore) ? data.lore.map(String) : [],
      system: data.system ? String(data.system) : undefined,
      style: this.validateStyle(data.style),
      messageExamples: Array.isArray(data.messageExamples)
        ? (data.messageExamples as MessageExample[][])
        : [],
      postExamples: Array.isArray(data.postExamples)
        ? data.postExamples.map(String)
        : [],
      adjectives: Array.isArray(data.adjectives)
        ? data.adjectives.map(String)
        : [],
      topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
      knowledge: Array.isArray(data.knowledge)
        ? (data.knowledge as KnowledgeItem[])
        : [],
      clients: Array.isArray(data.clients) ? data.clients.map(String) : [],
      modelProvider: data.modelProvider ? String(data.modelProvider) : undefined,
      settings: this.validateSettings(data.settings),
      vehicleConfig: data.vehicleConfig as AgentCharacter["vehicleConfig"],
      systemPromptTemplate: data.systemPromptTemplate
        ? String(data.systemPromptTemplate)
        : undefined,
      sourceFormat: (data.sourceFormat as "native" | "elizaos") || "native",
      createdAt: String(data.createdAt || now),
      updatedAt: String(data.updatedAt || now),
    };
  }

  /**
   * 验证对话风格
   */
  private validateStyle(style: unknown): DialogueStyle {
    if (!style || typeof style !== "object") {
      return { all: [], chat: [], voice: [], post: [] };
    }
    const s = style as Record<string, unknown>;
    return {
      all: Array.isArray(s.all) ? s.all.map(String) : [],
      chat: Array.isArray(s.chat) ? s.chat.map(String) : [],
      voice: Array.isArray(s.voice) ? s.voice.map(String) : [],
      post: Array.isArray(s.post) ? s.post.map(String) : [],
    };
  }

  /**
   * 验证模型设置
   */
  private validateSettings(settings: unknown): ModelSettings {
    if (!settings || typeof settings !== "object") {
      return {
        model: "gpt-4.1-mini",
        embeddingModel: "text-embedding-3-small",
        temperature: 0.7,
        maxTokens: 2000,
        topP: 0.9,
      };
    }
    const s = settings as Record<string, unknown>;
    return {
      model: String(s.model || "gpt-4.1-mini"),
      embeddingModel: String(s.embeddingModel || "text-embedding-3-small"),
      voice: s.voice as ModelSettings["voice"],
      temperature: Number(s.temperature ?? 0.7),
      maxTokens: Number(s.maxTokens ?? 2000),
      topP: Number(s.topP ?? 0.9),
    };
  }

  // ==================== 公共接口 ====================

  /**
   * 获取人格配置
   */
  getCharacter(characterId: string): AgentCharacter | null {
    return this.characters.get(characterId) || null;
  }

  /**
   * 列出所有可用人格
   */
  listCharacters(): AgentCharacter[] {
    return Array.from(this.characters.values());
  }

  /**
   * 构建动态 System Prompt
   *
   * 融合以下信息生成完整的系统提示词：
   * 1. 人格配置（bio, lore, style, knowledge）
   * 2. 用户画像（displayName, preferences, relationships）
   * 3. 记忆上下文（检索到的相关记忆）
   * 4. 情感标签指令（引导 LLM 输出 [tag:value] 标签）
   *
   * 来源：SmartAgent2 的 CharacterManager.buildSystemPrompt()
   */
  buildSystemPrompt(options: BuildSystemPromptOptions): string {
    const {
      characterId,
      userProfile,
      memoryContext,
      emotionTagInstructions,
    } = options;

    const character =
      this.getCharacter(characterId) ||
      this.getCharacter(this.defaultCharacterId);

    if (!character) {
      console.warn(
        `[PersonalityEngine] Character not found: ${characterId}, using minimal prompt`
      );
      return "你是一个友善的 AI 助手。";
    }

    // 如果有自定义模板，使用模板替换
    if (character.systemPromptTemplate) {
      return this.buildFromTemplate(
        character,
        userProfile,
        memoryContext,
        emotionTagInstructions
      );
    }

    // 否则使用默认的分段构建方式
    const sections: string[] = [];

    // === 1. 核心身份 ===
    sections.push(this.buildIdentitySection(character));

    // === 2. 用户画像 ===
    if (userProfile) {
      const profileSection = this.buildUserProfileSection(userProfile);
      if (profileSection) {
        sections.push(profileSection);
      }
    }

    // === 3. 记忆上下文 ===
    if (memoryContext && memoryContext.trim()) {
      sections.push(this.buildMemorySection(memoryContext));
    }

    // === 4. 记忆技能使用策略 ===
    sections.push(this.buildMemorySkillSection());

    // === 5. 对话风格指令 ===
    sections.push(this.buildStyleSection(character));

    // === 6. 对话示例 ===
    const examplesSection = this.buildExamplesSection(character);
    if (examplesSection) {
      sections.push(examplesSection);
    }

    // === 7. 情感标签指令 ===
    if (emotionTagInstructions) {
      sections.push(emotionTagInstructions);
    }

    return sections.join("\n\n");
  }

  /**
   * 生成问候语
   */
  generateGreeting(
    characterId: string,
    userProfile?: ContextualProfileSnapshot
  ): string {
    const character =
      this.getCharacter(characterId) ||
      this.getCharacter(this.defaultCharacterId);

    if (!character) {
      return "你好！有什么可以帮你的吗？";
    }

    const name = userProfile?.displayName || "你";
    const hour = new Date().getHours();

    let timeGreeting: string;
    if (hour < 6) timeGreeting = "夜深了";
    else if (hour < 12) timeGreeting = "早上好";
    else if (hour < 14) timeGreeting = "中午好";
    else if (hour < 18) timeGreeting = "下午好";
    else timeGreeting = "晚上好";

    // 根据人格风格生成不同的问候语
    switch (character.id) {
      case "jarvis":
        return `${timeGreeting}，${name}。贾维斯随时为您效劳。有什么需要我处理的事务吗？`;
      case "alfred":
        return `${timeGreeting}，${name}。很高兴见到您。今天有什么我可以为您做的吗？`;
      default:
        return `${timeGreeting}${name === "你" ? "" : "，" + name}！我是${character.name}，有什么可以帮你的吗？`;
    }
  }

  /**
   * 从 ElizaOS Characterfile 格式导入人格配置
   */
  importFromElizaOS(data: Record<string, unknown>): AgentCharacter {
    const character = this.validateCharacter({
      ...data,
      sourceFormat: "elizaos",
    });

    // ElizaOS 特有字段映射
    if (data.system && typeof data.system === "string") {
      character.system = data.system;
    }

    this.characters.set(character.id, character);
    console.log(
      `[PersonalityEngine] Imported ElizaOS character: ${character.id}`
    );

    return character;
  }

  // ==================== 私有构建方法 ====================

  /**
   * 使用模板构建 System Prompt
   */
  private buildFromTemplate(
    character: AgentCharacter,
    userProfile?: ContextualProfileSnapshot,
    memoryContext?: string,
    emotionTagInstructions?: string
  ): string {
    let prompt = character.systemPromptTemplate || "";

    // 替换变量
    prompt = prompt.replace("{character_name}", character.name);
    prompt = prompt.replace("{character_bio}", character.bio.join(" "));
    prompt = prompt.replace(
      "{user_profile_section}",
      userProfile ? this.buildUserProfileSection(userProfile) || "" : ""
    );
    prompt = prompt.replace(
      "{memory_section}",
      memoryContext ? this.buildMemorySection(memoryContext) : ""
    );
    prompt = prompt.replace(
      "{style_instructions}",
      this.buildStyleSection(character)
    );
    prompt = prompt.replace(
      "{emotion_instructions}",
      emotionTagInstructions || ""
    );

    return prompt;
  }

  /**
   * 构建核心身份段落
   */
  private buildIdentitySection(character: AgentCharacter): string {
    const parts: string[] = [];

    // 系统指令
    if (character.system) {
      parts.push(character.system);
    } else {
      parts.push(`你是${character.name}。`);
    }

    // 简介
    if (character.bio.length > 0) {
      parts.push(`\n## 关于你\n${character.bio.join("\n")}`);
    }

    // 背景故事
    if (character.lore.length > 0) {
      parts.push(`\n## 背景\n${character.lore.join("\n")}`);
    }

    // 性格特征
    if (character.adjectives.length > 0) {
      parts.push(
        `\n## 性格特征\n你的性格特点是：${character.adjectives.join("、")}。`
      );
    }

    // 擅长话题
    if (character.topics.length > 0) {
      parts.push(
        `\n## 擅长领域\n你擅长以下话题：${character.topics.join("、")}。`
      );
    }

    // 知识库
    if (character.knowledge.length > 0) {
      const knowledgeText = character.knowledge
        .map((k) => `- ${k.content}`)
        .join("\n");
      parts.push(`\n## 核心知识\n${knowledgeText}`);
    }

    return parts.join("\n");
  }

  /**
   * 构建用户画像段落
   */
  private buildUserProfileSection(
    profile: ContextualProfileSnapshot
  ): string | null {
    const parts: string[] = [];

    if (profile.displayName) {
      parts.push(`用户希望被称呼为"${profile.displayName}"。`);
    }

    if (profile.activePreferences.length > 0) {
      const prefsText = profile.activePreferences
        .map((p) => `- ${p.category}: ${p.key} = ${p.value}`)
        .join("\n");
      parts.push(`用户偏好：\n${prefsText}`);
    }

    if (profile.relevantRelationships.length > 0) {
      const relsText = profile.relevantRelationships
        .map((r) => `- ${r.personName}: ${r.relationship}`)
        .join("\n");
      parts.push(`用户的人际关系：\n${relsText}`);
    }

    if (parts.length === 0) return null;

    return `## 用户信息\n${parts.join("\n")}`;
  }

  /**
   * 构建记忆上下文段落
   */
  private buildMemorySection(memoryContext: string): string {
    return `## 相关记忆\n以下是与当前对话相关的历史记忆，请在回复中自然地参考这些信息：\n${memoryContext}`;
  }

  /**
   * 构建记忆技能使用策略段落
   *
   * 引导 Agent 在正确的时机主动调用记忆工具，实现从“被动捕获”到“主动调度”的范式转变。
   * 包含三大核心策略：任务总结（Store）、模糊消解（Search）、状态更新（Update/Forget）。
   */
  private buildMemorySkillSection(): string {
    return `## 记忆技能使用策略
你拥有以下记忆管理工具，必须根据以下策略主动使用：

### 任务总结（memory_store）
当你完成一个多轮任务（如导航规划、行程预订、复杂方案讨论）后，必须主动调用 memory_store 将本次任务的核心决策和关键信息总结为一条完整记忆。
- 不要存储无意义的闲聊内容，只存储有价值的信息。
- 内容应包含完整的上下文，而不是碎片化的单句。
- 必须指定正确的 type（fact/behavior/preference/emotion）和相关标签。

### 模糊消解（memory_search）
当用户的指令包含模糊指代（如“上次那家”、“昨晚的路线”、“我之前说过的”）或需要隐式偏好时，必须先调用 memory_search 检索历史记忆，然后再回复用户。
- 使用简洁的关键词进行搜索，而不是完整的句子。
- 如果搜索结果不理想，可以尝试不同的关键词重新搜索。

### 状态更新（memory_update / memory_forget）
当用户明确指出之前的记忆有误或状态发生改变（如“我搬家了”、“我不吃辣了”）时，必须主动调用 memory_update 或 memory_forget。
- 先用 memory_search 找到目标记忆的 ID，再执行更新或删除。
- 更新时确保新内容完整准确。`;
  }

  /**
   * 构建对话风格段落
   */
  private buildStyleSection(character: AgentCharacter): string {
    const styleRules: string[] = [];

    if (character.style.all.length > 0) {
      styleRules.push(...character.style.all);
    }
    if (character.style.chat.length > 0) {
      styleRules.push(...character.style.chat);
    }

    if (styleRules.length === 0) return "";

    return `## 对话风格\n${styleRules.map((r) => `- ${r}`).join("\n")}`;
  }

  /**
   * 构建对话示例段落
   */
  private buildExamplesSection(character: AgentCharacter): string | null {
    if (character.messageExamples.length === 0) return null;

    // 最多取 3 组示例
    const examples = character.messageExamples.slice(0, 3);
    const exampleTexts = examples.map((group, i) => {
      const msgs = group
        .map(
          (m) =>
            `${m.role === "user" ? "用户" : character.name}: ${m.content}`
        )
        .join("\n");
      return `示例 ${i + 1}:\n${msgs}`;
    });

    return `## 对话示例\n${exampleTexts.join("\n\n")}`;
  }
}

// ==================== 单例工厂 ====================

let _instance: PersonalityEngine | null = null;

/**
 * 获取 PersonalityEngine 单例
 */
export function getPersonalityEngine(): PersonalityEngine {
  if (!_instance) {
    _instance = new PersonalityEngine();
  }
  return _instance;
}
