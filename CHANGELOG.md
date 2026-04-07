# Changelog

本文件记录 SmartAgent4 项目的所有重要变更。

---

## [1.4.0] - 2026-04-07

### 第七轮迭代：记忆系统优化（Embedding + 智能检索 + 质量门控）

本轮迭代基于 PRODUCT_SPEC.md 定义的 7 项功能需求（P0×3 + P1×4），实现记忆系统从“纯文本匹配”到“语义理解 + 智能决策 + 质量门控”的全链路升级。

#### 新增模块（5个）

**新增**
- `server/memory/embeddingService.ts` — Embedding 服务
  - DashScope / OpenAI 双通道向量化，通过环境变量自动切换
  - 单例模式 + 延迟初始化，避免重复创建客户端
  - 批量向量化支持，失败返回 null 优雅降级
- `server/memory/preRetrievalDecision.ts` — 预检索决策
  - 规则层快速过滤（闲聊/emoji/感谢/纯问候）
  - LLM 层深度判断（是否需要检索记忆）
  - 查询重写（代词消解、上下文补全）
- `server/memory/extractionAudit.ts` — 提取审计层
  - 按记忆类型动态重要性阈值（preference > fact > event > episodic）
  - Jaccard 相似度去重（阈值 0.6）
  - ACCEPT / REJECT / MERGE 三种审计结果
- `server/memory/confidenceEvolution.ts` — 置信度演化
  - BOOST：重复提及时提升置信度
  - SUPERSEDE：矛盾信息时替代旧记忆
  - NO_MATCH / SKIP：无关联时保持现状
  - 基于 versionGroup 匹配同类记忆
- `server/memory/backfillExtraction.ts` — 做梦补漏提取
  - LLM 批量回溯提取遗漏记忆
  - 与现有记忆去重
  - 兼容 MemoryWorkerManager 执行器

#### 修改模块（5个）

**修改**
- `server/memory/memorySystem.ts` — addMemory 集成 Embedding 生成 + Confidence 演化；getFormattedMemoryContext 支持 queryEmbedding 参数
- `server/agent/supervisor/contextEnrichNode.ts` — 插入 Pre-Retrieval Decision 决策层 + 查询向量化 + 缓存命中/需要检索/跳过检索三路分支
- `server/agent/tools/memoryTools.ts` — memory_store 写入前经过审计层（重要性门控 + 去重 + 合并建议）
- `server/agent/supervisor/memoryExtractionNode.ts` — 行为检测从自动提取流程中解耦，基于对话计数器独立触发
- `server/memory/hybridSearch.ts` — 向量不可用时自动回退到纯 BM25，动态调整 alpha 权重

#### Phase 3：接口设计

**新增**
- `docs/INTERFACE_DESIGN_MEMORY_OPT.md` — 全量接口契约文档（10 个模块的方法签名、类型、配置项、错误处理约定）

#### Phase 5：需求反思

**修复**
- `server/agent/tools/memoryTools.ts` — 补充 auditMemoryExtraction 调用中缺失的 kind, versionGroup, tags 参数
- `server/agent/supervisor/memoryExtractionNode.ts` — 添加对话计数器和阈值触发逻辑

**新增**
- `REQUIREMENTS_REFLECTION.md` — 第七轮迭代需求反思报告

#### Phase 6：自动化测试

**新增**
- `server/memory/__tests__/embeddingService.test.ts` — 24 个测试用例
- `server/memory/__tests__/extractionAudit.test.ts` — 54 个测试用例
- `server/memory/__tests__/confidenceEvolution.test.ts` — 16 个测试用例
- `server/memory/__tests__/preRetrievalDecision.test.ts` — 46 个测试用例
- `server/memory/__tests__/backfillExtraction.test.ts` — 15 个测试用例
- `TESTING.md` — 全量测试文档

**测试结果**
- 全量测试：654 个（651 通过，3 个需数据库）
- 新增模块覆盖率：语句 94.3%，函数 97.6%

#### Phase 6b：AI 架构指南

**修改**
- `CLAUDE.md` — 更新为第七轮迭代版本，新增记忆系统优化章节

#### Phase 7：文档与交付

**修改**
- `README.md` — 更新技术栈、测试信息、开发路线图、文档列表
- `CHANGELOG.md` — 新增第七轮迭代变更记录
- `PROJECT_STATUS.md` — 更新阶段状态

#### 新增依赖

- `openai` (^6.33.0) — 用于 Embedding API 调用（OpenAI 兼容接口）
- `@vitest/coverage-v8` — 覆盖率报告（devDependency）

---

## [1.2.0] - 2026-03-27

### 第三轮迭代：多智能体协同架构（windows-compat 分支）

本轮迭代基于《SmartAgent4 架构分析与演进报告 V2》，实现从单体编排走向多智能体协同的架构演进。

#### 功能点 1：Agent Card 动态发现

**新增**
- `server/agent/discovery/types.ts` — AgentCard、IAgentCardRegistry、IDynamicPromptAssembler、DelegateRequest/Result 等类型定义
- `server/agent/discovery/agentCardRegistry.ts` — Agent Card 注册表（Zod 校验、加载、注册、注销、按能力/领域查询、单例工厂）
- `server/agent/discovery/dynamicPromptAssembler.ts` — 动态 Prompt 组装器（buildClassifyPrompt、buildPlanPrompt、getAgentCapabilitySummary）
- `server/agent/discovery/index.ts` — discovery 模块导出
- `server/agent/agent-cards/fileAgent.json` — 文件管理专员 Agent Card（15 工具）
- `server/agent/agent-cards/navigationAgent.json` — 导航出行专员 Agent Card（19 工具）
- `server/agent/agent-cards/multimediaAgent.json` — 多媒体娱乐专员 Agent Card（8 工具）
- `server/agent/agent-cards/generalAgent.json` — 通用对话专员 Agent Card（0 工具）

#### 功能点 2：并行执行引擎

**新增**
- `server/agent/discovery/parallelExecuteEngine.ts` — DAG 并行执行引擎
  - `analyzeDependencies()` — Kahn 拓扑排序，生成按层级排列的执行批次
  - `createParallelExecuteNode()` — LangGraph 兼容节点函数，替代串行 executeNode
  - `resolveInputMapping()` — 步骤间数据引用解析（step_N.field 格式）
  - 循环依赖检测与降级处理

#### 功能点 3：委托协议

**修改**
- `server/agent/domains/baseAgent.ts` — 新增 `setAgentCardRegistry()` 和 `delegate()` 委托方法（深度限制 3 层）

#### 核心改造

**修改**
- `server/agent/supervisor/state.ts` — `PlanStep.targetAgent` 从联合字面量改为 `string`
- `server/agent/supervisor/classifyNode.ts` — 注入 DynamicPromptAssembler，动态生成分类 Prompt
- `server/agent/supervisor/planNode.ts` — 注入 DynamicPromptAssembler，动态 Agent 列表 + 并行执行提示
- `server/agent/supervisor/supervisorGraph.ts` — 双模式支持（IAgentCardRegistry 使用并行引擎，AgentRegistry 使用串行兼容）
- `server/agent/smartAgentApp.ts` — 初始化流程改造：加载 Agent Card → 创建实例 → 绑定注册表 → 注入委托能力
- `server/agent/supervisor/index.ts` — 更新导出，新增 discovery 模块

#### Phase 5：需求反思

**修复**
- `server/agent/agent-cards/navigationAgent.json` — 工具名与真实实现对齐（19 个工具完全匹配）
- `server/agent/agent-cards/fileAgent.json` — 补充缺失的文件整理工具和能力标签
- `server/agent/discovery/agentCardRegistry.ts` — `findByCapability` 从模糊 includes 改为精确匹配

**新增**
- `REQUIREMENTS_REFLECTION_V2.md` — 第三轮迭代需求反思报告

#### Phase 6：自动化测试

**新增**
- `server/agent/discovery/__tests__/agentCardRegistry.test.ts` — 36 个测试用例
- `server/agent/discovery/__tests__/dynamicPromptAssembler.test.ts` — 15 个测试用例
- `server/agent/discovery/__tests__/parallelExecuteEngine.test.ts` — 18 个测试用例
- `server/agent/discovery/__tests__/parallelExecuteEngine.integration.test.ts` — 8 个测试用例

**测试结果**
- discovery 模块：77 个测试，77 全部通过
- discovery 模块覆盖率：语句 97.68%，分支 90.4%，函数 100%

#### Phase 6b：AI 架构指南

**修改**
- `CLAUDE.md` — 全面更新为第三轮迭代版本，新增多智能体协同架构章节

#### Phase 7：文档与交付

**修改**
- `README.md` — 全面更新，新增多智能体协同架构章节
- `CHANGELOG.md` — 新增第三轮迭代变更记录

---

## [1.1.0] - 2026-03-25

### 第二轮迭代：Phase 4-7（windows-compat 分支）

本轮迭代基于上传文档中的三个功能点需求，在 `windows-compat` 分支上完成。

#### 功能点 1：数据库从 MySQL 迁移至 PostgreSQL

**新增**
- `docker-compose.yml` — PostgreSQL 16 容器配置（替换原 MySQL 容器）

**修改**
- `drizzle.config.ts` — dialect 从 `mysql` 改为 `postgresql`
- `drizzle/schema.ts` — 从 `drizzle-orm/mysql-core` 迁移至 `drizzle-orm/pg-core`
  - `mysqlTable` → `pgTable`，`mysqlEnum` → `pgEnum`
  - `int` → `integer`，`json` → `jsonb`，`datetime` → `timestamp`
  - 新增 `serial` 自增主键
- `server/db.ts` — 驱动从 `mysql2` 替换为 `postgres.js`
  - `upsert` 改为 `onConflictDoUpdate`
  - `insert` 改为 `.returning()`
- `package.json` — `mysql2` 依赖替换为 `postgres`
- `.env.example` — 连接字符串改为 `postgresql://`
- `start.bat`、`start.ps1` — 提示文案更新
- `WINDOWS_SETUP_GUIDE.md` — 全面更新为 PostgreSQL 安装和配置说明
- `client/src/pages/Chat.tsx` — 前端提示文案更新

#### 功能点 2：记忆提取管道优化（四层过滤）

**修改**
- `server/memory/memorySystem.ts` — 重写记忆提取管道
  - Layer 1: 预过滤（空消息、短内容、纯问候语拦截）
  - Layer 2: 增强版 LLM 提取 Prompt（结构化输出 + 正反面示例）
  - Layer 3: 置信度门控（importance ≥ 0.3, confidence ≥ 0.4, type 白名单）
  - Layer 4: 动态阈值去重（Jaccard 字符相似度 + 子串包含 + 自适应阈值）
  - 新增 `MemoryExtractionOptions` 接口（Phase 5 修复）
  - 新增 `cleanInlineNoise()` 内联噪声清洗函数

#### 功能点 3：自进化闭环落地

**新增**
- `server/agent/supervisor/reflectionNode.ts` — 反思节点
  - 异步 fire-and-forget，不阻塞用户响应
  - 分析执行结果，更新工具效用分数
  - 持久化工具调用日志到 `tool_utility_logs` 表
  - LLM 反思生成 Prompt 补丁，写入 `prompt_versions` 表
- `drizzle/schema.ts` — 新增两张表
  - `tool_utility_logs`：工具调用效用日志（含索引）
  - `prompt_versions`：Prompt 版本历史（含索引）

**修改**
- `server/mcp/toolRegistry.ts` — v2 增强
  - `RegisteredTool` 接口新增 `utilityScore`、`successCount`、`failureCount`、`avgExecutionTimeMs`
  - 新增 `updateUtility()` 方法（EMA 算法，alpha=0.3）
  - 新增 `getRankedTools()` 方法（按效用分数降序）
- `server/agent/supervisor/supervisorGraph.ts` — 挂接 reflectionNode（memoryExtract → reflection → END）
- `server/agent/supervisor/index.ts` — 导出 reflectionNode
- `server/agent/smartAgentApp.ts` — 新增 `getToolRegistry()` 公开方法
- `server/mcp/mcpManager.ts` — 注册工具时初始化效用字段默认值

#### Phase 5：需求反思验证

**新增**
- `REQUIREMENTS_REFLECTION.md` — 本轮迭代需求反思报告

**修复**
- `server/memory/memorySystem.ts` — 添加 `MemoryExtractionOptions` 接口，扩展函数签名
- `vitest.config.ts` — 将 reflectionNode.ts 加入覆盖率配置
- `ARCHITECTURE.md` — 补充工具效用分数已知限制说明

#### Phase 6：自动化测试

**新增**
- `server/memory/__tests__/memoryPipeline.test.ts` — 四层过滤管道单元测试（30 用例）
- `server/memory/__tests__/schemaPostgres.test.ts` — PostgreSQL Schema 结构验证（13 用例）
- `server/memory/__tests__/memoryExtractionOptions.test.ts` — MemoryExtractionOptions 接口测试（6 用例）
- `server/agent/supervisor/__tests__/reflectionNode.test.ts` — 反思节点测试（11 用例）

**测试结果**
- 全量测试：282 个测试，271 通过，11 失败（遗留问题）
- 本轮新增：60 个测试，60 全部通过

#### Phase 6b：AI 架构指南

**修改**
- `CLAUDE.md` — 全面更新为第二轮迭代版本

---

## [1.0.0] - 2026-03-24

### 第二轮迭代：Phase 1-3（windows-compat 分支）

#### Phase 1：仓库分析

**新增**
- `REPO_ANALYSIS.md` — 源仓库分析报告（第二轮）

#### Phase 2：架构设计

**修改**
- `ARCHITECTURE.md` — 更新架构设计，新增 PostgreSQL 迁移、四层过滤管道、自进化闭环设计

#### Phase 3：接口设计

**修改**
- `INTERFACE_DESIGN.md` — 更新接口设计，新增 MemoryExtractionOptions、ToolUtilityUpdate、PromptPatch 等接口

---

## [0.7.0] - 2026-03-03

### 第7阶段：文档与交付

#### 新增
- `CHANGELOG.md` — 变更日志

#### 修改
- `README.md` — 更新为完整的项目文档（概述、安装说明、模块详解、API 端点、测试覆盖）

---

## [0.6.0] - 2026-03-03

### 第6阶段：自动化测试

#### 新增
- `vitest.config.ts` — Vitest 测试配置
- `tests/unit/personalityEngine.test.ts` — PersonalityEngine 单元测试（21 个用例）
- `tests/unit/emotionsClient.test.ts` — EmotionsExpressClient 单元测试（16 个用例）
- `tests/unit/profileBuilder.test.ts` — ProfileBuilder 单元测试（14 个用例）
- `tests/unit/emotionTagInstructions.test.ts` — EmotionTagInstructions 单元测试（11 个用例）
- `tests/integration/personalityIntegration.test.ts` — PersonalityEngine + ProfileBuilder 集成测试（3 个用例）

#### 测试结果
- 5 个测试文件全部通过
- 65 个测试用例全部通过
- 覆盖率：语句 71.05%，分支 78.75%，函数 89.74%

---

## [0.5.0] - 2026-03-03

### 第5阶段：需求反思

#### 新增
- `REQUIREMENTS_REFLECTION.md` — 需求反思报告

#### 修复
- `server/routers/chatRouterEnhanced.ts` — 修复 Message 类型导入错误
- `client/src/components/DashboardLayout.tsx` — 修复 getLoginUrl() 返回 string|null 的类型错误
- `client/src/main.tsx` — 修复 getLoginUrl() 返回 string|null 的类型错误
- `client/src/pages/Settings.tsx` — 修复 getLoginUrl() 返回 string|null 的类型错误
- `client/src/pages/Memories.tsx` — 修复 renderList 函数签名和 setData Updater 类型不匹配
- `server/_core/context.ts` — 修复 undefined 不能赋值给 null 的类型错误

#### 验证
- TypeScript 编译检查：零错误通过
- 所有 17 个模块文件全部存在，职责对齐
- 接口签名和类型契约完全匹配

---

## [0.4.0] - 2026-03-03

### 第4阶段：功能实现

#### 新增
- `server/personality/personalityEngine.ts` — PersonalityEngine 核心引擎
- `server/emotions/emotionsClient.ts` — EmotionsExpressClient 情感渲染客户端
- `server/emotions/emotionTagInstructions.ts` — 情感标签指令模板
- `server/memory/profileBuilder.ts` — 用户画像构建器
- `server/agent/supervisor/contextEnrichNode.ts` — 上下文增强节点
- `server/agent/supervisor/memoryExtractionNode.ts` — 记忆提取节点

#### 修改
- `server/agent/supervisor/state.ts` — 扩展状态定义
- `server/agent/supervisor/supervisorGraph.ts` — 改造 Supervisor 图
- `server/agent/supervisor/respondNode.ts` — 注入动态 System Prompt
- `server/memory/memorySystem.ts` — 增强记忆系统
- `server/routers.ts` — 扩展 tRPC 路由

---

## [0.3.0] - 2026-03-03

### 第3阶段：接口与数据结构定义

#### 新增
- `INTERFACE_DESIGN.md` — 完整的接口设计文档
- `server/personality/types.ts` — 个性引擎类型定义
- `server/emotions/types.ts` — 情感表达类型定义
- 人格配置文件（xiaozhi、jarvis、alfred）

---

## [0.2.0] - 2026-03-03

### 第2阶段：架构与设计

#### 新增
- `ARCHITECTURE.md` — 系统架构设计文档
- `diagrams/` — 架构图

---

## [0.1.0] - 2026-03-03

### 第1阶段：分析与范围界定

#### 新增
- `REPO_ANALYSIS.md` — 源仓库分析报告
- `changes_summary.md` — SmartAgent_PL_E 最新变更摘要
