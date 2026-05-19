# SmartAgent4 主动推荐与记忆召回逻辑分析报告

## 1. 现象与问题描述

根据用户反馈及提供的截图，系统在执行车控等操作时出现了两个不符合预期的现象：

1.  **主动推荐未触发**：用户连续进行了三次同类型操作（“空调 24 度，关大灯，放白噪音”），按照预期设计，应该触发主动场景命名推荐（如“发现高频操作，建议创建午睡模式”），但实际并未触发。
2.  **不合理的记忆召回**：用户执行的是单纯的车控操作，但思考面板显示“召回 4 条相关记忆”，并在最终回复中强行关联了用户的地域偏好（“贵州人，喜欢吃辣的，喜欢喝拿铁咖啡”），导致回复内容显得生硬且不合理。

## 2. 根因分析

经过对代码库的深入排查，发现这两个问题分别由执行引擎的重构遗漏和记忆注入机制的缺陷导致。

### 2.1 主动推荐未触发的原因：并行执行引擎的遗漏

在 SmartAgent4 的架构演进中，执行引擎从串行（`executeNode.ts`）升级到了并行（`parallelExecuteEngine.ts`），并引入了新的 `AgentCardRegistry`。

1.  **旧版逻辑（串行）**：在 `executeNode.ts` 中，当一个步骤成功执行后，会明确调用 `recordDeterministicActionPatterns` 来记录确定性行为模式，并累加频率。
2.  **新版逻辑（并行）**：在 `supervisorGraph.ts` 中，系统优先使用 `createParallelExecuteNode`。然而，在 `parallelExecuteEngine.ts` 的 `executeStep` 函数中，**完全遗漏了对 `recordDeterministicActionPatterns` 的调用**。
3.  **结果**：由于车控操作走的是新的并行执行引擎，其执行结果并未被记录到 `behavior_patterns` 表中。频率无法累加，自然也就无法达到触发 `checkAndPublishProactiveSuggestion` 的阈值（frequency >= 3）。

### 2.2 记忆召回不合理的原因：无差别广播与强行注入

当前的记忆检索和注入机制存在“过度热心”的问题，缺乏基于任务领域的过滤。

1.  **无差别检索与预取**：
    *   在 `contextEnrichNode.ts` 中，系统会在对话开始时进行记忆检索（`getFormattedMemoryContext`）。
    *   虽然有 `makePreRetrievalDecision`（规则+轻量 LLM 判断是否需要检索），但如果 LLM 判断失误或降级，依然会拉取大量偏好记忆。
2.  **无差别广播给所有 Agent**：
    *   在 `parallelExecuteEngine.ts` 中，提取到的 `retrievedMemories` 会被**无条件地**放入 `AgentExecutionInput` 中，传递给所有被调用的领域 Agent（包括车控、多媒体等）。
3.  **强行注入回复生成**：
    *   在 `respondNode.ts` 中，无论当前任务是什么类型，只要 `retrievedMemories` 存在，就会被打包进最终的 Prompt 中，甚至加上了类似“请在回复中参考”的强制性指令。
    *   这导致即使是简单的车控任务，LLM 也会因为 Prompt 的引导，强行将召回的地域偏好（贵州人）和饮食偏好与车控结果拼接在一起，产生荒谬的回复。

## 3. 修复方案建议

针对上述问题，提出以下修改方案：

### 3.1 修复主动推荐（P0）

需要在并行执行引擎中补齐行为模式记录的逻辑。

**修改文件**：`/home/ubuntu/SmartAgent4/server/agent/discovery/parallelExecuteEngine.ts`

**修改内容**：
1.  导入 `recordDeterministicActionPatterns`。
2.  在 `executeStep` 函数中，当 `output.success` 为 `true` 时，异步调用该函数记录行为。

```typescript
// 1. 顶部导入
import { recordDeterministicActionPatterns } from "../../memory/deterministicBehaviorAggregator";

// 2. 在 executeStep 内部的成功分支添加：
const output = await agent.execute(input);

if (output.success) {
  const numericUserId = context?.userId ? parseInt(context.userId, 10) : NaN;
  if (!Number.isNaN(numericUserId)) {
    // 异步记录行为模式，不阻塞主流程
    recordDeterministicActionPatterns({
      userId: numericUserId,
      userText: userMessage,
      step,
      result: {
        stepId: step.id,
        status: "success",
        output: output.output,
        toolCalls: output.toolCalls,
        durationMs: Date.now() - startTime,
      },
    }).catch((e) =>
      console.warn(
        "[ParallelExecuteEngine] deterministic behavior aggregation failed:",
        (e as Error).message
      )
    );
  }
}
```

### 3.2 优化记忆召回与注入（P1）

需要将无差别的记忆广播改为按需、按领域注入，避免简单指令被无关偏好污染。

**修改方案 A：在检索前决策层（Pre-Retrieval）增强规则（推荐）**

**修改文件**：`/home/ubuntu/SmartAgent4/server/memory/preRetrievalDecision.ts`

**修改内容**：在 `CHITCHAT_PATTERNS` 中扩展高频工具指令的正则，或者新增一个 `TOOL_COMMAND_PATTERNS`，对于明确的车控、设备控制指令，直接返回 `NO_RETRIEVE`。

```typescript
// 扩展 CHITCHAT_PATTERNS 或新增
const TOOL_COMMAND_PATTERNS: RegExp[] = [
  // 车控/设备控制指令
  /^(帮我)?(打开|关闭|开启|调到|设置).{0,10}(空调|大灯|车窗|座椅|温度|风量)/i,
  /^(空调|大灯|车窗).{0,10}(打开|关闭|调到|设置)/i,
];

// 在 ruleBasedDecision 中增加判断：
for (const pattern of TOOL_COMMAND_PATTERNS) {
  if (pattern.test(trimmed)) {
    return {
      decision: "NO_RETRIEVE",
      reason: `规则层命中设备控制指令，无需记忆检索`,
    };
  }
}
```

**修改方案 B：在 RespondNode 中降低记忆注入的强制性**

**修改文件**：`/home/ubuntu/SmartAgent4/server/agent/supervisor/respondNode.ts`

**修改内容**：根据任务分类（`classification.domain`）动态决定是否在 Prompt 中强调记忆。如果 domain 是 `vehicle_control` 或 `device_control`，且用户没有明确询问个人偏好，则不在回复 Prompt 中强制要求结合记忆。

## 4. 总结

当前的异常现象主要是架构升级过程中的逻辑遗漏（并行引擎未接入行为记录）以及记忆系统缺乏领域隔离（过度检索和注入）共同导致的。通过在并行引擎补齐记录逻辑，并在检索前置规则中过滤明确的控制指令，可以有效解决这两个问题，提升用户体验。
