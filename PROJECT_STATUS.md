# SmartAgent4 记忆系统优化 — 项目状态跟踪

## 当前阶段

**第1阶段：分析与范围界定** — 进行中

## 阶段进度

| 阶段 | 状态 | 产出物 | 备注 |
|:---|:---|:---|:---|
| 第1阶段：分析与范围界定 | 进行中 | PRODUCT_SPEC.md | 含 P0+P1 全量功能定义与用户测试用例 |
| 第2阶段：架构与设计 | 待办 | ARCHITECTURE.md | — |
| 第3阶段：接口与数据结构定义 | 待办 | INTERFACE_DESIGN.md | — |
| 第4阶段：子代理驱动实现 (TDD) | 待办 | 功能代码 + 测试 | — |
| 第5阶段：需求反思 | 待办 | REQUIREMENTS_REFLECTION.md | — |
| 第6阶段：代码质量与覆盖率审查 | 待办 | TESTING.md | — |
| 第6b阶段：生成 AI 架构指南 | 待办 | CLAUDE.md | — |
| 第7阶段：文档与交付 | 待办 | README.md 等 | — |

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

## 已有测试资产基线

- `server/agent/tools/__tests__/memoryTools.test.ts` — 4 个记忆工具的参数校验、正常调用和错误处理
- `server/agent/supervisor/__tests__/memoryExtractionNode.test.ts` — 提取节点降级开关行为
- `server/memory/__tests__/memoryPipeline.test.ts` — 四层提取管道纯函数验证
- `server/memory/worker/__tests__/memoryWorkerManager.test.ts` — 做梦工作管理器
- `server/agent/supervisor/__tests__/dialogueSlots.test.ts` — 对话槽位提取
- `server/agent/supervisor/__tests__/navigationMemoryPlan.test.ts` — 导航记忆计划
- `server/agent/supervisor/__tests__/classifyNode.test.ts` — 分类节点
