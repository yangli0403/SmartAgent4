# SmartAgent4 — 全量测试文档

> 本文档是项目的全量测试文档，随系统功能增加而持续更新。每次迭代开发完成后，在第6阶段（代码质量与覆盖率审查）中生成或更新本文档。

## 测试策略概览

### 测试分层

| 测试类型 | 目标 | 工具/框架 | 覆盖重点 |
|:---------|:-----|:----------|:---------|
| 单元测试 | 验证单个函数/类的逻辑正确性 | Vitest + vi.mock | 核心业务逻辑、边缘情况、错误处理 |
| 集成测试 | 验证模块之间的交互 | Vitest + fixtures | 模块接口、数据流、并行执行引擎 |
| 端到端测试 | 验证完整的用户流程 | Vitest + tRPC caller | 路由层、记忆 CRUD 完整流程 |

### 测试原则

本项目遵循 TDD（测试驱动开发）的 RED-GREEN-REFACTOR 循环。每个用户故事至少对应一个正向用例和一个异常用例。覆盖率目标为新增模块 80% 以上。

## 测试环境与配置

### 环境要求

运行测试需要 Node.js 22.x 和 pnpm。测试框架使用 Vitest，覆盖率提供者为 `@vitest/coverage-v8`。大部分测试通过 `vi.mock` 隔离外部依赖（数据库、LLM API），无需启动外部服务。`server/chat.test.ts` 中的 3 个端到端测试需要 PostgreSQL 数据库连接。

### 运行测试

```bash
# 运行全量测试
npx vitest run

# 运行测试并生成覆盖率报告
npx vitest run --coverage

# 运行指定模块的测试
npx vitest run server/memory/__tests__/

# 运行单个测试文件
npx vitest run server/memory/__tests__/embeddingService.test.ts
```

## 全量测试用例清单

### 记忆优化新增模块（本次迭代）

#### embeddingService（向量化服务）— 13 个用例

**测试文件**：`server/memory/__tests__/embeddingService.test.ts`

| 用例名称 | 验证目标 | 测试类型 | 状态 |
|:---------|:---------|:---------|:-----|
| 应使用 DashScope 配置初始化客户端 | DashScope 环境变量优先 | 单元测试 | 通过 |
| 应使用 OpenAI 配置作为回退 | 无 DashScope 时回退 OpenAI | 单元测试 | 通过 |
| 应使用单例模式 | 多次调用返回同一实例 | 单元测试 | 通过 |
| 应成功生成 embedding | 正常调用返回向量 | 单元测试 | 通过 |
| 应在 API 错误时返回 null | 错误优雅降级 | 单元测试 | 通过 |
| 应在超时时返回 null | 超时优雅降级 | 单元测试 | 通过 |
| 空输入应返回 null | 边界条件 | 单元测试 | 通过 |
| 应成功批量生成 embedding | 批量处理正常路径 | 单元测试 | 通过 |
| 批量处理应按批次分割 | 大批量分批处理 | 单元测试 | 通过 |
| 部分失败应返回 null 占位 | 批量部分失败降级 | 单元测试 | 通过 |
| 空数组应返回空数组 | 边界条件 | 单元测试 | 通过 |
| 应使用可配置的维度 | 环境变量配置维度 | 单元测试 | 通过 |
| 应使用可配置的模型 | 环境变量配置模型 | 单元测试 | 通过 |

#### preRetrievalDecision（预检索决策）— 46 个用例

**测试文件**：`server/memory/__tests__/preRetrievalDecision.test.ts`

涵盖规则层（闲聊识别、emoji 识别、感谢语识别、记忆关键词、代词指代、偏好查询）和 LLM 层（RETRIEVE/NO_RETRIEVE 判定、查询重写、错误降级、决策来源记录）的完整测试。

#### extractionAudit（提取审计）— 20 个用例

**测试文件**：`server/memory/__tests__/extractionAudit.test.ts`

涵盖重要性门控（按类型动态阈值）、Jaccard 去重（完全匹配/高相似/低相似）、MERGE 建议、空库路径等。

#### confidenceEvolution（置信度演化）— 16 个用例

**测试文件**：`server/memory/__tests__/confidenceEvolution.test.ts`

涵盖 BOOST/SUPERSEDE/NO_MATCH/SKIP 四种策略、置信度上下限约束、自定义配置等。

#### backfillExtraction（补漏提取）— 15 个用例

**测试文件**：`server/memory/__tests__/backfillExtraction.test.ts`

涵盖 LLM 响应解析、错误降级、数量限制、数据清洗、去重、完整补漏流程、MemoryWorkerManager 兼容执行器等。

#### memoryExtractionNode（记忆提取节点 — 修改模块）— 6 个用例

**测试文件**：`server/agent/supervisor/__tests__/memoryExtractionNode.test.ts`

涵盖自动提取开关、对话计数器阈值触发、工作记忆更新、边界条件等。

### 前序迭代模块

| 测试文件 | 用例数 | 覆盖模块 |
|:---------|:-------|:---------|
| `memoryPipeline.test.ts` | 30 | 四层预过滤、置信度门控、Jaccard 去重 |
| `hybridSearch.test.ts` | 6 | BM25 匹配、向量降级、结果限制 |
| `behaviorDetector.test.ts` | 9 | 行为模式检测 |
| `forgettingService.test.ts` | 10 | 记忆遗忘服务 |
| `prefetchCache.test.ts` | 10 | 预取缓存 |
| `proactiveEngine.test.ts` | 7 | 主动引擎 |
| `profileBuilder.test.ts` | 14 | 画像构建器 |
| `personalityEngine.test.ts` | 21 | 人格引擎 |
| `emotionsClient.test.ts` | 32 | 情感客户端 |
| `toolRegistry.test.ts` | 32 | 工具注册表 |
| `agentCardRegistry.test.ts` | 37 | Agent 卡片注册 |
| `dynamicPromptAssembler.test.ts` | 26 | 动态 Prompt 组装 |
| `parallelExecuteEngine.test.ts` | 18 | 并行执行引擎 |
| `memoryTools.test.ts` | 25 | 记忆技能工具 |
| 其他 19 个测试文件 | 175 | 分类节点、反思节点、状态管理等 |

## 用户验收测试清单

> 来源于 `PRODUCT_SPEC.md` 中的用户测试用例。

| 用例编号 | 关联功能 | 用户故事摘要 | 自动化测试文件 | 状态 |
|:---------|:---------|:------------|:--------------|:-----|
| UTC-001 | 功能1 | 新记忆自动生成 embedding | `embeddingService.test.ts` | 已自动化 |
| UTC-002 | 功能1 | Embedding API 故障优雅降级 | `embeddingService.test.ts` | 已自动化 |
| UTC-003 | 功能1 | 历史记忆批量回填 embedding | `embeddingService.test.ts` | 已自动化 |
| UTC-004 | 功能2 | 语义相似查询召回 | `hybridSearch.test.ts` | 已自动化 |
| UTC-005 | 功能2 | 混合检索优雅降级 | `hybridSearch.test.ts` | 已自动化 |
| UTC-006 | 功能3 | 闲聊跳过检索 | `preRetrievalDecision.test.ts` | 已自动化 |
| UTC-007 | 功能3 | 记忆相关查询触发检索 | `preRetrievalDecision.test.ts` | 已自动化 |
| UTC-008 | 功能3 | 规则快速判断延迟 | `preRetrievalDecision.test.ts` | 已自动化 |
| UTC-009 | 功能4 | 代词消解重写 | `preRetrievalDecision.test.ts` | 已自动化 |
| UTC-010 | 功能4 | 重写查询用于双路检索 | — | 需集成测试 |
| UTC-011 | 功能5 | 审计拦截低质量记忆 | `extractionAudit.test.ts` | 已自动化 |
| UTC-012 | 功能5 | 审计拦截重复记忆 | `extractionAudit.test.ts` | 已自动化 |
| UTC-013 | 功能5 | 做梦补漏提取 | `backfillExtraction.test.ts` | 已自动化 |
| UTC-014 | 功能6 | 自动提取关闭时行为检测仍触发 | `memoryExtractionNode.test.ts` | 已自动化 |
| UTC-015 | 功能6 | 行为检测异步不阻塞 | `memoryExtractionNode.test.ts` | 已自动化 |
| UTC-016 | 功能7 | 确认信息提升置信度 | `confidenceEvolution.test.ts` | 已自动化 |
| UTC-017 | 功能7 | 矛盾信息降低置信度 | `confidenceEvolution.test.ts` | 已自动化 |
| UTC-018 | 功能7 | 人格记忆不参与演化 | `confidenceEvolution.test.ts` | 已自动化 |

**自动化覆盖率**：17/18 已自动化（94.4%），1 个需集成测试环境验证。

## 覆盖率报告摘要

### 整体覆盖率

**当前版本语句覆盖率**：40.19%（含大量非本次迭代的未测试模块）

**本次迭代新增模块覆盖率**：94.3%（加权平均）

**目标覆盖率**：新增模块 > 80% — **已达标**

### 本次迭代新增模块覆盖率

| 模块 | 语句覆盖率 | 分支覆盖率 | 函数覆盖率 | 状态 |
|:-----|:----------|:----------|:----------|:-----|
| embeddingService.ts | 95.4% | 87.5% | 100% | 达标 |
| preRetrievalDecision.ts | 99.0% | 87.2% | 100% | 达标 |
| extractionAudit.ts | 96.1% | 88.1% | 100% | 达标 |
| confidenceEvolution.ts | 100% | 79.2% | 100% | 达标 |
| backfillExtraction.ts | 91.4% | 74.5% | 100% | 达标 |
| hybridSearch.ts | 81.5% | 88.0% | 85.7% | 达标 |

### 低覆盖率模块说明

| 模块 | 覆盖率 | 未覆盖原因 |
|:-----|:-------|:----------|
| memorySystem.ts | 3.8% | 核心数据库操作模块，需要 PostgreSQL 连接 |
| memoryCron.ts | 0% | 定时任务模块，需要运行时环境 |
| memoryMaintenance.ts | 0% | 维护模块，需要数据库连接 |
| dreamGatekeeper.ts | 0% | 做梦守门人，需要运行时环境 |
| memoryWorkerManager.ts | 0% | Worker 管理器，需要运行时环境 |
| airi-bridge 模块 | 0% | 外部桥接服务，需要 AIRI 运行时 |

### 未覆盖分支说明

| 模块 | 未覆盖行 | 说明 |
|:-----|:---------|:-----|
| confidenceEvolution.ts | 187, 200-203, 228 | 防御性代码：versionGroup 为空和 accessCount 为 null 的默认值路径 |
| backfillExtraction.ts | 394-400, 446-452 | 异常降级路径：executeBackfillExtraction 和 createBackfillExecutor 的 catch 块 |
| hybridSearch.ts | 240-271 | reflectOnMemories 函数，需要 LLM 调用的集成测试 |

## 变更记录

| 日期 | 迭代版本 | 变更类型 | 变更描述 |
|:-----|:---------|:---------|:---------|
| 2026-04-07 | 记忆优化迭代 | 新增 | 新增 6 个测试文件共 116 个测试用例，覆盖 5 个新增模块和 1 个修改模块 |
| 2026-04-07 | 记忆优化迭代 | 更新 | 更新 memoryExtractionNode.test.ts，适配行为检测对话计数器逻辑 |
| 2026-04-06 | PostgreSQL 迁移迭代 | 新增 | 初始测试套件建立，覆盖数据库迁移、记忆管道、自进化闭环等模块 |
