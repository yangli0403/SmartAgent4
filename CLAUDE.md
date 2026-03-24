# SmartAgent4 — AI 架构指南

> 本文件是 SmartAgent4 项目的**高层架构浓缩版**，专为 AI 编程助手设计。
> 在每次代码分析或优化对话开始时，请优先阅读本文件以快速建立项目全局视角。
> **最后更新：** 2026-03-24

---

## 1. 项目定位

SmartAgent4 是一个基于 **LangGraph Supervisor-Agent 架构**的智能对话系统，融合了个性引擎、三层记忆系统和情感表达渲染能力。底层使用 TypeScript + Node.js，前端使用 React + Vite + TailwindCSS。

## 2. 技术栈速查

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + TailwindCSS |
| 后端 | Node.js + Express + tRPC |
| AI 框架 | LangGraph (StateGraph) + LangChain |
| LLM | Manus API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨 |
| 数据库 | MySQL/TiDB (Drizzle ORM) |
| 情感渲染 | Emotions-Express Python 微服务 (HTTP API) |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest + @vitest/coverage-v8 |
| 包管理 | pnpm |

## 3. 核心对话处理管线

```
用户消息 → [contextEnrichNode] → [classifyNode] → [planNode?] → [executeNode] → [replanNode] → [respondNode] → [memoryExtractionNode] → AI 回复
```

| 节点 | 文件路径 | 职责 |
|------|---------|------|
| **contextEnrichNode** | `server/agent/supervisor/contextEnrichNode.ts` | 检索记忆 + 构建用户画像 + 生成动态 System Prompt + 注入情感标签指令 |
| **classifyNode** | `server/agent/supervisor/classifyNode.ts` | 意图分类，按复杂度路由到 plan 或直接 execute |
| **planNode** | `server/agent/supervisor/planNode.ts` | 复杂任务的多步规划 |
| **executeNode** | `server/agent/supervisor/executeNode.ts` | 调度 Domain Agent 执行，捕获 `StepResult`（含工具调用耗时和报错） |
| **replanNode** | `server/agent/supervisor/replanNode.ts` | 评估执行结果，决定继续执行或进入响应 |
| **respondNode** | `server/agent/supervisor/respondNode.ts` | 使用动态 Prompt 生成最终回复（含情感标签） |
| **memoryExtractionNode** | `server/agent/supervisor/memoryExtractionNode.ts` | **异步 fire-and-forget**，从对话中提取记忆，不阻塞回复 |

图定义入口：`server/agent/supervisor/supervisorGraph.ts` → `buildSupervisorGraph()`

## 4. 三层记忆系统

### 4.1 架构

```
工作记忆（内存 Map，30 分钟 TTL）
    ↓ 对话结束时
记忆提取（LLM 异步提取）
    ↓ 写入
长期记忆（MySQL memories 表）
    ↓ 后台定时任务
记忆巩固（LLM 聚类提炼）+ 记忆遗忘（艾宾浩斯衰减）
```

### 4.2 核心文件

| 文件 | 职责 |
|------|------|
| `server/memory/memorySystem.ts` | 记忆系统入口：搜索、添加、提取、画像、巩固、遗忘 |
| `server/memory/profileBuilder.ts` | 从 persona 记忆构建用户画像 (`ContextualProfileSnapshot`) |
| `server/memory/hybridSearch.ts` | BM25 + Vector 混合检索 |
| `server/memory/consolidationService.ts` | LLM 驱动的记忆巩固（聚类 + 摘要） |
| `server/memory/forgettingService.ts` | 艾宾浩斯遗忘曲线指数衰减 |
| `server/memory/memoryCron.ts` | 后台定时任务调度 |

### 4.3 记忆分类

- **kind**：`episodic`（情景）| `semantic`（语义）| `persona`（人格）
- **type**：`fact` | `behavior` | `preference` | `emotion`
- **去重机制**：`versionGroup` 键名匹配 + 内容相似度比较

### 4.4 数据库表（Drizzle Schema）

定义在 `drizzle/schema.ts`：

| 表名 | 用途 |
|------|------|
| `users` | 用户表（OAuth） |
| `user_preferences` | 用户偏好设置（人格、响应风格） |
| `memories` | 核心记忆表（含 embedding、versionGroup、importance、tags） |
| `memory_clusters` | 巩固后的记忆聚类 |
| `chat_sessions` | 会话管理 |
| `conversations` | 对话历史 |
| `behavior_patterns` | 检测到的行为模式 |

## 5. 个性引擎

| 文件 | 职责 |
|------|------|
| `server/personality/personalityEngine.ts` | 核心引擎：人格加载、动态 System Prompt 构建、问候语生成 |
| `server/personality/types.ts` | 类型定义（`AgentCharacter`, `BuildSystemPromptOptions`） |
| `server/personality/characters/*.json` | 人格配置文件（xiaozhi、jarvis、alfred） |

动态 Prompt 构建公式：`人格配置 + 用户画像 + 记忆上下文 + 情感标签指令`

## 6. 情感表达系统

| 文件 | 职责 |
|------|------|
| `server/emotions/emotionsClient.ts` | Emotions-Express HTTP 客户端（含超时降级） |
| `server/emotions/emotionTagInstructions.ts` | `[tag:value]` 情感标签模板 |

服务不可用时自动降级为纯文本输出。

## 7. MCP 工具集成

| 文件 | 职责 |
|------|------|
| `server/mcp/toolRegistry.ts` | MCP 工具注册与管理 |
| `server/mcp/mcpClientManager.ts` | MCP 客户端连接管理 |

当前已集成：高德地图导航、文件系统操作。

## 8. Domain Agent 架构

| 文件 | 职责 |
|------|------|
| `server/agent/domains/baseAgent.ts` | Domain Agent 基类（定义统一接口） |
| `server/agent/domains/*.ts` | 各领域 Agent 实现 |

所有 Domain Agent 继承 `BaseAgent`，通过 `AgentRegistry` 注册到 `executeNode`。

## 9. API 层

- **协议**：tRPC（类型安全的 RPC）
- **路由定义**：`server/routers.ts`
- **主要端点**：`personality.*`、`emotions.*`、`chat.*`、`memory.*`

## 10. 测试

- **框架**：Vitest
- **配置**：`vitest.config.ts`
- **运行**：`pnpm test`
- **覆盖率**：`npx vitest run --config vitest.config.ts --coverage`
- **当前覆盖率**：语句 71.05%，函数 89.74%，共 65 个测试用例

## 11. 开发约定

1. **新增 Domain Agent**：继承 `BaseAgent` → 在 `toolRegistry.ts` 注册 → 在 `AgentRegistry` 中添加映射
2. **新增人格**：在 `server/personality/characters/` 中添加 JSON 配置，兼容 ElizaOS Characterfile 格式
3. **记忆提取**：所有记忆必须指定 `versionGroup`，相同 versionGroup 的记忆会自动合并更新
4. **异步副作用**：后置任务（记忆提取、巩固）一律使用 fire-and-forget 模式，不阻塞用户响应
5. **数据库迁移**：`pnpm db:push`（Drizzle ORM）

## 12. 关键设计决策

| 决策 | 理由 |
|------|------|
| 记忆系统内嵌而非独立微服务 | 减少网络开销，记忆数据与 Agent 上下文高度耦合 |
| 文件清理强制用户确认 | 安全考虑，防止 AI 误删系统文件 |
| 语音合成微服务解耦 | 避免在 TypeScript 项目中混入 Python 依赖 |
| LLM 双轨策略 | Manus API 为主，Volcengine ARK 为回退 |

## 13. 待办事项

- [ ] 记忆数据从 SQLite 迁移到 MySQL/TiDB
- [ ] 前端 UI 适配个性切换和情感渲染展示
- [ ] Emotions-Express 微服务部署与端到端集成测试
- [ ] 引入图记忆（Apache AGE / Neo4j）
- [ ] 记忆提取管道噪声过滤优化
- [ ] Agent 自进化闭环（Reflect + Write）

---

> **使用方式**：在每次 AI 辅助开发对话的开头，发送"请先阅读 CLAUDE.md"即可让 AI 快速理解项目全貌。
