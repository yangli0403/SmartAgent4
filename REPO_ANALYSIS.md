# SmartAgent4 仓库分析报告 V2：从"单体编排"走向"多智能体协同"

> **分析对象**：SmartAgent4 仓库 `windows-compat` 分支
> **分析日期**：2026-03-27
> **分析依据**：《SmartAgent4 架构分析与演进报告 V2》+ 源代码深度审查

## 1. 源代码阅读与初步分析

### 1.1 核心组件分析

通过对 SmartAgent4 仓库 `windows-compat` 分支的全面源代码审查，我们识别出以下关键组件及其主要职责和当前局限性。

**Supervisor 编排层**（`server/agent/supervisor/`）是系统的"大脑"，由 `supervisorGraph.ts` 定义了固定的 LangGraph 状态图：`START → contextEnrich → classify → [plan|execute] → execute → replan → [execute|respond] → memoryExtract → reflection → END`。其中 `classifyNode.ts` 使用 LLM 进行任务分类，`planNode.ts` 将复杂任务分解为线性的 `PlanStep[]` 数组，`executeNode.ts` 按索引逐步分发到 Domain Agent，`replanNode.ts` 在步骤失败时触发 LLM 重规划。所有决策集中在 Supervisor，Domain Agent 无自主权。

**Domain Agent 层**（`server/agent/domains/`）包含 4 个硬编码的领域 Agent：`FileAgent`（文件系统操作）、`NavigationAgent`（导航和地图）、`MultimediaAgent`（音乐和多媒体）、`GeneralAgent`（通用对话）。它们均继承自 `BaseAgent` 基类，该基类封装了 LangGraph ReAct 循环的通用逻辑。每个 Agent 的 `availableTools` 列表在构造时静态确定，`execute()` 方法只围绕分配给它的步骤和工具集做本地 ReAct，不具备注册发现、横向委托或动态工具选择能力。

**工具注册表**（`server/mcp/toolRegistry.ts`）已实现 v2 版本，包含工具效用分数（`utilityScore`）、成功/失败计数和平均执行时间等自进化闭环增强字段。`MCPManager` 负责连接 MCP Server 并将工具注册到 `ToolRegistry`。但当前效用分数仅存储在内存中，重启后丢失，且未被 `classifyNode` 或 `planNode` 的路由决策所消费。

**记忆系统**（`server/memory/`）已实现完整的三层记忆架构：工作记忆（内存 Map，TTL 30 分钟）、混合检索（BM25 + 向量余弦相似度双路召回）、记忆巩固（LLM 聚类提炼）和动态遗忘（艾宾浩斯衰减模型）。`contextEnrichNode.ts` 在 Supervisor 图的前置阶段并行检索记忆和用户画像。

**人格引擎**（`server/personality/`）管理多个人格配置（`xiaozhi.json`、`jarvis.json`、`alfred.json`），通过 `PersonalityEngine.buildSystemPrompt()` 构建动态 System Prompt。当前 Prompt 拼接为硬编码分段组装，缺乏标准化语法。

**情感语音合成**（`server/emotions/emotionsClient.ts`）对接 Emotions-System 微服务，解析 LLM 输出中的复合情感标签 `[emotion:happy|instruction:用欢快的语气]`，通过 HTTP POST 调用 TTS 接口。当前实现为同步串行处理每个文本片段，导致语音回复延迟较高。

**自进化反思节点**（`server/agent/supervisor/reflectionNode.ts`）在 Supervisor 图的末尾异步执行，负责分析执行结果、更新工具效用分数、持久化工具调用日志到 `tool_utility_logs` 表、生成 Prompt 补丁并写入 `prompt_versions` 表。但存在三个断路点：工具选择未消费效用分数、Prompt 补丁无消费机制、效用分数易失。

**数据库层**（`drizzle/schema.ts`）已完成从 MySQL 到 PostgreSQL 的迁移，使用 `drizzle-orm/pg-core`，定义了用户、偏好、记忆、对话、行为模式、工具效用日志和 Prompt 版本历史等核心表。

### 1.2 架构模式与代码质量

| 维度 | 评估结论 |
|------|----------|
| 架构模式 | 中心化星型编排（Hub-and-Spoke），Supervisor 为唯一决策者，Domain Agent 为被动 Worker |
| 代码质量 | 模块化程度高，TypeScript 严格类型检查，注释完善（中文），命名规范 |
| 测试覆盖 | 包含单元测试和集成测试（Vitest），覆盖 personality、emotions、memory、mcp、supervisor 等模块 |
| 技术栈 | 前端 React + TailwindCSS + tRPC，后端 Express + LangGraph + MCP SDK，数据库 PostgreSQL + Drizzle ORM |
| 外部依赖 | @langchain/langgraph ^1.2.0、@langchain/openai ^1.2.11、@modelcontextprotocol/sdk ^1.27.1 |

## 2. 深度分析：单体编排的五大局限

### 2.1 绝对的中央集权

通过对 `classifyNode.ts`、`planNode.ts`、`executeNode.ts` 的逐行审查，确认所有"思考"、"规划"和"路由"都集中在 Supervisor。`planNode` 调用 LLM 生成线性的 `PlanStep[]` 数组，`executeNode` 只是一个执行机器——遍历数组，按顺序唤醒对应的 Domain Agent，等待执行完毕，再唤醒下一个。Domain Agent 自己不做任何决策，只是"被叫到名字就干活"。

### 2.2 缺乏 Agent 间直接通信

通过对代码库的全局检索（搜索 `agentCard`、`A2A`、`peer`、`delegate`、`broadcast`、`subscribe` 等关键词），确认不存在任何 Agent 之间直接通信的机制。Agent A 无法直接将数据传递给 Agent B。当前数据流转完全依赖 Supervisor 的 `inputMapping` 机制（在 `executeNode.ts` 中解析 `step_1.output` 并作为参数喂给 `step_2`），所有信息必须经过中央中转。

### 2.3 静态的硬编码注册

新增一个 Agent 需要修改 5 处核心代码：

| 序号 | 要修改的文件 | 修改内容 |
|------|-------------|----------|
| 1 | `server/agent/domains/` 新建文件 | 编写 Agent 类，继承 BaseAgent，定义 System Prompt 和工具列表 |
| 2 | `server/agent/supervisor/state.ts` | `targetAgent` 联合类型必须加上新 Agent 名称 |
| 3 | `server/agent/smartAgentApp.ts` | `agentRegistry` 对象里手动加一行实例化代码 |
| 4 | `server/agent/supervisor/classifyNode.ts` | 修改 `CLASSIFY_SYSTEM_PROMPT` 告诉 LLM "现在多了一个领域" |
| 5 | `server/agent/supervisor/planNode.ts` | 修改 `PLAN_SYSTEM_PROMPT` 把新 Agent 的名字和所有工具写进去 |

### 2.4 串行阻塞执行

`executeNode.ts` 通过 `currentStepIndex` 逐步执行，每个步骤必须等待前一个完成。即使两个步骤之间没有数据依赖（如"查天气"和"建文件夹"），也必须串行等待。`crossDomainTask.ts` 虽然有 `groupStepsByDomain()` 和 `stepsByDomain` 概念，但注释明确写着"当前实现为顺序执行"，`runCrossDomain()` 使用 `for` 循环依次执行全部步骤。

### 2.5 自进化闭环的三个断路点

`reflectionNode.ts` 已实现了自进化闭环的基础设施（质量评分、工具效用更新、Prompt 补丁生成），但存在三个关键断路点：

| 断路点 | 现状 | 影响 |
|--------|------|------|
| 工具选择静态化 | `BaseAgent.availableTools` 硬编码，`getRankedTools()` 未被消费 | 效用分数无法影响工具路由 |
| Prompt 补丁沉睡 | 补丁写入 `prompt_versions` 表但 `isActive` 默认为 `false`，无消费者读取 | Prompt 无法自动进化 |
| 效用分数易失 | `utilityScore` 存储在内存 Map 中，重启后丢失 | 历史学习成果无法累积 |

## 3. 现状与目标对比总览

| 维度 | 当前现状（单智能体编排） | 目标状态（多智能体协同） |
|------|--------------------------|--------------------------|
| 架构模式 | 中心化星型拓扑，Supervisor 是唯一大脑，Agent 只是执行工具的 Worker | 去中心化网状拓扑，Agent 具备自主性，可点对点协作与任务委托 |
| 通信机制 | 所有数据必须经 Supervisor 的 `inputMapping` 中转 | A2A 协议：Agent 之间直接交换上下文和产物（Artifacts） |
| 注册与发现 | 硬编码 `agentRegistry` 对象，写死 4 个 Agent | Agent Card 动态广播：新 Agent 随时接入，系统自动发现 |
| 执行方式 | 串行阻塞，按 `PlanStep[]` 数组顺序一步步执行 | 并行分发：独立子任务同时执行，最后由 Supervisor 汇总 |
| 路由决策 | 规则映射 domain → agent，LLM Prompt 中硬编码工具列表 | 语义缓存：向量化嵌入快速匹配最合适的 Agent |
| 容错机制 | 步骤失败 → Supervisor 整体重规划（昂贵的 LLM 调用） | Agent 自主重试或横向委托，Supervisor 无感 |
| 扩展性 | 新增 Agent 需修改 5 处核心代码 | 新增 Agent 只需提供一个 JSON 配置文件（Agent Card） |

## 4. 本次迭代范围界定

基于修改可行报告的三阶段路线图，本次迭代聚焦于**第二阶段：架构解耦**，这是从单体编排走向多智能体协同的关键基础。具体包含以下核心改造：

### 4.1 Agent Card 动态发现机制

将硬编码的 `agentRegistry` 改造为基于 JSON 配置文件的动态注册系统。每个 Agent 通过一个 Agent Card 描述自己的身份、能力和工具集，系统启动时自动扫描配置目录加载。

### 4.2 动态 Prompt 组装

`classifyNode.ts` 和 `planNode.ts` 的 System Prompt 不再写死 Agent 列表和工具列表，而是运行时遍历 `agentRegistry`，自动把所有 Agent 的 `description` 和 `capabilities` 拼进 Prompt。

### 4.3 并行执行引擎

改造 `executeNode.ts`，基于 `PlanStep.dependsOn` 依赖关系分析，将无依赖的步骤并行执行，有依赖的步骤等待前置完成后再执行。

### 4.4 Agent 间委托协议（基础版）

在 `BaseAgent` 中引入 `delegate()` 方法，允许 Agent 在执行过程中发现自身能力不足时，通过 Agent Card 查找合适的 Agent 并直接委托子任务，无需回退到 Supervisor 重规划。

## 5. 结论

SmartAgent4 当前是一个优秀的"流水线工厂"——拥有成熟的三层记忆系统、完善的人格引擎、初步的自进化闭环基础设施，以及良好的模块化代码结构。但其核心编排架构仍停留在中心化串行模式，Domain Agent 本质上只是被动执行工具的 Worker。

本次迭代的目标是完成架构解耦的关键改造：引入 Agent Card 动态发现、动态 Prompt 组装、并行执行引擎和基础委托协议，为后续的深度多智能体协同（A2A 协议、Agent Lightning 强化学习闭环）奠定坚实基础。
