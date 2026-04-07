# SmartAgent4 记忆系统优化 — 项目状态跟踪

## 当前阶段

**第3阶段：接口与数据结构定义** — 已完成，待确认

## 阶段进度

| 阶段 | 状态 | 产出物 | 备注 |
|:---|:---|:---|:---|
| 第1阶段：分析与范围界定 | ✅ 已完成 | `PRODUCT_SPEC.md` | P0+P1 共7项功能定义 + 18个用户测试用例 |
| 第2阶段：架构与设计 | ✅ 已完成 | `docs/MEMORY_OPTIMIZATION_ARCHITECTURE.md` | 5个新增模块 + 5个修改模块 + 4个数据流场景 + 5项设计决策 |
| 第3阶段：接口与数据结构定义 | ✅ 已完成 | `docs/INTERFACE_DESIGN_MEMORY_OPT.md` + 5个代码框架文件 | 所有模块的接口契约、类型定义、配置项已定义 |
| 第4阶段：子代理驱动实现 (TDD) | 待办 | 功能代码 + 测试 | — |
| 第5阶段：需求反思 | 待办 | REQUIREMENTS_REFLECTION.md | — |
| 第6阶段：代码质量与覆盖率审查 | 待办 | TESTING.md | — |
| 第6b阶段：生成 AI 架构指南 | 待办 | CLAUDE.md | — |
| 第7阶段：文档与交付 | 待办 | README.md 等 | — |

## 技术选型变更（第3阶段确认）

| 组件 | 生产环境 | 测试环境 |
|:---|:---|:---|
| Embedding API | 阿里云百炼 `text-embedding-v3`（1024维） | OpenAI `text-embedding-3-small` |
| 轻量 LLM | 字节火山引擎 ARK（DeepSeek） | OpenAI `gpt-4.1-nano` |
| 主 LLM | 字节火山引擎 ARK | OpenAI `gpt-4.1-mini` |

## 第3阶段产出物清单

### 接口设计文档

- `docs/INTERFACE_DESIGN_MEMORY_OPT.md` — 完整的接口设计文档

### 新增代码框架文件（5个）

| 文件路径 | 说明 |
|:---|:---|
| `server/memory/embeddingService.ts` | Embedding 生成服务 — 单条/批量向量化 + 配置管理 |
| `server/memory/preRetrievalDecision.ts` | 检索前决策 — 规则层 + LLM 层 + 查询重写 |
| `server/memory/extractionAudit.ts` | 提取审计层 — 重要性门控 + 去重校验 |
| `server/memory/confidenceEvolution.ts` | Confidence 演化 — BOOST / SUPERSEDE / NO_MATCH |
| `server/memory/backfillExtraction.ts` | 补漏提取 — 做梦机制执行器 |

### 修改模块变更说明（5个）

| 文件路径 | 变更内容 |
|:---|:---|
| `server/memory/memorySystem.ts` | addMemory 集成 Embedding 生成 + Confidence 演化 |
| `server/agent/supervisor/contextEnrichNode.ts` | 插入 Pre-Retrieval Decision + 查询向量化 |
| `server/agent/tools/memoryTools.ts` | memoryStoreImpl 集成审计层 |
| `server/agent/supervisor/memoryExtractionNode.ts` | 解耦行为模式检测（独立计数器触发） |
| `server/memory/hybridSearch.ts` | embedding 为空时优雅降级为纯 BM25 |

## 开发范围

**P0 功能（3项）**：

1. 记忆写入时生成 Embedding
2. contextEnrichNode 启用混合检索
3. 引入 Pre-Retrieval Decision

**P1 功能（4项）**：

4. 实现查询重写（Query Rewrite）
5. 建立自动提取与 Agent 主动的协同机制
6. 解耦行为模式检测触发条件
7. 实现 Confidence 动态演化

## 新增环境变量（18个）

详见 `docs/INTERFACE_DESIGN_MEMORY_OPT.md` 第4.2节。

## 已有测试资产基线

- `server/agent/tools/__tests__/memoryTools.test.ts` — 4 个记忆工具的参数校验、正常调用和错误处理
- `server/agent/supervisor/__tests__/memoryExtractionNode.test.ts` — 提取节点降级开关行为
- `server/memory/__tests__/memoryPipeline.test.ts` — 四层提取管道纯函数验证
- `server/memory/worker/__tests__/memoryWorkerManager.test.ts` — 做梦工作管理器
- `server/agent/supervisor/__tests__/dialogueSlots.test.ts` — 对话槽位提取
- `server/agent/supervisor/__tests__/navigationMemoryPlan.test.ts` — 导航记忆计划
- `server/agent/supervisor/__tests__/classifyNode.test.ts` — 分类节点
