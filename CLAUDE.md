# SmartAgent4 — AI 架构指南

> 本文件是 SmartAgent4 项目的**高层架构浓缩版**，专为 AI 编程助手设计。
> 在每次代码分析或优化对话开始时，请优先阅读本文件以快速建立项目全局视角。
> **最后更新：** 2026-03-27（第三轮迭代 Phase 6b — 多智能体协同架构）

---

## 1. 项目定位

SmartAgent4 是一个基于 **LangGraph Supervisor-Agent 架构**的智能对话系统，融合了个性引擎、三层记忆系统（含四层过滤管道）、情感表达渲染、自进化闭环能力，以及**多智能体协同架构**（Agent Card 动态发现 + 并行执行引擎 + 委托协议）。底层使用 TypeScript + Node.js，前端使用 React + Vite + TailwindCSS，数据库使用 PostgreSQL（Drizzle ORM）。

## 2. 技术栈速查

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 + TailwindCSS 4 |
| 后端 | Node.js + Express + tRPC 11 |
| AI 框架 | LangGraph (StateGraph) + LangChain |
| LLM | Manus API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨 |
| 数据库 | **PostgreSQL 16** (Drizzle ORM + postgres.js 驱动) |
| Agent 发现 | **Agent Card JSON + AgentCardRegistry + Zod 校验** |
| 情感渲染 | Emotions-Express Python 微服务 (HTTP API) |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest 2 + @vitest/coverage-v8 |
| 包管理 | pnpm 10 |

## 3. 核心对话处理管线

```
用户消息
  → [contextEnrichNode]     检索记忆 + 构建画像 + 动态 System Prompt
  → [classifyNode]          意图分类（动态 Prompt 注入），按复杂度路由
  → [planNode?]             复杂任务多步规划（动态 Agent 列表 + 并行提示）
  → [parallelExecuteNode]   DAG 分析 + Promise.all 并行分发（新注册表模式）
     或 [executeNode]       串行调度（旧注册表兼容模式）
  → [replanNode]            评估结果，决定继续或响应
  → [respondNode]           生成最终回复（含情感标签）
  → [memoryExtractionNode]  异步 fire-and-forget 记忆提取
  → [reflectionNode]        异步自进化：工具效用更新 + Prompt 补丁
  → AI 回复
```

| 节点 | 文件路径 | 职责 |
|------|---------|------|
| contextEnrichNode | `server/agent/supervisor/contextEnrichNode.ts` | 检索记忆 + 构建用户画像 + 生成动态 System Prompt + 注入情感标签指令 |
| classifyNode | `server/agent/supervisor/classifyNode.ts` | 意图分类，**动态 Prompt 注入**（DynamicPromptAssembler），按复杂度路由 |
| planNode | `server/agent/supervisor/planNode.ts` | 复杂任务多步规划，**动态 Agent 列表 + 并行执行提示** |
| **parallelExecuteNode** | `server/agent/discovery/parallelExecuteEngine.ts` | **[新增]** DAG 拓扑排序 + Promise.all 并行分发 |
| executeNode | `server/agent/supervisor/executeNode.ts` | 串行调度（旧 AgentRegistry 兼容模式） |
| replanNode | `server/agent/supervisor/replanNode.ts` | 评估执行结果，决定继续执行或进入响应 |
| respondNode | `server/agent/supervisor/respondNode.ts` | 使用动态 Prompt 生成最终回复（含情感标签） |
| memoryExtractionNode | `server/agent/supervisor/memoryExtractionNode.ts` | 异步 fire-and-forget，从对话中提取记忆 |
| reflectionNode | `server/agent/supervisor/reflectionNode.ts` | 异步反思：分析执行质量、更新工具效用分数、生成 Prompt 补丁 |

图定义入口：`server/agent/supervisor/supervisorGraph.ts` → `buildSupervisorGraph()`

## 4. 多智能体协同架构（第三轮迭代新增）

### 4.1 Agent Card 动态发现

```
启动时：
  agent-cards/*.json → AgentCardRegistry.loadFromDirectory()
                     → Zod Schema 校验
                     → 注册到 Map<agentId, {card, agent?}>
                     → smartAgentApp.ts 绑定 Agent 实例

运行时：
  classifyNode / planNode → DynamicPromptAssembler → 遍历注册表 → 动态拼接 Prompt
  parallelExecuteNode → registry.getAgent() → 获取实例执行
  BaseAgent.delegate() → registry.findByCapability() → 横向委托
```

### 4.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| AgentCardRegistry | `server/agent/discovery/agentCardRegistry.ts` | Agent Card 注册表：加载、注册、注销、按能力/领域查询 |
| DynamicPromptAssembler | `server/agent/discovery/dynamicPromptAssembler.ts` | 运行时动态拼接 classifyNode 和 planNode 的 System Prompt |
| ParallelExecuteEngine | `server/agent/discovery/parallelExecuteEngine.ts` | DAG 分析（Kahn 拓扑排序）+ Promise.all 并行分发 |
| Agent Card 类型 | `server/agent/discovery/types.ts` | AgentCard、IAgentCardRegistry、IDynamicPromptAssembler、DelegateRequest/Result |
| Agent Card JSON | `server/agent/agent-cards/*.json` | 4 个 Agent Card 配置文件 |

### 4.3 Agent Card 配置文件

| 文件 | Agent ID | 工具数 | 领域 |
|------|----------|--------|------|
| `fileAgent.json` | fileAgent | 15 | file_system |
| `navigationAgent.json` | navigationAgent | 19 | navigation |
| `multimediaAgent.json` | multimediaAgent | 8 | multimedia |
| `generalAgent.json` | generalAgent | 0 | general |

### 4.4 委托协议

`BaseAgent.delegate(request)` 通过 `AgentCardRegistry.findByCapability()` 查找目标 Agent，直接调用 `agent.execute()` 实现同步横向委托。委托深度限制为 3 层（`MAX_DELEGATE_DEPTH = 3`），防止无限递归。

### 4.5 双模式兼容

`supervisorGraph.ts` 中的 `buildSupervisorGraph()` 支持两种注册表：
- **新模式**（`IAgentCardRegistry`）：使用 `parallelExecuteNode`（DAG 并行）
- **旧模式**（`AgentRegistry`）：使用 `executeNode`（串行兼容）

通过 `isNewRegistry` 运行时判断自动切换。

## 5. 三层记忆系统

### 5.1 架构

```
工作记忆（内存 Map，30 分钟 TTL）
    ↓ 对话结束时
四层过滤管道（预过滤 → LLM 提取 → 置信度门控 → 动态去重）
    ↓ 写入
长期记忆（PostgreSQL memories 表）
    ↓ 后台定时任务
记忆巩固（LLM 聚类提炼）+ 记忆遗忘（艾宾浩斯衰减）
```

### 5.2 四层过滤管道

| 层级 | 名称 | 机制 |
|------|------|------|
| Layer 1 | 预过滤 | 拦截空消息、短内容（< 4字符）、纯问候语 |
| Layer 2 | 增强版 LLM 提取 | 结构化 Prompt（kind/type/importance/confidence/versionGroup），含正反面示例 |
| Layer 3 | 置信度门控 | importance >= 0.3, confidence >= 0.4, type 白名单校验 |
| Layer 4 | 动态阈值去重 | Jaccard 字符相似度 + 子串包含 + 自适应阈值（50/200 条分界） |

### 5.3 核心文件

| 文件 | 职责 |
|------|------|
| `server/memory/memorySystem.ts` | 记忆系统入口：搜索、添加、提取（四层过滤）、画像、巩固、遗忘 |
| `server/memory/profileBuilder.ts` | 从 persona 记忆构建用户画像 |
| `server/memory/hybridSearch.ts` | BM25 + Vector 混合检索 |
| `server/memory/consolidationService.ts` | LLM 驱动的记忆巩固 |
| `server/memory/forgettingService.ts` | 艾宾浩斯遗忘曲线指数衰减 |
| `server/memory/memoryCron.ts` | 后台定时任务调度 |

## 6. 自进化闭环

### 6.1 架构

```
工具调用
  → reflectionNode 异步分析
  → ToolRegistry.updateUtility() (EMA 算法)
  → tool_utility_logs 表持久化
  → LLM 反思生成 Prompt 补丁
  → prompt_versions 表版本控制
```

### 6.2 已知限制

- 工具效用分数的"读取端"尚未实现 — `classifyNode` 和 `baseAgent` 未消费 `utilityScore`
- Domain Agent 的工具集仍由 `availableTools` 静态数组决定

## 7. 数据库 Schema

定义在 `drizzle/schema.ts`，使用 **PostgreSQL** (pg-core)：

| 表名 | 用途 |
|------|------|
| `users` | 用户表（OAuth） |
| `user_preferences` | 用户偏好设置 |
| `memories` | 核心记忆表（含 embedding、versionGroup、importance、tags） |
| `memory_clusters` | 巩固后的记忆聚类 |
| `chat_sessions` | 会话管理 |
| `conversations` | 对话历史 |
| `behavior_patterns` | 检测到的行为模式 |
| `tool_utility_logs` | 工具调用效用日志 |
| `prompt_versions` | Prompt 版本历史（自进化闭环） |

## 8. Domain Agent 架构

| 文件 | 职责 |
|------|------|
| `server/agent/domains/baseAgent.ts` | Domain Agent 基类（含 `delegate()` 委托方法） |
| `server/agent/domains/generalAgent.ts` | 通用对话 Agent |
| `server/agent/domains/fileAgent.ts` | 文件操作 Agent（含文件整理大师） |
| `server/agent/domains/navigationAgent.ts` | 导航 Agent |
| `server/agent/domains/multimediaAgent.ts` | 多媒体 Agent |

所有 Domain Agent 继承 `BaseAgent`，通过 **AgentCardRegistry** 注册和发现（新模式），或通过 `AgentRegistry` 注册到 `executeNode`（旧兼容模式）。

## 9. 个性引擎

| 文件 | 职责 |
|------|------|
| `server/personality/personalityEngine.ts` | 核心引擎：人格加载、动态 System Prompt 构建 |
| `server/personality/types.ts` | 类型定义 |
| `server/personality/characters/*.json` | 人格配置文件 |

## 10. MCP 工具集成

| 文件 | 职责 |
|------|------|
| `server/mcp/toolRegistry.ts` | MCP 工具注册与管理（v2：含效用分数） |
| `server/mcp/mcpManager.ts` | MCP 客户端连接管理 |
| `server/mcp/fileOrganizerTools.ts` | 文件整理工具 |
| `server/mcp/freeWeatherTools.ts` | 天气查询工具 |
| `server/mcp/netease/` | 网易云音乐 MCP 服务 |

## 11. AIRI Bridge 模块

AIRI Bridge 将 SmartAgent4 作为 AIRI Plugin Module 连接到 AIRI Server Runtime，实现 Live2D/VRM 形象的情感化渲染。

| 文件 | 职责 |
|------|------|
| `server/airi-bridge/airiBridgeService.ts` | 核心 Bridge 服务 |
| `server/airi-bridge/emotionMapper.ts` | 情感映射器 |
| `server/airi-bridge/audioConverter.ts` | 音频格式转换器 |
| `server/airi-bridge/config.ts` | 配置管理 |

## 12. API 层

- **协议**：tRPC（类型安全的 RPC）
- **路由定义**：`server/routers.ts`
- **主要端点**：`chat.*`、`memory.*`、`preferences.*`、`character.*`、`emotions.*`、`airi.*`、`agent.*`
- **服务入口**：`server/_core/index.ts`

## 13. 测试

- **框架**：Vitest 2
- **配置**：`vitest.config.ts`
- **运行**：`pnpm test` 或 `npx vitest run`
- **覆盖率**：`npx vitest run --config vitest.config.ts --coverage`
- **discovery 模块**：77 个测试全部通过，覆盖率 97.68%（agentCardRegistry 96%、dynamicPromptAssembler 100%、parallelExecuteEngine 98%）
- **遗留测试**：282 个测试，271 通过，11 失败（emotionsClient + contextManager）

## 14. 开发约定

1. **新增 Domain Agent**：创建 `agent-cards/xxxAgent.json` → 继承 `BaseAgent` → `smartAgentApp.ts` 自动加载和绑定
2. **新增人格**：在 `server/personality/characters/` 中添加 JSON 配置
3. **记忆提取**：所有记忆必须指定 `versionGroup`，相同 versionGroup 的记忆会自动合并更新
4. **异步副作用**：后置任务一律使用 fire-and-forget 模式
5. **数据库迁移**：`pnpm db:push`（Drizzle ORM → PostgreSQL）
6. **Agent Card 规范**：JSON 文件中的 `tools` 字段必须与对应 Agent 实现中的 `toolNames` 完全一致

## 15. 关键设计决策

| 决策 | 理由 |
|------|------|
| Agent Card JSON 动态发现 | 新增 Agent 只需放置 JSON 文件，零代码修改核心编排 |
| DAG 驱动的并行执行 | 无依赖步骤 Promise.all 并行，有依赖步骤按拓扑序串行 |
| targetAgent 从联合字面量改为 string | 支持动态注册的 Agent，不再硬编码 Agent ID |
| 委托深度限制（3层） | 防止 Agent 间无限递归委托 |
| findByCapability 精确匹配 | 避免子串匹配导致的误匹配 |
| 新旧注册表双模式兼容 | 渐进式迁移，旧 AgentRegistry 仍可使用 |
| 数据库从 MySQL 迁移至 PostgreSQL | 为后续引入 Apache AGE 和 pgvector 统一底层 |
| 异步 fire-and-forget 反思节点 | 不增加用户感知延迟 |

## 16. 待办事项

- [ ] 闭合自进化反馈回路：classifyNode 消费工具效用分数
- [ ] Agent Card 的 `llmConfig` 消费端实现（当前 Agent 仍使用自身硬编码配置）
- [ ] 引入 pgvector 向量存储，替代内存向量检索
- [ ] 引入 Apache AGE 图记忆
- [ ] 前端 UI 适配个性切换和情感渲染展示
- [ ] AIRI Bridge 流式输出（边说边动）实现
- [ ] 修复遗留测试失败（emotionsClient + contextManager）

---

> **使用方式**：在每次 AI 辅助开发对话的开头，发送"请先阅读 CLAUDE.md"即可让 AI 快速理解项目全貌。
