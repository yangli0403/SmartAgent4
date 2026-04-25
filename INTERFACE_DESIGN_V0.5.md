# SmartAgent4 v0.5 接口与数据结构定义（第 3 阶段交付物）

**作者**：Manus Agent
**日期**：2026-04-24
**对应阶段**：system-dev v0.8 第 3 阶段
**前置文档**：`REPO_ANALYSIS_V0.5.md`、`ARCHITECTURE_V0.5.md`

本阶段为后续 TDD 实现（第 4 阶段）提供**代码级别的契约**：所有新增类型、函数签名、组件 Props、HTTP/SSE 端点、环境变量都以最终落盘形态定义。第 4 阶段子代理只需照此实现具体逻辑、不再发明新接口。

---

## 1. 共享类型（`shared/`）

### 1.1 `shared/chatTts.ts`（扩展 `ChatUiMessage`）

```ts
// 现有保留：ChatTtsStatus / ChatTtsSegmentDTO / ChatTtsPayload
export type ChatTtsStatus = "ready" | "skipped" | "failed";
export interface ChatTtsSegmentDTO { /* 不变 */ }
export interface ChatTtsPayload { /* 不变 */ }

// 新增：思考气泡相关 ===================================================

/** 思考阶段（与 supervisorEvents.ThinkingPhase 一致） */
export type ChatThinkingPhase =
  | "queued"          // 已发出请求、未收到首事件
  | "classified"      // classify 节点完成
  | "plan_ready"      // plan 节点产出 ExecutionPlan
  | "step_running"    // execute 节点：某 step 正在跑
  | "step_finished"   // execute 节点：某 step 完成
  | "replan"          // 触发了重新规划
  | "completed"       // 收到 final 事件
  | "error";          // 任一阶段失败

/** 单条思考事件细节（一条思考气泡内累积多条） */
export interface ChatThinkingDetail {
  phase: ChatThinkingPhase;
  /** 一句话摘要，用于折叠态展示，例：「正在调用 high_de.search_route」 */
  summary: string;
  /** 可选结构化负载，用于展开态时序详情 */
  payload?: Record<string, unknown>;
  /** UTC 时间戳（ms） */
  ts: number;
}

/** 思考气泡消息 */
export interface ChatUiThinkingMessage {
  role: "thinking";
  /** 与 mutation 关联的请求 ID（来自前端 crypto.randomUUID） */
  requestId: string;
  /** 顶层状态机：基于 details 中最新阶段计算 */
  status: "pending" | "running" | "completed" | "error";
  /** 当前折叠态摘要（一般取最新 detail.summary，可被 final 事件覆盖） */
  headline: string;
  /** 时间轴细节列表 */
  details: ChatThinkingDetail[];
  /** 起始 / 结束时间（ms） */
  startedAt: number;
  endedAt?: number;
}

/** 升级后的 ChatUiMessage 联合类型 */
export type ChatUiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tts?: ChatTtsPayload }
  | ChatUiThinkingMessage;
```

> 兼容性：现有渲染只识别 `assistant / user`，加判断时以 `msg.role === "thinking"` 早返回；不新增 `tts` 字段。

### 1.2 `shared/supervisorEvents.ts`（新增）

```ts
import type { ChatThinkingPhase } from "./chatTts";

/** Supervisor 事件标准信封（SSE / 进程内 EventBus 通用） */
export interface SupervisorEventEnvelope<P = unknown> {
  /** 关联请求 ID（前端生成、mutation 与 SSE 共用） */
  requestId: string;
  /** 监听者用于路由的事件类型 */
  type: SupervisorEventType;
  /** 与 ChatThinkingDetail.phase 一致，便于直接前端落盘 */
  phase: ChatThinkingPhase;
  /** UI 友好摘要 */
  summary: string;
  /** 结构化负载（不同 type 形状不同） */
  payload?: P;
  /** UTC 时间戳（ms） */
  ts: number;
}

export type SupervisorEventType =
  | "classified"
  | "plan_ready"
  | "step_started"
  | "step_finished"
  | "replan"
  | "final"
  | "error";

/** 各类型负载（用于子代理实现时的强类型） */
export interface ClassifiedPayload {
  domain: string;
  complexity: "simple" | "moderate" | "complex";
  reasoning: string;
}
export interface PlanReadyPayload {
  goal: string;
  steps: Array<{
    id: number;
    description: string;
    targetAgent: string;
    expectedTools: string[];
  }>;
}
export interface StepStartedPayload {
  stepId: number;
  description: string;
  targetAgent: string;
}
export interface StepFinishedPayload {
  stepId: number;
  status: "success" | "error" | "timeout" | "skipped";
  durationMs: number;
  toolCalls: Array<{ name: string; argsPreview?: string }>;
  outputPreview?: string;
}
export interface ReplanPayload {
  reason: string;
  newSteps: PlanReadyPayload["steps"];
}
export interface FinalPayload {
  response: string;
  classification: { domain: string; complexity: string };
  stepsExecuted: number;
  totalToolCalls: number;
  totalDurationMs: number;
}
export interface ErrorPayload {
  message: string;
  stage: ChatThinkingPhase;
}
```

---

## 2. 后端接口

### 2.1 `server/agent/supervisor/supervisorEvents.ts`（新增）

```ts
import { EventEmitter } from "events";
import type { SupervisorEventEnvelope } from "../../../shared/supervisorEvents";

/** 进程内 Supervisor 事件总线（单例） */
class SupervisorEventBus {
  private emitter = new EventEmitter();
  /** 默认上限够用，超过会触发 warning（生产可调到 100） */
  constructor() { this.emitter.setMaxListeners(50); }

  /** 发布事件：按 requestId 路由 */
  publish(env: SupervisorEventEnvelope): void {
    this.emitter.emit(env.requestId, env);
  }

  /** 订阅指定 requestId 的所有事件，返回取消函数 */
  subscribe(
    requestId: string,
    handler: (env: SupervisorEventEnvelope) => void
  ): () => void {
    this.emitter.on(requestId, handler);
    return () => this.emitter.off(requestId, handler);
  }

  /** 释放资源（默认进程退出时调用，不强制） */
  dispose(): void {
    this.emitter.removeAllListeners();
  }
}

export const supervisorEventBus = new SupervisorEventBus();
```

### 2.2 `server/agent/supervisor/supervisorGraph.ts`（新增 streaming 入口）

```ts
/**
 * 流式版本的 Supervisor 入口：在原有图执行的同时，
 * 通过 onEvent 把节点流转事件以 SupervisorEventEnvelope 的形式吐出。
 *
 * - 不改原有 runSupervisor 行为
 * - 内部使用 compiled.streamEvents() v2，监听 LangGraph chain 名称事件
 * - 节点完成判定基于 LangGraph 内置的 on_chain_end + 节点名映射
 */
export async function runSupervisorStreaming(
  input: SupervisorInput,
  agentSource: IAgentCardRegistry | AgentRegistry,
  onEvent: (env: SupervisorEventEnvelope) => void,
  meta: { requestId: string }
): Promise<SupervisorOutput>;
```

事件映射规则（落地依据 `references/phase4_steps/02_tdd_loop.md`）：

| LangGraph chain 名 | type | phase |
|---|---|---|
| `classifyNode` end | `classified` | `classified` |
| `planNode` end | `plan_ready` | `plan_ready` |
| `executeNode` step_started（自定义 hook） | `step_started` | `step_running` |
| `executeNode` step_finished（自定义 hook） | `step_finished` | `step_finished` |
| `replanNode` end | `replan` | `replan` |
| graph end | `final` | `completed` |
| 任意节点抛错 | `error` | `error` |

> step_started/step_finished 由 `runSupervisorStreaming` 内部从 `state.stepResults` 增量 diff 出，避免改 executeNode。

### 2.3 `server/agent/smartAgentApp.ts`（新增 chatStreaming）

```ts
/** 流式 chat：内部调 runSupervisorStreaming，会在 onEvent 上吐 envelope */
chatStreaming = traceable(
  async (
    userMessage: string,
    options: { /* 同 chat() */ },
    onEvent: (env: SupervisorEventEnvelope) => void,
    meta: { requestId: string }
  ): Promise<SupervisorOutput> => { /* ... */ },
  { name: "SmartAgent_Chat_Stream", run_type: "chain" }
);
```

### 2.4 `server/routers/supervisorChatRouter.ts`（扩展输入）

```ts
sendMessage: protectedProcedure
  .input(
    z.object({
      message: z.string().min(1),
      sessionId: z.number().nullable().optional(),
      /** v0.5 新增：若提供则启用流式事件总线 */
      requestId: z.string().min(8).max(64).optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    /* ...构建 input...  */
    const app = getSmartAgentApp();
    const result = input.requestId
      ? await app.chatStreaming(
          input.message,
          appOptions,
          (env) => supervisorEventBus.publish(env),
          { requestId: input.requestId }
        )
      : await app.chat(input.message, appOptions);
    /* ...保存对话、返回...  */
  });
```

> 不破坏旧客户端：未传 `requestId` 时走原 chat。

### 2.5 SSE 端点 `/api/supervisor/stream`

**请求**：
```
GET /api/supervisor/stream?requestId=<uuid>
Cookie: <已登录会话 cookie，浏览器自带>
Accept: text/event-stream
```

**响应**（伪示例）：
```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no

event: thinking
data: {"requestId":"abc","type":"classified","phase":"classified","summary":"任务被分类为导航·复杂","ts":1714000000000}

event: thinking
data: {"requestId":"abc","type":"plan_ready","phase":"plan_ready",...}

event: thinking
data: {"requestId":"abc","type":"step_started","phase":"step_running",...}

event: thinking
data: {"requestId":"abc","type":"final","phase":"completed",...}
```

新增模块 `server/_core/supervisorStream.ts`：

```ts
import type { Express, Request, Response } from "express";
import { supervisorEventBus } from "../agent/supervisor/supervisorEvents";

/** 注册 SSE 端点（在 /api/trpc 之前调用） */
export function registerSupervisorStream(app: Express): void;

/** 内部：单连接处理器（导出仅供测试） */
export function handleSupervisorStream(req: Request, res: Response): void;
```

**实现要点**：
- 鉴权：复用现有 cookie + `ensureUser` 逻辑（基于 `protectedProcedure` 同一 ctx 创建器）
- 心跳：每 15 秒发送 `: keep-alive\n\n`
- 关闭：收到 `final / error` 后 1s 关闭；客户端断开时立即 `unsubscribe`

### 2.6 ASR 模块变更

```ts
// server/asr/asrStreamSocket.ts —— 关键变更
const DEFAULT_MODEL = "qwen3-asr-flash"; // ← was "fun-asr-realtime"

function buildRunTaskMessage(taskId: string, model: string) {
  return {
    header: { /* 不变 */ },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model,
      parameters: {
        sample_rate: 16000,
        format: "pcm",
        // qwen3-asr-flash 默认开启方言识别
        language_hints: process.env.DASHSCOPE_ASR_LANGUAGE_HINTS
          ? process.env.DASHSCOPE_ASR_LANGUAGE_HINTS.split(",")
          : ["zh"],
      },
      input: {},
    },
  };
}
```

### 2.7 新增/复用环境变量

| 变量名 | 是否新增 | 默认值 | 用途 |
|---|---|---|---|
| `DASHSCOPE_ASR_MODEL` | 复用 | `qwen3-asr-flash` | 覆盖 ASR 模型 |
| `DASHSCOPE_ASR_LANGUAGE_HINTS` | 新增 | `zh` | 方言/语言提示，逗号分隔 |
| `SUPERVISOR_STREAM_HEARTBEAT_MS` | 新增 | `15000` | SSE 心跳间隔 |
| `SUPERVISOR_STREAM_MAX_LISTENERS` | 新增 | `50` | EventEmitter 上限 |

---

## 3. 前端接口

### 3.1 `client/src/components/airi-stage/AiriStageContainer.tsx`

```ts
type AiriViewMode = "fullBody" | "halfBody";

interface AiriStageContainerProps {
  enabled?: boolean;
  modelUrl?: string;
  className?: string;
  onModelLoaded?: () => void;
  onModelError?: (error: string) => void;
  /** v0.5 新增：默认 fullBody，向后兼容 */
  viewMode?: AiriViewMode;
  /** v0.5 新增：可选覆盖 framing 系数 */
  framingRatio?: number;
}

/** 抽出的几何工具，可独立测试 */
export function computeFraming(
  viewMode: AiriViewMode,
  containerWidth: number,
  containerHeight: number,
  modelWidth: number,
  modelHeight: number,
  override?: number
): { scale: number; x: number; y: number; anchorY: number };
```

`computeFraming` 行为契约（用于 `framing.test.ts`）：
- `fullBody`：保持现有公式 `Math.min(w/mw, h/mh) * 0.85`，`y = h * 0.92`，`anchorY = 1.0`
- `halfBody`：scale = fullBody.scale × 1.6（默认）；`y = h * 1.2`；`anchorY = 1.0`
- `override` 取值范围 `[0.5, 3.0]`，覆盖 1.6 系数

### 3.2 `client/src/components/cockpit/ThinkingBubble.tsx`（新增）

```ts
export interface ThinkingBubbleProps {
  message: ChatUiThinkingMessage;
  /** 默认折叠，点击展开 */
  defaultExpanded?: boolean;
  /** 测试钩子 */
  onToggle?: (expanded: boolean) => void;
}

/**
 * 三态视觉：
 * - status === "running": 灰色卡片 + 跳动点 + headline 一句话
 * - status === "completed": 浅紫色卡片 + 折叠图标 + headline
 * - status === "error": 红色卡片 + 错误图标 + 错误说明
 *
 * 文案：headline 折叠态以 "Metris Agent 思考中..." 起头（running 态）
 * 或 "Metris Agent 已完成思考" 起头（completed 态）
 */
export function ThinkingBubble(props: ThinkingBubbleProps): JSX.Element;
```

### 3.3 `client/src/hooks/useSupervisorStream.ts`（新增）

```ts
export interface SupervisorStreamHandle {
  /** 已收到的事件队列（按时间序，含 final） */
  events: SupervisorEventEnvelope[];
  /** 是否处于活动连接状态 */
  isActive: boolean;
  /** 主动关闭 */
  close: () => void;
}

/**
 * 启动一个对 /api/supervisor/stream?requestId=... 的 EventSource 订阅
 *
 * - 在收到 final / error 事件后自动关闭
 * - 组件 unmount 时自动 close
 * - useEffect 内创建，requestId 变更则销毁旧连接
 */
export function useSupervisorStream(
  requestId: string | null
): SupervisorStreamHandle;
```

### 3.4 `client/src/components/AIChatBox.tsx`

```ts
// 类型升级（保持文件名 / 导出名兼容）
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "thinking"; thinking: ChatUiThinkingMessage }; // 新增

// 渲染分支：
// - role === "system" → 仍然过滤
// - role === "thinking" → 渲染 <ThinkingBubble message={msg.thinking} />
// - 其它保持不变
```

### 3.5 `client/src/components/cockpit/AssistantPanel.tsx`

```ts
// 在 recentMessages.map 渲染分支增加：
{msg.role === "thinking" ? (
  <ThinkingBubble message={msg} />
) : msg.role === "assistant" ? (
  <AssistantMessage ... />
) : (
  <UserMessage ... />
)}
```

### 3.6 `client/src/pages/Cockpit.tsx`（接入流式）

伪流程（不展开实现细节，第 4 阶段补完）：

```ts
const [thinkingByRequestId, setThinkingByRequestId] = useState<Record<string, ChatUiThinkingMessage>>({});
const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
const stream = useSupervisorStream(activeRequestId);

// 1) 用户发送
const handleSend = (text: string) => {
  const requestId = crypto.randomUUID();
  setActiveRequestId(requestId);

  // 先插入 thinking 占位消息
  setMessages(prev => [
    ...prev,
    { role: "user", content: text },
    {
      role: "thinking",
      requestId,
      status: "pending",
      headline: "Metris Agent 思考中...",
      details: [],
      startedAt: Date.now(),
    },
  ]);

  // 再调用 mutation（带 requestId）
  sendMessageMutation.mutate({ message: text, sessionId, requestId });
};

// 2) stream.events 变化时合并到 thinking 消息
useEffect(() => {
  // 把最新事件合入对应 ChatUiThinkingMessage
  // 当 type === "final" 时，把 thinking.status 切到 "completed"，并 push assistant 消息
}, [stream.events]);

// 3) AIRI 默认 halfBody
<AiriStageContainer enabled={...} viewMode="halfBody" />
```

---

## 4. 测试契约（第 4 阶段子代理 RED 阶段使用）

### 4.1 ASR
- 文件：`server/asr/__tests__/asrStreamSocket.config.test.ts`
- 用例：
  - U-ASR-1：默认模型 ID = `qwen3-asr-flash`
  - U-ASR-2：环境变量 `DASHSCOPE_ASR_MODEL` 覆盖生效
  - U-ASR-3：`buildRunTaskMessage` 在新模型下含 `parameters.language_hints`

### 4.2 Stage
- 文件：`client/src/components/airi-stage/__tests__/framing.test.ts`
- 用例：
  - U-FR-1：`fullBody` 行为与现状一致（黄金值断言）
  - U-FR-2：`halfBody` scale = fullBody × 1.6、`y = h * 1.2`
  - U-FR-3：`override = 2.0` 时按系数计算
  - U-FR-4：极端值（width=0 / height=0）安全降级到 0 缩放

### 4.3 Supervisor 事件
- 文件：`server/agent/supervisor/__tests__/supervisorEvents.test.ts`
- 用例：
  - U-SE-1：`publish/subscribe` 按 requestId 隔离
  - U-SE-2：取消订阅后再 publish 不再触发 handler
  - U-SE-3：`runSupervisorStreaming` 在桩节点上发出 classified→plan_ready→step_started→step_finished→final 顺序

### 4.4 SSE 端点
- 文件：`server/_core/__tests__/supervisorStream.test.ts`
- 用例：
  - U-SSE-1：未提供 requestId 返回 400
  - U-SSE-2：心跳每 15s 发送一次
  - U-SSE-3：收到 final 事件后端正确关闭流

### 4.5 ChatUiMessage 联合类型
- 文件：`shared/__tests__/chatTts.test.ts`
- 用例：
  - U-CT-1：`role === "thinking"` 时 narrowing 后能访问 `details`
  - U-CT-2：`role === "assistant"` 时不可访问 `details`（编译期）
  - U-CT-3：JSON 序列化/反序列化往返一致

### 4.6 ThinkingBubble
- 文件：`client/src/components/cockpit/__tests__/ThinkingBubble.test.tsx`
- 用例：
  - U-TB-1：running 态渲染 "Metris Agent 思考中..." 文案
  - U-TB-2：completed 态渲染 "Metris Agent 已完成思考"
  - U-TB-3：点击折叠图标切换展开/收起

### 4.7 useSupervisorStream
- 文件：`client/src/hooks/__tests__/useSupervisorStream.test.tsx`
- 用例：
  - U-USS-1：requestId 变化时旧 EventSource 被关闭
  - U-USS-2：收到 final 事件后 isActive 转为 false
  - U-USS-3：jsdom 下 mock EventSource 注入回调正确累加 events

### 4.8 supervisorChatRouter（流式分支）
- 文件：`server/routers/__tests__/supervisorChatStream.test.ts`
- 用例：
  - U-SCR-1：未传 requestId 时走旧 chat 路径，行为不变
  - U-SCR-2：传 requestId 后调用 `chatStreaming`，事件被发布到 `supervisorEventBus`
  - U-SCR-3：仍写入 conversation 表（mock db）

---

## 5. 实施前的硬约束

1. **类型源单一**：所有 `SupervisorEvent*` 必须只在 `shared/supervisorEvents.ts` 定义，后端从 `../../../shared/...` 导入，前端从 `@shared/...` 导入。
2. **不改 LangGraph 节点**：禁止在 `classifyNode / planNode / executeNode / replanNode` 文件中加事件 emit；所有 emit 集中在 `supervisorGraph.ts` 的流式包装层。
3. **SSE 鉴权与 tRPC 一致**：复用 `protectedProcedure` 的 ctx；未登录或 cookie 失效返回 401。
4. **第 1 阶段已知失败用例**（`server/chat.test.ts`）维持不动；本次新增测试不引入新的 DB 依赖。
5. **品牌词**：所有用户可见文案统一使用 "Metris Agent"，避免 "AI/小智/智能助手" 出现在思考气泡 headline。

---

## 6. 第 4 阶段任务分派建议（与 REPO_ANALYSIS_V0.5.md US 对齐）

| 子代理 | 故事 | 主要落地文件 |
|---|---|---|
| A | US-1 (Schema) + US-3 (Stage 半身) | `shared/chatTts.ts`、`AiriStageContainer.tsx`、`framing.test.ts` |
| B | US-2 (方言 ASR) | `server/asr/asrStreamSocket.ts`、`asrStreamSocket.config.test.ts` |
| C | US-4 (Supervisor 事件) + US-5 (tRPC + SSE) | `supervisorEvents.ts`、`supervisorGraph.ts`、`smartAgentApp.ts`、`supervisorChatRouter.ts`、`supervisorStream.ts`、相关 tests |
| D | US-6 (ThinkingBubble) + US-7 (Cockpit 集成) | `ThinkingBubble.tsx`、`useSupervisorStream.ts`、`AIChatBox.tsx`、`AssistantPanel.tsx`、`Cockpit.tsx`、相关 tests |

子代理 A 与 B 可与 C 并行；D 需等 A 与 C 完成后启动。

---

## 7. 验收门（DoD）

- [x] 共享类型 / 后端类 / 前端组件 / Hook 全部具有可编译的最终签名
- [x] SSE 与 ASR 的 HTTP 行为以 request/response 样例形式定型
- [x] 测试契约逐条列出（24 条新用例）
- [x] 与第 2 阶段 ADR 对齐，无新决策遗漏
- [ ] 用户在检查点 3 确认（待用户回复）
