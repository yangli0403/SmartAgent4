# CLAUDE_V0.5.md — SmartAgent4 v0.5 知识沉淀

> system-dev v0.8 第 7 阶段交付物
> 给后续 AI 协作者（包括下一轮迭代的 Claude / Manus）使用的项目导航与决策记录
> 分支：`demo_0423` · 日期：2026-04-24

---

## 1. 项目当前形态（v0.5 落地后）

SmartAgent4 是一款车机座舱多 Agent 智能助手，技术栈：
- **后端**：Node.js 22 + TypeScript + Express + tRPC + LangGraph + DashScope（ASR/LLM）+ MCP（高德地图等）
- **前端**：Vite 7 + React 19 + Tailwind 4 + AIRI Live2D Stage + tRPC Client
- **持久层**：PostgreSQL（drizzle-orm，开发环境也可用 MySQL/TiDB）
- **测试**：Vitest 2.1 + @testing-library/react（v0.5 升级，引入 jsx automatic）

v0.5 第一批落地的能力：
1. 方言 ASR（默认模型 paraformer-realtime-v2 + 可配 language_hints）
2. AIRI 半身展示（viewMode prop + 纯函数 framing 几何）
3. 可视化思考气泡（ThinkingBubble 三态 + 对话流内嵌）
4. Supervisor 流式事件后端（事件总线 + SSE 端点 + 不改 LangGraph 节点）

未落地（留给第二批）：Omni 端到端语音、新闻可成长助理、飞书 OfficeAgent、行程规划、订餐 ServiceAgent。

---

## 2. 关键架构决策（必须沿用，不可推翻）

### 2.1 流式事件用 SSE，不用 tRPC subscription
**原因**：tRPC 客户端目前只挂 `httpBatchLink`，引入 subscription link 会牵连测试桩与代理配置；SSE 旁路 + 原生 EventSource 零侵入。
**禁忌**：不要在第二批迭代时回头改 tRPC link，破坏已建立的解耦边界。

### 2.2 不改 LangGraph 节点内部
**原因**：classify/plan/execute/replan/respond/memoryExtract/reflection 节点已稳定，未来要保持其测试快照；流式能力通过 `compiledGraph.stream(initialState)` 在外层包装实现。
**禁忌**：节点内部不要直接调用 `supervisorEventBus.publish`，破坏单一职责。

### 2.3 ChatUiMessage 升级为联合类型
**原因**：thinking 是新一类消息，挂在 assistant 上会让 UI switch 复杂；提升为顶级 role 后渲染 `switch(role)` 一行分发。
**约束**：再加新角色（例如 system 提示卡）时也走"新增 union 成员"路径，不要回到 if-else 嵌套。

### 2.4 viewMode 用 props 不进 Zustand store
**原因**：当前唯一调用方是 Cockpit，过早抽象会让 store 抖动；后续若要全局动效（例如多页同步切换）再迁移到 store。
**约束**：第二批迭代时不要随意把 viewMode 推到 store。

### 2.5 品牌词统一为 "Metris Agent"
**约束**：所有用户可见的思考态文案使用：
- 进行中："Metris Agent 思考中..."
- 完成："Metris Agent 已完成思考"
- 失败："Metris Agent 思考失败"

---

## 3. 重要文件导航（v0.5 新增/修改）

```text
shared/
  chatTts.ts                              # ChatUiMessage 升级为联合类型，新增 thinking 角色
  supervisorEvents.ts                     # SupervisorEventEnvelope + 7 种事件 type 强类型
  __tests__/{chatTts,supervisorEvents}.test.ts

server/
  asr/
    asrConfig.ts                          # ✨ 新建：DEFAULT_ASR_MODEL + parseLanguageHints + buildRunTaskMessage
    asrStreamSocket.ts                    # 改造为复用 asrConfig
    __tests__/asrConfig.test.ts
  agent/
    supervisor/
      supervisorEventBus.ts               # ✨ 新建：进程内 per-requestId emitter
      runSupervisorStreaming.ts           # ✨ 新建：包装 stream() 调用
      supervisorStreaming.ts              # ✨ 新建：publishEventsFromUpdates
      supervisorSseRouter.ts              # ✨ 新建：Express SSE 端点
      __tests__/{supervisorEventBus,supervisorStreaming,supervisorSseRouter}.test.ts
    smartAgentApp.ts                      # 增 chatStreaming 方法
  routers.ts                              # chat.sendMessage input 加可选 requestId，转 chatStreaming
  routers/supervisorChatRouter.ts         # input 加可选 requestId
  _core/index.ts                          # 挂载 SSE 路由 /api/supervisor/stream

client/src/
  hooks/
    useSupervisorStream.ts                # ✨ 新建：EventSource 封装 hook
    __tests__/useSupervisorStream.test.ts
  components/
    cockpit/
      ThinkingBubble.tsx                  # ✨ 新建：思考气泡三态组件
      AssistantPanel.tsx                  # 渲染 thinking 角色
      __tests__/ThinkingBubble.test.tsx
    airi-stage/
      AiriStageContainer.tsx              # 加 viewMode/framingRatio props
  lib/airi-stage/
    framing.ts                            # ✨ 新建：computeFraming 纯函数
    __tests__/framing.test.ts
  pages/Cockpit.tsx                       # 集成 thinking 流：requestId/订阅/状态机；默认半身

vitest.config.ts                          # 加 react plugin，纳入 client / shared 测试

文档（docx/优化计划/）
  REPO_ANALYSIS_V0.5.md                   # P1 仓库分析 + 用户故事拆解
  ARCHITECTURE_V0.5.md                    # P2 架构设计 + 数据流图
  INTERFACE_DESIGN_V0.5.md                # P3 接口与数据结构
  TESTING_V0.5.md                         # P6 测试报告
  CLAUDE_V0.5.md                          # P7 知识沉淀（本文件）
  PROJECT_STATUS_V0.5.md                  # 阶段进度看板
  screenshots/v0.5_thinking_bubble_states.webp  # 视觉验证
```

---

## 4. 第二批迭代的入手点

### 4.1 Omni 端到端语音
- 入口：在 `client/src/lib/` 新建 `omniRealtimeClient.ts`（DashScope WebSocket）
- 后端：在 `server/_core/index.ts` 加临时 Token 颁发端点 `/api/omni/token`（避免暴露 API Key）
- UI：Cockpit 顶部加 Toggle，开启时旁路 ASR/Supervisor/TTS 完整链路
- 不要破坏：现有 ASR/Supervisor 链路保留为默认路径

### 4.2 OfficeAgent（飞书）
- 在 `mcp-config.json` 加 `@larksuiteoapi/lark-mcp` server 配置（本地 stdio）
- 新建 `server/agent/domains/officeAgent.ts`（参考 navigationAgent.ts 模板）
- 在 `server/agent/smartAgentApp.ts` 的 `AGENT_MODULE_LOADERS` 注册
- 在 `server/agent/supervisor/classifyNode.ts` 的 `CLASSIFY_SYSTEM_PROMPT` 加 `office` 域

### 4.3 ServiceAgent（订餐）+ NavigationAgent 增强（行程）
- 行程：在 `navigationAgent` 的 toolNames 加 `generate_itinerary`，配套 `server/mcp/itineraryTools.ts`
- 订餐：新建 `server/agent/domains/serviceAgent.ts` + `server/mcp/serviceTools.ts`（先 Mock）
- 跨域：用 `cross_domain` 让 navigationAgent → officeAgent 串行（已有 inputMapping/dependsOn 机制）

### 4.4 跨域 Demo 防御性设计（已规划，第二批落地）
- OfficeAgent system prompt 加硬性指示："存在前置导航行程时，必须把行程摘要作为消息正文"
- `im.v1.message.create` 工具调用前加拦截器：检测到跨域行程任务 + 消息内容过短，自动拼接 `stepResults[navigationAgent].output`

---

## 5. 已知技术债（按 v0.4 → v0.5 继承）

1. `pnpm check` 报 `server/memory/*` 等 ES2022 / iterator / regex flag 错误：v0.4 遗留，建议在第二批一次性清理（升级 tsconfig target）
2. `server/chat.test.ts` 依赖 PostgreSQL：建议加测试 docker-compose 或 testcontainers
3. 前端 build chunk size warning：>500kb chunks，第二批可拆分动态 import

---

## 6. system-dev 流程沉淀（给后续 AI 协作者参考）

### 6.1 七阶段实操体感
- **P1 仓库分析**：必须先把 ARCHITECTURE.md 和关键 router/agent 文件粗读一遍，再写 user story；user story 必须带机器可验证 AC
- **P2 架构**：sequence + flowchart 双图，明确"哪些不改"比"哪些要改"更重要
- **P3 接口**：把 TS 类型与函数签名直接落到代码字符串级别，第 4 阶段几乎是抄作业
- **P4 TDD**：严格 RED→GREEN→REFACTOR；前端 jsx 测试需要 vitest plugin react，提前确认基础设施
- **P5 反思**：检查 user story 是否真"被使用"（例：viewMode 写好但 Cockpit 没传，就是漏掉）
- **P6 测试报告**：必给基线对照表，让评审能 5 秒看完稳定性
- **P7 知识沉淀**：本文件就是给下一轮 AI 看的，决策原因 > 决策结论

### 6.2 沙箱限制下的 Demo 截屏策略
当真实服务依赖（数据库、OAuth、Live2D 资源）在沙箱跑不通时，三步策略：
1. 优先：起 dev 服务直接跑 → 若失败转 2
2. 次选：vite preview + mock env → 若仍受 OAuth 等阻塞转 3
3. 兜底：写隔离 demo HTML（Tailwind CDN + 静态数据复刻 UI），用于"视觉验证"，不替代功能验证

### 6.3 Git 提交节奏
每个用户故事完成（含测试通过）就 commit 一次，commit message 必含：
- 阶段编号 / 故事编号
- 改动文件分类（新增 / 修改 / 测试）
- 测试基线变化（"63 文件 756 通过 +7"）
- 重要决策（"不改 LangGraph 节点"）

---

## 7. 联系/责任

- 仓库：https://github.com/yangli0403/SmartAgent4 (分支 `demo_0423`)
- 主要文档目录：`docx/优化计划/`
- 本轮迭代由 Manus（system-dev v0.8 流程）完成
