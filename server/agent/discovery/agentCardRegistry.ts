/**
 * AgentCardRegistry — Agent Card 动态注册表
 *
 * 管理所有 Agent Card 的生命周期：
 * - 启动时扫描 `agent-cards/` 目录加载 JSON 配置
 * - 运行时支持注册、注销和按能力查询
 * - 为 classifyNode、planNode、executeNode 提供 Agent 发现服务
 * - 为 BaseAgent.delegate() 提供能力匹配服务
 */

import { z } from "zod";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type {
  AgentCard,
  AgentDomain,
  IAgentCardRegistry,
} from "./types";
import type { DomainAgentInterface } from "../domains/types";

// ==================== Agent Card JSON Schema（Zod 校验） ====================

/**
 * Agent Card 的 Zod 校验 Schema
 *
 * 用于在加载 JSON 文件时进行格式校验，拒绝不合法的配置。
 */
export const AgentCardSchema = z.object({
  id: z.string().min(1, "Agent ID 不能为空"),
  name: z.string().min(1, "Agent 名称不能为空"),
  description: z.string().min(1, "Agent 描述不能为空"),
  capabilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  domain: z.enum(["file_system", "navigation", "multimedia", "general", "custom"]),
  implementationClass: z.string().min(1),
  llmConfig: z.object({
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().min(1).default(4096),
    maxIterations: z.number().min(1).max(20).default(5),
  }),
  systemPromptTemplate: z.string().default(""),
  enabled: z.boolean().default(true),
  priority: z.number().min(0).max(100).default(50),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ==================== 注册表条目 ====================

/** 注册表内部条目：Card + Agent 实例 */
interface RegistryEntry {
  card: AgentCard;
  agent?: DomainAgentInterface;
}

// ==================== AgentCardRegistry 实现 ====================

export class AgentCardRegistry implements IAgentCardRegistry {
  /** 内部存储：agentId → RegistryEntry */
  private entries: Map<string, RegistryEntry> = new Map();

  /**
   * 从目录加载所有 Agent Card JSON 文件
   *
   * 扫描指定目录下的所有 .json 文件，逐个解析和校验，
   * 校验通过的 Card 注册到注册表中。
   */
  async loadFromDirectory(directory: string): Promise<void> {
    console.log(`[AgentCardRegistry] Loading agent cards from: ${directory}`);

    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      console.warn(
        `[AgentCardRegistry] Directory not found: ${directory}, skipping`
      );
      return;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    let loadedCount = 0;
    let errorCount = 0;

    for (const file of jsonFiles) {
      try {
        const filePath = join(directory, file);
        const content = await readFile(filePath, "utf-8");
        const rawData = JSON.parse(content);

        // Zod Schema 校验
        const card = AgentCardSchema.parse(rawData) as AgentCard;

        this.register(card);
        loadedCount++;
        console.log(
          `[AgentCardRegistry] Loaded: ${card.id} (${card.name}) from ${file}`
        );
      } catch (error) {
        errorCount++;
        console.error(
          `[AgentCardRegistry] Failed to load ${file}: ${(error as Error).message}`
        );
      }
    }

    console.log(
      `[AgentCardRegistry] Loading complete: ${loadedCount} loaded, ${errorCount} errors, ${this.entries.size} total`
    );
  }

  /**
   * 注册单个 Agent Card
   */
  register(card: AgentCard, agent?: DomainAgentInterface): void {
    if (this.entries.has(card.id)) {
      console.warn(
        `[AgentCardRegistry] Agent "${card.id}" already registered, overwriting`
      );
    }

    this.entries.set(card.id, { card, agent });
  }

  /**
   * 注销 Agent
   */
  unregister(agentId: string): void {
    if (this.entries.delete(agentId)) {
      console.log(`[AgentCardRegistry] Unregistered: ${agentId}`);
    }
  }

  /**
   * 获取 Agent Card
   */
  getCard(agentId: string): AgentCard | undefined {
    return this.entries.get(agentId)?.card;
  }

  /**
   * 获取 Agent 实例
   */
  getAgent(agentId: string): DomainAgentInterface | undefined {
    return this.entries.get(agentId)?.agent;
  }

  /**
   * 绑定 Agent 实例到已注册的 Card
   */
  bindAgent(agentId: string, agent: DomainAgentInterface): void {
    const entry = this.entries.get(agentId);
    if (!entry) {
      console.warn(
        `[AgentCardRegistry] Cannot bind agent: card "${agentId}" not found`
      );
      return;
    }
    entry.agent = agent;
    console.log(`[AgentCardRegistry] Bound agent instance to: ${agentId}`);
  }

  /**
   * 检查 Agent 是否已注册
   */
  has(agentId: string): boolean {
    return this.entries.has(agentId);
  }

  /**
   * 获取所有已启用的 Agent Card
   */
  getAllEnabled(): AgentCard[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.card.enabled)
      .map((entry) => entry.card);
  }

  /**
   * 获取所有已注册的 Agent ID
   */
  getAllIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * 按能力标签查找匹配的 Agent
   *
   * 返回所有 capabilities 中包含指定标签的已启用 Agent，
   * 按 priority 降序排列。
   */
  findByCapability(capability: string): AgentCard[] {
    const lowerCap = capability.toLowerCase();
    return this.getAllEnabled()
      .filter((card) =>
        card.capabilities.some((c) => c.toLowerCase() === lowerCap)
      )
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 按领域查找 Agent
   */
  findByDomain(domain: AgentDomain): AgentCard[] {
    return this.getAllEnabled()
      .filter((card) => card.domain === domain)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取注册表大小
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.entries.clear();
  }
}

// ==================== 单例工厂 ====================

let _instance: AgentCardRegistry | null = null;

/**
 * 获取 AgentCardRegistry 单例
 */
export function getAgentCardRegistry(): AgentCardRegistry {
  if (!_instance) {
    _instance = new AgentCardRegistry();
  }
  return _instance;
}

/**
 * 重置单例（仅用于测试）
 */
export function resetAgentCardRegistry(): void {
  _instance = null;
}
