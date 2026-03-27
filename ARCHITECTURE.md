# SmartAgent4 — 架构设计文档 V2：多智能体协同架构

> **版本**：V2（架构解耦迭代）
> **日期**：2026-03-27
> **基于**：《SmartAgent4 架构分析与演进报告 V2》

## 高层架构概览

SmartAgent4 V2 的核心目标是将系统从"中心化星型编排"升级为"动态发现 + 并行执行 + 委托协同"的多智能体架构。改造遵循"最小侵入"原则——保留现有 Supervisor 编排流程的骨架，在关键节点注入新能力层。

![系统架构图](./diagrams/architecture.png)

架构分为六个主要层次：客户端层（React + tRPC）、API 层（tRPC + Express + WebSocket）、Supervisor 编排层（LangGraph StateGraph）、**Agent Card 动态发现层**（新增）、Domain Agent 层（BaseAgent 继承体系）、基础设施层（MCP + 记忆 + 人格 + 情感）和数据持久层（PostgreSQL + Drizzle ORM）。

## 模块职责表

### 新增模块

| 模块 | 主要职责 | 技术选型 | 依赖关系 |
|------|----------|----------|----------|
| `AgentCardRegistry` | 管理所有 Agent Card 的生命周期：启动时扫描 `agent-cards/` 目录加载 JSON 配置，运行时支持注册、注销和按能力查询 | TypeScript Map + Zod Schema 校验 | 无外部依赖，被 `classifyNode`、`planNode`、`executeNode`、`BaseAgent.delegate()` 消费 |
| `DynamicPromptAssembler` | 运行时遍历 `AgentCardRegistry`，将所有已注册 Agent 的名称、描述和工具列表动态拼接为 LLM Prompt 片段 | 纯 TypeScript 字符串模板 | 依赖 `AgentCardRegistry` |
| `ParallelExecuteEngine` | 替代原有串行 `executeNode`，基于 `PlanStep.dependsOn` 构建 DAG，将无依赖步骤并行分发（`Promise.all`），有依赖步骤等待前置完成 | TypeScript async/await + Promise.all | 依赖 `AgentCardRegistry` 获取 Agent 实例 |
| `DelegateProtocol` | 在 `BaseAgent` 基类中新增 `delegate()` 方法，允许 Agent 在执行过程中发现能力不足时，通过 `AgentCardRegistry` 查找合适的 Agent 并直接委托子任务 | TypeScript 方法注入 | 依赖 `AgentCardRegistry` |

### 改造模块

| 模块 | 改造内容 | 影响范围 |
|------|----------|----------|
| `classifyNode.ts` | System Prompt 从硬编码改为调用 `DynamicPromptAssembler.buildClassifyPrompt()` | 仅 Prompt 构建逻辑变化，分类输出格式不变 |
| `planNode.ts` | System Prompt 从硬编码改为调用 `DynamicPromptAssembler.buildPlanPrompt()`；`validAgents` 数组改为从 `AgentCardRegistry` 动态获取 | Prompt 和验证逻辑变化，输出 `PlanStep[]` 格式不变 |
| `executeNode.ts` | 串行遍历改为 DAG 并行执行；Agent 实例查找从硬编码 `agentRegistry` 改为 `AgentCardRegistry.getAgent()` | 执行方式变化，输入输出接口不变 |
| `state.ts` | `targetAgent` 类型从联合字面量改为 `string`（支持动态 Agent 名称） | 类型定义变化，下游消费者需适配 |
| `smartAgentApp.ts` | 移除硬编码 `agentRegistry` 对象，改为启动时调用 `AgentCardRegistry.loadFromDirectory()` | 初始化逻辑变化 |
| `BaseAgent` | 新增 `delegate()` 方法和 `agentCardRegistry` 引用 | 基类扩展，子类无需修改 |

### 保留模块（不变）

| 模块 | 保留原因 |
|------|----------|
| `contextEnrichNode` | 上下文增强逻辑与 Agent 发现无关 |
| `replanNode` | 重规划逻辑保持不变，但受益于并行执行引擎的更细粒度步骤状态 |
| `respondNode` | 响应生成逻辑不变 |
| `memoryExtractionNode` | 记忆提取逻辑不变 |
| `reflectionNode` | 自进化反思逻辑不变 |
| `MemorySystem` | 三层记忆架构不变 |
| `PersonalityEngine` | 人格引擎不变 |
| `EmotionsClient` | 情感语音合成不变（TTS 并行化留待后续迭代） |

## 数据流场景

### 场景 1：写操作 — 用户发送复杂多域任务

> 示例：用户说"帮我查附近的咖啡店，然后创建一个文件记录地址"

1. **入口**：用户消息通过 tRPC `sendMessage` mutation 进入 Supervisor 图。`contextEnrichNode` 并行检索用户记忆、画像和情感服务状态，构建动态 System Prompt。

2. **分类**：`classifyNode` 调用 `DynamicPromptAssembler.buildClassifyPrompt()` 获取包含所有已注册 Agent 能力描述的 Prompt，LLM 返回分类结果 `{ domain: "cross_domain", complexity: "complex", requiredAgents: ["navigationAgent", "fileAgent"] }`。

3. **规划**：`planNode` 调用 `DynamicPromptAssembler.buildPlanPrompt()` 获取动态 Prompt，LLM 生成执行计划：`Step 1: [navigationAgent] 搜索附近咖啡店 (dependsOn: [])`、`Step 2: [fileAgent] 创建文件记录地址 (dependsOn: [1])`。

4. **并行执行**：`ParallelExecuteEngine` 分析 DAG，发现 Step 1 无依赖，立即执行。Step 1 完成后，Step 2 的 `inputMapping` 被解析，Step 2 开始执行。如果存在多个无依赖步骤，它们会通过 `Promise.all` 并行执行。

5. **响应与持久化**：`respondNode` 汇总所有步骤结果生成最终回复。`memoryExtractionNode` 异步提取记忆写入 PostgreSQL。`reflectionNode` 异步分析执行质量，更新工具效用分数。

### 场景 2：读操作 — Agent 执行中发现能力不足触发委托

> 示例：FileAgent 在整理文件时需要识别图片内容

1. **入口**：`FileAgent` 在执行"整理桌面文件并按类别归档"任务时，发现需要识别图片文件的内容才能正确分类。

2. **委托发现**：`FileAgent` 调用 `this.delegate({ capability: "image_recognition", task: "识别图片内容" })`。`delegate()` 方法查询 `AgentCardRegistry`，按 `capabilities` 字段匹配，找到具有图片识别能力的 Agent。

3. **委托执行**：`delegate()` 直接调用目标 Agent 的 `execute()` 方法，传入子任务描述和必要上下文。目标 Agent 执行完毕后返回结果。

4. **结果整合**：`FileAgent` 收到委托结果，继续自己的文件归档逻辑。整个委托过程对 Supervisor 透明，不触发重规划。

5. **反馈记录**：委托调用的工具使用记录会被合并到 `FileAgent` 的 `toolCallRecords` 中，最终由 `reflectionNode` 统一分析。

## 关键设计决策

### 决策 1：Agent Card 采用 JSON 文件而非数据库存储

- **背景**：Agent Card 需要在系统启动时快速加载，且开发者需要方便地添加和修改 Agent 配置。
- **备选方案**：(A) 存储在 PostgreSQL 数据库中，通过 Drizzle ORM 查询；(B) 存储为 JSON 文件在项目目录中；(C) 存储在 Redis 等缓存中。
- **最终决策**：选择方案 B — JSON 文件存储在 `server/agent/agent-cards/` 目录。
- **理由**：JSON 文件可以纳入 Git 版本控制，开发者可以直接编辑和 PR 审查。启动时一次性加载到内存 Map 中，运行时查询性能为 O(1)。数据库方案增加了不必要的 I/O 开销和部署依赖。

### 决策 2：并行执行引擎基于 DAG 而非固定并发数

- **背景**：原有 `executeNode` 串行执行所有步骤，需要改造为支持并行。
- **备选方案**：(A) 固定并发数（如最多 3 个 Agent 同时执行）；(B) 基于 `dependsOn` 字段构建 DAG，自动识别可并行步骤；(C) 全部并行执行，由 Agent 自己处理依赖。
- **最终决策**：选择方案 B — DAG 驱动的并行执行。
- **理由**：DAG 方案精确尊重步骤间的数据依赖关系，既能最大化并行度，又不会因为忽略依赖导致执行错误。`PlanStep` 已有 `dependsOn` 字段，无需修改数据结构。

### 决策 3：委托协议采用同步直接调用而非消息队列

- **背景**：Agent 间委托需要一种通信机制，需要在复杂度和实用性之间取得平衡。
- **备选方案**：(A) 异步消息队列（如 Redis Pub/Sub）；(B) 同步直接方法调用；(C) 完整的 A2A 协议实现。
- **最终决策**：选择方案 B — 同步直接调用作为基础版委托协议。
- **理由**：当前系统运行在单进程 Node.js 中，Agent 实例都在同一内存空间，直接方法调用是最简单高效的方式。完整 A2A 协议是第三阶段的目标，当前先用同步调用验证委托模式的可行性。

### 决策 4：`targetAgent` 类型从联合字面量改为 `string`

- **背景**：原有 `targetAgent` 类型为硬编码联合字面量，新增 Agent 必须修改类型定义。
- **备选方案**：(A) 保持联合字面量，每次新增 Agent 时更新；(B) 改为 `string` 类型，运行时通过 `AgentCardRegistry` 验证。
- **最终决策**：选择方案 B — 改为 `string` 类型。
- **理由**：动态发现的核心价值就是消除硬编码。`string` 类型配合运行时验证既保证了灵活性，又不丢失安全性。编译时类型检查的损失通过运行时验证和单元测试弥补。

### 决策 5：保留数据库迁移和记忆系统现状

- **背景**：上一轮迭代已完成 MySQL → PostgreSQL 迁移和记忆提取管道优化。
- **最终决策**：本次迭代不修改数据库层和记忆系统，聚焦于架构解耦。
- **理由**：数据库和记忆系统已处于稳定状态，本次迭代的改造范围应集中在 Supervisor 编排层和 Agent 发现层，避免同时修改过多底层模块增加风险。

## 可扩展性考虑

**Agent 热插拔**：新增 Agent 只需在 `agent-cards/` 目录放置一个 JSON 配置文件，并在 `server/agent/domains/` 中实现对应的 Agent 类。系统启动时自动发现和注册，无需修改任何核心编排代码。这将新增 Agent 的代码修改点从 5 处降低到 1 处（仅需编写 Agent 实现类）。

**并行执行**：DAG 驱动的并行执行引擎能够自动识别可并行步骤，随着 Agent 数量增加和任务复杂度提升，系统的吞吐量将线性提升而非保持串行瓶颈。

**委托链**：基础版委托协议支持 Agent 之间的单层委托。后续可扩展为多层委托链（A 委托 B，B 再委托 C），以及基于 A2A 协议的跨进程委托。

## 安全性考虑

**委托深度限制**：`delegate()` 方法设置最大委托深度（默认 3 层），防止循环委托导致的无限递归。

**Agent Card 校验**：`AgentCardRegistry` 在加载 JSON 文件时进行 Zod Schema 校验，拒绝格式不合法的配置文件，防止恶意或错误配置导致系统异常。

**并行执行隔离**：并行执行的 Agent 之间不共享状态，每个 Agent 的 `execute()` 调用都是独立的，通过 `inputMapping` 机制安全地传递前置步骤的输出数据。
