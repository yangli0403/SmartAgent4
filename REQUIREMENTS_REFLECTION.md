# 第5阶段：需求反思 (Requirements Reflection) — 第二轮迭代

## 1. 目标回顾

本轮迭代（基于 `windows-compat` 分支）的核心目标是实现三个功能点：

1. **数据库从 MySQL 迁移到 PostgreSQL**：将 Drizzle ORM 方言从 mysql 切换为 postgresql，驱动替换为 postgres.js，为后续引入 Apache AGE 图数据库和 pgvector 向量存储做准备。
2. **记忆提取管道优化**：引入四层预过滤机制 + 增强版 Prompt + 动态阈值去重，减少噪声、提高记忆质量。
3. **自进化闭环落地**：新增反思节点（Reflection Node）、工具效用分数（Utility Score）、Prompt 版本控制，实现系统的自我反思和进化能力。

## 2. 实现与设计的对比验证

### 2.1 数据库迁移 MySQL → PostgreSQL

| 设计要求 | 实际实现 | 一致性 |
|----------|---------|--------|
| `drizzle.config.ts` dialect 改为 postgresql | 已完成 | 完全一致 |
| `drizzle/schema.ts` 从 mysql-core 迁移到 pg-core | 已完成：pgTable、pgEnum、serial、jsonb、doublePrecision | 完全一致 |
| `server/db.ts` 驱动替换为 postgres.js | 已完成：onConflictDoUpdate、.returning() | 完全一致 |
| `package.json` 依赖替换 mysql2 → postgres | 已完成 | 完全一致 |
| `docker-compose.yml` 使用 PostgreSQL 16 | 已完成 | 完全一致 |
| `.env.example` 连接字符串改为 postgresql:// | 已完成 | 完全一致 |
| 前端/脚本/文档中 MySQL 文案更新 | 已完成：Chat.tsx、start.bat、start.ps1、WINDOWS_SETUP_GUIDE.md | 完全一致 |
| 时间戳更新：移除 .onUpdateNow() | 已完成：改为应用层处理 updatedAt | 完全一致 |

**验证结论**：**完全符合设计**。所有 MySQL 特有语法已替换为 PostgreSQL 等价物，全项目无残留 MySQL 引用。

### 2.2 记忆提取管道优化

| 设计要求 | 实际实现 | 一致性 |
|----------|---------|--------|
| Layer 1: 系统消息过滤 | `preFilterConversation()` 过滤 system 角色消息 | 完全一致 |
| Layer 2: 客套话/寒暄过滤 | 正则匹配 TRIVIAL_PATTERNS 列表 | 完全一致 |
| Layer 3: 内联噪声清洗 | `cleanInlineNoise()` 清除 URL、表情、重复标点 | 完全一致 |
| Layer 4: 长度截断 | 超长消息截断至 MAX_MSG_LENGTH | 完全一致 |
| 增强版 Prompt（时间锚定 + 反面示例） | `MEMORY_EXTRACTION_PROMPT_V2` 含强制时间锚定规则和反面示例 | 完全一致 |
| 动态阈值去重（Jaccard 相似度） | `deduplicateMemories()` 使用 Jaccard 相似度 + 可配置阈值 | 完全一致 |
| `MemoryExtractionOptions` 接口 | **未实现**（见问题 1） | 不一致 |

**验证结论**：**基本符合设计**。核心管道逻辑完备，但 `INTERFACE_DESIGN.md` 中定义的 `MemoryExtractionOptions` 配置接口未暴露。

### 2.3 自进化闭环

| 设计要求 | 实际实现 | 一致性 |
|----------|---------|--------|
| `reflectionNode` 异步 fire-and-forget | 已实现，不修改 SupervisorState | 完全一致 |
| 工具效用分数 EMA 更新 | `ToolRegistry.updateUtility()` 使用 EMA 算法 | 完全一致 |
| `getRankedTools()` 按效用排序 | 已实现 | 完全一致 |
| `RegisteredTool` 扩展字段 | utilityScore、successCount、failureCount、avgExecutionTimeMs | 完全一致 |
| 工具调用日志持久化 | `tool_utility_logs` 表 + `persistToolUtilityLogs()` | 完全一致 |
| LLM 反思分析 | `performLLMReflection()` 在有失败或复杂任务时触发 | 完全一致 |
| Prompt 版本控制 | `prompt_versions` 表 + `savePromptPatch()` | 完全一致 |
| 效用分数影响工具路由 | **未实现**（见问题 2） | 不一致 |

**验证结论**：**部分符合设计**。自进化闭环的"写入端"（记录、更新、持久化）完备，但"读取端"（效用分数影响路由决策）尚未实现。

## 3. 发现的问题列表

### 问题 1：`MemoryExtractionOptions` 接口未实现

- **严重程度**：低
- **描述**：`INTERFACE_DESIGN.md` 定义了 `MemoryExtractionOptions` 接口（含 `enableFiltering`、`deduplicationThreshold`、`requireTimeAnchor` 三个可选参数），要求 `extractMemoriesFromConversation` 接受该 options 参数。当前实现中函数签名仍为 `(input: MemoryFormationInput): Promise<Memory[]>`，四层过滤和去重阈值硬编码为常量。
- **纠正措施**：在 `memorySystem.ts` 中新增 `MemoryExtractionOptions` 接口，扩展函数签名为可选 options 参数，保持向后兼容。

### 问题 2：工具效用分数未被消费（"写入但未读取"）

- **严重程度**：中
- **描述**：`ARCHITECTURE.md` 第 3.2 节描述了"基于效用分数的工具路由"——分类节点应查询各工具的 `utilityScore` 并据此影响路由决策。但当前 `classifyNode.ts` 和 `baseAgent.ts` 均未调用 `getRankedTools()` 或读取 `utilityScore`，Domain Agent 的工具集仍由 `availableTools` 静态数组决定。
- **纠正措施**：此为较大的架构变更，标记为**已知限制**，将在下一轮迭代中专门设计和实现。在 `ARCHITECTURE.md` 中补充当前状态说明。

### 问题 3：`reflectionNode` 未纳入测试覆盖率统计

- **严重程度**：低
- **描述**：`vitest.config.ts` 的 `coverage.include` 未包含 `server/agent/supervisor/reflectionNode.ts`。
- **纠正措施**：将该路径加入覆盖率配置。

### 问题 4：`CLAUDE.md` 文档过时

- **严重程度**：低
- **描述**：现有 `CLAUDE.md` 仍将数据库标注为 "MySQL/TiDB"，核心对话管线未包含 `reflectionNode`，待办事项仍将本轮功能列为未完成。
- **纠正措施**：将在 Phase 6b（生成 AI 架构指南）阶段统一更新。

## 4. 纠正措施执行

### 修复 1：添加 `MemoryExtractionOptions` 接口

在 `memorySystem.ts` 中：
- 新增 `MemoryExtractionOptions` 接口
- 扩展 `extractMemoriesFromConversation` 签名为 `(input: MemoryFormationInput, options?: MemoryExtractionOptions)`
- 使用 options 中的值覆盖默认常量

### 修复 2：更新 `vitest.config.ts` 覆盖率配置

将 `server/agent/supervisor/reflectionNode.ts` 加入 `coverage.include`。

### 修复 3：在 `ARCHITECTURE.md` 中补充已知限制说明

在第 4 节"关键设计决策"中新增 4.4 节，说明工具效用分数的消费端尚未实现。

## 5. 最终验证结果

| 检查项 | 状态 |
|--------|------|
| 数据库迁移：schema.ts 使用 pg-core | 通过 |
| 数据库迁移：db.ts 使用 postgres.js 驱动 | 通过 |
| 数据库迁移：upsert 使用 onConflictDoUpdate | 通过 |
| 数据库迁移：docker-compose.yml 使用 PostgreSQL 16 | 通过 |
| 记忆管道：四层预过滤已实现 | 通过 |
| 记忆管道：增强版 Prompt（时间锚定 + 反面示例） | 通过 |
| 记忆管道：动态阈值去重（Jaccard 相似度） | 通过 |
| 记忆管道：MemoryExtractionOptions 可配置 | **修复后通过** |
| 自进化：reflectionNode 异步 fire-and-forget | 通过 |
| 自进化：工具效用分数 EMA 更新 | 通过 |
| 自进化：工具调用日志持久化 | 通过 |
| 自进化：LLM 反思 + Prompt 补丁生成 | 通过 |
| 自进化：Prompt 版本控制（prompt_versions 表） | 通过 |
| 自进化：效用分数消费端（路由影响） | **已知限制，下轮迭代** |
| 测试：toolRegistry.test.ts 覆盖新方法 | 通过 |
| 测试：vitest.config.ts 覆盖率配置更新 | **修复后通过** |
