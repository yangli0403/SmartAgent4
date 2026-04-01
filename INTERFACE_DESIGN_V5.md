# SmartAgent4 第五轮迭代：接口与数据结构设计文档

**作者**: Manus AI  
**日期**: 2026 年 4 月 1 日  
**迭代**: Phase 9 — 借鉴 Claude Code 源码的工程化优化

---

## 1. 记忆系统后台 "做梦" 机制 (autoDream)

### 1.1 Worker 消息协议

在主进程与 Worker 线程之间，通过消息传递进行通信。

```typescript
// server/memory/worker/types.ts

export type MemoryWorkerTaskType = "consolidate" | "predict";

export interface MemoryWorkerRequest {
  taskId: string;
  type: MemoryWorkerTaskType;
  userId: number;
  // 传递给 Worker 的额外上下文
  context?: Record<string, unknown>;
}

export interface MemoryWorkerResponse {
  taskId: string;
  success: boolean;
  result?: any; // ConsolidationResult 或预测结果
  error?: string;
  durationMs: number;
}
```

### 1.2 触发门控状态

在主进程中维护用户的会话状态，用于复合触发门控。

```typescript
// server/memory/worker/gatekeeper.ts

export interface UserSessionState {
  userId: number;
  messageCountSinceLastDream: number;
  lastDreamTime: number;
  isDreaming: boolean;
}

export interface GatekeeperConfig {
  messageThreshold: number; // 触发做梦的消息数量阈值（如 5）
  timeThresholdMs: number;  // 触发做梦的时间阈值（如 6 小时）
}
```

## 2. 多智能体协同 Fork 子代理模式

### 2.1 Fork 上下文与委托请求

扩展现有的 `DelegateRequest`，引入 `ForkContext`。

```typescript
// server/agent/discovery/types.ts (修改)

export interface ForkContext {
  /** 父代理的对话历史（用于共享背景知识） */
  conversationHistory: Array<{ role: string; content: string }>;
  /** 父代理的缓存标识（如 Prompt Cache ID，视 LLM 适配器支持情况而定） */
  cacheId?: string;
  /** 共享的用户上下文 */
  userContext: Record<string, unknown>;
}

export interface DelegateRequest {
  capability: string;
  task: string;
  context?: Record<string, unknown>;
  depth?: number;
  /** 新增：Fork 上下文，如果提供，则子代理将继承这些状态 */
  forkContext?: ForkContext;
  /** 新增：是否异步执行（触发事件通知） */
  async?: boolean;
}
```

### 2.2 事件通知机制

定义子代理完成任务后触发的事件结构。

```typescript
// server/agent/events/types.ts

export interface TaskCompletedEvent {
  taskId: string;
  agentId: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

// 在 Supervisor 或主代理中监听
// eventEmitter.on('taskCompleted', (event: TaskCompletedEvent) => { ... });
```

## 3. Prompt Caching 动态信息分离

### 3.1 动态信息载荷

修改 `DynamicPromptAssembler` 的接口，使其返回结构化的消息对象，而不是纯字符串。

```typescript
// server/agent/discovery/types.ts (修改)

export interface DynamicPromptPayload {
  /** 静态的 System Prompt（规则、角色等） */
  staticSystemPrompt: string;
  /** 动态的 Agent 列表和工具描述（作为独立的 Message） */
  dynamicContentMessage: {
    role: "system" | "user";
    content: string;
  };
}

export interface IDynamicPromptAssembler {
  // 原有方法保留以兼容旧代码
  buildClassifyPrompt(): string;
  buildPlanPrompt(): string;
  
  // 新增：返回分离的 Prompt 载荷
  buildSeparatedClassifyPrompt(): DynamicPromptPayload;
  buildSeparatedPlanPrompt(): DynamicPromptPayload;
}
```

### 3.2 消息组装示例

在 `classifyNode.ts` 和 `planNode.ts` 中，将载荷组装为 LangChain 的 Message 数组。

```typescript
// 示例组装逻辑
const payload = assembler.buildSeparatedClassifyPrompt();

const messages: BaseMessage[] = [
  new SystemMessage(payload.staticSystemPrompt),
  // 将动态信息作为独立的 SystemMessage 或 UserMessage 插入
  new SystemMessage(payload.dynamicContentMessage.content),
  // ... 用户历史消息
  new HumanMessage(userText)
];
```

## 4. 总结

本阶段定义了第五轮迭代所需的核心接口和数据结构。Worker 消息协议确立了主进程与后台任务的通信边界；`ForkContext` 和事件机制为子代理的异步、共享上下文执行提供了基础；`DynamicPromptPayload` 则实现了静态规则与动态数据的物理分离，为提升 Prompt Caching 命中率铺平了道路。下一步将进入 TDD 实现阶段。
