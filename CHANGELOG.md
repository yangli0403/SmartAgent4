# Changelog

本文件记录 SmartAgent3 项目的所有重要变更。

---

## [0.3.0] - 2026-03-03

### 第3阶段：接口与数据结构定义

#### 新增
- `INTERFACE_DESIGN.md` — 完整的接口设计文档，定义了所有模块的接口签名、数据结构和交互协议
- `server/personality/types.ts` — 个性引擎类型定义（AgentCharacter, BuildSystemPromptOptions, ContextualProfileSnapshot 等）
- `server/emotions/types.ts` — 情感表达类型定义（MultimodalSegment, EmotionType, EmotionAction 等）
- `server/personality/characters/xiaozhi.json` — 小智人格配置（智能车载助手）
- `server/personality/characters/jarvis.json` — 贾维斯人格配置（高效 AI 管家）
- `server/personality/characters/alfred.json` — 阿尔弗雷德人格配置（温和英式管家）
- 从 SmartAgent_PL_E 复制完整代码基座（前端、后端、数据库 Schema）

---

## [0.4.0] - 2026-03-03

### 第4阶段：功能实现

#### 新增
- `server/personality/personalityEngine.ts` — PersonalityEngine 核心引擎
  - 多人格配置加载和管理
  - 动态 System Prompt 构建（融合人格 + 用户画像 + 记忆 + 情感指令）
  - 个性化问候语生成
  - ElizaOS Characterfile 格式导入
- `server/emotions/emotionsClient.ts` — EmotionsExpressClient 情感渲染客户端
  - HTTP 客户端与 Emotions-Express 微服务通信
  - 同步渲染和流式渲染支持
  - 健康检查缓存和自动重试
  - 服务不可用时的优雅降级（去除标签返回纯文本）
- `server/emotions/emotionTagInstructions.ts` — 情感标签指令模板
  - 完整版和简化版两种指令模板
  - 涵盖表情、动画、手势、姿态、移动、音效、暂停等标签类型
- `server/memory/profileBuilder.ts` — 用户画像构建器
  - 从 persona 记忆中提取用户名称、偏好和关系信息
  - 记忆格式化为上下文文本（按重要性排序，支持长度限制）
- `server/agent/supervisor/contextEnrichNode.ts` — 上下文增强节点
  - 在 Supervisor 图中注入记忆检索和用户画像
  - 生成动态 System Prompt 并写入状态
- `server/agent/supervisor/memoryExtractionNode.ts` — 记忆提取节点
  - 在回复生成后异步提取事实、偏好和行为模式
  - 沉淀到记忆系统

#### 修改
- `server/agent/supervisor/state.ts` — 扩展状态定义，新增 memoryContext, characterId, dynamicSystemPrompt, emotionTagsEnabled 字段
- `server/agent/supervisor/supervisorGraph.ts` — 改造 Supervisor 图，插入 contextEnrich 和 memoryExtraction 节点
- `server/agent/supervisor/respondNode.ts` — 改造响应节点，注入动态 System Prompt 和情感标签指令
- `server/agent/supervisor/index.ts` — 更新导出，新增 contextEnrichNode 和 memoryExtractionNode
- `server/memory/memorySystem.ts` — 增强记忆系统，新增 getUserProfileSnapshot 和 extractMemoriesFromConversation 方法
- `server/routers.ts` — 扩展 tRPC 路由，新增 personality 和 emotions 相关 API
- `server/agent/smartAgentApp.ts` — 在 chat 方法中添加 characterId 支持
- `.env.example` — 新增 SmartAgent3 特有的环境变量

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

## [0.7.0] - 2026-03-03

### 第7阶段：文档与交付

#### 新增
- `CHANGELOG.md` — 变更日志

#### 修改
- `README.md` — 更新为完整的项目文档（概述、安装说明、模块详解、API 端点、测试覆盖）

---

## [0.2.0] - 2026-03-03

### 第2阶段：架构与设计

#### 新增
- `ARCHITECTURE.md` — 系统架构设计文档
- `diagrams/` — 架构图（C4 系统上下文图、数据流图等）

---

## [0.1.0] - 2026-03-03

### 第1阶段：分析与范围界定

#### 新增
- `REPO_ANALYSIS.md` — 源仓库分析报告
- `changes_summary.md` — SmartAgent_PL_E 最新变更摘要
