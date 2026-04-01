# SmartAgent4 第五轮迭代：架构设计文档

**作者**: Manus AI  
**日期**: 2026 年 4 月 1 日  
**迭代**: Phase 9 — 借鉴 Claude Code 源码的工程化优化

---

## 1. 架构设计目标

本轮迭代的架构设计旨在解决 SmartAgent4 在主进程阻塞、Token 消耗过高以及缓存命中率低等工程化痛点。通过借鉴 Claude Code 的成熟经验，我们将对现有架构进行三项关键升级：

1. **引入 Worker 线程处理后台任务**：实现非阻塞的记忆整合与意图预测。
2. **实现 Fork 子代理模式**：优化多智能体协同，共享上下文缓存并引入事件通知。
3. **分离动态 Prompt 信息**：提高大模型 Prompt Caching 命中率。

## 2. 核心模块架构设计

### 2.1 记忆系统后台 "做梦" 机制 (autoDream)

**设计思路**：
将原本在主进程中通过 `setInterval` 触发的 `consolidateMemories` 和 `runPredictionCycle` 任务，迁移至独立的 Node.js Worker 线程中执行。

**架构组件**：
- **`MemoryWorkerManager`**：负责管理 Worker 线程的生命周期，接收主进程的任务触发信号。
- **`MemoryWorker`**：独立的执行环境，包含数据库连接和 LLM 调用逻辑，专门处理耗时的记忆整合和预测任务。
- **复合触发门控**：
  - **时间门控**：保留原有的定时触发机制（如每 6 小时）。
  - **会话门控**：监听用户的对话次数，当某个用户的对话达到一定阈值（如 5 次）且系统处于空闲状态时，主动触发该用户的记忆整合。
- **权限降级**：在 Worker 线程中，禁用对敏感工具（如文件系统写操作、网络请求等）的调用权限，确保后台任务的安全性。

**数据流向**：
1. 主进程（`MemoryCron` 或事件监听器）检测到触发条件满足。
2. 主进程向 `MemoryWorkerManager` 发送任务指令（包含 `userId` 和任务类型）。
3. `MemoryWorkerManager` 将任务分配给空闲的 `MemoryWorker`。
4. `MemoryWorker` 执行任务，完成后将结果写入数据库，并向主进程发送完成通知。

### 2.2 多智能体协同 Fork 子代理模式

**设计思路**：
重构 `baseAgent.ts` 中的 `delegate()` 方法，使其不再是简单的同步调用，而是创建一个继承父代理上下文的子代理实例，并通过事件机制进行异步通知。

**架构组件**：
- **`ForkContext`**：在 `DelegateRequest` 中新增的上下文共享句柄，包含父代理的对话历史、已缓存的 Prompt ID 等信息。
- **`ForkedAgent`**：子代理的执行实例，它在初始化时会加载 `ForkContext`，从而复用父代理的背景知识，减少 Token 消耗。
- **事件驱动通知**：
  - 引入 `EventEmitter` 或类似机制。
  - 子代理执行完毕后，不再通过 `Promise.all` 阻塞返回，而是触发一个 `TaskCompleted` 事件。
  - 主代理（Supervisor）监听该事件，收到通知后更新状态并决定下一步行动。

**数据流向**：
1. 主代理在执行过程中决定委托任务，构造包含 `ForkContext` 的 `DelegateRequest`。
2. 注册表根据能力标签找到目标子代理，并初始化 `ForkedAgent`。
3. `ForkedAgent` 继承上下文开始执行，主代理继续处理其他非依赖任务（或等待事件）。
4. `ForkedAgent` 完成任务，触发 `TaskCompleted` 事件，附带执行结果。
5. 主代理收到事件，整合结果。

### 3.3 Prompt Caching 动态信息分离

**设计思路**：
将 `DynamicPromptAssembler` 生成的动态 Agent 列表和工具描述从 System Prompt 中剥离，作为独立的 User Message 或 System Message（附件形式）传入 LLM。

**架构组件**：
- **静态 System Prompt**：`classifyNode.ts` 和 `planNode.ts` 中的 System Prompt 仅保留固定不变的规则指令、角色设定和输出格式要求。
- **动态信息载荷**：`DynamicPromptAssembler` 生成的动态内容（Agent 列表、工具描述等）被封装为一个独立的消息对象（如 `SystemMessage` 的附加内容或特定的 `UserMessage`）。
- **消息组装逻辑**：在调用 LLM 之前，将静态 System Prompt 和动态信息载荷按特定顺序组装。

**数据流向**：
1. `DynamicPromptAssembler` 收集当前注册表中的 Agent 和工具信息。
2. 组装器生成动态信息载荷。
3. 节点（如 `classifyNode`）获取静态 System Prompt 和动态信息载荷。
4. 节点将它们与用户输入组合成最终的消息列表发送给 LLM。
5. LLM 能够有效缓存静态 System Prompt，仅对动态信息载荷进行重新计算。

## 4. 总结

通过上述架构设计，SmartAgent4 将在第五轮迭代中实现显著的工程化提升。Worker 线程将释放主进程压力，Fork 子代理模式将优化多智能体协同的效率和 Token 消耗，而 Prompt Caching 的优化将进一步降低 API 成本。这些改进为 SmartAgent4 迈向生产级应用奠定了坚实的基础。
