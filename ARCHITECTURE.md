# SmartAgent4 系统架构设计

## 1. 高层架构概览

SmartAgent4 采用基于 Supervisor 的多 Agent 协作架构，结合了 LangGraph 进行流程编排。系统主要分为前端客户端、API 层、Agent 引擎、记忆系统、人格系统、工具系统和数据访问层。

![系统架构图](./diagrams/architecture.png)

## 2. 模块职责表

| 模块名称 | 主要职责 | 核心技术 | 依赖关系 |
|----------|----------|----------|----------|
| **前端客户端** | 提供用户交互界面，包括对话窗口和驾驶舱视图 | React, Vite, TailwindCSS | tRPC Client |
| **API 层** | 提供类型安全的后端接口，处理请求路由和鉴权 | tRPC, Express | Agent 引擎, 数据访问层 |
| **Agent 引擎** | 核心业务逻辑，负责任务分类、规划、执行和反思 | LangGraph, LangChain | 记忆系统, 人格系统, 工具系统 |
| **记忆系统** | 管理工作记忆和长期记忆，提供记忆提取、检索和巩固功能 | LLM, 向量检索 | 数据访问层 |
| **人格系统** | 管理 AI 角色配置，动态构建 System Prompt | JSON 配置, 模板引擎 | 数据访问层 |
| **工具系统** | 统一管理 MCP Server 提供的工具，支持动态调用 | MCP SDK | 外部 API |
| **数据访问层** | 提供数据库连接和基础 CRUD 操作 | Drizzle ORM, PostgreSQL | 底层数据库 |

## 3. 数据流描述

### 3.1 典型的"写"操作：记忆提取与存储

1. 用户发送消息，前端通过 tRPC 调用 `chat.sendMessage` 接口。
2. 请求进入 Agent 引擎，经过上下文增强、分类、规划和执行节点，最终生成回复。
3. 在回复生成后，异步触发 `MemoryExtractionNode`（记忆提取节点）。
4. 记忆提取节点调用 `memorySystem.ts` 中的 `extractMemoriesFromConversation` 方法。
5. 该方法首先对对话历史进行四层过滤（去噪、去客套话等），然后使用增强版 Prompt 调用 LLM 提取记忆。
6. 提取出的记忆经过动态阈值去重后，通过数据访问层（`db.ts`）写入 PostgreSQL 数据库的 `memories` 表中。

### 3.2 典型的"读"操作：基于效用分数的工具路由

1. 用户发送复杂任务请求，进入 Agent 引擎的 `ClassifyNode`（任务分类节点）。
2. 分类节点在构建 Prompt 时，从工具系统（`ToolRegistry`）中查询各工具的当前效用分数（Utility Score）。
3. LLM 根据用户意图和工具效用分数，决定将任务路由给哪个具体的 Domain Agent（如 `FileAgent` 或 `NavigationAgent`）。
4. 被选中的 Agent 在执行过程中，通过 `MCPManager` 调用具体工具。
5. 执行完成后，`ReflectionNode`（反思节点）异步分析执行结果，更新工具的效用分数，并可能生成 Prompt 补丁反馈给人格系统。

## 4. 关键设计决策

### 4.1 数据库从 MySQL 迁移至 PostgreSQL
- **背景**：为了后续引入 Apache AGE 图数据库和 pgvector 向量存储，需要统一底层数据库。
- **决策**：将 Drizzle ORM 的方言从 `mysql` 切换为 `postgresql`，使用 `postgres.js` 驱动。
- **理由**：PostgreSQL 提供了更强大的扩展能力，能够在一个实例中同时处理关系型、图和向量数据，简化了部署架构。

### 4.2 记忆提取管道的四层过滤机制
- **背景**：原有的记忆提取直接将原始对话送入 LLM，导致大量噪声被提取，浪费 Token 且降低了记忆质量。
- **决策**：在送入 LLM 前，增加四层预过滤（系统消息、客套话、内联噪声、长度截断），并强制要求 LLM 输出时间锚定。
- **理由**：通过预处理减少无用信息，提高 LLM 提取的精准度和效率，确保提取出的记忆具有持久价值。

### 4.3 异步 fire-and-forget 的自进化闭环
- **背景**：需要在不增加用户感知延迟的前提下，实现系统的自我反思和进化。
- **决策**：在对话回复返回给用户后，异步触发反思节点（Reflection Node），进行工具效用评估和 Prompt 补丁生成。
- **理由**：异步处理可以完全解耦核心对话链路与后台优化逻辑，保证了系统的实时响应性能。

### 4.4 工具效用分数的当前状态与后续规划
- **当前状态**：工具效用分数的“写入端”已完备——`ToolRegistry.updateUtility()` 使用 EMA 算法实时更新分数，`reflectionNode` 将工具调用日志持久化到 `tool_utility_logs` 表。`getRankedTools()` 提供按效用分数排序的查询接口。
- **已知限制**：效用分数的“读取端”尚未实现——`classifyNode` 和 `baseAgent` 未消费 `utilityScore`，Domain Agent 的工具集仍由 `availableTools` 静态数组决定。自进化闭环的“反馈回路”尚未完全闭合。
- **后续规划**：在下一轮迭代中，计划在 `classifyNode` 中注入工具效用摘要，并在 `baseAgent.buildLangChainTools()` 中使用 `getRankedTools()` 动态调整工具优先级。
