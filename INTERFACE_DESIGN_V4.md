# SmartAgent4 — 接口设计文档 V4（主动记忆引擎）

> **版本**：V4（主动记忆引擎迭代）  
> **日期**：2026-03-30

---

## 1. 新增核心数据结构

### 1.1 BehaviorPatternInput

行为模式检测器的输入数据结构，由 `memoryExtractionNode` 传递给 `behaviorDetector`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | `number` | 是 | 用户 ID |
| `conversationHistory` | `Array<{role: string; content: string}>` | 是 | 本轮对话历史 |
| `extractedMemories` | `ExtractedMemoryItem[]` | 否 | 本轮提取的记忆项（来自四层过滤管道） |
| `timestamp` | `string` | 是 | 对话发生的 ISO 时间戳 |

### 1.2 DetectedPattern

行为模式检测器的输出数据结构，对应 `behavior_patterns` 表的写入格式。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `patternType` | `string` | 是 | 模式类型：`schedule`（时间规律）/ `topic_preference`（话题偏好）/ `communication_style`（沟通风格）/ `task_habit`（任务习惯） |
| `description` | `string` | 是 | 模式的自然语言描述（如"用户通常在晚上 10 点后讨论技术话题"） |
| `confidence` | `number` | 是 | 置信度 (0.0-1.0)，LLM 输出 |
| `frequency` | `number` | 是 | 观察到的频次（新模式为 1，已有模式递增） |

### 1.3 PredictedIntent

意图预测引擎的输出数据结构。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | `number` | 是 | 用户 ID |
| `intent` | `string` | 是 | 预测的意图描述（如"用户可能需要查看明天的天气"） |
| `confidence` | `number` | 是 | 预测置信度 (0.0-1.0) |
| `suggestedQueries` | `string[]` | 是 | 建议的记忆检索查询（用于预取） |
| `reasoning` | `string` | 是 | 预测的推理过程 |
| `predictedAt` | `string` | 是 | 预测时间（ISO 格式） |
| `expiresAt` | `string` | 是 | 预测过期时间（ISO 格式，默认 +4h） |

### 1.4 PrefetchCacheEntry

上下文预取缓存的条目数据结构。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | `number` | 是 | 用户 ID |
| `predictedIntent` | `PredictedIntent` | 是 | 对应的意图预测结果 |
| `prefetchedMemories` | `Memory[]` | 是 | 预取的记忆列表（来自 hybridSearch） |
| `formattedContext` | `string` | 是 | 预格式化的上下文字符串（可直接注入 System Prompt） |
| `createdAt` | `number` | 是 | 缓存创建时间戳（ms） |
| `expiresAt` | `number` | 是 | 缓存过期时间戳（ms），默认 4 小时 |

## 2. 新增服务接口规范

### 2.1 IBehaviorDetector

行为模式检测器接口，负责从对话中识别用户行为模式。

| 方法 | 签名 | 说明 |
|------|------|------|
| `detectPatterns` | `(input: BehaviorPatternInput) => Promise<DetectedPattern[]>` | 分析对话，检测行为模式 |
| `persistPatterns` | `(userId: number, patterns: DetectedPattern[]) => Promise<number>` | 将检测到的模式写入 `behavior_patterns` 表，返回写入/更新数量 |
| `getUserPatterns` | `(userId: number, limit?: number) => Promise<BehaviorPattern[]>` | 获取用户的历史行为模式 |

**实现文件**：`server/memory/behaviorDetector.ts`

**LLM Prompt 设计**：

```
你是一个用户行为分析专家。请分析以下对话和用户记忆，识别出有统计意义的行为模式。

## 输出格式（JSON 数组）
[
  {
    "patternType": "schedule|topic_preference|communication_style|task_habit",
    "description": "清晰简洁的模式描述",
    "confidence": 0.0-1.0
  }
]

## 模式类型说明
- schedule: 时间相关的规律（如"每天早上 9 点查看天气"）
- topic_preference: 话题偏好（如"经常讨论 Python 编程"）
- communication_style: 沟通风格（如"偏好简短直接的回复"）
- task_habit: 任务习惯（如"喜欢先列计划再执行"）

## 注意事项
- 只输出有足够证据支撑的模式（confidence >= 0.5）
- 不要从单次对话中过度推断
- 如果没有检测到有意义的模式，返回空数组 []
```

### 2.2 IProactiveEngine

意图预测引擎接口，负责基于用户画像和行为模式预测下一步意图。

| 方法 | 签名 | 说明 |
|------|------|------|
| `predictIntent` | `(userId: number) => Promise<PredictedIntent \| null>` | 为指定用户预测下一步意图 |
| `runPredictionCycle` | `() => Promise<void>` | 执行一轮完整的预测周期（遍历所有活跃用户） |

**实现文件**：`server/memory/proactiveEngine.ts`

**预测流程**：
1. 调用 `getUserPreferences(userId)` 检查 `proactiveService` 是否为 `enabled`。
2. 调用 `getRecentConversations(userId)` 获取最近 24 小时的对话。
3. 调用 `getUserPatterns(userId)` 获取行为模式。
4. 调用 `searchMemories({userId, kind: "persona"})` 获取用户画像。
5. 将以上信息组装为 LLM Prompt，调用 LLM 预测意图。
6. 根据预测结果中的 `suggestedQueries`，调用 `hybridSearch` 预取记忆。
7. 将预取结果存入 `PrefetchCache`。

**LLM Prompt 设计**：

```
你是一个用户意图预测专家。基于以下用户信息，预测该用户下一次与 AI 助手交互时最可能的需求。

## 输出格式（严格 JSON）
{
  "intent": "预测的意图描述",
  "confidence": 0.0-1.0,
  "suggestedQueries": ["用于检索相关记忆的查询1", "查询2"],
  "reasoning": "推理过程"
}

## 注意事项
- 基于行为模式和最近对话推断，不要凭空猜测
- suggestedQueries 应该是能从记忆系统中检索到有用信息的查询
- 如果信息不足以做出有意义的预测，将 confidence 设为 0
```

### 2.3 IPrefetchCache

上下文预取缓存接口，管理预取的记忆上下文。

| 方法 | 签名 | 说明 |
|------|------|------|
| `set` | `(entry: PrefetchCacheEntry) => void` | 写入缓存条目 |
| `get` | `(userId: number) => PrefetchCacheEntry \| null` | 获取缓存条目（自动检查过期） |
| `invalidate` | `(userId: number) => void` | 手动失效缓存 |
| `cleanup` | `() => void` | 清理所有过期条目 |
| `getStats` | `() => { size: number; hitCount: number; missCount: number }` | 获取缓存统计 |

**实现文件**：`server/memory/prefetchCache.ts`

**缓存策略**：
- **存储方式**：内存 Map（`Map<number, PrefetchCacheEntry>`），以 `userId` 为键。
- **默认 TTL**：4 小时（`PREFETCH_TTL = 4 * 60 * 60 * 1000`）。
- **最大条目数**：1000（`MAX_CACHE_SIZE = 1000`），超出时淘汰最早过期的条目。
- **清理频率**：每 30 分钟自动清理过期条目。

## 3. 现有模块改造接口

### 3.1 contextEnrichNode.ts 改造

在现有的 `contextEnrichNode` 中增加缓存命中逻辑：

```typescript
// 新增导入
import { getPrefetchCache } from "../../memory/prefetchCache";

// 在 Promise.all 之前增加缓存检查
const prefetchCache = getPrefetchCache();
const cachedEntry = prefetchCache.get(userId);

if (cachedEntry && !isNewSession) {
  // 缓存命中：使用预取的上下文
  console.log(`[ContextEnrichNode] Prefetch cache HIT for user ${userId}`);
  const memoryContext = cachedEntry.formattedContext;
  // ... 继续构建 dynamicSystemPrompt
} else {
  // 缓存未命中：执行常规实时检索
  console.log(`[ContextEnrichNode] Prefetch cache MISS for user ${userId}`);
  // ... 现有逻辑不变
}
```

### 3.2 memoryExtractionNode.ts 改造

在现有的记忆提取完成后，异步触发行为模式检测：

```typescript
// 新增导入
import { detectAndPersistPatterns } from "../../memory/behaviorDetector";

// 在 extractMemoriesFromConversation 的 .then() 中追加
.then((memories) => {
  if (memories.length > 0) {
    console.log(`[MemoryExtractionNode] Extracted ${memories.length} new memories`);
    // 异步触发行为模式检测（fire-and-forget）
    detectAndPersistPatterns({
      userId,
      conversationHistory,
      extractedMemories: memories,
      timestamp: new Date().toISOString(),
    }).catch((err) => {
      console.error("[MemoryExtractionNode] Behavior detection failed:", err.message);
    });
  }
})
```

### 3.3 memoryCron.ts 改造

在现有的定时任务调度器中新增意图预测任务：

```typescript
// 新增导入
import { getProactiveEngine } from "./proactiveEngine";

// 新增配置
const PREDICTION_INTERVAL = 2 * 60 * 60 * 1000; // 2 小时

// 新增定时器引用
let predictionTimer: ReturnType<typeof setInterval> | null = null;

// 在 startMemoryCron() 中新增
async function runPrediction(): Promise<void> {
  console.log("[MemoryCron] Running intent prediction cycle...");
  const engine = getProactiveEngine();
  await engine.runPredictionCycle();
}

// 延迟 15 分钟后首次执行
setTimeout(() => {
  runPrediction().catch(console.error);
}, 15 * 60 * 1000);

predictionTimer = setInterval(() => {
  runPrediction().catch(console.error);
}, PREDICTION_INTERVAL);
```

## 4. 代码框架文件清单

| 文件路径 | 类型 | 说明 |
|----------|------|------|
| `server/memory/behaviorDetector.ts` | 新增 | 行为模式检测器完整实现 |
| `server/memory/proactiveEngine.ts` | 新增 | 意图预测引擎完整实现 |
| `server/memory/prefetchCache.ts` | 新增 | 上下文预取缓存完整实现 |
| `server/memory/memoryCron.ts` | 改造 | 新增意图预测定时任务 |
| `server/agent/supervisor/contextEnrichNode.ts` | 改造 | 新增缓存命中逻辑 |
| `server/agent/supervisor/memoryExtractionNode.ts` | 改造 | 新增行为模式检测触发 |

## 5. 错误处理规范

| 场景 | 处理方式 |
|------|----------|
| LLM 行为模式检测返回非法 JSON | `behaviorDetector` 记录错误日志，返回空数组，不影响主流程 |
| LLM 意图预测返回非法 JSON | `proactiveEngine` 记录错误日志，返回 `null`，跳过该用户 |
| 预取缓存超出最大条目数 | 淘汰最早过期的条目，保证内存占用可控 |
| `proactiveService` 为 `disabled` | `proactiveEngine` 跳过该用户，不执行预测和预取 |
| 数据库不可用 | `behaviorDetector.persistPatterns()` 返回 0，不抛出异常 |
| 缓存命中但用户输入与预测不相关 | `contextEnrichNode` 降级到实时检索（缓存仅作为加速手段） |

## 6. 保留接口（前三轮迭代）

本轮迭代不修改以下已有接口：

- `MemoryExtractionOptions`（`server/memory/memorySystem.ts`）
- `ToolUtilityUpdate` / `PromptPatch`（`server/agent/supervisor/reflectionNode.ts`）
- `IAgentCardRegistry` / `IDynamicPromptAssembler`（`server/agent/discovery/types.ts`）
- `IToolRegistry`（`server/mcp/toolRegistry.ts`）
