# SmartAgent4 — AI 架构指南

> 本文件是 SmartAgent4 项目的**高层架构浓缩版**，专为 AI 编程助手设计。
> 在每次代码分析或优化对话开始时，请优先阅读本文件以快速建立项目全局视角。
> **最后更新：** 2026-03-30（第四轮迭代 Phase 6b — 主动记忆引擎）

---

## 1. 项目定位

SmartAgent4 是一个基于 **LangGraph Supervisor-Agent 架构**的智能对话系统，融合了个性引擎、三层记忆系统（含四层过滤管道与**主动预测预取**）、情感表达渲染、自进化闭环能力，以及多智能体协同架构。底层使用 TypeScript + Node.js，前端使用 React + Vite + TailwindCSS，数据库使用 PostgreSQL（Drizzle ORM）。

## 2. 技术栈速查

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 + TailwindCSS 4 |
| 后端 | Node.js + Express + tRPC 11 |
| AI 框架 | LangGraph (StateGraph) + LangChain |
| LLM | Manus API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨 |
| 数据库 | **PostgreSQL 16** (Drizzle ORM + postgres.js 驱动) |
| Agent 发现 | Agent Card JSON + AgentCardRegistry + Zod 校验 |
| 情感渲染 | Emotions-Express Python 微服务 (HTTP API) |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest 2 + @vitest/coverage-v8 |
| 包管理 | pnpm 10 |

## 3. 核心对话处理管线

```
用户消息
  → [contextEnrichNode]     检查预取缓存(HIT则跳过检索) → 检索记忆 + 构建画像 + 动态 System Prompt
  → [classifyNode]          意图分类（动态 Prompt 注入），按复杂度路由
  → [planNode?]             复杂任务多步规划（动态 Agent 列表 + 并行提示）
  → [parallelExecuteNode]   DAG 分析 + Promise.all 并行分发（新注册表模式）
     或 [executeNode]       串行调度（旧注册表兼容模式）
  → [replanNode]            评估结果，决定继续或响应
  → [respondNode]           生成最终回复（含情感标签）
  → [memoryExtractionNode]  异步 fire-and-forget 记忆提取
     ↘ [behaviorDetector]   异步 fire-and-forget 行为模式检测
  → [reflectionNode]        异步自进化：工具效用更新 + Prompt 补丁
  → AI 回复
```

| 节点 | 文件路径 | 职责 |
|------|---------|------|
| **contextEnrichNode** | `server/agent/supervisor/contextEnrichNode.ts` | **[第四轮增强] 检查预取缓存** + 检索记忆 + 构建用户画像 + 生成动态 System Prompt |
| classifyNode | `server/agent/supervisor/classifyNode.ts` | 意图分类，动态 Prompt 注入，按复杂度路由 |
| planNode | `server/agent/supervisor/planNode.ts` | 复杂任务多步规划，动态 Agent 列表 + 并行执行提示 |
| parallelExecuteNode | `server/agent/discovery/parallelExecuteEngine.ts` | DAG 拓扑排序 + Promise.all 并行分发 |
| executeNode | `server/agent/supervisor/executeNode.ts` | 串行调度（旧 AgentRegistry 兼容模式） |
| replanNode | `server/agent/supervisor/replanNode.ts` | 评估执行结果，决定继续执行或进入响应 |
| respondNode | `server/agent/supervisor/respondNode.ts` | 使用动态 Prompt 生成最终回复（含情感标签） |
| **memoryExtractionNode** | `server/agent/supervisor/memoryExtractionNode.ts` | 异步 fire-and-forget，从对话中提取记忆；**[第四轮增强] 触发行为模式检测** |
| reflectionNode | `server/agent/supervisor/reflectionNode.ts` | 异步反思：分析执行质量、更新工具效用分数、生成 Prompt 补丁 |

图定义入口：`server/agent/supervisor/supervisorGraph.ts` → `buildSupervisorGraph()`

## 4. 主动记忆引擎（第四轮迭代新增）

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

## 5. 多智能体协同架构（第三轮迭代新增）

### 5.1 Agent Card 动态发现

启动时：`agent-cards/*.json` → `AgentCardRegistry` → 校验注册
运行时：`DynamicPromptAssembler` 动态拼接 Prompt；`parallelExecuteNode` 拓扑排序并行执行；`BaseAgent.delegate()` 横向委托。

### 5.2 委托协议

`BaseAgent.delegate(request)` 通过 `AgentCardRegistry.findByCapability()` 查找目标 Agent，直接调用 `agent.execute()` 实现同步横向委托。委托深度限制为 3 层（`MAX_DELEGATE_DEPTH = 3`）。

## 6. 三层记忆系统

### 6.1 架构

```
工作记忆（内存 Map，30 分钟 TTL）
    ↓ 对话结束时
四层过滤管道（预过滤 → LLM 提取 → 置信度门控 → 动态去重）
    ↓ 写入
长期记忆（PostgreSQL memories 表）
    ↓ 后台定时任务
记忆巩固（LLM 聚类提炼）+ 记忆遗忘（艾宾浩斯衰减）+ 意图预测预取（主动记忆引擎）
```

### 6.2 四层过滤管道

| 层级 | 名称 | 机制 |
|------|------|------|
| Layer 1 | 预过滤 | 拦截空消息、短内容（< 4字符）、纯问候语 |
| Layer 2 | 增强版 LLM 提取 | 结构化 Prompt（kind/type/importance/confidence/versionGroup），含正反面示例 |
| Layer 3 | 置信度门控 | importance >= 0.3, confidence >= 0.4, type 白名单校验 |
| Layer 4 | 动态阈值去重 | Jaccard 字符相似度 + 子串包含 + 自适应阈值（50/200 条分界） |

## 7. 自进化闭环

工具调用 → `reflectionNode` 异步分析 → `ToolRegistry.updateUtility()` (EMA 算法) → `tool_utility_logs` 表持久化 → LLM 反思生成 Prompt 补丁 → `prompt_versions` 表版本控制。

## 8. 数据库 Schema

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

## 9. 测试

- **框架**：Vitest 2
- **配置**：`vitest.config.ts`
- **运行**：`pnpm test` 或 `npx vitest run`
- **覆盖率**：`npx vitest run --coverage`
- **现状**：432 个测试全部通过（含第四轮迭代新增的 26 个主动记忆引擎测试）。

## 10. 开发约定

1. **新增 Domain Agent**：创建 `agent-cards/xxxAgent.json` → 继承 `BaseAgent` → `smartAgentApp.ts` 自动加载和绑定
2. **新增人格**：在 `server/personality/characters/` 中添加 JSON 配置
3. **记忆提取**：所有记忆必须指定 `versionGroup`，相同 versionGroup 的记忆会自动合并更新
4. **异步副作用**：后置任务一律使用 fire-and-forget 模式（如 `memoryExtractionNode`, `behaviorDetector`）
5. **数据库迁移**：`pnpm db:push`（Drizzle ORM → PostgreSQL）

## 11. 待办事项

- [ ] 闭合自进化反馈回路：classifyNode 消费工具效用分数
- [ ] 引入 pgvector 向量存储，替代内存向量检索
- [ ] 引入 Apache AGE 图记忆
- [ ] AIRI Bridge 流式输出（边说边动）实现
- [ ] 探索更小、更快的本地模型（如 Llama-3-8B）用于后台预测任务，降低 Token 成本
- [ ] 实现事件驱动的预取缓存失效机制（目前仅依赖 TTL）

---

> **使用方式**：在每次 AI 辅助开发对话的开头，发送"请先阅读 CLAUDE.md"即可让 AI 快速理解项目全貌。
貌。
