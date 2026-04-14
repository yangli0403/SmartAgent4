# SmartAgent4 LangSmith 集成改装方案

经过对 SmartAgent4 项目代码的深入分析，我为您制定了以下 LangSmith 集成改装方案。

## 1. 项目架构分析

SmartAgent4 是一个基于 LangGraph Supervisor-Agent 架构的复杂多智能体系统。其核心执行流程如下：

1.  **入口**：`server/routers.ts` 中的 tRPC 路由接收用户请求，调用 `SmartAgentApp.chat()`。
2.  **编排（Supervisor）**：`server/agent/supervisor/supervisorGraph.ts` 构建并执行 LangGraph 状态图，包含上下文增强、意图分类、任务规划、执行、重规划、响应生成、记忆提取和反思等节点。
3.  **执行（Agent）**：
    *   **并行执行引擎**：`server/agent/discovery/parallelExecuteEngine.ts` 负责将任务分发给具体的 Domain Agent。
    *   **Domain Agent**：继承自 `server/agent/domains/baseAgent.ts`，使用 LangGraph 的 `StateGraph` 和 `ToolNode` 构建 ReACT 循环，通过 `createToolCallingLLM` 调用大模型并执行 MCP 工具。
4.  **LLM 适配层**：`server/llm/langchainAdapter.ts` 封装了 OpenAI 兼容接口和 Volcengine ARK 接口的调用。

## 2. 改装目标与策略

由于项目已经深度使用了 LangChain 和 LangGraph 框架，集成 LangSmith 将非常顺畅。我们的目标是实现**端到端的可观测性（Observability）**，能够清晰地追踪从用户请求进入，到 Supervisor 编排，再到各个 Domain Agent 执行和工具调用的完整链路。

### 核心策略：利用环境变量与 `@traceable` 装饰器

LangChain 和 LangGraph 原生支持 LangSmith。我们主要通过配置环境变量来开启全局追踪，并在关键的非 LangChain 函数上添加 `@traceable` 装饰器，以确保追踪树（Trace Tree）的完整性。

## 3. 具体改装步骤

### 步骤一：配置环境变量

在 `.env` 文件中添加 LangSmith 相关的环境变量。这是开启 LangChain/LangGraph 自动追踪的关键。

```env
# ============================================================
# LangSmith 配置
# ============================================================
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_PROJECT=SmartAgent4-Local
```

### 步骤二：安装依赖

确保项目中安装了 `langsmith` SDK。

```bash
pnpm add langsmith
```

### 步骤三：代码层面的深度集成

虽然环境变量可以自动追踪 LangGraph 的节点和 LLM 调用，但为了获得更清晰的业务语义和完整的调用栈，我们需要在关键入口和自定义逻辑处添加手动追踪。

#### 1. 顶层入口追踪：`SmartAgentApp.chat`

在 `server/agent/smartAgentApp.ts` 中，为 `chat` 方法添加 `@traceable` 装饰器，将其作为整个 Trace 的根节点（Root Span）。

```typescript
import { traceable } from "langsmith/traceable";

// ...

  @traceable({ name: "SmartAgent_Chat_Session", run_type: "chain" })
  async chat(
    userMessage: string,
    options: { /* ... */ }
  ): Promise<SupervisorOutput> {
    // ... 现有逻辑
  }
```
*(注：由于 TypeScript 装饰器在类方法上的使用可能需要配置 `experimentalDecorators`，如果项目未开启，可以使用高阶函数包装的方式：`this.chat = traceable(this.chat.bind(this), { name: "SmartAgent_Chat_Session" })`)*

#### 2. Supervisor 节点追踪

Supervisor 的各个节点（如 `classifyNode`, `planNode`, `respondNode`）已经是 LangGraph 的一部分，会自动被追踪。但为了更好的可读性，我们可以使用 `traceable` 包装那些包含复杂业务逻辑的内部函数。

例如，在 `server/agent/supervisor/classifyNode.ts` 中：

```typescript
import { traceable } from "langsmith/traceable";

export const classifyNode = traceable(
  async (state: typeof SupervisorState.State) => {
    // ... 现有逻辑
  },
  { name: "Supervisor_Classify_Node", run_type: "chain" }
);
```

#### 3. Domain Agent 执行追踪：`BaseAgent.execute`

`server/agent/domains/baseAgent.ts` 是所有具体 Agent 执行的核心。为其 `execute` 方法添加追踪，可以清晰地看到每个 Agent 的输入、输出和耗时。

```typescript
import { traceable } from "langsmith/traceable";

// ...

  @traceable({ name: "DomainAgent_Execute", run_type: "agent" })
  async execute(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    // ... 现有逻辑
  }
```

#### 4. LLM 适配层增强：`langchainAdapter.ts`

虽然 `ChatOpenAI` 会自动被追踪，但项目中有一些自定义的 LLM 调用函数（如 `callLLMStructured`, `callLLMText`, `callLLMWithTools`）。为这些函数添加追踪，确保不遗漏任何 LLM 请求。

```typescript
import { traceable } from "langsmith/traceable";

export const callLLMStructured = traceable(
  async <T>(systemPrompt: string, userMessage: string, options: LLMAdapterOptions = {}): Promise<T> => {
    // ... 现有逻辑
  },
  { name: "callLLMStructured", run_type: "llm" }
);
```

#### 5. MCP 工具调用追踪

在 `server/mcp/mcpManager.ts` 中，追踪 `callTool` 方法，这对于监控外部工具调用的性能和错误至关重要。

```typescript
import { traceable } from "langsmith/traceable";

// ...

  @traceable({ name: "MCP_CallTool", run_type: "tool" })
  async callTool(serverId: string, toolName: string, args: any): Promise<any> {
    // ... 现有逻辑
  }
```

## 4. 评估（Evaluation）方案建议

在完成上述追踪（Tracing）集成后，您可以利用收集到的数据进行评估。

1.  **构建数据集**：从 LangSmith 的 Traces 中筛选出具有代表性的对话（如复杂的导航规划、文件操作），将其添加到 Dataset 中。
2.  **自定义评估器**：针对 SmartAgent4 的特性编写评估器。例如：
    *   **工具调用准确率**：评估 Agent 是否选择了正确的 MCP 工具。
    *   **JSON 结构化输出验证**：评估 `callLLMStructured` 的输出是否符合预期的 Schema。
    *   **多智能体协同评估**：评估 `parallelExecuteEngine` 的任务拆分和依赖关系是否合理。

## 5. 实施计划

如果您同意此方案，我们可以按照以下步骤进行：

1.  **您提供 LangSmith API Key**。
2.  **我修改代码**：在沙盒中修改上述提到的关键文件，引入 `langsmith` 依赖并添加追踪代码。
3.  **本地测试**：在沙盒中启动项目，发送几条测试消息，验证 LangSmith 平台上是否成功生成了 Trace 树。
4.  **提交更改**：将修改后的代码打包或生成 patch 文件供您下载。

请确认是否按照此方案进行改装？如果您有其他特定的追踪需求（例如重点关注记忆系统或情感渲染模块），请告诉我。
