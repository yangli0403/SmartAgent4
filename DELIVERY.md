# SmartAgent4 第二轮迭代交付文档

## 1. 迭代概述

本轮迭代在 `windows-compat` 分支上进行，基于上传文档中的三个功能点需求，完成了从 Phase 4（实现）到 Phase 7（文档与交付）的全部工作。迭代前已完成 Phase 1-3（仓库分析、架构设计、接口设计），本轮从中断处继续。

本次迭代的核心交付物包括三大功能模块的代码实现、60 个新增测试用例、更新的架构指南和完整的变更日志。

## 2. 功能点交付详情

### 2.1 功能点 1：数据库从 MySQL 迁移至 PostgreSQL

本功能点将项目的数据库底层从 MySQL/TiDB 完整迁移至 PostgreSQL 16，为后续引入 Apache AGE 图数据库和 pgvector 向量存储奠定基础。迁移涉及 ORM Schema 定义、数据库驱动、Docker 容器配置、环境变量、启动脚本和用户文档等多个层面。

迁移范围涵盖以下文件：`drizzle.config.ts`（dialect 切换）、`drizzle/schema.ts`（pg-core 重写，含 pgTable、pgEnum、serial、jsonb 等）、`server/db.ts`（postgres.js 驱动 + upsert/insert 语法适配）、`package.json`（mysql2 → postgres）、`docker-compose.yml`（PostgreSQL 16 容器）、`.env.example`（postgresql:// 连接字符串）、`start.bat`/`start.ps1`（提示文案）、`WINDOWS_SETUP_GUIDE.md`（全面更新）以及 `Chat.tsx`（前端提示文案）。

### 2.2 功能点 2：记忆提取管道优化

本功能点对 `memorySystem.ts` 中的记忆提取流程进行了全面重构，引入四层过滤机制以提高记忆质量并减少 LLM Token 消耗。

第一层（预过滤）在送入 LLM 前拦截空消息、短内容（< 4 字符）和纯问候语对话。第二层（增强版 LLM 提取）使用结构化 Prompt，要求输出 kind/type/importance/confidence/versionGroup 等字段，并提供正反面示例指导 LLM 精准提取。第三层（置信度门控）对 LLM 输出进行后验证，过滤 importance < 0.3、confidence < 0.4 或 type 不合法的记忆。第四层（动态阈值去重）使用 Jaccard 字符相似度和子串包含检测，配合自适应阈值（记忆数 < 50 用 0.6，50-200 用 0.5，> 200 用 0.4）防止重复记忆入库。

此外，Phase 5 中补充了 `MemoryExtractionOptions` 接口，支持调用方自定义过滤开关、去重阈值等参数。

### 2.3 功能点 3：自进化闭环落地

本功能点实现了系统的自我反思和进化能力，包含三个核心组件。

**反思节点**（`reflectionNode.ts`）作为 Supervisor 图中 `memoryExtractionNode` 之后的新节点，以异步 fire-and-forget 方式运行，不阻塞用户响应。它分析本轮执行中的工具调用记录，更新工具效用分数，将日志持久化到 `tool_utility_logs` 表，并使用 LLM 分析执行质量生成 Prompt 补丁建议。

**工具效用分数**通过扩展 `ToolRegistry`（v2）实现。`RegisteredTool` 接口新增了 `utilityScore`、`successCount`、`failureCount`、`avgExecutionTimeMs` 四个字段。`updateUtility()` 方法使用指数移动平均（EMA, alpha=0.3）算法更新效用分数，成功调用得 1.0 分、慢但成功得 0.7 分、失败得 0.0 分，分数下限为 0.05。`getRankedTools()` 提供按效用分数排序的查询接口。

**Prompt 版本控制**通过新增的 `prompt_versions` 表实现，记录每次 Prompt 变更的补丁内容、推理过程、变更前后快照，支持回滚到任意历史版本。

## 3. 测试覆盖

本轮新增 4 个测试文件，共 60 个测试用例，全部通过。

| 测试文件 | 用例数 | 覆盖范围 |
|---------|--------|---------|
| `memoryPipeline.test.ts` | 30 | 四层过滤管道：预过滤、置信度门控、Jaccard 相似度、动态去重 |
| `schemaPostgres.test.ts` | 13 | PostgreSQL Schema 结构验证：枚举、表结构、类型导出 |
| `reflectionNode.test.ts` | 11 | 反思节点：跳过逻辑、触发逻辑、状态不变性、输入构建 |
| `memoryExtractionOptions.test.ts` | 6 | MemoryExtractionOptions 接口兼容性 |

全量测试结果：282 个测试中 271 通过，11 个失败为上一轮遗留问题（emotionsClient 5 个 + contextManager 6 个），与本轮功能无关。

## 4. 文件变更清单

本轮迭代共涉及以下文件的新增或修改：

| 类别 | 文件 | 操作 |
|------|------|------|
| Schema | `drizzle.config.ts` | 修改 |
| Schema | `drizzle/schema.ts` | 修改 |
| 数据库 | `server/db.ts` | 修改 |
| 配置 | `docker-compose.yml` | 修改 |
| 配置 | `.env.example` | 修改 |
| 配置 | `package.json` | 修改 |
| 记忆系统 | `server/memory/memorySystem.ts` | 修改 |
| 自进化 | `server/agent/supervisor/reflectionNode.ts` | 新增 |
| 自进化 | `server/mcp/toolRegistry.ts` | 修改 |
| 自进化 | `server/agent/supervisor/supervisorGraph.ts` | 修改 |
| 自进化 | `server/agent/supervisor/index.ts` | 修改 |
| 自进化 | `server/agent/smartAgentApp.ts` | 修改 |
| 自进化 | `server/mcp/mcpManager.ts` | 修改 |
| 测试 | `server/memory/__tests__/memoryPipeline.test.ts` | 新增 |
| 测试 | `server/memory/__tests__/schemaPostgres.test.ts` | 新增 |
| 测试 | `server/memory/__tests__/memoryExtractionOptions.test.ts` | 新增 |
| 测试 | `server/agent/supervisor/__tests__/reflectionNode.test.ts` | 新增 |
| 测试 | `vitest.config.ts` | 修改 |
| 文档 | `CLAUDE.md` | 修改 |
| 文档 | `ARCHITECTURE.md` | 修改 |
| 文档 | `REQUIREMENTS_REFLECTION.md` | 新增 |
| 文档 | `CHANGELOG.md` | 修改 |
| 文档 | `DELIVERY.md` | 修改 |
| 文档 | `WINDOWS_SETUP_GUIDE.md` | 修改 |
| 脚本 | `start.bat` | 修改 |
| 脚本 | `start.ps1` | 修改 |
| 前端 | `client/src/pages/Chat.tsx` | 修改 |

## 5. 已知限制与后续规划

本轮迭代在自进化闭环的"写入端"已完备，但"读取端"尚未实现。具体而言，`classifyNode` 和 `baseAgent` 尚未消费工具效用分数，Domain Agent 的工具集仍由静态数组决定。此外，代码和文档中仍有少量 MySQL 残留引用（`routers.ts` 错误提示、`index.ts` 注释等）需要在后续迭代中清理。

建议在下一轮迭代中优先完成以下工作：在 `classifyNode` 中注入工具效用摘要，在 `baseAgent.buildLangChainTools()` 中使用 `getRankedTools()` 动态调整工具优先级，以及引入 pgvector 替代内存向量检索。

## 6. Git 提交历史

本轮迭代在 `windows-compat` 分支上的提交记录：

| 提交 | 阶段 | 说明 |
|------|------|------|
| Phase 4 | 实现 | 三个功能点的完整代码实现 |
| Phase 5 | 需求反思 | 需求对比验证 + 3 项修复 |
| Phase 6 | 自动化测试 | 新增 4 个测试文件 60 个用例 |
| Phase 6b | AI 架构指南 | 更新 CLAUDE.md |
| Phase 7 | 文档与交付 | 更新 CHANGELOG.md + DELIVERY.md |
