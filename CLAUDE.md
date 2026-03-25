# SmartAgent4 — AI 架构指南

> 本文件是 SmartAgent4 项目的**高层架构浓缩版**，专为 AI 编程助手设计。
> 在每次代码分析或优化对话开始时，请优先阅读本文件以快速建立项目全局视角。
> **最后更新：** 2026-03-25（第二轮迭代 Phase 6b）

---

## 1. 项目定位

SmartAgent4 是一个基于 **LangGraph Supervisor-Agent 架构**的智能对话系统，融合了个性引擎、三层记忆系统（含四层过滤管道）、情感表达渲染和自进化闭环能力。底层使用 TypeScript + Node.js，前端使用 React + Vite + TailwindCSS，数据库使用 PostgreSQL（Drizzle ORM）。

## 2. 技术栈速查

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 + TailwindCSS 4 |
| 后端 | Node.js + Express + tRPC 11 |
| AI 框架 | LangGraph (StateGraph) + LangChain |
| LLM | Manus API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨 |
| 数据库 | **PostgreSQL 16** (Drizzle ORM + postgres.js 驱动) |
| 情感渲染 | Emotions-Express Python 微服务 (HTTP API) |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest 2 + @vitest/coverage-v8 |
| 包管理 | pnpm 10 |

## 3. 核心对话处理管线

```
用户消息
  → [contextEnrichNode]     检索记忆 + 构建画像 + 动态 System Prompt
  → [classifyNode]          意图分类，按复杂度路由
  → [planNode?]             复杂任务多步规划
  → [executeNode]           调度 Domain Agent 执行
  → [replanNode]            评估结果，决定继续或响应
  → [respondNode]           生成最终回复（含情感标签）
  → [memoryExtractionNode]  异步 fire-and-forget 记忆提取
  → [reflectionNode]        异步自进化：工具效用更新 + Prompt 补丁
  → AI 回复
```

| 节点 | 文件路径 | 职责 |
|------|---------|------|
| contextEnrichNode | `server/agent/supervisor/contextEnrichNode.ts` | 检索记忆 + 构建用户画像 + 生成动态 System Prompt + 注入情感标签指令 |
| classifyNode | `server/agent/supervisor/classifyNode.ts` | 意图分类，按复杂度路由到 plan 或直接 execute |
| planNode | `server/agent/supervisor/planNode.ts` | 复杂任务的多步规划 |
| executeNode | `server/agent/supervisor/executeNode.ts` | 调度 Domain Agent 执行，捕获 StepResult（含工具调用耗时和报错） |
| replanNode | `server/agent/supervisor/replanNode.ts` | 评估执行结果，决定继续执行或进入响应 |
| respondNode | `server/agent/supervisor/respondNode.ts` | 使用动态 Prompt 生成最终回复（含情感标签） |
| memoryExtractionNode | `server/agent/supervisor/memoryExtractionNode.ts` | 异步 fire-and-forget，从对话中提取记忆 |
| **reflectionNode** | `server/agent/supervisor/reflectionNode.ts` | **[新增]** 异步反思：分析执行质量、更新工具效用分数、生成 Prompt 补丁 |

图定义入口：`server/agent/supervisor/supervisorGraph.ts` → `buildSupervisorGraph()`

## 4. 三层记忆系统

### 4.1 架构

```
工作记忆（内存 Map，30 分钟 TTL）
    ↓ 对话结束时
四层过滤管道（预过滤 → LLM 提取 → 置信度门控 → 动态去重）
    ↓ 写入
长期记忆（PostgreSQL memories 表）
    ↓ 后台定时任务
记忆巩固（LLM 聚类提炼）+ 记忆遗忘（艾宾浩斯衰减）
```

### 4.2 四层过滤管道（第二轮迭代新增）

| 层级 | 名称 | 机制 |
|------|------|------|
| Layer 1 | 预过滤 | 拦截空消息、短内容（< 4字符）、纯问候语 |
| Layer 2 | 增强版 LLM 提取 | 结构化 Prompt（kind/type/importance/confidence/versionGroup），含正反面示例 |
| Layer 3 | 置信度门控 | importance ≥ 0.3, confidence ≥ 0.4, type 白名单校验 |
| Layer 4 | 动态阈值去重 | Jaccard 字符相似度 + 子串包含 + 自适应阈值（50/200 条分界） |

### 4.3 核心文件

| 文件 | 职责 |
|------|------|
| `server/memory/memorySystem.ts` | 记忆系统入口：搜索、添加、提取（四层过滤）、画像、巩固、遗忘 |
| `server/memory/profileBuilder.ts` | 从 persona 记忆构建用户画像 (ContextualProfileSnapshot) |
| `server/memory/hybridSearch.ts` | BM25 + Vector 混合检索 |
| `server/memory/consolidationService.ts` | LLM 驱动的记忆巩固（聚类 + 摘要） |
| `server/memory/forgettingService.ts` | 艾宾浩斯遗忘曲线指数衰减 |
| `server/memory/memoryCron.ts` | 后台定时任务调度 |

### 4.4 记忆分类

- **kind**：`episodic`（情景）| `semantic`（语义）| `persona`（人格）
- **type**：`fact` | `behavior` | `preference` | `emotion`
- **去重机制**：`versionGroup` 键名匹配 + Jaccard 相似度 + 动态阈值

## 5. 自进化闭环（第二轮迭代新增）

### 5.1 架构

```
工具调用
  → reflectionNode 异步分析
  → ToolRegistry.updateUtility() (EMA 算法)
  → tool_utility_logs 表持久化
  → LLM 反思生成 Prompt 补丁
  → prompt_versions 表版本控制
```

### 5.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| ReflectionNode | `server/agent/supervisor/reflectionNode.ts` | 异步反思节点，分析执行质量 |
| ToolRegistry v2 | `server/mcp/toolRegistry.ts` | 工具效用分数管理（updateUtility / getRankedTools） |
| SmartAgentApp | `server/agent/smartAgentApp.ts` | 提供 getToolRegistry() 公开方法 |

### 5.3 已知限制

- 工具效用分数的"读取端"尚未实现 — `classifyNode` 和 `baseAgent` 未消费 `utilityScore`
- Domain Agent 的工具集仍由 `availableTools` 静态数组决定
- 计划在下一轮迭代中闭合反馈回路

## 6. 数据库 Schema

定义在 `drizzle/schema.ts`，使用 **PostgreSQL** (pg-core)：

| 表名 | 用途 | 状态 |
|------|------|------|
| `users` | 用户表（OAuth） | 已有 |
| `user_preferences` | 用户偏好设置（人格、响应风格） | 已有 |
| `memories` | 核心记忆表（含 embedding、versionGroup、importance、tags） | 已有 |
| `memory_clusters` | 巩固后的记忆聚类 | 已有 |
| `chat_sessions` | 会话管理 | 已有 |
| `conversations` | 对话历史 | 已有 |
| `behavior_patterns` | 检测到的行为模式 | 已有 |
| **`tool_utility_logs`** | 工具调用效用日志 | **新增** |
| **`prompt_versions`** | Prompt 版本历史（自进化闭环） | **新增** |

枚举类型：`roleEnum`、`kindEnum`、`memoryTypeEnum`、`toolCallStatusEnum`

关系定义：`drizzle/relations.ts`

## 7. 个性引擎

| 文件 | 职责 |
|------|------|
| `server/personality/personalityEngine.ts` | 核心引擎：人格加载、动态 System Prompt 构建、问候语生成 |
| `server/personality/types.ts` | 类型定义（AgentCharacter, BuildSystemPromptOptions） |
| `server/personality/characters/*.json` | 人格配置文件（xiaozhi、jarvis、alfred） |

动态 Prompt 构建公式：`人格配置 + 用户画像 + 记忆上下文 + 情感标签指令`

## 8. MCP 工具集成

| 文件 | 职责 |
|------|------|
| `server/mcp/toolRegistry.ts` | MCP 工具注册与管理（v2：含效用分数） |
| `server/mcp/mcpManager.ts` | MCP 客户端连接管理 |
| `server/mcp/fileOrganizerTools.ts` | 文件整理工具 |
| `server/mcp/freeWeatherTools.ts` | 天气查询工具 |
| `server/mcp/netease/` | 网易云音乐 MCP 服务 |

当前已集成：高德地图导航、文件系统操作、天气查询、网易云音乐。

## 9. Domain Agent 架构

| 文件 | 职责 |
|------|------|
| `server/agent/domains/baseAgent.ts` | Domain Agent 基类（定义统一接口） |
| `server/agent/domains/generalAgent.ts` | 通用对话 Agent |
| `server/agent/domains/fileAgent.ts` | 文件操作 Agent |
| `server/agent/domains/navigationAgent.ts` | 导航 Agent |
| `server/agent/domains/multimediaAgent.ts` | 多媒体 Agent |

所有 Domain Agent 继承 `BaseAgent`，通过 `AgentRegistry` 注册到 `executeNode`。

## 10. API 层

- **协议**：tRPC（类型安全的 RPC）
- **路由定义**：`server/routers.ts`
- **主要端点**：`chat.*`、`memory.*`、`preferences.*`、`character.*`、`emotions.*`、`agent.*`
- **额外 REST 路由**：`server/routers/chatRouterEnhanced.ts`、`server/routers/sequentialThinkingRouter.ts`
- **服务入口**：`server/_core/index.ts`

## 11. 测试

- **框架**：Vitest 2
- **配置**：`vitest.config.ts`
- **运行**：`pnpm test` 或 `npx vitest run`
- **覆盖率**：`npx vitest run --config vitest.config.ts --coverage`
- **当前状态**：282 个测试，271 通过，11 失败（遗留问题：emotionsClient 5 + contextManager 6）
- **本轮新增**：60 个测试全部通过（memoryPipeline 30 + schemaPostgres 13 + memoryExtractionOptions 6 + reflectionNode 11）

## 12. 开发约定

1. **新增 Domain Agent**：继承 `BaseAgent` → 在 `toolRegistry.ts` 注册 → 在 `AgentRegistry` 中添加映射
2. **新增人格**：在 `server/personality/characters/` 中添加 JSON 配置，兼容 ElizaOS Characterfile 格式
3. **记忆提取**：所有记忆必须指定 `versionGroup`，相同 versionGroup 的记忆会自动合并更新
4. **异步副作用**：后置任务（记忆提取、反思、巩固）一律使用 fire-and-forget 模式，不阻塞用户响应
5. **数据库迁移**：`pnpm db:push`（Drizzle ORM → PostgreSQL）
6. **工具效用更新**：通过 `ToolRegistry.updateUtility()` 使用 EMA 算法更新，由 `reflectionNode` 自动触发

## 13. 关键设计决策

| 决策 | 理由 |
|------|------|
| 数据库从 MySQL 迁移至 PostgreSQL | 为后续引入 Apache AGE 图数据库和 pgvector 向量存储统一底层 |
| 记忆提取四层过滤管道 | 减少 LLM Token 消耗，提高记忆质量，过滤噪声和重复 |
| 异步 fire-and-forget 反思节点 | 不增加用户感知延迟，解耦核心对话与后台优化 |
| 工具效用 EMA 算法 | 平衡历史表现与最近调用，给工具恢复机会（下限 0.05） |
| 记忆系统内嵌而非独立微服务 | 减少网络开销，记忆数据与 Agent 上下文高度耦合 |
| LLM 双轨策略 | Manus API 为主，Volcengine ARK 为回退 |

## 14. 待办事项

- [ ] 闭合自进化反馈回路：classifyNode 消费工具效用分数，baseAgent 使用 getRankedTools() 动态调整工具优先级
- [ ] 引入 pgvector 向量存储，替代内存向量检索
- [ ] 引入 Apache AGE 图记忆
- [ ] 前端 UI 适配个性切换和情感渲染展示
- [ ] Emotions-Express 微服务部署与端到端集成测试
- [ ] 修复遗留测试失败（emotionsClient mock + contextManager 位置服务 mock）
- [ ] 清理代码和文档中残留的 MySQL 引用（routers.ts、index.ts 注释等）

---

> **使用方式**：在每次 AI 辅助开发对话的开头，发送"请先阅读 CLAUDE.md"即可让 AI 快速理解项目全貌。
