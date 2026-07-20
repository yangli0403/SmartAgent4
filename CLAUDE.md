# SmartAgent4 — AI 架构指南

> 本文件是 SmartAgent4 项目的**高层架构浓缩版**，专为 AI 编程助手设计。
> 在每次代码分析或优化对话开始时，请优先阅读本文件以快速建立项目全局视角。
> **最后更新：** 2026-06-18（第十轮迭代 — M4 阶段：preAnalysisNode 接入 supervisorGraph，executionMode 替代 complexity，SSE sseSchemaVersion 强约束）

---

## 1. 项目定位

SmartAgent4 是一个基于 **LangGraph Supervisor-Agent 架构**的智能对话系统，融合了个性引擎、三层记忆系统（含四层过滤管道、**向量语义检索**、**智能预检索决策**与**主动预测预取**）、情感表达渲染、自进化闭环能力，以及多智能体协同架构。底层使用 TypeScript + Node.js，前端使用 React + Vite + TailwindCSS，数据库使用 PostgreSQL（Drizzle ORM）。**v1.3 起：执行模式 executionMode（single/parallel/plan）替代 complexity 作为权威字段。**

## 2. 技术栈速查

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 + TailwindCSS 4 + **PixiJS 7 + Live2D** |
| 后端 | Node.js + Express + tRPC 11 |
| AI 框架 | LangGraph (StateGraph) + LangChain |
| LLM | Manus API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨 |
| Embedding | 阿里云百炼 DashScope `text-embedding-v3` (1024维) / OpenAI 兼容 |
| 数据库 | **PostgreSQL 16** (Drizzle ORM + postgres.js 驱动) |
| Agent 发现 | Agent Card JSON + AgentCardRegistry + Zod 校验 |
| 情感渲染 | Emotions-Express (后端) + **AIRI Stage (前端 Live2D 舞台)** |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest 2 + @vitest/coverage-v8 + **jsdom (前端组件测试)** |
| 包管理 | pnpm 10 |

## 3. AIRI 前端角色舞台（第八轮迭代新增）

基于 PixiJS 和 pixi-live2d-display 构建的非侵入式前端渲染层，通过事件总线与现有 UI 解耦。

### 3.1 架构与数据流

```
[后端 AI 回复] → (包含 [emotion:happy] 等标签)
       ↓
[前端 emotionParser] → 提取纯文本 + 标签数组
       ↓
[StageEventBus] → 将标签转换为标准舞台事件 (expression, motion, tts_start 等)
       ↓
[Zustand Store] ← 集中管理所有舞台状态 (当前表情、动作优先级、口型电平、闲置状态)
       ↓
[驱动器 Hooks] → 监听事件/状态，调用 Live2D 模型 API
  ├─ useExpressionDriver (平滑插值更新参数)
  ├─ useMotionDriver (优先级打断播放动作)
  ├─ useLipsyncDriver (Web Audio 音量映射口型)
  └─ useIdleManager (闲置超时自动呼吸/眨眼)
```

### 3.2 核心组件

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| **AiriStageContainer** | `client/src/components/airi-stage/AiriStageContainer.tsx` | 承载 Live2D 画布，管理模型加载与自适应缩放，集成所有驱动器 |
| **StageEventBus** | `client/src/lib/airi-stage/stageEventBus.ts` | 基于 mitt 的轻量级事件总线，解耦 UI 与驱动层 |
| **useStageStore** | `client/src/lib/airi-stage/useStageStore.ts` | Zustand 状态机，管理表情过渡、动作优先级、口型和闲置状态 |
| **驱动器 Hooks** | `client/src/hooks/use*Driver.ts` | 桥接 Store 状态与 Live2D 底层 API (`setParameterValueById`, `motion`) |

## 4. 核心对话处理管线

```
用户消息
  → [preAnalysisNode]       **[第九轮新增 v1.3]** 4 路流水线：PrefetchCache → RuleLayer → 相似度短路 → LLM，输出 PreAnalyzerOutput
  → [contextEnrichNode]     **Pre-Retrieval Decision** → 检查预取缓存 → 向量化查询 → 混合检索(BM25+向量) + 构建画像 + 动态 System Prompt
  → [classifyNode]          意图分类（动态 Prompt 注入），按复杂度路由
  → [planNode?]             复杂任务多步规划（动态 Agent 列表 + 并行提示）
  → [parallelExecuteNode]   DAG 分析 + Promise.all 并行分发（新注册表模式）
     或 [executeNode]       串行调度（旧注册表兼容模式）
  → [replanNode]            评估结果，决定继续或响应
  → [respondNode]           生成最终回复（含情感标签）
  → [memoryExtractionNode]  更新工作记忆 + 异步 fire-and-forget 记忆提取（受开关控制）
     ⇘ [behaviorDetector]   **已解耦**：基于对话计数器独立触发（不依赖自动提取开关）
     ↘ [DreamGatekeeper]    触发后台 Worker 进行记忆整合与预测
  → [reflectionNode]        异步自进化：工具效用更新 + Prompt 补丁
  → AI 回复
```

| 节点 | 文件路径 | 职责 |
|------|---------|------|
| **preAnalysisNode** | `server/agent/preAnalysis/node/preAnalysisNode.ts` | **[第九轮新增 v1.3]** 4 路流水线编排：PrefetchCache 命中 → RuleLayer complete → rulePartial 满足 → LLM；含 schemaVersion 校验、soft/hard 超时降级、14 项 v1.3 修复 |
| **contextEnrichNode** | `server/agent/supervisor/contextEnrichNode.ts` | **[第七轮增强]** Pre-Retrieval Decision → 缓存/向量检索/跳过三路分支 + 构建画像 + 动态 System Prompt |
| classifyNode | `server/agent/supervisor/classifyNode.ts` | **[第五轮增强]** 意图分类，**Prompt Caching 动态信息分离** |
| planNode | `server/agent/supervisor/planNode.ts` | **[第五轮增强]** 复杂任务多步规划，**Prompt Caching 动态信息分离** |
| parallelExecuteNode | `server/agent/discovery/parallelExecuteEngine.ts` | DAG 拓扑排序 + 并行分发 |
| executeNode | `server/agent/supervisor/executeNode.ts` | 串行调度（旧 AgentRegistry 兼容模式） |
| replanNode | `server/agent/supervisor/replanNode.ts` | 评估执行结果，决定继续执行或进入响应 |
| respondNode | `server/agent/supervisor/respondNode.ts` | 使用动态 Prompt 生成最终回复（含情感标签） |
| **memoryExtractionNode** | `server/agent/supervisor/memoryExtractionNode.ts` | **[第七轮增强]** 更新工作记忆 + 异步提取（受开关控制）+ 行为检测已解耦（基于对话计数器独立触发） |
| reflectionNode | `server/agent/supervisor/reflectionNode.ts` | 异步反思：分析执行质量、更新工具效用分数、生成 Prompt 补丁 |

图定义入口：`server/agent/supervisor/supervisorGraph.ts` → `buildSupervisorGraph()`

## 5. 主动记忆引擎（第四轮迭代新增）

基于 memU 理念，系统从"被动响应"升级为具备"主动预测"能力的 24/7 全天候助理。

### 4.1 核心机制

```
[Memory Extraction] → [Behavior Detector] (异步检测行为模式)
                                ↓
[Memory Cron] → [Proactive Engine] (每2小时遍历活跃用户)
                                ↓ (预测意图)
                       [Prefetch Cache] (提前检索并格式化上下文)
                                ↓ (缓存命中)
[Context Enrich] ←----------(快速返回，跳过实时检索)
```

### 4.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| Behavior Detector | `server/memory/behaviorDetector.ts` | LLM 驱动，异步分析对话历史和提取的记忆，识别用户的习惯、偏好等行为模式。 |
| Proactive Engine | `server/memory/proactiveEngine.ts` | 意图预测引擎，结合用户画像、行为模式和最近对话，预测用户下一步意图并执行预取。 |
| Prefetch Cache | `server/memory/prefetchCache.ts` | 内存级 LRU + TTL 缓存，存储预取好的记忆上下文。 |
| Memory Cron | `server/memory/memoryCron.ts` | 后台调度器，新增 `PREDICTION_INTERVAL` (默认 2h) 触发预测周期。 |

## 6. 多智能体协同架构（第三轮/第五轮迭代增强）

### 5.1 Agent Card 动态发现

启动时：`agent-cards/*.json` → `AgentCardRegistry` → 校验注册
运行时：`DynamicPromptAssembler` 动态拼接 Prompt（**[第五轮增强]** 分离静态规则与动态内容，优化 Prompt Caching）；`parallelExecuteNode` 拓扑排序并行执行；`BaseAgent.delegate()` 横向委托。

### 5.2 委托协议与 Fork 子代理模式

`BaseAgent.delegate(request)` 通过 `AgentCardRegistry.findByCapability()` 查找目标 Agent。
**[第五轮增强]** 引入 Fork 子代理模式：
- **上下文共享**：通过 `ForkContext` 传递父代理的对话历史和用户上下文，减少 Token 消耗。
- **事件驱动通知**：支持 `async=true` 异步委托，子代理完成后通过 `AgentEventBus` 发布 `TaskCompleted` 事件，替代硬阻塞的 `Promise.all`。
- 委托深度限制为 3 层（`MAX_DELEGATE_DEPTH = 3`）。

## 7. 三层记忆系统

### 6.1 架构

```
工作记忆（内存 Map，30 分钟 TTL）
    ↓ 对话结束时
Agent 主动记忆技能 (memory_store/search/update/forget) 
  或 四层过滤管道（受 AUTO_EXTRACTION_ENABLED 开关控制，默认关闭）
    ↓ 写入
长期记忆（PostgreSQL memories 表）
    ↓ **[第五轮增强]** DreamGatekeeper 复合触发门控（时间+消息数量）
记忆巩固（LLM 聚类提炼）+ 记忆遗忘（艾宾浩斯衰减）+ 意图预测预取（主动记忆引擎）
    ↓ **[第五轮增强]** MemoryWorkerManager 异步隔离执行
```

### 6.2 记忆技能化改造（第六轮迭代）

将记忆的定义权和执行权交还给 Agent，实现从“被动捕获”到“主动调度”的范式转变：
1. **主动记忆工具**：新增 `memory_store`、`memory_search`、`memory_update`、`memory_forget` 四个内置工具。
2. **System Prompt 策略**：注入任务总结、模糊消解、状态更新三大策略，引导 Agent 在正确时机调用工具。
3. **降级自动提取**：默认关闭每轮对话后的自动 LLM 提取，大幅降低 Token 消耗（预计降低 50%-80%）。
4. **兼容后台服务**：Agent 主动存入的记忆（`source: "agent_skill"`）完全兼容现有的记忆巩固和意图预测管道。

### 6.3 记忆系统优化（第七轮迭代）

从“纯文本匹配”升级为“语义理解 + 智能决策 + 质量门控”的全链路优化：

**写入路径优化：**
```
新记忆 → [extractionAudit] 重要性门控 + Jaccard 去重
       → [embeddingService] 生成向量 (DashScope/OpenAI)
       → [confidenceEvolution] 置信度演化 (BOOST/SUPERSEDE)
       → memorySystem.addMemory()
```

**读取路径优化：**
```
用户查询 → [preRetrievalDecision] 规则层+LLM层双重决策
         → NO_RETRIEVE: 跳过检索（闲聊/表情）
         → RETRIEVE: [embeddingService] 向量化查询
                    → [hybridSearch] BM25 + 向量融合检索（无向量时自动降级为纯 BM25）
```

**做梦补漏路径：**
```
DreamGatekeeper → [backfillExtraction] LLM 回溯提取 + 去重
                → memorySystem.addMemory()
```

#### 新增模块职责表

| 模块 | 文件 | 职责 |
|------|------|------|
| **Embedding 服务** | `server/memory/embeddingService.ts` | DashScope/OpenAI 双通道向量化，单例延迟初始化，批量处理，失败返回 null 优雅降级 |
| **预检索决策** | `server/memory/preRetrievalDecision.ts` | 规则层快速过滤（闲聊/emoji/感谢）+ LLM 层深度判断 + 查询重写（代词消解） |
| **提取审计** | `server/memory/extractionAudit.ts` | 按类型动态重要性阈值 + Jaccard 去重 + MERGE 建议 |
| **置信度演化** | `server/memory/confidenceEvolution.ts` | BOOST/SUPERSEDE/NO_MATCH/SKIP 四种策略，基于 versionGroup 匹配 |
| **补漏提取** | `server/memory/backfillExtraction.ts` | LLM 批量回溯提取 + 去重 + MemoryWorkerManager 兼容执行器 |

#### 修改模块变更表

| 模块 | 变更要点 |
|------|----------|
| `memorySystem.ts` | addMemory 集成 Embedding 生成 + Confidence 演化；getFormattedMemoryContext 支持 queryEmbedding |
| `contextEnrichNode.ts` | 插入 Pre-Retrieval Decision 决策层 + 查询向量化 + 三路分支 |
| `memoryTools.ts` | memory_store 写入前经过审计层（重要性门控 + 去重 + 合并） |
| `memoryExtractionNode.ts` | 行为检测从自动提取流程中解耦，基于对话计数器独立触发 |
| `hybridSearch.ts` | 向量不可用时自动回退到纯 BM25，动态调整 alpha 权重 |

## 8. 第十轮 M4 阶段 — supervisorGraph 集成与 v1.3 字段收敛

### 8.1 关键变更

- **preAnalysisNode 已接入 supervisorGraph**（`START → preAnalysis → contextEnrich → classify → [plan | execute] → ...`）
- **executionMode 替代 complexity**：`TaskClassification.executionMode: "single" | "parallel" | "plan"` 作为权威字段；`complexity` 保留为 `@deprecated` 别名
- **新增 state 字段**：`preAnalysisResult: PreAnalyzerOutput | null`、`sceneActivationResult: SceneActivationOutput | null`
- **SSE 强约束**：`runSupervisorStreaming.ts` + `supervisorStreaming.ts` 强制注入 `sseSchemaVersion: "v1.3"`（CI gate 强约束）
- **classifyNode 删 LLM 调用**：直接消费 `preAnalysisResult`，LLM 仅作 fallback
- **contextEnrichNode 读 preAnalysisResult**：`rewrittenQuery` 优先级高于 Pre-Retrieval Decision；`memoryRelevant=false` 跳过检索

### 8.2 关键文件变更

| 文件 | 变更 |
|------|------|
| `server/agent/supervisor/state.ts` | 新增 `preAnalysisResult` + `sceneActivationResult` Annotation；`TaskClassification.executionMode` 权威化；新增 `COMPLEXITY_TO_EXECUTION_MODE` / `EXECUTION_MODE_TO_COMPLEXITY` |
| `server/agent/supervisor/supervisorGraph.ts` | 新增 `preAnalysis` 节点；新增 `routeByExecutionMode`；`SupervisorOutput.classification.executionMode` 替代 `complexity` |
| `server/agent/supervisor/classifyNode.ts` | 移除 LLM 主路径（保留 fallback）；读 `state.preAnalysisResult`；新增 `inferExecutionMode(agents)` |
| `server/agent/supervisor/contextEnrichNode.ts` | 读 `preAnalysisResult.rewrittenQuery` + `memoryRelevant` |
| `server/agent/supervisor/runSupervisorStreaming.ts` | 注入 `sseSchemaVersion` 常量（CI gate） |
| `server/agent/supervisor/supervisorStreaming.ts` | 注入 `sseSchemaVersion` 常量；新增 `preAnalysisPublished` 事件状态 |
| `server/agent/discovery/dynamicPromptAssembler.ts` | prompt schema `executionMode` 替代 `complexity` |
| `server/routers/chatRouterEnhanced.ts` | SSE complexity 事件携带 `sseSchemaVersion: 'v1.3'` |
| `tests/e2e/M4_supervisorGraphIntegration.test.ts` | 7 个 e2e 覆盖 preAnalysis→contextEnrich→classify 串联 |
| `tests/preAnalysis/sse/sseCompatGate.test.ts` | 9 个 gate 强约束测试 |

## 9. 自进化闭环

工具调用 → `reflectionNode` 异步分析 → `ToolRegistry.updateUtility()` (EMA 算法) → `tool_utility_logs` 表持久化 → LLM 反思生成 Prompt 补丁 → `prompt_versions` 表版本控制。

## 9. 数据库 Schema

定义在 `drizzle/schema.ts`，使用 **PostgreSQL** (pg-core)：

| 表名 | 用途 |
|------|------|
| `users` | 用户表（OAuth） |
| `user_preferences` | 用户偏好设置（含 `proactiveService` 开关） |
| `memories` | 核心记忆表（含 embedding、versionGroup、importance、tags） |
| `memory_clusters` | 巩固后的记忆聚类 |
| `chat_sessions` | 会话管理 |
| `conversations` | 对话历史 |
| `behavior_patterns` | **[激活]** 检测到的行为模式 |
| `tool_utility_logs` | 工具调用效用日志 |
| `prompt_versions` | Prompt 版本历史（自进化闭环） |

## 10. 测试

- **框架**：Vitest 2
- **配置**：`vitest.config.ts`
- **运行**：`pnpm test` 或 `npx vitest run`
- **覆盖率**：`npx vitest run --coverage`
- **现状**：后端 864 个测试（含第九轮新增 210 个 preAnalysis 测试），前端 71 个 AIRI 舞台测试（全部通过）。
- **新增模块覆盖率**：AIRI 核心库（`lib/airi-stage`）语句/分支/函数 100%。
- **全量测试文档**：`TESTING.md` (后端) / `docs/TESTING_AIRI_STAGE.md` (前端)。

## 10.5 意图预分析模块（第九轮迭代新增 v1.3）

取代原 `intentClassifier` 中 LLM-only 调用，构建"缓存优先 + 规则兜底 + LLM 兜底"的 4 路流水线，输出统一的 `PreAnalyzerOutput`，与下游 `contextEnrichNode` 解耦。

### 10.5.1 流水线

```
用户输入 → Path 1 PrefetchCache
            ├─ 命中 (schema=v1)       → 直接返回 source=prefetch
            └─ schema 不匹配 (v0)     → 记录 prefetch_invalid_version，降级
         → Path 2 RuleLayer
            ├─ isComplete=true         → 返回 source=rule
            └─ partial 字段           → Path 4b 跳过 LLM
         → Path 3 相似度短路（P2 占位）
         → Path 4 LLM
            ├─ 成功                  → 返回 source=llm
            ├─ soft timeout (3s)     → 降级 source=rule [fallback:llm_soft_timeout]
            ├─ hard timeout (8s)     → 降级 source=rule [fallback:llm_hard_timeout]
            └─ 错误                  → 降级 source=rule [fallback:llm_error]
         → 输出 PreAnalyzerOutput
```

### 10.5.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **preAnalysisNode** | `server/agent/preAnalysis/node/preAnalysisNode.ts` | 主流程编排器，4 路流水线 + 14 项 v1.3 修复集成点 |
| PrefetchCache | `server/agent/preAnalysis/cache/prefetchCache.ts` | LRU+TTL 缓存，`schemaVersion: "v1"` 校验 + `setRaw/computeHash` 测试 seam（v1.3 修复 #7） |
| RuleLayer | `server/agent/preAnalysis/rules/ruleLayer.ts` | 多租户规则评估器，`isComplete` 遍历所有规则 + `calculateConfidence` 统一公式（v1.3 修复 #2/#5/#8/#10） |
| LLMPreAnalyzer | `server/agent/preAnalysis/llm/llmPreAnalyzer.ts` | LLM 调用器，`memoryRelevant` 默认 false + `domain→'unknown'` + soft/hard 超时分级 + Prompt 模板版本控制（v1.3 修复 #1/#9/#12/#13） |
| SceneActivationCache | `server/agent/preAnalysis/cache/sceneActivationCache.ts` | 5min TTL LRU，sceneActivation schema **不含** `memoryRelevant`（v1.3 修复 #4）+ fire-and-forget 异步填充（v1.3 修复 #14）|
| PreAnalyzerOutput | `server/agent/preAnalysis/types/preAnalyzerOutput.ts` | Zod 严格 schema：6 业务字段 + 2 元字段（`source`/`schemaVersion="v1"`）|
| SSE Event Schema | `server/agent/preAnalysis/sse/sseEventSchema.ts` | 全部 SSE 事件工厂自动注入 `sseSchemaVersion: "v1.3"`（v1.3 修复 #11） |

### 10.5.3 v1.3 关键修复（14 项）

| # | 修复 | 落地位置 |
|---|------|---------|
| #1 | `memoryRelevant` 默认 false | `LLMPreAnalyzerImpl.normalize()` |
| #2 | RuleLayer `isComplete` 遍历所有规则 | `ruleLayer.evaluate()` |
| #3 | rulePartial 拼接策略（只填 undefined） | `preAnalysisNode.mergeRulePartial()` |
| #4 | sceneActivation schema 移除 `memoryRelevant` | `sceneActivationOutput.ts` |
| #5 | `calculateConfidence` 统一公式 | `ruleLayer.calculateConfidence()` |
| #6 | A/B test fallback FineTuned→LLM→rule | `preAnalysisNode` |
| #7 | PrefetchCache `schemaVersion` 校验 + `setRaw` seam | `prefetchCache.ts` |
| #8 | 多租户规则隔离 | `ruleLayer` tenant 维度 |
| #9 | LLM `domain → 'unknown'` 兜底 | `LLMPreAnalyzerImpl.normalize()` |
| #10 | 多租户配置注入 | `RuleLayerConfig.tenant` |
| #11 | SSE `sseSchemaVersion: "v1.3"` 注入 | `sseEventSchema.ts` 工厂 |
| #12 | Prompt 模板版本控制 | `LLMPreAnalyzerImpl.PROMPT_VERSION` |
| #13 | LLM soft(3s)/hard(8s) 超时分级 | `LLMTimeoutError.type` |
| #14 | SceneActivationCache fire-and-forget 异步填充 | `preAnalysisNode.fireAndForgetSceneActivation()` |

### 10.5.4 Observability 接入

- **10 指标** (M1-M10)：见 `server/observability/metrics.ts` COUNTER/HISTOGRAM/GAUGE_NAMES
- **7 告警** (A1-A7)：见 `server/observability/alerts.ts` ALERT_THRESHOLDS
- **全链路 trace**：`tracer.startSpan("preAnalysis", { parentSpanId, attributes })` 包裹主流程
- **测试覆盖**：`tests/preAnalysis/` (84) + `tests/observability/` (33) + `tests/integration/` (11) + `tests/e2e/` (23) = **210 测试全绿**

## 11. 开发约定

1. **新增 Domain Agent**：创建 `agent-cards/xxxAgent.json` → 继承 `BaseAgent` → `smartAgentApp.ts` 自动加载和绑定
2. **新增人格**：在 `server/personality/characters/` 中添加 JSON 配置
3. **记忆提取**：所有记忆必须指定 `versionGroup`，相同 versionGroup 的记忆会自动合并更新
4. **异步副作用**：后置任务一律使用 fire-and-forget 模式（如 `memoryExtractionNode`, `behaviorDetector`）
5. **数据库迁移**：`pnpm db:push`（Drizzle ORM → PostgreSQL）

## 12. 待办事项

- [ ] 闭合自进化反馈回路：classifyNode 消费工具效用分数
- [x] ~~引入向量语义检索~~（第七轮已实现，应用层余弦相似度，未使用 pgvector）
- [ ] 迁移到 pgvector 扩展，将向量检索下沉到数据库层
- [ ] 引入 Apache AGE 图记忆
- [x] ~~AIRI 前端角色舞台集成~~（第八轮已实现）
- [ ] AIRI Bridge 流式输出（边说边动）与前端舞台的深度结合
- [ ] 探索更小、更快的本地模型（如 Llama-3-8B）用于后台预测任务，降低 Token 成本
- [ ] 实现事件驱动的预取缓存失效机制（目前仅依赖 TTL）
- [x] ~~意图预分析模块重构 v1.3~~（第九轮已实现：4 路流水线 + 14 项修复 + 10 指标 + 7 告警 + 210 测试全绿）
- [ ] preAnalysisNode 接入 supervisorGraph（替换原 intentClassifier LLM 调用）
- [ ] 接入 class 11.x 中的 CI gate 静态扫描（`sseCompatGate.test.ts` 当前为警告级，待转为强约束）

---

> **使用方式**：在每次 AI 辅助开发对话的开头，发送”请先阅读 CLAUDE.md”即可让 AI 快速理解项目全貌。

---

## gstack 技能配置

本项目已配置 gstack，优先使用 gstack 技能进行代码开发工作流。

**可用技能：**
- `/review` — 代码 review + 自动修复明显 bug
- `/ship` — sync main → run tests → push → open PR
- `/qa <url>` — 打开真实浏览器测试 app，找 bug 并修复
- `/autoplan` — 一键生成完整实现计划
- `/office-hours` — 产品需求分析
- `/investigate` — 调试问题根源分析
- `/browse` — 持久化浏览器（~100ms/命令）

**使用约定：**
- 涉及代码 review 时，使用 `/review`
- 涉及调试问题时，使用 `/investigate`
- 提交代码前，使用 `/ship` 自动处理 PR
- 测试前端 UI 时，使用 `/qa`
