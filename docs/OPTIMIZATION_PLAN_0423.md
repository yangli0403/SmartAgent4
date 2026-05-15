# SmartAgent4 优化开发计划：意图分类纠偏与记忆系统扩展

作者：**Manus AI**日期：2026-05-15

本文档基于对 SmartAgent4 `demo_0423` 分支代码的分析以及《路线情景记忆扩展到车控午睡场景的通俗说明》文档的解读，针对“意图分类的相似性方案纠偏”和“记忆系统支持午睡与导航规划”两个方向，提出详细的后续优化开发计划。

## 一、关于意图分类的相似性方案纠偏

### 1.1 当前现状与痛点分析

在当前的 `classifyNode.ts` 中，意图分类主要依赖于 LLM（如 `qwen-turbo`）进行结构化输出。为了弥补 LLM 在特定场景下的误判，系统中硬编码了大量的规则纠偏函数，例如 `refineClassificationForMusicIntent`、`refineClassificationForDiskIntent`、`refineClassificationForNewsIntent` 以及针对多轮对话的 `refineClassificationForFollowUp`。

此外，项目中存在一个 `intent_similarity_prototype.py` 原型脚本，展示了基于字符 N-gram 和 TF-IDF 余弦相似度的分类方案。该原型通过计算用户输入与预定义候选集（`CANDIDATES`）的相似度，结合正则拦截（Guard Patterns），能够在极低延迟下对意图进行纠偏。

**当前痛点：**

- **规则膨胀与维护困难**：随着支持领域的增加，`classifyNode.ts` 中的正则规则越来越长，难以维护且容易产生冲突。

- **LLM 延迟与不稳定性**：即使使用了轻量级 LLM，每次分类仍需网络请求，且在面对模糊表达（如“按我的喜好，今晚适合吃什么、听什么？”）时，LLM 的分类结果可能不稳定。

- **原型未工程化**：相似性纠偏方案目前仅停留在 Python 原型阶段，尚未集成到 TypeScript 编写的 Node.js 服务中。

### 1.2 优化开发计划

为了提升意图分类的准确性和响应速度，计划将相似性纠偏方案工程化并集成到现有的分类节点中

#### 1.2.1 方案设计：混合分类架构

采用“规则前置拦截 + 相似度计算 + LLM 兜底/验证”的混合架构：

1. **前置正则拦截 (Guard)**：将 `intent_similarity_prototype.py` 中的 `MEMORY_GUARD_PATTERNS`、`NAV_EXPLICIT_PATTERNS` 等高置信度正则移植到 TS 中。如果命中强规则，直接返回分类结果，跳过后续步骤。

1. **轻量级相似度计算 (Similarity)**：在 Node.js 中实现基于 N-gram 和 TF-IDF 的余弦相似度算法。在服务启动时，加载各领域的典型语料（可从 `AgentCardRegistry` 动态提取或配置静态语料库），构建文档向量。

1. **LLM 验证与融合**：当相似度得分低于阈值，或得分接近导致难以决断时，再调用 LLM 进行分类。最终结合相似度得分和 LLM 结果进行决策（如原型中的 `should_override` 逻辑）。

#### 1.2.2 代码调整内容

- **新建模块**：在 `server/agent/supervisor/` 下新建 `intentSimilarity.ts`。
  - 实现 `charNgrams`、`buildDocs`、`vectorize` 和 `cosine` 函数。
  - 定义候选语料库接口，支持从 Agent Cards 动态加载 `examples` 或 `triggerPhrases`。

- **改造 ****`classifyNode.ts`**：
  - 引入 `intentSimilarity.ts`。
  - 在调用 `callLightLLMStructured` 之前，先执行前置拦截和相似度计算。
  - 如果相似度得分极高（例如 > 0.85）且分差明显，可直接返回分类结果，实现**短路优化**，降低 LLM 调用成本和延迟。
  - 如果调用了 LLM，则在获取 LLM 结果后，使用相似度结果进行二次纠偏（替换现有的部分硬编码正则纠偏）。

- **保留多轮上下文纠偏**：`refineClassificationForFollowUp` 逻辑非常重要，应继续保留，并在相似度计算前优先应用，以确保多轮对话的意图延续。

## 二、关于记忆系统支持午睡与导航规划

### 2.1 当前现状与痛点分析

根据《路线情景记忆扩展到车控午睡场景的通俗说明》文档，系统需要支持将“午睡模式”（关闭车灯、打开空调、座椅调舒躺）等车控操作作为一种**场景流程记忆（Scene Episode / Routine Episode）**保存下来。

目前 SmartAgent4 的记忆系统（`drizzle/schema.ts`）中，`memories` 表支持 `kind = 'episodic'`，并且在 `navigationMemoryPlan.ts` 和 `persistNavigationEpisodic.ts` 中已经实现了针对导航路线的情景记忆写入。然而，现有的结构主要面向文本摘要（如“本次通勤/路线规划情景...途经...”），缺乏对结构化动作列表（Actions）的标准化支持。

**当前痛点：**

- **车控动作缺乏结构化存储**：车控场景不仅需要记录“用户喜欢午睡”，更需要记录精确的动作序列、参数和安全策略。

- **召回与执行未分离**：车控涉及物理实体的操作，具有安全风险。目前的记忆提取后往往直接用于生成回复，缺乏“召回 -> 确认 -> 执行”的明确分层机制。

- **工具支持不足**：`memoryTools.ts` 中的 `memory_store` 工具目前主要接收 `content` 文本，虽然支持 `tags` 和 `versionGroup`，但对复杂的 `metadata`（如动作列表）支持不够友好。

### 2.2 优化开发计划

结合文档建议，采用**短期快速版**方案，复用现有的 `memories` 表，通过扩展 `metadata` 字段来支持车控午睡场景及更复杂的导航规划。

#### 2.2.1 方案设计：扩展 Episodic Memory 结构

将路线情景记忆和车控情景记忆统一抽象为 **Scene Episode**，存储在 `memories` 表中，`kind` 设为 `episodic`，`type` 设为 `behavior`。

核心在于规范化 `metadata` 的 JSON 结构，使其能够承载结构化的场景信息：

```typescript
// 扩展 schema.ts 中的 metadata 类型定义
metadata: jsonb("metadata").$type<{
  source?: string;
  relatedMemoryIds?: number[];
  tags?: string[];
  // --- 新增场景流程相关字段 ---
  domain?: "vehicle_control" | "navigation" | "multimedia" | "smart_home";
  sceneName?: string;
  triggerPhrases?: string[];
  timePattern?: string;
  actions?: Array<{
    tool: string;
    command: string;
    [key: string]: any; // 动作参数，如 temperature, preset 等
  }>;
  safetyLevel?: "confirm_before_execute" | "auto_execute";
}>()
```

#### 2.2.2 代码调整内容

1. **更新 Schema 与类型定义**：
  - 修改 `drizzle/schema.ts` 中 `memories` 表的 `metadata` 类型，增加上述场景流程字段。
  - 在 `server/memory/types.ts` 中同步更新相关接口。

1. **升级 ****`memoryTools.ts`**：
  - 扩展 `memory_store` 工具的入参 Schema，允许 Agent 传入 `metadata` 对象（或将其扁平化为特定参数如 `sceneName`, `actions` 等）。
  - 确保 `auditMemoryExtraction` 和 `addMemory` 能够正确处理并保存这些扩展的元数据。

1. **实现“召回与执行分离”机制**：
  - 在 `hybridSearch.ts` 或 `memorySystem.ts` 中，增强对 `triggerPhrases` 的匹配能力。当用户说“昨天中午睡觉操作”时，能够通过文本相似度或向量检索命中对应的 `episodic` 记忆。
  - **关键调整**：在 Agent（如 `serviceAgent` 或未来的 `vehicleAgent`）的 System Prompt 中明确规定：**当检索到包含 ****`actions`**** 的车控情景记忆时，必须先向用户复述动作列表并请求确认，收到明确同意后方可调用相应的车控工具执行。**

1. **导航规划的适配**：
  - 现有的 `persistNavigationEpisodic.ts` 可以平滑迁移到新的结构。除了保存文本摘要到 `content`，还可以将起点、终点、途经点等结构化数据存入 `metadata.actions` 或 `metadata.slots` 中，以便未来更精确地复用路线。

### 2.3 实施路径总结

- **第一阶段**：修改 `schema.ts` 和 `memoryTools.ts`，打通结构化 `metadata` 的存储链路。

- **第二阶段**：在 Agent Prompt 中注入车控场景的“确认后执行”安全策略。

- **第三阶段**：将 Python 版本的意图相似性纠偏算法移植为 TypeScript，集成到 `classifyNode.ts` 中，替换部分硬编码规则，提升分类的准确性和系统的可维护性。

---

*本文档基于 SmartAgent4 架构规范编写，旨在为后续迭代提供清晰的技术蓝图。*

