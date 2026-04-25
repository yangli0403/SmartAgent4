# SmartAgent4 v0.5 仓库分析与用户故事拆解（第 1 阶段交付物）

**作者**：Manus Agent
**日期**：2026-04-24
**目标分支**：`demo_0423`
**对应方案**：`docx/优化计划/SmartAgent4_Demo_v0.5_0424.md`（待并入）

---

## 1. 分析目标

本次代码迭代的目标是在不动摇现有 Supervisor / MCP / Memory 主架构的前提下，实施 v0.5 Demo 方案的 **第一批四项改动**：

| 编号 | 改动项 | 影响层 | 复杂度 |
|---|---|---|---|
| ① | 方言 ASR 模型切换至 `qwen3-asr-flash`（支持 22 种方言） | 后端 ASR | 低 |
| ② | AIRI 虚拟人新增半身（halfBody）展示模式 | 前端 Stage | 低 |
| ③ | 可视化思考"对话内嵌"气泡（"Metris Agent 思考中..."） | 前端聊天 + 共享类型 | 中 |
| ④ | Supervisor 流式事件后端改造（步骤/工具调用增量推送） | 后端 tRPC subscription + Supervisor Graph 监听 | 中 |

剩余四项（Omni 端到端语音、新闻 Agent、飞书 OfficeAgent、订餐 ServiceAgent）按用户决策放到第二批迭代。

---

## 2. 当前代码资产盘点（聚焦四项改动相关）

### 2.1 后端关键文件
| 路径 | 行数 | 与本次迭代关系 |
|---|---|---|
| `server/asr/asrStreamSocket.ts` | 236 | 包含 `DEFAULT_MODEL = "fun-asr-realtime"` 常量与 DashScope WebSocket 连接逻辑，是 ① 的唯一改动点 |
| `server/agent/supervisor/supervisorGraph.ts` | 274 | 暴露 `runSupervisor(...)` 与 `SupervisorOutput`，本次需要新增并行的"流式 yield" 模式 |
| `server/agent/supervisor/state.ts` | — | 已结构化 `PlanStep / StepResult / ToolCallRecord / ReplanDecision`，前端展示直接复用，无需改 schema |
| `server/routers/supervisorChatRouter.ts` | 164 | 当前仅 `mutation` 同步返回最终结果；需要新增 `subscription` 用于 ④ |
| `server/agent/supervisor/{classify,plan,execute,replan}Node.ts` | — | 节点已经在 console.log 里输出阶段信息，可挂事件 hook 不动业务逻辑 |

### 2.2 前端关键文件
| 路径 | 行数 | 与本次迭代关系 |
|---|---|---|
| `client/src/components/airi-stage/AiriStageContainer.tsx` | 260 | 当前 `model.scale.set(scaleVal)` 与 `model.y = height * 0.92` 是固定全身策略；需要新增 `viewMode` prop 支撑 ② |
| `client/src/components/AIChatBox.tsx` | 336 | 仅识别 `role: "user" | "assistant"`，需要扩展至支持 `thinking` 类型气泡（③） |
| `client/src/pages/Cockpit.tsx` | 486 | 整合 AIRI 舞台 + 聊天 + 麦克风 + Mutation；需要在 ④ 落地后从 mutation 切换为 subscription/SSE |
| `client/src/components/cockpit/AssistantPanel.tsx` | — | 同样基于 `ChatUiMessage[]`，会跟随 ③ 一起升级 |
| `shared/chatTts.ts` | — | 定义 `ChatUiMessage`，③ 需在此扩展 `thinking` 字段或新增联合类型 |

### 2.3 测试资产盘点（基线）
- 测试框架：**Vitest 2.1.9**，配置文件 `vitest.config.ts`（服务端）/ `vitest.client.config.ts`（前端 jsdom）
- 现有测试：**46 个测试文件、654 个用例**
- 基线运行结果（沙箱 `pnpm test`）：**45 个文件通过 / 1 失败（`server/chat.test.ts`，3 个用例）**
- 失败原因：沙箱未启动 MySQL，`saveConversation` 写入失败，**与本次 v0.5 改动无关**，将记录为已知遗留项
- 目录结构：测试与被测代码同目录共存（`*.test.ts(x)`）+ 顶层 `tests/`、`server/agent/__tests__/`、`client/src/lib/airi-stage/__tests__/`

---

## 3. v0.5 用户故事（按 Schema → 后端 → UI 依赖排序）

> 粒度遵循 system-dev v0.8：每个故事可在单个子代理上下文窗口内完成，并附机器可验证的验收标准。

### US-1：扩展 ChatUiMessage 共享类型支持思考气泡
- **作为** 全栈架构
- **我希望** `ChatUiMessage` 能表达三种角色：`user / assistant / thinking`，并在 `thinking` 角色下携带 `phase`、`summary`、`detail`、`status` 四个字段
- **以便** 前后端共用同一份消息形状，避免散布私有 DTO

**验收标准**
- AC1：`shared/chatTts.ts` 新增 `ChatThinkingDetail` 与 `ChatUiThinkingMessage` 类型，并合并入 `ChatUiMessage` 联合类型
- AC2：`tsc --noEmit` 通过
- AC3：`shared/__tests__/chatTts.test.ts` 新增至少 3 个用例覆盖联合类型 narrowing

### US-2：方言 ASR 模型升级（Qwen3-ASR-Flash）
- **作为** 后端 ASR 网关
- **我希望** 通过环境变量 `DASHSCOPE_ASR_MODEL` 指定 ASR 模型，默认值升级为 `qwen3-asr-flash` 并在 init 帧自动开启方言识别
- **以便** 用户用方言/口音说话也能被准确识别

**验收标准**
- AC1：`server/asr/asrStreamSocket.ts` 默认模型变更为 `qwen3-asr-flash`，并支持环境变量覆盖
- AC2：连接握手后下发的 `run-task` 帧 `parameters.language` 设为 `"auto"`（或文档要求字段），保留对原 `fun-asr-realtime` 的回退能力
- AC3：新增 `server/asr/__tests__/asrStreamSocket.config.test.ts`，断言模型 ID 与默认参数；不依赖真实网络

### US-3：AIRI 半身展示模式（viewMode prop）
- **作为** 前端 Stage 组件
- **我希望** `AiriStageContainer` 支持 `viewMode: 'fullBody' | 'halfBody'` prop，halfBody 下放大缩放、下移锚点
- **以便** 在车机狭长屏幕上聚焦角色面部表情

**验收标准**
- AC1：组件新增 `viewMode` prop（默认 `fullBody`，向后兼容）
- AC2：`scale` 与 `model.y` 在 halfBody 下分别按系数 `1.6` 与 `height * 1.2` 计算，可被 `framingRatio` 二次覆盖
- AC3：新增 `client/src/components/airi-stage/__tests__/framing.test.ts` 覆盖两种 viewMode 的几何计算
- AC4：`Cockpit.tsx` 默认传入 `viewMode="halfBody"`，并在浏览器中肉眼可见角色被裁至腰部以上

### US-4：Supervisor 流式事件总线
- **作为** Supervisor 内部事件源
- **我希望** 提供一个 `runSupervisorStreaming(...)` 函数，在 `classify / plan / execute / replan / respond` 节点完成时通过回调实时 emit 结构化事件
- **以便** 上层 tRPC subscription 与前端可视化组件订阅

**验收标准**
- AC1：在 `server/agent/supervisor/supervisorGraph.ts` 旁新增 `supervisorEvents.ts` 定义 `SupervisorEvent` 联合类型（`classified / plan_ready / step_started / step_finished / replan / final`）
- AC2：`runSupervisorStreaming(input, onEvent)` 在不破坏现有 `runSupervisor` 行为的前提下并存
- AC3：新增 `server/agent/supervisor/__tests__/supervisorEvents.test.ts`，使用桩节点验证事件顺序与字段

### US-5：tRPC Subscription 暴露思考事件
- **作为** 后端 tRPC 路由
- **我希望** 在 `supervisorChatRouter` 增加 `streamMessage` subscription（基于 `observable`），把 US-4 的事件转发给前端，最后再 emit `final` 与原有 `mutation` 的返回值字段对齐
- **以便** 前端获得增量"思考"流，同时仍保留 `sendMessage` mutation 兼容旧前端

**验收标准**
- AC1：新增 `streamMessage` subscription，输入与 `sendMessage` 一致
- AC2：subscription 完成时仍持久化对话（与 mutation 行为一致）
- AC3：新增 `server/routers/__tests__/supervisorChatStream.test.ts`，使用 mock supervisor 验证 yield 顺序与最终持久化

### US-6：前端思考气泡（Metris Agent 思考中...）
- **作为** 前端聊天面板
- **我希望** 在 `AIChatBox` 与 `AssistantPanel` 中渲染 `thinking` 类型消息：折叠时只显示一行摘要（带"Metris Agent 思考中..."品牌前缀），展开时按时间轴显示步骤、工具调用与重规划
- **以便** 复杂任务下用户能感知 Agent 的推理过程

**验收标准**
- AC1：新增 `client/src/components/cockpit/ThinkingBubble.tsx`
- AC2：`AIChatBox.displayMessages` 支持渲染 thinking 角色（无文本气泡样式，只渲染 `ThinkingBubble`）
- AC3：当订阅流推送 `final` 事件时，气泡变为已收起态（`status: 'completed'`），并在其下方追加正常 assistant 气泡
- AC4：新增 `client/src/components/cockpit/__tests__/ThinkingBubble.test.tsx` 覆盖折叠/展开/已完成三态渲染

### US-7：Cockpit 接入流式 + halfBody 默认
- **作为** 顶层页面
- **我希望** Cockpit 在 `arkDirectMode === false` 时默认走 `streamMessage` 订阅，并把流事件落到 `messages: ChatUiMessage[]` 中；同时把 AIRI 默认 `viewMode` 切到 `halfBody`
- **以便** 端到端把 ②③④ 串通

**验收标准**
- AC1：Cockpit 状态机正确处理 `subscribe -> incremental thinking -> final` 三类回调
- AC2：在沙箱里 `pnpm build` 通过、`pnpm check` 通过
- AC3：能在 Manus 沙箱启动 `pnpm dev`，截屏显示思考气泡 + 半身 AIRI

---

## 4. 任务依赖与排程（Schema → 后端 → UI）

```
US-1 (Schema)
  ├─► US-2 (后端 ASR)            ─────┐
  ├─► US-3 (前端 Stage)           ─────┤
  └─► US-4 (后端 Supervisor 事件) ─► US-5 (tRPC) ─► US-6 (UI气泡) ─► US-7 (Cockpit集成)
```

US-1/US-2/US-3 之间可并行；US-4 → US-5 → US-6 → US-7 形成关键路径。建议子代理分派：
- 子代理 A：US-1 + US-3
- 子代理 B：US-2
- 子代理 C：US-4 + US-5
- 子代理 D：US-6 + US-7（必须等 A、C 完成）

---

## 5. 已识别风险与决策记录

1. **数据库依赖测试**：基线 `server/chat.test.ts` 在沙箱中失败属环境问题，本次 v0.5 不引入新的数据库依赖，因此不修复，但会在 `TESTING.md` 中标注。
2. **tRPC subscription 传输**：当前项目 tRPC 客户端使用 HTTP，subscription 需要 `httpSubscriptionLink`/SSE，存在前后端 link 配置变更；如发现侵入性大，将退化为"发送 mutation 后通过独立 SSE 端点订阅事件"，避免改动 tRPC 客户端。
3. **真实 Live2D 资源**：halfBody 仅做几何裁剪，不依赖新模型资源；如果沙箱无法加载远端 Live2D，将以单元测试验证几何参数 + 静态截图说明。
4. **品牌词**：所有可视化思考气泡的提示文本统一为"Metris Agent 思考中..."。
5. **第二批迭代**：Omni / 新闻 / 飞书 / 订餐方向放到下一冲刺，本仓库分析不展开其用户故事。

---

## 6. 子任务状态跟踪

详见同目录 `PROJECT_STATUS_V0.5.md`（与本文件同时落地）。
