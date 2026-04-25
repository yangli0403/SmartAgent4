# SmartAgent v0.5 测试报告

> system-dev v0.8 第 6 阶段交付物
> 版本：v0.5 第一批改动（方言 ASR + AIRI 半身 + 可视化思考前端 + Supervisor 流式后端）
> 分支：`demo_0423`
> 日期：2026-04-24

---

## 1. 测试基线对照

| 指标 | v0.4 基线 | v0.5 当前 | 变化 |
|---|---|---|---|
| Test Files（通过） | 45 | **63** | +18 |
| Test Files（失败） | 1 | 1 | 不变 |
| Tests（通过用例） | 651 | **756** | **+105** |
| Tests（失败） | 3 | 3 | 不变 |
| 前端 `pnpm build` | ✅ | ✅ | — |

**说明**：唯一持续失败的 `server/chat.test.ts` 是基线已存在的环境问题（沙箱无 PostgreSQL/MySQL 实例），与 v0.5 改动**完全无关**。所有 v0.5 新增测试 100% 通过。

---

## 2. v0.5 新增/修改测试清单

| 用户故事 | 测试文件 | 新增用例数 | 通过 |
|---|---|---|---|
| US-1 共享类型扩展 | `shared/__tests__/chatTts.test.ts` | 3 | ✅ |
| US-1 共享类型扩展 | `shared/__tests__/supervisorEvents.test.ts` | 3 | ✅ |
| US-2 方言 ASR | `server/asr/__tests__/asrConfig.test.ts` | 5 | ✅ |
| US-3 AIRI 半身 | `client/src/lib/airi-stage/__tests__/framing.test.ts` | 4 | ✅ |
| US-4 事件总线 | `server/agent/supervisor/__tests__/supervisorEventBus.test.ts` | 5 | ✅ |
| US-5 Supervisor 流式 | `server/agent/supervisor/__tests__/supervisorStreaming.test.ts` | 3 | ✅ |
| US-5 SSE 端点 | `server/agent/supervisor/__tests__/supervisorSseRouter.test.ts` | 4 | ✅ |
| US-6 ThinkingBubble | `client/src/components/cockpit/__tests__/ThinkingBubble.test.tsx` | 4 | ✅ |
| US-7 useSupervisorStream | `client/src/hooks/__tests__/useSupervisorStream.test.ts` | 3 | ✅ |
| **合计** | 9 个测试文件 | **34 用例** | ✅ |

---

## 3. 测试基础设施变更

### 3.1 vitest.config.ts 升级

**新增能力**：
1. 通过 `environmentMatchGlobs` 把 `client/**` 与 `shared/**` 切换为 `jsdom` 环境，server 仍走 `node`
2. 通过 `include` 把 `client/src/**/__tests__/**/*.test.{ts,tsx}` 与 `shared/__tests__/**/*.test.ts` 纳入运行集
3. 引入 `@vitejs/plugin-react`，让 `.tsx` 文件支持 JSX automatic runtime
4. `coverage.include` 增加 v0.5 关键模块作为覆盖统计目标

### 3.2 setup.ts 复用

继续使用既有 `client/src/__tests__/setup.ts`（导入 `@testing-library/jest-dom`、Mock `import.meta.env`），无需改动。

---

## 4. 关键改动的测试覆盖说明

### 4.1 方言 ASR（US-2）
通过将 `buildRunTaskMessage` 从 `asrStreamSocket.ts` 抽取到 `asrConfig.ts`，并暴露 `DEFAULT_ASR_MODEL` / `parseLanguageHints()` 可独立测试。覆盖：
- 默认模型升级到 `paraformer-realtime-v2`
- `language_hints` 默认值与环境变量覆盖
- `vocabulary_id` 可选字段
- task message JSON 序列化结构稳定性

### 4.2 AIRI 半身（US-3）
将 PIXI 缩放/锚点几何计算抽离为纯函数 `computeFraming(viewMode, modelW, modelH, viewW, viewH, ratio?)`：
- `fullBody`：缩放使模型完整入框，锚点 `(0.5, 1.0)`
- `halfBody`：默认 `framingRatio=1.7` 放大，锚点 `(0.5, 0.8)` 让头肩位于视窗中上
- 自定义 ratio 可覆盖默认比例
- 使用纯函数后无需启动 PIXI 即可测试

### 4.3 可视化思考前端（US-6/US-7）
- `ThinkingBubble`：4 用例覆盖三态文案、点击展开/折叠、details 渲染、failed 错误样式
- `useSupervisorStream`：3 用例覆盖 idle 不连接、事件聚合到 details、onerror 切 failed
- `EventSource` 通过 mock class 注入，避免真实网络

### 4.4 Supervisor 流式后端（US-4/US-5）
- `supervisorEventBus`：单例 + per-requestId emitter + 内存安全自动清理
- `runSupervisorStreaming`（`publishEventsFromUpdates`）：从 LangGraph update 提取 `taskClassification` / `plan` / `stepResults` 增量映射成事件，**桩 graph** 测试避免依赖真实 LLM
- `supervisorSseRouter`：4 用例覆盖参数缺失、事件转发、断连清理、心跳

---

## 5. 已知限制与遗留问题

### 5.1 沙箱端到端验证限制

由于 SmartAgent4 启动需要 PostgreSQL + GitHub OAuth 配置，沙箱中**无法直接以正常路径访问 Cockpit**。已通过两条路径验证：
1. **单元 + 集成测试**：34 个新增用例在 jsdom + node 双环境下全部通过
2. **隔离视觉验证**：用 Tailwind CDN 静态页复刻 ThinkingBubble 三态视觉，确认品牌词与排版对齐

视觉验证截图：`docx/优化计划/screenshots/v0.5_thinking_bubble_states.webp`（ThinkingBubble running 折叠/running 展开/completed/failed 四态全景）

### 5.2 基线遗留 TS / 测试问题

- `server/chat.test.ts`：依赖 PostgreSQL，沙箱跳过（基线已存在，与 v0.5 无关）
- `pnpm check` 报的 `server/memory/*` / `server/mcp/preRetrievalDecision.ts` 等 ES2022 / iterator 错误：v0.4 仓库遗留，**与 v0.5 改动无关**，未在本次修复

### 5.3 后续验证建议

第二批迭代（Omni / 新闻 / 飞书 / 行程 / 订餐）落地后，建议做一次**完整本地端到端联调**：
1. 起本地 PostgreSQL + 配置 .env
2. 真实方言音频文件回归 ASR（覆盖至少 3 种方言）
3. 配合飞书 MCP 自建应用测试 OfficeAgent 完整链路
4. 跨域 thinking 气泡的端到端事件序列

---

## 6. 验收 checklist

| 检查项 | 状态 |
|---|---|
| 第 4 阶段所有用户故事都有靶向测试 | ✅ |
| 新增测试 100% 通过 | ✅ |
| 全量回归测试只剩基线遗留失败 | ✅ |
| `pnpm build`（前端）通过 | ✅ |
| 关键 UI 状态有可视化截图 | ✅ |
| 测试基础设施改动（vitest jsx）已记录 | ✅ |
| 基线遗留问题已识别且不阻塞 | ✅ |
