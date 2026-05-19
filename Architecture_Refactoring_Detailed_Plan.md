# SmartAgent4 架构拆分与重构详细落地方案

## 1. 背景与目标

当前 SmartAgent4 项目代码量已达 4.6 万行，其中核心模块如 `agent/supervisor`（5195行）、`memory`（5969行）、`mcp`（5066行）等耦合较深。特别是意图分类节点（`classifyNode.ts`，近 1000 行）充斥着大量硬编码的规则纠偏，难以维护。

**重构目标**：
1. **意图分类模型化**：将 `classifyNode.ts` 中的硬编码规则替换为模型驱动的意图分类器。
2. **记忆系统解耦**：将记忆系统独立为高性能、可插拔的子系统，优化主动推送机制。
3. **多 Agent 协作增强**：完善 Agent 注册机制，支持复杂任务拆分与并行执行。
4. **支持多人并行开发**：通过定义清晰的接口契约（Interface First），实现各模块独立迭代。

---

## 2. 模块化拆分方案与接口定义

### 2.1 意图理解与路由子系统 (Intent & Routing)

**当前痛点**：`classifyNode.ts` 包含 `refineClassificationForMusicIntent`、`refineClassificationForWeatherIntent` 等大量硬编码规则，难以扩展。

**重构方案**：
- 引入统一的 `IIntentClassifier` 接口。
- 接入微调模型或强力通用模型（配合 Few-Shot），将场景匹配与意图分类解耦。
- 移除硬编码的 `refineClassificationForXxx` 规则。

**接口定义**：
```typescript
// server/intent/types.ts
export interface IntentClassificationResult {
  domain: string;
  complexity: "simple" | "moderate" | "complex";
  confidence: number;
  extractedSlots?: Record<string, any>;
}

export interface IIntentClassifier {
  classify(
    userMessage: string,
    context: UserContext,
    history: BaseMessage[]
  ): Promise<IntentClassificationResult>;
}
```

**目录结构调整**：
```
server/intent/
├── index.ts
├── types.ts
├── classifiers/
│   ├── llmClassifier.ts       // 基于大模型的分类器
│   ├── ruleFallback.ts        // 降级规则（仅保留最基础的安全规则）
│   └── fewShotExamples.ts     // Few-Shot 样本库
└── router.ts                  // 路由分发逻辑
```

### 2.2 记忆与个性化子系统 (Memory & Personality)

**当前痛点**：记忆提取阻塞主流程，主动推送引擎（Proactive Engine）与主流程耦合。

**重构方案**：
- 将 `server/memory/` 封装为独立的 `MemoryService`。
- 记忆提取完全异步化，通过事件总线与主流程通信。
- 将主动推送引擎拆分为独立的后台 Worker。

**接口定义**：
```typescript
// server/memory/types.ts
export interface IMemoryService {
  // 核心读写
  addMemory(memory: InsertMemory): Promise<Memory | null>;
  searchMemories(options: MemorySearchOptions): Promise<Memory[]>;
  
  // 异步提取
  extractMemoriesAsync(
    userId: number,
    sessionId: string,
    conversation: BaseMessage[]
  ): void; // Fire-and-forget
  
  // 主动推送
  checkProactiveSuggestions(userId: number, requestId: string): Promise<void>;
}
```

**目录结构调整**：
```
server/memory/
├── index.ts
├── types.ts
├── core/
│   ├── memorySystem.ts        // 核心读写逻辑
│   └── hybridSearch.ts        // 混合检索
├── workers/
│   ├── extractionWorker.ts    // 异步记忆提取
│   └── proactiveWorker.ts     // 主动推送引擎
└── personality/               // 人格系统（从外层移入）
```

### 2.3 多 Agent 协作子系统 (Multi-Agent Collaboration)

**当前痛点**：Agent 注册机制不够灵活，复杂任务拆分与并行执行能力不足。

**重构方案**：
- 完善 `BaseAgent` 接口，优化 `agentCardRegistry.ts` 实现插件化注册。
- 增强 `planNode` 和 `executeNode`，支持将复杂任务拆分给多个 Agent 并行执行。
- 引入共享状态（Blackboard）机制。

**接口定义**：
```typescript
// server/agents/types.ts
export interface IAgentRegistry {
  register(card: AgentCard): void;
  getAgent(domain: string): DomainAgentInterface | undefined;
  getAllAgents(): AgentCard[];
}

export interface ITaskPlanner {
  plan(
    task: string,
    context: UserContext,
    availableAgents: AgentCard[]
  ): Promise<ExecutionPlan>;
}
```

**目录结构调整**：
```
server/agents/
├── index.ts
├── types.ts
├── registry/
│   └── agentCardRegistry.ts   // 插件化注册表
├── domains/                   // 各领域 Agent 实现
│   ├── baseAgent.ts
│   ├── generalAgent.ts
│   └── ...
└── supervisor/                // 编排与调度
    ├── planNode.ts
    ├── executeNode.ts
    └── blackboard.ts          // 共享状态机制
```

### 2.4 LLM 网关与模型管理子系统 (LLM Gateway)

**当前痛点**：`server/llm/langchainAdapter.ts`（581行）直接耦合了 LangChain 和具体模型配置，各模块直接调用 `callLLM` / `callLLMText` / `callLLMStructured`，无法统一管理模型路由、Token 计费、限流和降级策略。

**重构方案**：
- 抽象出 `ILLMGateway` 接口，统一管理所有 LLM 调用。
- 支持多模型路由（按任务类型自动选择模型）、Token 预算管理、自动降级。
- 将 LangChain 作为可替换的底层实现之一，而非唯一绑定。

**接口定义**：
```typescript
// server/llm/types.ts
export interface LLMCallOptions {
  model?: string;           // 指定模型（如 "deepseek-v4-flash"、"gpt-4.1-mini"）
  temperature?: number;
  maxTokens?: number;
  taskType?: "classify" | "plan" | "respond" | "extract" | "general";
  timeout?: number;
}

export interface ILLMGateway {
  callText(system: string, user: string, options?: LLMCallOptions): Promise<string>;
  callStructured<T>(system: string, user: string, schema: z.ZodType<T>, options?: LLMCallOptions): Promise<T>;
  callChat(messages: BaseMessage[], options?: LLMCallOptions): Promise<string>;
  
  // 模型管理
  getAvailableModels(): string[];
  getTokenUsage(userId: number): Promise<{ used: number; limit: number }>;
}
```

**目录结构调整**：
```
server/llm/
├── index.ts
├── types.ts
├── gateway.ts              // ILLMGateway 实现（路由、限流、降级）
├── adapters/
│   ├── langchainAdapter.ts // LangChain 适配器
│   └── directAdapter.ts   // 直接 HTTP 调用适配器
└── config/
    └── modelRegistry.ts   // 模型注册表（模型名称→端点映射）
```

---

### 2.5 MCP/工具注册与管理子系统 (Tool Registry)

**当前痛点**：`server/mcp/`（5066行）包含了 MCP 协议管理、文件系统工具、天气工具、网易云音乐工具等大量具体实现，职责混杂。

**重构方案**：
- 将 MCP 协议层（连接管理、工具发现）与具体工具实现分离。
- 工具实现按领域归类到各 Agent 目录下，MCP 层只负责协议和注册。
- 引入 `IToolRegistry` 接口，统一管理本地工具和远程 MCP 工具。

**接口定义**：
```typescript
// server/tools/types.ts
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (input: any, context: ToolContext) => Promise<ToolResult>;
  source: "local" | "mcp";
  domain?: string;  // 绑定的领域（如 "navigation"、"music"）
}

export interface IToolRegistry {
  register(tool: ToolDefinition): void;
  getToolsForDomain(domain: string): ToolDefinition[];
  getToolByName(name: string): ToolDefinition | undefined;
  getAllTools(): ToolDefinition[];
}
```

**目录结构调整**：
```
server/tools/
├── index.ts
├── types.ts
├── registry.ts             // 统一工具注册表
├── mcp/
│   ├── mcpManager.ts       // MCP 协议连接管理
│   └── mcpConfig.ts        // MCP 服务器配置
└── local/
    ├── fileTools.ts        // 文件管理工具
    ├── weatherTools.ts     // 天气工具
    └── newsTools.ts        // 新闻工具
```

---

### 2.6 情感与表达子系统 (Emotion & Expression)

**当前痛点**：`server/emotions/`（846行）和 `server/personality/`（857行）分散在不同目录，但功能紧密相关（情感标签生成、TTS 参数映射、人格风格控制）。

**重构方案**：
- 合并为统一的「表达层」，负责将 AI 回复文本转化为多模态输出（文本 + 情感标签 + 动作指令 + TTS 参数）。
- 定义 `IExpressionEngine` 接口，支持不同人格配置的切换。

**接口定义**：
```typescript
// server/expression/types.ts
export interface ExpressionOutput {
  text: string;                    // 纯文本回复
  emotionTags: string[];           // 情感标签 [expression:smile]
  animationTags: string[];         // 动作标签 [animation:head_tilt]
  ttsParams?: TTSParams;           // TTS 参数（语速、音调等）
  characterId: string;             // 人格 ID
}

export interface IExpressionEngine {
  enrich(
    rawResponse: string,
    context: { characterId: string; emotion?: string }
  ): Promise<ExpressionOutput>;
  
  getAvailableCharacters(): CharacterConfig[];
}
```

**目录结构调整**：
```
server/expression/
├── index.ts
├── types.ts
├── engine.ts               // IExpressionEngine 实现
├── characters/             // 人格配置文件
│   ├── xiaozhi.ts
│   └── ...
├── emotions/               // 情感标签逻辑
│   └── emotionTagInstructions.ts
└── tts/                    // TTS 参数映射
    └── chatTtsHelper.ts
```

---

### 2.7 上下文管理子系统 (Context Management)

**当前痛点**：`server/context/`（348行）目前较轻量，但上下文信息散落在 `SupervisorState`、`DialogueSlots`、`UserContext` 等多处，缺乏统一的上下文生命周期管理。

**重构方案**：
- 建立统一的 `IContextManager`，管理会话上下文的完整生命周期（创建、更新、持久化、过期）。
- 将 `DialogueSlots`（对话槽位）、`UserLocation`（位置信息）、`WorkingMemory`（工作记忆）统一纳入上下文管理。

**接口定义**：
```typescript
// server/context/types.ts
export interface SessionContext {
  userId: number;
  sessionId: string;
  location?: UserLocation;
  dialogueSlots: DialogueSlots;
  workingMemory: WorkingMemoryEntry[];
  recentHistory: BaseMessage[];
  metadata: Record<string, any>;
}

export interface IContextManager {
  getContext(userId: number, sessionId: string): Promise<SessionContext>;
  updateContext(userId: number, sessionId: string, updates: Partial<SessionContext>): Promise<void>;
  clearContext(userId: number, sessionId: string): Promise<void>;
}
```

---

## 3. 完整目录结构对比

### 3.1 当前目录结构（Before）

```
server/
├── _core/          # 启动、认证、tRPC
├── agent/          # 混合了 supervisor、domains、discovery、tools、events、tasks
│   ├── supervisor/ # classifyNode + planNode + executeNode + respondNode + ...
│   ├── domains/    # baseAgent + 各领域 Agent
│   ├── discovery/  # agentCardRegistry + dynamicPromptAssembler
│   ├── tools/      # memoryTools + newsTools + ...
│   └── ...
├── memory/         # memorySystem + hybridSearch + proactiveEngine + behaviorDetector + ...
├── llm/            # langchainAdapter
├── mcp/            # mcpManager + fileTools + weatherTools + netease + ...
├── personality/    # personalityEngine + personalitySystem
├── emotions/       # emotionsClient + chatTtsHelper
├── context/        # contextManager
└── ...
```

### 3.2 重构后目录结构（After）

```
server/
├── _core/              # 启动、认证、tRPC、事件总线
│   ├── eventBus.ts     # 统一事件总线（从 supervisor 提升到全局）
│   └── featureFlags.ts # 特性开关
│
├── intent/             # 子系统 1：意图理解与路由
│   ├── types.ts
│   ├── classifiers/
│   │   ├── llmClassifier.ts
│   │   ├── ruleFallback.ts
│   │   └── fewShotExamples.ts
│   └── router.ts
│
├── memory/             # 子系统 2：记忆与个性化
│   ├── types.ts
│   ├── core/
│   │   ├── memorySystem.ts
│   │   ├── hybridSearch.ts
│   │   └── embeddingService.ts
│   ├── workers/
│   │   ├── extractionWorker.ts
│   │   ├── proactiveWorker.ts
│   │   └── behaviorAggregator.ts
│   └── personality/
│       ├── personalityEngine.ts
│       └── profileBuilder.ts
│
├── agents/             # 子系统 3：多 Agent 协作
│   ├── types.ts
│   ├── registry/
│   │   ├── agentCardRegistry.ts
│   │   └── agent-cards/       # JSON 配置
│   ├── domains/
│   │   ├── baseAgent.ts
│   │   ├── generalAgent.ts
│   │   ├── navigationAgent.ts
│   │   └── ...
│   └── supervisor/
│       ├── supervisorGraph.ts
│       ├── planNode.ts
│       ├── executeNode.ts
│       ├── respondNode.ts
│       ├── blackboard.ts
│       └── streaming.ts
│
├── llm/                # 子系统 4：LLM 网关
│   ├── types.ts
│   ├── gateway.ts
│   └── adapters/
│       ├── langchainAdapter.ts
│       └── directAdapter.ts
│
├── tools/              # 子系统 5：工具注册与管理
│   ├── types.ts
│   ├── registry.ts
│   ├── mcp/
│   │   ├── mcpManager.ts
│   │   └── mcpConfig.ts
│   └── local/
│       ├── fileTools.ts
│       ├── weatherTools.ts
│       └── newsTools.ts
│
├── expression/         # 子系统 6：情感与表达
│   ├── types.ts
│   ├── engine.ts
│   ├── characters/
│   └── tts/
│
└── context/            # 子系统 7：上下文管理
    ├── types.ts
    └── contextManager.ts
```

---

## 4. 分工建议与实施步骤

### 4.1 分工建议

为支持多人并行开发，建议按子系统划分职责：

| 角色 | 负责模块 | 核心任务 | 代码量预估 |
|------|----------|----------|------------|
| **开发 A** | 意图理解与路由 | 实现 `IIntentClassifier`，接入新模型，清理 `classifyNode.ts` 规则 | ~1500行 |
| **开发 B** | 记忆与个性化 | 封装 `MemoryService`，实现异步提取 Worker，优化主动推送逻辑 | ~6000行 |
| **开发 C** | 多 Agent 协作 | 优化 Agent 注册表，增强 `planNode` 和 `executeNode` 的并行执行能力 | ~4000行 |
| **开发 D** | LLM 网关 + 工具层 | 抽象 LLM 网关，重构 MCP/工具注册 | ~5600行 |
| **架构师** | 核心基础设施 + 表达层 + 上下文 | 定义接口契约，维护事件总线，合并情感/人格为表达层 | ~2000行 |

### 4.2 实施步骤

**第一阶段：接口定义与脚手架搭建（1周）**

1. 架构师牵头，定义各子系统的核心接口（`IIntentClassifier`、`IMemoryService`、`ILLMGateway`、`IToolRegistry`、`IExpressionEngine`、`IContextManager`）。
2. 搭建新的目录结构，创建空实现或代理实现（Proxy to old logic）。
3. 引入特性开关（Feature Flags），允许新旧逻辑并存。
4. 建立 `shared/interfaces/` 目录，存放所有跨模块接口定义。

**第二阶段：并行开发与单元测试（2-3周）**

1. **开发 A**：开发基于模型的新意图分类器，编写 Few-Shot 样本，进行准确率对比测试。
2. **开发 B**：将记忆提取逻辑移入 Worker，通过事件总线触发；重构主动推送逻辑。
3. **开发 C**：重构 Agent 注册机制，实现复杂任务的拆分与并行执行逻辑。
4. **开发 D**：抽象 LLM 网关，支持多模型路由；重构工具注册表。
5. **架构师**：合并情感/人格为表达层，统一上下文管理。

**第三阶段：集成与灰度验证（1-2周）**

1. 在测试环境开启特性开关，进行全链路集成测试。
2. 重点验证：意图分类准确率、记忆提取是否阻塞主流程、多 Agent 协作是否正常。
3. 逐步放量（灰度发布），收集线上反馈，修复遗留问题。

**第四阶段：清理与固化（1周）**

1. 确认新逻辑稳定后，移除旧代码（如 `classifyNode.ts` 中的硬编码规则）。
2. 移除特性开关，固化新架构。
3. 更新开发文档与 API 契约。

---

## 5. 关键代码调整示例

### 5.1 classifyNode.ts 重构示例

**Before**（当前代码，931行，充斥规则）：
```typescript
// classifyNode.ts - 当前
export async function classifyNode(state: SupervisorStateType) {
  // ... LLM 分类 ...
  const result = await callLLMStructured(...);
  
  // 大量硬编码规则纠偏
  result = refineClassificationForMusicIntent(result, userText);
  result = refineClassificationForWeatherIntent(result, userText);
  result = refineClassificationForNewsIntent(result, userText);
  result = refineClassificationForDiskIntent(result, userText);
  result = refineClassificationForVehicleControl(result, userText);
  result = refineClassificationForFollowUp(result, userText, history);
  result = refineClassificationBySimilarity(result, userText, history);
  // ... 更多规则 ...
}
```

**After**（重构后，~200行）：
```typescript
// server/intent/classifiers/llmClassifier.ts
export class LLMIntentClassifier implements IIntentClassifier {
  private fewShotExamples: FewShotExample[];
  
  async classify(userMessage: string, context: UserContext, history: BaseMessage[]) {
    // 1. 构建 Few-Shot Prompt（动态选择最相关的样本）
    const examples = this.selectRelevantExamples(userMessage, 5);
    
    // 2. 调用 LLM（模型自身完成分类，无需规则纠偏）
    const result = await this.llmGateway.callStructured(
      buildClassifyPrompt(examples, context),
      userMessage,
      IntentClassificationSchema,
      { taskType: "classify", model: "intent-classifier-v1" }
    );
    
    // 3. 仅保留最基础的安全规则（如车控指令强制走 vehicle_control）
    return this.applyMinimalSafetyRules(result, userMessage);
  }
}
```

### 5.2 记忆系统异步化示例

**Before**（当前代码，阻塞主流程）：
```typescript
// memoryExtractionNode.ts - 当前
export async function memoryExtractionNode(state: SupervisorStateType) {
  // 同步等待记忆提取完成（3-5秒）
  const extracted = await extractMemoriesFromConversation(...);
  await detectAndPersistPatterns(...);
  return { memoryExtracted: true };
}
```

**After**（重构后，异步化）：
```typescript
// server/memory/workers/extractionWorker.ts
export class MemoryExtractionWorker {
  constructor(private eventBus: EventBus, private memoryService: IMemoryService) {
    // 订阅"对话完成"事件
    this.eventBus.on("conversation.completed", this.handleExtraction.bind(this));
  }
  
  private async handleExtraction(event: ConversationCompletedEvent) {
    // 异步执行，不阻塞主流程
    const extracted = await this.memoryService.extractMemories(event.conversation);
    
    // 提取完成后发布事件，通知其他模块
    this.eventBus.emit("memory.extracted", { userId: event.userId, count: extracted.length });
  }
}
```

### 5.3 特性开关（Feature Flags）示例

```typescript
// server/_core/featureFlags.ts
export const FeatureFlags = {
  USE_MODEL_CLASSIFIER: process.env.FF_MODEL_CLASSIFIER === "true",
  ASYNC_MEMORY_EXTRACTION: process.env.FF_ASYNC_MEMORY === "true",
  PARALLEL_AGENT_EXECUTION: process.env.FF_PARALLEL_AGENTS === "true",
  LLM_GATEWAY_V2: process.env.FF_LLM_GATEWAY_V2 === "true",
};

// 使用示例
import { FeatureFlags } from "../_core/featureFlags";

export async function classifyNode(state: SupervisorStateType) {
  if (FeatureFlags.USE_MODEL_CLASSIFIER) {
    // 新逻辑：模型驱动
    return await newModelClassifier.classify(...);
  } else {
    // 旧逻辑：规则驱动（渐进迁移期间保留）
    return await legacyClassifyNode(...);
  }
}
```

---

## 6. 模块间通信机制

重构后各子系统通过**统一事件总线**进行解耦通信：

```typescript
// server/_core/eventBus.ts
export interface SystemEvent {
  type: string;
  payload: any;
  timestamp: number;
  source: string;
}

export const systemEventBus = new TypedEventEmitter<{
  "intent.classified": { domain: string; complexity: string; userId: number };
  "conversation.completed": { userId: number; sessionId: string; messages: BaseMessage[] };
  "memory.extracted": { userId: number; count: number };
  "agent.executed": { agentId: string; success: boolean; durationMs: number };
  "proactive.triggered": { userId: number; patternId: number; sceneName: string };
}>();
```

**事件流转示意**：
```
用户消息 → Intent 子系统（分类）
         → emit("intent.classified")
         → Supervisor 编排（planNode → executeNode → respondNode）
         → emit("conversation.completed")
         → Memory Worker（异步提取）
         → emit("memory.extracted")
         → Proactive Worker（检查高频模式）
         → emit("proactive.triggered") → SSE → 前端卡片
```

---

## 7. 风险与应对策略

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| 接口变更 | 并行开发冲突 | 每日站会 + 接口变更需架构师评审 |
| 模型分类准确率不及预期 | 用户体验下降 | 保留 `ruleFallback.ts` 降级 + 补充 Few-Shot 样本 |
| 异步记忆提取状态不一致 | 下一轮对话缺失最新记忆 | 引入"记忆处理中"UI 提示 + 关键节点短暂等待 |
| 事件总线性能瓶颈 | 高并发下事件丢失 | 引入队列（如 BullMQ）做削峰 |
| 特性开关管理复杂 | 代码分支混乱 | 限制开关数量，每个开关设置过期日期 |

---

## 8. 验收标准

| 子系统 | 验收指标 |
|--------|----------|
| 意图分类 | 准确率 >= 95%（对比当前规则方案），延迟 < 500ms |
| 记忆系统 | 主流程不阻塞（记忆提取异步化），主动推送成功率 100% |
| 多 Agent | 支持 >= 3 个 Agent 并行执行，复杂任务完成率 >= 90% |
| LLM 网关 | 支持多模型路由，自动降级成功率 >= 99% |
| 工具注册 | 新工具注册无需修改核心代码，热加载支持 |
| 表达层 | 情感标签准确率 >= 90%，人格切换无感知 |

### 3.1 分工建议

为支持多人并行开发，建议按子系统划分职责：

| 角色 | 负责模块 | 核心任务 |
|------|----------|----------|
| **开发 A** | 意图理解与路由 | 实现 `IIntentClassifier`，接入新模型，清理 `classifyNode.ts` 规则。 |
| **开发 B** | 记忆与个性化 | 封装 `MemoryService`，实现异步提取 Worker，优化主动推送逻辑。 |
| **开发 C** | 多 Agent 协作 | 优化 Agent 注册表，增强 `planNode` 和 `executeNode` 的并行执行能力。 |
| **架构师** | 核心基础设施 | 定义接口契约，维护事件总线（`supervisorEventBus`），把控整体进度。 |

### 3.2 实施步骤

**第一阶段：接口定义与脚手架搭建（1周）**
1. 架构师牵头，定义各子系统的核心接口（如 `IIntentClassifier`、`IMemoryService`）。
2. 搭建新的目录结构，创建空实现或代理实现（Proxy to old logic）。
3. 引入特性开关（Feature Flags），允许新旧逻辑并存。

**第二阶段：并行开发与单元测试（2-3周）**
1. **开发 A**：开发基于模型的新意图分类器，编写 Few-Shot 样本，进行准确率对比测试。
2. **开发 B**：将记忆提取逻辑移入 Worker，通过事件总线触发；重构主动推送逻辑。
3. **开发 C**：重构 Agent 注册机制，实现复杂任务的拆分与并行执行逻辑。

**第三阶段：集成与灰度验证（1-2周）**
1. 在测试环境开启特性开关，进行全链路集成测试。
2. 重点验证：意图分类准确率、记忆提取是否阻塞主流程、多 Agent 协作是否正常。
3. 逐步放量（灰度发布），收集线上反馈，修复遗留问题。

**第四阶段：清理与固化（1周）**
1. 确认新逻辑稳定后，移除旧代码（如 `classifyNode.ts` 中的硬编码规则）。
2. 移除特性开关，固化新架构。
3. 更新开发文档与 API 契约。

---

## 4. 风险与应对策略

1. **接口变更风险**：在并行开发过程中，接口定义可能需要调整。
   - *应对*：建立每日站会机制，任何接口变更需经架构师评审并同步全组。
2. **模型分类准确率不及预期**：新模型可能在某些长尾场景下表现不如硬编码规则。
   - *应对*：保留 `ruleFallback.ts` 作为降级策略，针对高频错误补充 Few-Shot 样本。
3. **异步记忆提取导致状态不一致**：记忆提取异步化后，可能导致下一轮对话无法及时获取最新记忆。
   - *应对*：在前端引入"记忆处理中"的 UI 提示，或在关键节点（如生成回复前）增加短暂的等待机制。
