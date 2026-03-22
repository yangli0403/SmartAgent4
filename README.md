# SmartAgent3

**智能对话交互系统** — 整合个性引擎、记忆系统与情感表达的多模态 AI 助手平台。

---

## 项目概述

SmartAgent3 是一个基于 **LangGraph Supervisor-Agent 架构** 的智能对话系统，整合了三个源项目的核心能力：

| 源项目 | 整合能力 | 整合方式 |
|--------|---------|---------|
| **SmartAgent_PL_E** | Supervisor 多 Agent 架构、tRPC 接口、MCP 工具管理 | 作为项目基座 |
| **SmartAgent2** | 个性化引擎（多人格管理）、记忆系统（三层记忆） | 代码级合并（TypeScript） |
| **Emotions-Express** | 情感标签解析、多模态渲染（语音+表情+动作） | 微服务对接（HTTP API） |

### 核心特性

- **多人格管理**：支持加载和切换多个 AI 人格配置（小智、贾维斯、阿尔弗雷德），兼容 ElizaOS Characterfile 格式导入
- **动态 System Prompt**：融合人格配置 + 用户画像 + 记忆上下文 + 情感标签指令，构建个性化的系统提示词
- **三层记忆系统**：情景记忆（episodic）、语义记忆（semantic）、人格记忆（persona），支持记忆版本管理和重要性衰减
- **情感表达渲染**：通过 `[tag:value]` 标签体系，将 LLM 回复渲染为包含表情、手势、姿态、音效的多模态输出
- **Supervisor 多 Agent 架构**：意图分类 → 任务规划 → 领域 Agent 执行 → 响应生成的完整对话处理管线
- **MCP 工具集成**：支持高德地图导航、文件系统操作等外部工具

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + TailwindCSS |
| 后端 | Node.js + Express + tRPC |
| AI 框架 | LangGraph (Supervisor-Agent) + LangChain |
| LLM | Manus 内置 API (gpt-4.1-mini) + Volcengine ARK (DeepSeek) 双轨策略 |
| 数据库 | MySQL/TiDB (Drizzle ORM) + SQLite (记忆系统) |
| 情感渲染 | Emotions-Express Python 微服务 |
| 工具集成 | MCP (Model Context Protocol) |
| 测试 | Vitest + @vitest/coverage-v8 |

---

## 项目结构

```
SmartAgent3/
├── client/                          # React 前端
│   └── src/
│       ├── components/              # UI 组件
│       ├── pages/                   # 页面（Chat, Memories, Settings）
│       └── lib/                     # 工具库（tRPC client）
├── server/                          # Node.js 后端
│   ├── personality/                 # 🆕 个性引擎模块
│   │   ├── types.ts                 # 类型定义（AgentCharacter, BuildSystemPromptOptions）
│   │   ├── personalityEngine.ts     # 核心引擎（人格加载、Prompt 构建、问候语生成）
│   │   ├── personalitySystem.ts     # 原有个性系统（兼容层）
│   │   ├── characters/              # 人格配置 JSON 文件
│   │   │   ├── xiaozhi.json         # 小智 — 智能车载助手
│   │   │   ├── jarvis.json          # 贾维斯 — 高效 AI 管家
│   │   │   └── alfred.json          # 阿尔弗雷德 — 温和英式管家
│   │   └── index.ts                 # 模块导出
│   ├── emotions/                    # 🆕 情感表达模块
│   │   ├── types.ts                 # 类型定义（MultimodalSegment, EmotionType）
│   │   ├── emotionsClient.ts        # Emotions-Express HTTP 客户端
│   │   ├── emotionTagInstructions.ts # 情感标签指令模板
│   │   └── index.ts                 # 模块导出
│   ├── memory/                      # 🆕增强 记忆系统
│   │   ├── memorySystem.ts          # 记忆系统（新增 getUserProfileSnapshot, extractMemories）
│   │   └── profileBuilder.ts        # 用户画像构建器
│   ├── agent/                       # Agent 架构
│   │   ├── supervisor/              # 🆕改造 Supervisor 图
│   │   │   ├── state.ts             # 状态定义（新增 memoryContext, characterId 等字段）
│   │   │   ├── supervisorGraph.ts   # Supervisor 图（新增 contextEnrich, memoryExtraction 节点）
│   │   │   ├── contextEnrichNode.ts # 🆕 上下文增强节点
│   │   │   ├── memoryExtractionNode.ts # 🆕 记忆提取节点
│   │   │   ├── respondNode.ts       # 🆕改造 响应节点（注入动态 Prompt）
│   │   │   ├── classifyNode.ts      # 意图分类节点
│   │   │   ├── executeNode.ts       # 执行节点
│   │   │   └── ...
│   │   ├── domains/                 # 领域 Agent
│   │   └── smartAgentApp.ts         # SmartAgent 应用入口
│   ├── routers.ts                   # 🆕扩展 tRPC 路由（personality, emotions API）
│   ├── llm/                         # LLM 适配层
│   └── mcp/                         # MCP 工具管理
├── drizzle/                         # 数据库 Schema 和迁移
├── shared/                          # 前后端共享类型
├── tests/                           # 🆕 自动化测试
│   ├── unit/                        # 单元测试
│   └── integration/                 # 集成测试
├── diagrams/                        # 架构图
├── ARCHITECTURE.md                  # 架构设计文档
├── INTERFACE_DESIGN.md              # 🆕 接口设计文档
├── REQUIREMENTS_REFLECTION.md       # 🆕 需求反思报告
├── REPO_ANALYSIS.md                 # 源仓库分析文档
└── CHANGELOG.md                     # 🆕 变更日志
```

---

## 快速开始

### 环境要求

- Node.js >= 22.x
- pnpm >= 9.x
- MySQL 8.0+ 或 TiDB（主数据库）
- Python 3.10+（可选，用于 Emotions-Express 微服务）

### 安装

```bash
# 克隆仓库
git clone https://github.com/yangli0403/SmartAgent3.git
cd SmartAgent3

# 安装依赖
pnpm install

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
DATABASE_URL=mysql://user:pass@host:port/db

# 情感渲染（可选）
EMOTIONS_EXPRESS_URL=http://localhost:8000
EMOTIONS_EXPRESS_ENABLED=true

# 高德地图 MCP（可选）
AMAP_API_KEY=your_amap_key

# OAuth 配置（可选）
VITE_OAUTH_PROVIDER=github
VITE_GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

### 运行

```bash
# 开发模式
pnpm dev

# 数据库迁移
pnpm db:push

# 运行测试
pnpm test

# 构建生产版本
pnpm build
```

---

## 新增模块详解

### 1. PersonalityEngine（个性引擎）

负责管理 AI 人格配置和构建动态 System Prompt。

```typescript
import { getPersonalityEngine } from "./server/personality";

const engine = getPersonalityEngine();

// 获取人格配置
const character = engine.getCharacter("xiaozhi");

// 构建动态 System Prompt
const prompt = engine.buildSystemPrompt({
  characterId: "xiaozhi",
  userProfile: { displayName: "张三", activePreferences: [], relevantRelationships: [] },
  memoryContext: "用户上次提到想去北京旅行",
  emotionTagInstructions: getEmotionTagInstructions(),
});

// 导入 ElizaOS 格式人格
engine.importFromElizaOS(elizaCharacterData);
```

### 2. EmotionsExpressClient（情感渲染客户端）

与 Emotions-Express Python 微服务通信，将文本渲染为多模态输出。

```typescript
import { getEmotionsClient } from "./server/emotions";

const client = getEmotionsClient();

// 检查服务可用性
const available = await client.isAvailable();

// 渲染文本为多模态数据
const segments = await client.render("你好！", "session-1");
// segments: [{ text: "你好！", emotion: "happy", audioBase64: "...", actions: [...] }]

// 服务不可用时自动降级为纯文本
```

### 3. ProfileBuilder（用户画像构建器）

从记忆系统中提取用户画像信息。

```typescript
import { buildProfileFromMemories, formatMemoriesForContext } from "./server/memory/profileBuilder";

// 从记忆构建用户画像
const profile = buildProfileFromMemories(personaMemories);
// profile: { displayName: "张三", activePreferences: [...], relevantRelationships: [...] }

// 格式化记忆为上下文文本
const context = formatMemoriesForContext(relevantMemories, 2000);
```

---

## 对话处理流程

SmartAgent3 的对话处理管线如下：

```
用户消息
    ↓
[contextEnrichNode] — 上下文增强
    ├── 检索相关记忆
    ├── 构建用户画像
    ├── 生成动态 System Prompt
    └── 注入情感标签指令
    ↓
[classifyNode] — 意图分类
    ↓
[planNode] — 任务规划（复杂任务）
    ↓
[executeNode] — 领域 Agent 执行
    ↓
[respondNode] — 响应生成（使用动态 Prompt）
    ↓
[memoryExtractionNode] — 异步记忆提取
    ├── 提取事实、偏好、行为模式
    └── 沉淀到记忆系统
    ↓
AI 回复（含情感标签）
    ↓
[EmotionsExpressClient] — 情感渲染（可选）
    ↓
多模态输出（文本 + 语音 + 表情 + 动作）
```

---

## API 端点

### 新增 API

| 方法 | 路径 | 描述 |
|------|------|------|
| `personality.listCharacters` | tRPC query | 列出所有可用人格 |
| `personality.getCharacter` | tRPC query | 获取指定人格配置 |
| `personality.getGreeting` | tRPC query | 获取个性化问候语 |
| `personality.importElizaOS` | tRPC mutation | 导入 ElizaOS 格式人格 |
| `emotions.render` | tRPC mutation | 渲染文本为多模态数据 |
| `emotions.parseOnly` | tRPC mutation | 仅解析情感标签 |
| `emotions.isAvailable` | tRPC query | 检查情感渲染服务状态 |

---

## 测试

```bash
# 运行所有测试
pnpm test

# 运行测试并生成覆盖率报告
npx vitest run --config vitest.config.ts --coverage
```

### 测试覆盖

| 模块 | 语句覆盖率 | 函数覆盖率 | 测试用例数 |
|------|-----------|-----------|-----------|
| emotionTagInstructions.ts | 100% | 100% | 11 |
| profileBuilder.ts | 97.34% | 100% | 14 |
| personalityEngine.ts | 79.17% | 88.23% | 21 |
| emotionsClient.ts | 67.32% | 83.33% | 16 |
| 集成测试 | — | — | 3 |
| **总计** | **71.05%** | **89.74%** | **65** |

---

## 项目文档

| 文档 | 描述 |
|------|------|
| [REPO_ANALYSIS.md](./REPO_ANALYSIS.md) | 源仓库分析报告（第1阶段） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构设计文档（第2阶段） |
| [INTERFACE_DESIGN.md](./INTERFACE_DESIGN.md) | 接口与数据结构设计（第3阶段） |
| [REQUIREMENTS_REFLECTION.md](./REQUIREMENTS_REFLECTION.md) | 需求反思报告（第5阶段） |
| [CHANGELOG.md](./CHANGELOG.md) | 变更日志 |

---

## 开发路线图

- [x] 第1阶段：源仓库分析
- [x] 第2阶段：架构与设计
- [x] 第3阶段：接口与数据结构定义
- [x] 第4阶段：功能实现
- [x] 第5阶段：需求反思与验证
- [x] 第6阶段：自动化测试
- [x] 第7阶段：文档与交付
- [ ] 后续：Emotions-Express 微服务部署与端到端集成测试
- [ ] 后续：记忆数据从 SQLite 迁移到 MySQL/TiDB
- [ ] 后续：前端 UI 适配个性切换和情感渲染展示

---

## 许可证

本项目为私有项目。
