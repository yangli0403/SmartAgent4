# Changelog

本文件记录 SmartAgent4 项目的所有重要变更。

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
