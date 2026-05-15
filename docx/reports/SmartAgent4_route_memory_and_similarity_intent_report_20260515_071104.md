# SmartAgent4 路线型情景记忆与相似性意图纠偏方案

作者：**Manus AI**
日期：2026-05-15

## 一、结论摘要

我建议把这次问题拆成两个相互独立但需要在链路上衔接的改造。**路线型情景记忆**不应继续依赖“导航执行完以后，由通用 Agent 自行调用 memory_store”这一条弱路径，而应被做成一个**一等公民的结构化 Route Episode**，由服务端在“路线请求识别、导航结果落地、后续短指代召回”三个阶段确定性参与。这样才能解决 Demo 中出现的“路线规划能答，但记忆面板不新增；后续问昨晚路线时又重跑导航而非召回”的问题。

对于**意图分类错误**，我认为可以使用相似性搜索来解决，但不建议把它做成新的重模型主分类器。更稳妥的方式是把它放在当前 LLM 分类之后、计划生成之前，作为一个**低延迟的分类纠偏层**。具体实现上，P0 版本可以使用本地字符 n-gram TF-IDF / BM25 相似性加高精度 guard 规则，已经能在 Manus 沙盒中以约 **0.065 ms/次** 的平均延迟运行；P1 版本再复用现有 embedding / hybridSearch 链路做语义召回，并只在低置信度或冲突样例上触发。

> 用户提供的“均衡版模型方案”强调：高频入口模块应“规则优先，模型回退”，Capability 仍建议使用 Embedding 召回，而 Reranker 应改成条件触发；这与本文建议的“LLM 分类 + 轻量相似性纠偏 + 条件语义召回”是一致的。[1]

| 问题 | 当前现象 | 建议方案 | 预期收益 |
|---|---|---|---|
| 路线规划后未稳定写入情景记忆 | 路线规划回复完成，但记忆面板未新增路线记忆 | 结构化 `route_episode`，服务端确定性写入和 finalize | 写入稳定，不再依赖 LLM 自觉调用工具 |
| “昨晚路线怎么走”短指代不稳 | 容易被判成导航，触发实时规划 | 先做记忆召回意图保护，再按 route episode 检索 | 短指代可直接复述上次路线 |
| “喜欢听谁的歌”被 multimedia 吸走 | 明确记忆查询被音乐域关键词误导 | 高精度 memory guard + 相似性候选纠偏 | 避免把记忆查询误判为工具执行 |
| “按我的喜好吃什么听什么”分类错误 | 偏好召回可能被其他域吸走 | similarity correction 在 classify 后执行 | 不改主分类器，降低误伤风险 |

## 二、路线型情景记忆的更好实现方案

当前实现已经有两个方向是对的：一是 `dialogueSlots.ts` 会从多轮用户消息中启发式抽取城市、起点、终点、途经点；二是 `navigationMemoryPlan.ts` 和 `persistNavigationEpisodic.ts` 尝试在导航步骤后追加记忆写入或兜底写入。但这两条路径在 Demo 中仍然不稳，核心原因是**路线情景并没有被建模成稳定实体**。现在路线记忆只是自然语言 content 中的一段摘要，写入时机依赖 plan 和 stepResults 的状态，召回时又依赖通用记忆检索和意图分类是否正好走到 generalAgent。

更稳的方案是新增一个“Route Episode Manager”。它不需要替代现有 memory 系统，而是作为 memory 系统之上的一个窄域适配层，专门管理路线情景的写入、去重、更新、召回和短指代解析。

### 2.1 数据结构：把路线记忆从自然语言升级为结构化 Route Episode

路线记忆仍可以写入原 memory 表，但必须在 metadata 中保存结构化字段，并为检索准备专门的 `embeddingText`。如果当前 memory 表不方便扩字段，可以先把 metadata 存成 JSON；如果后续要做高质量检索，再单独建 `route_episodes` 表。

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `episodeId` | string | 路线情景唯一 ID | `route_ep_20260515_xxx` |
| `routeKey` | string | 规范化去重 key | `太湖软件园->上海虹桥机场 via 山姆会员店,苏州北站` |
| `origin` | object | 起点原文、规范名、经纬度 | `{raw:"苏州太湖软件园", canonical:"太湖软件园"}` |
| `destination` | object | 终点原文、规范名、经纬度 | `{raw:"上海虹桥机场", canonical:"上海虹桥机场"}` |
| `waypoints` | array | 途经点列表 | `山姆会员店；苏州北站` |
| `departTime` | string | 用户指定时间或相对时间 | `明天早上` |
| `mode` | string | 驾车、公交、步行等 | `driving` 或 `transit` |
| `constraints` | array | 用户约束 | `中途经过山姆；少换乘` |
| `routeSummary` | string | 最终回复摘要 | `从太湖软件园出发...` |
| `sourceTurnIds` | array | 来源消息 ID | `[m1,m2]` |
| `status` | enum | `pending/finalized/failed` | `finalized` |
| `confidence` | number | 抽取和执行置信度 | `0.88` |
| `lastUsedAt` | datetime | 召回时间 | `2026-05-15T...` |
| `tags` | array | 检索标签 | `导航, 路线, 通勤, 虹桥机场` |
| `embeddingText` | string | 专门用于相似性召回的文本 | `昨晚 从太湖软件园 到 虹桥机场 途经 山姆 苏州北站 路线` |

这里最关键的字段是 `routeKey` 和 `embeddingText`。现有 `persistNavigationEpisodic.ts` 使用固定的 `versionGroup: "commute_route_episodic_v1"`，这会把不同路线都挤到同一个版本组里，不利于多条路线共存和精确更新。建议改成 `route:${originCanonical}:${destinationCanonical}:via:${waypointsHash}`，这样既能合并同一路线的多次规划，也不会覆盖完全不同的路线。

### 2.2 写入策略：由“执行后可选写入”改为“三阶段确定性写入”

路线型情景记忆必须支持“用户提出路线需求但工具执行慢、工具失败、最终回复生成很晚”的场景。因此我建议拆成三阶段。

| 阶段 | 触发条件 | 写入动作 | 目的 |
|---|---|---|---|
| `prepare` | 用户输入命中明确路线规划，且可抽取起终点或途经点 | 创建 `pending route_episode`，保存用户原始路线需求和槽位 | 防止后续工具卡住导致完全无记忆 |
| `finalize` | navigationAgent 有成功结果或最终答复已生成 | 更新同一 `routeKey` 的 episode，写入 routeSummary、routeOptions、status | 保存可复述的最终路线 |
| `recall_touch` | 用户用“昨晚那条路线”“上次路线”召回 | 更新 `lastUsedAt`、`useCount`，不重跑导航 | 支持短指代和常用路线排序 |

在工程上，`prepare` 可以放在 classify 之后、plan 之前，`finalize` 可以放在 executeNode 或 respondNode 后，而不是只依赖 plan 中追加 generalAgent 的 `memory_store`。这样即便 plan 没追加 memory step，或者 generalAgent 的工具调用循环没有触发，也不会影响路线 episode 的落地。

### 2.3 召回策略：短指代优先查 Route Episode，而不是直接进导航

路线召回应在意图分类阶段之前或之后立即做一个轻量判断。只要用户输入满足“时间/指代 + 路线词”的模式，例如“昨晚的路线怎么走”“上次去虹桥那条路”“那条从太湖软件园去虹桥的路线”，系统就应该先查 route episode。如果查到高置信记录，应直接把 routeSummary 注入上下文，让 generalAgent 复述；只有查不到或用户明确要求“重新规划/现在路况/实时导航”时，才进入 navigationAgent。

| 用户表达 | 正确路由 | 是否重跑导航 | 说明 |
|---|---|---|---|
| “帮我规划明早从 A 到 B 途经 C 的路线” | navigationAgent + route prepare/finalize | 是 | 这是新路线规划 |
| “昨晚那条从 A 到 B 的路线帮我再说一遍” | route episode recall + generalAgent | 否 | 这是记忆复述 |
| “昨晚的路线怎么走？” | route episode recall，必要时澄清 | 否 | 短指代召回，按最近路线排序 |
| “重新规划一条现在最快的路线” | navigationAgent | 是 | 用户明确要求实时重新规划 |

### 2.4 当前代码的最小改动建议

第一，保留 `dialogueSlots.ts`，但不要只用四个槽位。建议新增 `routeEpisodeExtractor.ts`，在现有槽位基础上补充 `temporalHint`、`routeAction`、`isRecallLike`、`isReplanLike`、`rawLocations`、`constraints`。第二，把 `persistNavigationEpisodicIfNeeded` 从“兜底写一条自然语言 fact”改成“upsertRouteEpisode”，并使用动态 `routeKey`。第三，在 `classifyNode.ts` 的 LLM 分类和现有规则纠偏之后，增加 `refineClassificationForMemoryRecallIntent`，专门保护“你还记得 / 按我的喜好 / 上次路线 / 昨晚路线”这类输入。

## 三、相似性搜索模型能否解决意图分类错误

结论是：**可以，但应该作为纠偏层，而不是主分类器替代层**。用户提供的“均衡版模型方案”已经指出，Pre-Router 是固定标签空间下的粗路由问题，适合小模型甚至规则兜底；Capability 则是开放能力召回，适合 embedding 检索。[1] 当前 SmartAgent4 的 Agent Card 本身已经具备小规模候选池，包括 `generalAgent` 的“记忆管理”、`navigationAgent` 的“路线规划”、`multimediaAgent` 的“音乐搜索/播放”等描述。也就是说，系统不需要在每轮对话中全量调用一个新大模型，只需要把用户输入和少量候选能力描述做相似性比较，就能形成低成本纠偏信号。

### 3.1 为什么当前错误适合相似性纠偏

这次 Demo 中的错误主要不是“完全无法理解用户”，而是**关键词把任务吸到了错误工具域**。例如“你还记得我喜欢听谁的歌吗？”包含“歌”，容易被 multimedia 吸走；但完整句式中的“你还记得我喜欢”明显是记忆查询。又如“昨晚的路线怎么走？”包含“路线/怎么走”，容易被 navigation 吸走；但“昨晚的”是情景记忆召回信号。这类错误非常适合用“高精度 guard + 相似性候选排序”处理。

| 误分类样例 | 关键词诱因 | 真实意图 | 纠偏特征 |
|---|---|---|---|
| “按我的喜好，今晚适合吃什么、听什么？” | 吃、听可能触发服务或多媒体 | 偏好记忆召回 + 建议 | “按我的喜好” |
| “你还记得我喜欢听谁的歌吗？” | 歌 | 明确记忆查询 | “你还记得我喜欢” |
| “昨晚的路线怎么走？” | 路线、怎么走 | 路线情景记忆召回 | “昨晚的” + “路线” |
| “帮我规划从 A 到 B 的路线” | 路线 | 实时导航规划 | “帮我规划” + 起终点 |

### 3.2 Manus 沙盒可运行的低延迟原型

我在项目目录下写了一个可直接运行的原型：`/home/ubuntu/SmartAgent4/intent_similarity_prototype.py`。它不依赖外部服务，不下载模型，只使用字符 n-gram TF-IDF/cosine 与少量高精度 guard 规则模拟分类纠偏层。运行命令如下。

```bash
cd /home/ubuntu/SmartAgent4
python3.11 intent_similarity_prototype.py
```

实测输出文件为 `/home/ubuntu/intent_similarity_prototype_output.txt`。在 20,000 轮循环中，总耗时约 1,298.76 ms，平均 **0.0649 ms/次**。这说明即使把它放在每轮 classify 后，也几乎不会增加可感知延迟。

| 测试输入 | 假设 LLM 原分类 | 原型建议 | 是否覆盖 | 说明 |
|---|---|---|---|---|
| “按我的喜好，今晚适合吃什么、听什么？” | navigation | general | 是 | 命中偏好记忆 guard |
| “你还记得我喜欢听谁的歌吗？” | multimedia | general | 是 | 命中明确记忆查询 guard |
| “昨晚的路线怎么走？” | navigation | general | 是 | 命中路线情景回忆 guard |
| “帮我规划明早从太湖软件园到虹桥机场的路线...” | navigation | navigation | 不覆盖 | 正确保留实时路线规划 |
| “播放周杰伦的歌” | multimedia | multimedia | 不覆盖 | 正确保留音乐工具意图 |
| “以后少给我推荐太吵的活动...” | general | general | 不覆盖 | 正确保留偏好更新 |

需要注意，P0 原型不是为了证明字符 n-gram 是最终最佳模型，而是证明**在小候选池上做相似性纠偏完全可以低延迟运行**。线上版本可以沿用这一结构，逐步把 candidate 文本从手写样例升级为 Agent Card + Capability Card + Memory Intent Card 的组合。

### 3.3 推荐的线上纠偏链路

建议把纠偏层放在 `classifyNode.ts` 中现有规则之后、`requiredAgents` 校验与 defaultPlan 生成之前。这样它不会影响 LLM 结构化输出，也不会进入 planner 后再补救，代价最小。

```text
用户输入
  → 轻量 LLM classify
  → 现有规则纠偏：music / disk / directory / news / follow-up
  → 新增 memory guard：偏好查询、偏好更新、路线情景召回
  → 新增 similarity correction：Agent/Intent Card Top-K 相似性
  → requiredAgents 校验
  → simple defaultPlan 或 planner
```

相似性纠偏不应无条件覆盖 LLM。建议只在以下条件下覆盖：第一，命中高精度 memory guard；第二，Top-1 相似度超过阈值且 Top-1 与 Top-2 分差明显；第三，LLM 结果和相似性结果属于已知高混淆对，例如 `multimedia ↔ general(memory)`、`navigation ↔ general(route_recall)`、`service ↔ navigation(nearby/route)`。如果只是轻微分差或候选冲突，应保留 LLM 分类或要求澄清。

| 层级 | P0 实现 | P1 实现 | 触发策略 |
|---|---|---|---|
| Memory Guard | 正则 + 关键词模板 | 加入少量可配置 intent cards | 每轮默认，<1 ms |
| Similarity Search | 字符 n-gram TF-IDF/BM25 | 复用 embedding + hybridSearch | 每轮默认或低置信度触发 |
| Semantic Embedding | 不依赖 | Qwen3-Embedding-0.6B 或现有 embedding 服务 | 仅候选冲突时触发 |
| Reranker | 不启用 | 条件触发 | Top-1/Top-2 接近时触发 |

## 四、与“均衡版模型方案”的关系

用户给出的方案中，Pre-Router 建议“0.5B~0.6B 级 Instruct 小模型 + 规则优先”，Capability 召回建议保留 Embedding，Reranker 改为条件触发。[1] 因此，本文方案并不是另起一套重链路，而是把相似性搜索用于两个更窄的场景。

第一，它用于**分类纠偏**，候选池非常小，通常只有 6 个 domain、若干 Agent Card 和十几个 Memory Intent Card。这一层甚至可以不用向量模型，仅靠本地 TF-IDF/BM25 就能先解决 Demo 中的关键误分。第二，它用于**路线 episode 召回**，候选池只包含当前用户的路线记忆，数量通常也很小，因此可以复用现有 `hybridSearch.ts` 中的 BM25 + vector 混合检索，并在无 embedding 时自动退化为 BM25。

| 文档原则 | 本文对应设计 | 说明 |
|---|---|---|
| Pre-Router 缩小，规则优先 | LLM classify 后加 memory guard | 不增加重模型 |
| Capability 保留 Embedding 召回 | Agent/Intent Card 相似性检索 | 适合扩展 Agent 能力 |
| Reranker 条件触发 | 仅在 Top-1/Top-2 接近时使用 | 控制边界样本延迟 |
| Planner 仅复杂任务触发 | 记忆查询和短指代不进 planner | 降低普通轮次链路长度 |

## 五、建议的落地优先级

P0 目标是让 Demo 先稳定。此阶段不需要训练模型，也不需要本地部署 embedding 大模型，只需要新增 memory guard、route episode upsert、短指代召回和轻量相似性候选表。P1 再把相似性候选从手写样例升级为 Agent Card / Capability Card，并复用现有 hybridSearch 做混合检索。P2 才考虑引入 Qwen3-Embedding-0.6B 或 Reranker；如果部署环境不能稳定常驻模型，也可以继续走远程 embedding 或纯 BM25 降级。

| 优先级 | 改动 | 预计工程量 | 风险 | 验收标准 |
|---|---|---:|---|---|
| P0 | 新增 `refineClassificationForMemoryRecallIntent` | 小 | 规则误伤 | Demo 三个误分类样例不再走错 Agent |
| P0 | 新增 `routeEpisodeExtractor/upsertRouteEpisode` | 中 | 结构字段设计 | 路线规划完成后记忆面板稳定出现路线 episode |
| P0 | “昨晚路线/上次路线”先查 route episode | 中 | 多路线排序 | 不带地点线索也能召回最近路线或要求澄清 |
| P0 | 本地 TF-IDF/BM25 similarity correction | 小 | 阈值需要调 | 沙盒单次 <1 ms，误分样例可覆盖 |
| P1 | 复用 Agent Card 构建 Intent/Capability Card | 中 | 文本质量 | 新增 Agent 后无需改分类规则 |
| P1 | 复用 `hybridSearch` 做 route episode 召回 | 中 | embedding 可用性 | 有 embedding 时语义更稳，无 embedding 自动 BM25 |
| P2 | 条件 Reranker 或 0.6B embedding 常驻 | 中高 | 部署资源 | 只在低置信样例触发，端到端延迟可控 |

## 六、代码级实现草案

建议新增 `server/agent/supervisor/memoryIntentRefine.ts`，导出 `refineClassificationForMemoryIntent(userText, classification, similarityIndex)`。它先执行高精度 guard，再执行相似性 Top-K。对于 Demo 中的三类输入，guard 应直接覆盖为 `general + generalAgent`，同时把 `classification.reasoning` 加上 `[rule:memory_recall]` 或 `[similarity:intent_card]`，便于日志定位。

```ts
if (looksLikePreferenceRecall(userText) || looksLikeExplicitMemoryQuery(userText)) {
  classification.domain = "general";
  classification.complexity = "simple";
  classification.requiredAgents = ["generalAgent"];
  classification.reasoning = `[rule:memory_recall] ${classification.reasoning ?? ""}`;
}

if (looksLikeRouteEpisodeRecall(userText)) {
  classification.domain = "general";
  classification.complexity = "simple";
  classification.requiredAgents = ["generalAgent"];
  classification.reasoning = `[rule:route_episode_recall] ${classification.reasoning ?? ""}`;
}
```

建议新增 `server/memory/routeEpisodeMemory.ts`，导出 `prepareRouteEpisode`、`finalizeRouteEpisode` 和 `retrieveRouteEpisode`。`prepareRouteEpisode` 在路线 intent 已确认但导航尚未完成时写入 pending；`finalizeRouteEpisode` 在 navigationAgent 成功后更新摘要；`retrieveRouteEpisode` 在短指代召回时按 `lastUsedAt + similarity + routeKey` 排序返回。

```ts
await upsertRouteEpisode({
  userId,
  routeKey,
  origin,
  destination,
  waypoints,
  departTime,
  constraints,
  status: "pending",
  sourceTurnIds,
});

await finalizeRouteEpisode({
  userId,
  routeKey,
  routeSummary: finalAnswer.slice(0, 800),
  status: "finalized",
});
```

最后，在 `respondNode` 或 supervisor 结束前增加一次兜底：如果本轮 `taskClassification.domain === "navigation"` 且 route episode 仍是 pending，但最终回复中包含可用路线摘要，就 finalize；如果没有可用摘要，至少保留 pending，并在 UI 上不要展示为“已确认路线”，避免误导。

## 七、风险与边界条件

相似性搜索不能替代所有意图分类。它最适合处理小候选池、可枚举的高混淆边界，例如 memory vs multimedia、route recall vs navigation、nearby service vs POI navigation。对于真正复杂的跨域任务，仍应交给当前 planner。路线记忆也不能在用户明确要求实时路况、重新规划、避堵、当前最快路线时直接复述旧记忆；这些词应触发 replan guard，优先进入 navigationAgent。

另一个需要注意的点是隐私和过期策略。路线 episode 往往包含住址、公司、机场等敏感位置。建议默认只对当前用户可见，tags 中不要暴露过多精确地址，UI 上允许用户删除；对于一次性路线可以设置较低 importance 或较短 TTL，对于“通勤/常用路线”则可以提升 importance 并长期保留。

## 八、最终建议

如果目标是尽快让演示稳定，我建议先做 P0：**memory guard + route episode upsert + 短指代 route recall + 本地相似性纠偏**。这一方案不依赖新模型，已经在 Manus 沙盒中用原型验证能以约 0.065 ms/次运行，并且能覆盖当前 Demo 的核心误分类样例。等 P0 稳定后，再把相似性候选迁移到 Agent Card / Capability Card，并复用已有 `hybridSearch.ts` 加入 embedding。这样既符合“均衡版模型方案”的低延迟原则，也不会因为引入新模型而拖慢普通对话轮次。

## References

[1]: https://github.com/yangli0403/SmartAgent4/blob/demo_0423/docx/%E9%9D%A2%E5%90%91%E5%AF%B9%E8%AF%9D%E7%B3%BB%E7%BB%9F%E7%9A%84%E5%9D%87%E8%A1%A1%E7%89%88%E6%A8%A1%E5%9E%8B%E6%96%B9%E6%A1%88 "面向对话系统的均衡版模型方案"
[2]: https://github.com/QwenLM/Qwen3-Embedding "Qwen3-Embedding GitHub Repository"
[3]: https://github.com/FlagOpen/FlagEmbedding "FlagEmbedding GitHub Repository"
