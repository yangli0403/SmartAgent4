# SmartAgent4

**智能对话交互系统** — 整合个性引擎、记忆系统（含**向量语义检索** + **智能预检索决策** + **质量门控**）、情感表达与**多智能体协同架构**的多模态 AI 助手平台。

---

## 项目概述

SmartAgent4 是一个基于 **LangGraph Supervisor-Agent 架构** 的智能对话系统，整合了三个源项目的核心能力，并在第三轮迭代中引入了**多智能体协同架构**（Agent Card 动态发现 + 并行执行引擎 + 委托协议）。

### 核心特性

- **多智能体协同**：Agent Card JSON 动态发现 + DAG 并行执行引擎 + Agent 间横向委托协议
- **多人格管理**：支持加载和切换多个 AI 人格配置（小智、贾维斯、阿尔弗雷德），兼容 ElizaOS Characterfile 格式
- **动态 System Prompt**：融合人格配置 + 用户画像 + 记忆上下文 + 情感标签指令 + **动态 Agent 能力描述**
- **三层记忆系统**：情景记忆、语义记忆、人格记忆，含四层过滤管道、**向量语义检索**、**智能预检索决策**、**提取质量门控**和记忆巩固/遗忘机制
- **自进化闭环**：工具效用 EMA 评分 + LLM 反思 Prompt 补丁 + 版本控制
- **情感表达渲染**：通过标签体系将 LLM 回复渲染为多模态输出
- **AIRI Bridge**：连接 AIRI Server Runtime 实现 Live2D/VRM 情感化渲染

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 + TailwindCSS 4 |
| 后端 | Node.js + Express + tRPC 11 |
| AI 框架 | LangGraph (StateGraph) + LangChain |
| LLM | Manus API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨 |
| Embedding | 阿里云百炼 DashScope `text-embedding-v3` (1024维) / OpenAI 兼容 |
| 数据库 | PostgreSQL 16 (Drizzle ORM + postgres.js) |
| Agent 发现 | Agent Card JSON + AgentCardRegistry + Zod 校验 |
| 情感渲染 | Emotions-Express Python 微服务 (HTTP API) |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest 2 + @vitest/coverage-v8 |
| 包管理 | pnpm 10 |

---

## 项目结构

```
SmartAgent4/
├── client/                              # React 前端
│   └── src/
│       ├── components/                  # UI 组件
│       ├── pages/                       # 页面（Chat, Memories, Settings）
│       └── lib/                         # 工具库（tRPC client）
├── server/                              # Node.js 后端
│   ├── agent/                           # Agent 架构
│   │   ├── supervisor/                  # Supervisor 编排图
│   │   │   ├── state.ts                 # 状态定义（targetAgent 改为 string）
│   │   │   ├── supervisorGraph.ts       # 图构建（双模式：新注册表/旧注册表）
│   │   │   ├── classifyNode.ts          # 意图分类（动态 Prompt 注入）
│   │   │   ├── planNode.ts              # 任务规划（动态 Agent 列表）
│   │   │   ├── executeNode.ts           # 串行执行（旧兼容模式）
│   │   │   ├── contextEnrichNode.ts     # 上下文增强
│   │   │   ├── respondNode.ts           # 响应生成
│   │   │   ├── memoryExtractionNode.ts  # 记忆提取
│   │   │   └── reflectionNode.ts        # 自进化反思
│   │   ├── discovery/                   # 🆕 多智能体协同模块
│   │   │   ├── types.ts                 # AgentCard、Registry、Delegate 类型定义
│   │   │   ├── agentCardRegistry.ts     # Agent Card 注册表（加载/注册/查询）
│   │   │   ├── dynamicPromptAssembler.ts # 动态 Prompt 组装器
│   │   │   ├── parallelExecuteEngine.ts # DAG 并行执行引擎
│   │   │   ├── index.ts                 # 模块导出
│   │   │   └── __tests__/               # 77 个测试用例
│   │   ├── agent-cards/                 # 🆕 Agent Card JSON 配置
│   │   │   ├── fileAgent.json           # 文件管理专员（15 工具）
│   │   │   ├── navigationAgent.json     # 导航出行专员（19 工具）
│   │   │   ├── multimediaAgent.json     # 多媒体娱乐专员（8 工具）
│   │   │   └── generalAgent.json        # 通用对话专员（0 工具）
│   │   ├── domains/                     # 领域 Agent
│   │   │   ├── baseAgent.ts             # 基类（含 delegate() 委托方法）
│   │   │   ├── generalAgent.ts          # 通用对话
│   │   │   ├── fileAgent.ts             # 文件操作
│   │   │   ├── navigationAgent.ts       # 导航
│   │   │   └── multimediaAgent.ts       # 多媒体
│   │   └── smartAgentApp.ts             # 应用入口（AgentCardRegistry 初始化）
│   ├── personality/                     # 个性引擎
│   ├── emotions/                        # 情感表达
│   ├── memory/                          # 三层记忆系统（含 Embedding/审计/决策/演化/补漏）
│   ├── mcp/                             # MCP 工具管理
│   ├── airi-bridge/                     # AIRI Bridge 模块
│   └── routers.ts                       # tRPC 路由
├── drizzle/                             # 数据库 Schema
├── diagrams/                            # 架构图
├── CLAUDE.md                            # AI 架构指南
├── ARCHITECTURE.md                      # 架构设计文档
├── INTERFACE_DESIGN.md                  # 接口设计文档
├── REQUIREMENTS_REFLECTION.md           # 需求反思报告
├── REPO_ANALYSIS.md                     # 仓库分析文档
└── CHANGELOG.md                         # 变更日志
```

---

## 快速开始

### 环境要求

- Node.js >= 22.x
- pnpm >= 9.x
- PostgreSQL 16+
- Python 3.10+（可选，用于 Emotions-Express 微服务）

### 安装

```bash
# 克隆仓库
git clone https://github.com/yangli0403/SmartAgent4.git
cd SmartAgent4
git checkout windows-compat

# 安装依赖
pnpm install

# 安装 openai SDK（用于 Embedding 服务）
pnpm add openai

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入必要的配置
```

### 环境变量配置

```bash
# LLM 配置（必须）
OPENAI_API_KEY=your_openai_api_key
ARK_API_KEY=your_volcengine_ark_key        # 可选，双轨策略回退

# 数据库配置（必须）
DATABASE_URL=postgresql://user:pass@host:port/db

# Embedding 配置（必须，二选一）
DASHSCOPE_API_KEY=your_dashscope_key       # 阿里云百炼（国内推荐）
# 或使用 OPENAI_API_KEY + OPENAI_BASE_URL    # OpenAI 兼容接口
EMBEDDING_MODEL=text-embedding-v3          # 默认值
EMBEDDING_DIMENSIONS=1024                  # 默认值

# 情感渲染（可选）
EMOTIONS_EXPRESS_URL=http://localhost:8000
EMOTIONS_EXPRESS_ENABLED=true

# 高德地图 MCP（可选）
AMAP_API_KEY=your_amap_key

# AIRI Bridge（可选）
AIRI_SERVER_URL=ws://localhost:6121/ws
AIRI_TOKEN=your_airi_token
```

### 运行

```bash
# 开发模式
pnpm dev

# 数据库迁移
pnpm db:push

# 运行测试
pnpm test

# 运行测试并生成覆盖率报告
npx vitest run --coverage

# 查看全量测试文档
# 详见 TESTING.md

# 构建生产版本
pnpm build
```

---

## 多智能体协同架构（第三轮迭代）

### Agent Card 动态发现

新增 Agent 只需在 `server/agent/agent-cards/` 目录放置 JSON 配置文件，系统启动时自动加载和注册，无需修改核心编排代码。

```json
{
  "id": "navigationAgent",
  "name": "导航出行专员",
  "description": "负责地点搜索、路线规划、实时交通和天气查询",
  "capabilities": ["poi_search", "route_planning", "traffic_query", "weather_query"],
  "tools": ["maps_searchPOI", "maps_getRoute", ...],
  "domain": "navigation",
  "llmConfig": { "temperature": 0.3, "maxTokens": 4096, "maxIterations": 10 },
  "enabled": true,
  "priority": 80
}
```

### 并行执行引擎

基于 `PlanStep.dependsOn` 构建 DAG（有向无环图），使用 Kahn 拓扑排序将步骤分组为可并行执行的批次，通过 `Promise.all` 并行分发无依赖步骤。

```
步骤1（搜索充电桩）  步骤2（查天气）   ← 批次0：并行执行
         ↘              ↙
      步骤3（汇总规划路线）              ← 批次1：等待前置完成
```

### 委托协议

Domain Agent 可通过 `this.delegate(request)` 横向委托其他 Agent 执行子任务，委托深度限制为 3 层。

```typescript
// 在 NavigationAgent 中委托 FileAgent 保存结果
const result = await this.delegate({
  targetCapability: "file_management",
  task: "保存搜索结果到文件",
  context: { data: searchResults },
});
```

---

## 对话处理流程

```
用户消息
    ↓
[contextEnrichNode] — Pre-Retrieval Decision → 向量化查询 → 混合检索(BM25+向量) + 画像构建 + 动态 Prompt
    ↓
[classifyNode] — 意图分类（动态 Prompt 注入 Agent 能力描述）
    ↓
[planNode] — 任务规划（动态 Agent 列表 + 并行执行提示）
    ↓
[parallelExecuteNode] — DAG 并行执行（新模式）
    或 [executeNode] — 串行执行（旧兼容模式）
    ↓
[replanNode] — 评估结果
    ↓
[respondNode] — 响应生成（含情感标签）
    ↓
[memoryExtractionNode] — 异步记忆提取 + 行为检测（已解耦，基于对话计数器独立触发）
    ↓
[reflectionNode] — 异步自进化反思
    ↓
AI 回复
```

---

## 测试

```bash
# 运行所有测试
pnpm test

# 运行 discovery 模块测试
npx vitest run server/agent/discovery/__tests__/ --reporter=verbose

# 运行测试并生成覆盖率报告
npx vitest run --config vitest.config.ts --coverage
```

### 测试概览

- **总测试数**：654 个（651 通过，3 个需数据库）
- **新增模块覆盖率**：语句 94.3%，函数 97.6%
- **全量测试文档**：详见 [TESTING.md](./TESTING.md)

| 模块 | 语句覆盖率 | 函数覆盖率 | 测试用例数 |
|------|-----------|-----------|----------|
| discovery 模块 | 97.68% | 100% | 77 |
| embeddingService | 98.4% | 100% | 24 |
| extractionAudit | 97.1% | 100% | 54 |
| confidenceEvolution | 87.2% | 100% | 16 |
| preRetrievalDecision | 93.5% | 100% | 46 |
| backfillExtraction | 88.9% | 85.7% | 15 |

---

## 项目文档

| 文档 | 描述 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 架构指南（面向 AI 编程助手） |
| [REPO_ANALYSIS.md](./REPO_ANALYSIS.md) | 仓库分析报告 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构设计文档 |
| [INTERFACE_DESIGN.md](./INTERFACE_DESIGN.md) | 接口与数据结构设计 |
| [docs/INTERFACE_DESIGN_MEMORY_OPT.md](./docs/INTERFACE_DESIGN_MEMORY_OPT.md) | 第七轮记忆优化接口设计 |
| [docs/MEMORY_OPTIMIZATION_ARCHITECTURE.md](./docs/MEMORY_OPTIMIZATION_ARCHITECTURE.md) | 第七轮记忆优化架构设计 |
| [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) | 产品规格说明 |
| [TESTING.md](./TESTING.md) | 全量测试文档 |
| [REQUIREMENTS_REFLECTION.md](./REQUIREMENTS_REFLECTION.md) | 需求反思报告 |
| [CHANGELOG.md](./CHANGELOG.md) | 变更日志 |

---

## 开发路线图

### 已完成

- [x] 第一轮迭代：个性引擎 + 情感渲染 + 记忆系统整合
- [x] 第二轮迭代：PostgreSQL 迁移 + 四层过滤管道 + 自进化闭环
- [x] 第三轮迭代：Agent Card 动态发现 + 并行执行引擎 + 委托协议
- [x] 第四轮迭代：主动记忆引擎（行为检测 + 意图预测 + 预取缓存）
- [x] 第五轮迭代：Prompt Caching + Fork 子代理 + DreamGatekeeper
- [x] 第六轮迭代：记忆技能化改造（Agent 主动调度）
- [x] **第七轮迭代：记忆系统优化（Embedding + 智能检索 + 质量门控）**

### 待完成

- [ ] 闭合自进化反馈回路（classifyNode 消费工具效用分数）
- [ ] Agent Card 的 llmConfig 消费端实现
- [ ] 迁移到 pgvector 扩展，将向量检索下沉到数据库层
- [ ] 引入 Apache AGE 图记忆
- [ ] 前端 UI 适配个性切换和情感渲染展示
- [ ] AIRI Bridge 流式输出实现

---

## 许可证

本项目为私有项目。
