# SmartAgent4 记忆系统优化计划（更新版，2026-04-13）

## 1. 背景与结论

在重新阅读 SmartAgent4 当前代码实现后，可以确认项目已经不再处于“每轮都盲目检索”的初始状态。当前系统已经具备 **检索前决策**、**查询重写**、**BM25 + 向量的混合检索**、以及 **意图预测驱动的预取缓存** 等能力，这意味着此前基于 MemU 的若干建议实际上已经部分落地，不宜再被列为新的主攻方向。[1] [2] [3] [4]

与此同时，对比 Mem0 与 MemU 的最新开源设计可以发现，两者真正值得 SmartAgent4 借鉴的增量并不在“是否做基础记忆检索”，而在于 **记忆层级化、关系化、可过滤、可追溯、可渐进** 这五类能力。Mem0 的价值更偏向 **作用域分层、图关系记忆、结构化过滤、异步化与多模态接口**；MemU 的价值则更偏向 **三层渐进检索、语义回读与向量检索双通道、充分性判断驱动的早停、主动记忆引擎化**。[5] [6] [7] [8] [9] [10]

基于这一判断，本次更新后的优化计划不再把“Pre-Retrieval Decision”和“Query Rewrite”作为新需求，而是把它们视为 **已具备基础设施**。新的重点应转向：在现有 SmartAgent4 架构上，构建 **分层记忆作用域 + 渐进式检索编排 + 结构化过滤 + 关系增强 + 可追溯上下文注入** 的下一代记忆系统。

## 2. 当前 SmartAgent4 能力重估

从 `contextEnrichNode`、`preRetrievalDecision.ts`、`memorySystem.ts` 与 `proactiveEngine.ts` 的实现来看，SmartAgent4 当前的记忆系统已经形成了一个较完整的“前置判断—检索—格式化注入—后台预取”链路。[1] [2] [3] [4] 这意味着项目的短板已经不再是“没有长期记忆”，而是“长期记忆在检索深度、结构层次和结果治理上还不够精细”。

| 维度 | SmartAgent4 当前状态 | 结论 |
| --- | --- | --- |
| 检索触发 | 已有规则 + 轻量 LLM 的检索前决策，可直接返回 `NO_RETRIEVE` | 该能力已达到 MemU 的第一层参考价值，不应重复建设 |
| 查询处理 | 已支持基于最近对话的查询重写 | 已解决一部分代词、省略与模糊问法问题 |
| 检索方式 | 已支持混合检索与重要度排序 | 具备基础召回能力，但仍偏扁平 |
| 主动能力 | 已有意图预测与预取缓存 | 具备“弱主动”基础，但尚未成为独立主动记忆引擎 |
| 记忆层次 | 以统一记忆表/统一检索入口为主 | 缺少 Mem0/MemU 那种清晰的层级治理 |
| 检索终止 | 主要依赖固定 top-k 与长度裁剪 | 缺少 MemU 式充分性判断与早停 |
| 结构约束 | 重要度、类型等能力存在，但缺少统一高级过滤接口 | 缺少 Mem0 式复杂 metadata filtering |
| 关系增强 | 尚未形成图关系记忆链路 | 缺少 Mem0 Graph Memory 的关系补充能力 |
| 可追溯性 | 注入 Prompt 时以文本上下文为主 | 缺少来源、时间、层级、置信度等可追溯元信息 |

## 3. Mem0 与 MemU 对 SmartAgent4 最有价值的新特性

### 3.1 来自 Mem0 的高价值增量

Mem0 最新开源文档最值得关注的，不是“支持向量库”这类通用能力，而是其将记忆明确分成 **conversation、session、user、organization** 四类作用域，并在查询时做跨层合并。这种设计天然适合区分“当前任务临时状态”“用户长期偏好”“团队共享知识”等不同生命周期的数据，有助于降低误召回和上下文污染。[6]

此外，Mem0 的 **Graph Memory** 将“向量命中”和“关系补充”拆分为两条并行链路：向量检索负责缩小候选集，图后端返回相关实体关系作为附加上下文，而不是粗暴替代主排序。这一设计非常适合 SmartAgent4 渐进演化，因为它允许先把关系信息作为 **补充证据** 注入，而不必一次性重构全部主检索逻辑。[7]

Mem0 另一个立即可落地的价值点是 **Enhanced Metadata Filtering**。它支持比较运算、集合运算、字符串匹配和逻辑组合，使“搜记忆”从单纯的语义近邻检索升级为“语义召回 + 结构化约束”的混合检索。这对于 SmartAgent4 后续做时间窗、记忆类型、可信度、重要度、用户/agent/run 作用域限制尤其关键。[8]

最后，Mem0 在文档层面已经将 **Async Memory**、**Multimodal Support**、**REST API Server** 与 **OpenAI Compatibility** 整合为统一开放能力集，这对 SmartAgent4 的长期演进具有产品层启发意义：记忆系统不应只是一段内部逻辑，而应逐步沉淀为稳定的能力边界与服务接口。[5]

### 3.2 来自 MemU 的高价值增量

MemU 的第一批参考价值——“要不要搜”和“查询重写”——SmartAgent4 实际上已经具备基础实现。[2] 因而 MemU 真正仍有吸引力的地方，在于它将记忆系统设计成 **Category → Item → Resource** 的三层渐进检索结构，并在每层之间插入 **充分性检查**，让系统在信息已经足够时提前停止，避免无意义地继续下钻。[9] [10]

与此同时，MemU 官方材料还强调 **LLM-based semantic reading** 与 **RAG-based vector search** 的双路径能力。前者适合高质量、低频、复杂问题；后者适合低延迟、常规召回。这种双通道思想对 SmartAgent4 非常有价值，因为它比“统一走一个检索函数”更接近真实业务中的性能分层。[9]

MemU 还有两个值得吸收的思路。其一是 **Traceable Results**，即检索结果需要保留原始来源链接与上下文来路，便于后续解释、审计和纠错。[9] 其二是将记忆能力从单纯数据库能力上升为 **主动记忆引擎**：包括自动分类、模式识别、上下文预测和后台任务协同。[10] SmartAgent4 虽已有预取缓存，但离“主动记忆代理”仍有显著差距。[4]

## 4. 更新后的总体设计原则

新的优化方案应遵循“**先增强编排，再扩展存储；先补充证据，再改造主链；先可观测，再做智能化**”的原则。具体而言，短期不建议直接引入重型图数据库重构，也不建议马上复制 MemU 的完整三层文件式记忆架构，而应优先把这些外部能力翻译成适配 SmartAgent4 当前代码基线的渐进改造。

| 原则 | 含义 | 落地方式 |
| --- | --- | --- |
| 与现有实现兼容 | 不推翻已有 pre-retrieval、hybrid search、prefetch | 在既有入口前后插入新编排节点 |
| 先编排后存储 | 先解决“何时搜、搜几层、何时停” | 引入 sufficiency check 与 retrieval mode |
| 先作用域后关系 | 优先解决 session/user/org 混淆问题 | 增加 memory scope 与 metadata schema |
| 先补充上下文后改变排序 | 关系信息先作为 evidence 注入 | 先做 lightweight relation extraction |
| 先可解释后自动化 | 每一步检索都要可追踪 | 输出来源、时间、层级、置信度 |

## 5. 核心改造方案（更新版）

### 5.1 建立“作用域分层”的统一记忆模型

建议将当前相对统一的记忆读写逻辑，扩展为更清晰的作用域模型：**conversation / session / user / shared(org)**。其中，conversation 与 session 主要承载任务内短期状态，user 承载跨会话偏好与长期事实，shared(org) 则承载共享知识、规则和团队上下文。这一设计直接借鉴 Mem0 的分层思想，但应与 SmartAgent4 现有用户画像、行为模式和长期记忆表兼容演进，而不是完全另起炉灶。[6]

在实现上，第一步并不一定要求拆成四张物理表，更现实的做法是先在现有 memory schema 中增加 `scope`、`scope_id`、`agent_id`、`run_id`、`source_type`、`confidence`、`valid_from`、`valid_to` 等字段，把作用域治理前置到数据模型与过滤器层。

### 5.2 从“单次扁平召回”升级为“渐进式检索编排”

建议在现有 `searchMemories` 与 `getFormattedMemoryContext` 之上，再包一层 **Retrieval Orchestrator**。该编排器不直接替换底层检索，而是决定先检哪一层、是否继续深入、是否切换检索模式。其最小可行流程可以不是完全照搬 MemU 的 Category/Item/Resource，而是按 SmartAgent4 当前数据现状设计成：

1. **Profile / Preference 层**：先检长期高价值事实与偏好；
2. **Episode / Task 层**：再检近期任务摘要、行为和事件；
3. **Source / Raw Layer**：最后才回看原始会话、文档片段或附件来源。

每层检索之后，都执行一次 **Sufficiency Check**。若当前候选已经足够支撑回答，则直接停止；只有在“信息不足”时才继续下钻。这种方式既保留了 MemU 的早停优势，又避免一次性重构全部存储形态。[10]

### 5.3 引入“双通道检索模式”

建议把检索统一接口扩展为两种模式：**Fast Retrieval** 与 **Deep Retrieval**。Fast Retrieval 继续使用当前混合检索，服务于大多数普通问答；Deep Retrieval 则面向复杂、多跳、强上下文依赖问题，允许在召回后触发语义回读、关系补充和更高成本的重排逻辑。该设计本质上吸收了 MemU 的 semantic reading 与 vector search 双路径思想，但不必原样实现“读 memory files”，而可以替换为“读已召回来源片段”。[9]

### 5.4 引入结构化过滤器与检索约束规划

建议在 `memory_search` 与 `searchMemories` 的参数层新增标准化过滤对象，让系统能够在检索前表达类似以下条件：指定 scope、限定时间范围、限定记忆类型、设定最低 importance / confidence、排除失效记忆、限制仅来自某一 agent 或 run。该能力可直接参考 Mem0 的 Enhanced Metadata Filtering 思路，但字段集合应以 SmartAgent4 业务真实需要为准。[8]

进一步地，可以增加一个轻量 **Retrieval Filter Planner**：由规则或小模型将用户请求转成结构化过滤条件，例如把“我上周提过的餐厅”转成 `scope=user + type=preference/episode + time>=now-7d + topic=restaurant` 的候选约束。

### 5.5 增加关系增强层，而非立即全面图化

建议不要直接把 SmartAgent4 改造成强依赖 Neo4j 的图系统，而是先做 **Lightweight Relation Extraction**。在写入阶段，通过小模型或规则抽取“人物—地点—事件”“用户—偏好—对象”“任务—状态—时间”等关系三元组，先存入轻量关系表或 JSON 边集合。检索阶段，当主召回命中某个节点型记忆时，再并行补充其关联关系，作为附加上下文注入 Prompt。这个思路直接对应 Mem0 的 Graph Memory，但实现成本更可控，也更符合当前项目阶段。[7]

### 5.6 让注入上下文具备“可追溯性”

目前格式化上下文主要关注“给模型看什么内容”，但未来应同步回答“这些内容来自哪里、为什么被召回、可信度如何”。建议把当前 `formatMemoriesForContext` 扩展为 **内容 + 证据头信息** 的形式，至少输出记忆层级、来源时间、来源会话、重要度、置信度与召回原因。这一能力与 MemU 的 traceable results 高度一致，也能显著提升调试、审计与错误修复效率。[9]

### 5.7 预留异步写入与多模态记忆接口

Mem0 已经把 Async Memory 与 Multimodal Support 作为标准能力暴露出来。[5] 对 SmartAgent4 而言，这并不意味着要立刻完成图片、语音、视频记忆的一体化，但至少应该在接口设计上预留 `source_type`、`source_uri`、`media_summary`、`embedding_status` 等字段，并将写入链路改为可异步执行，以避免后续因为接口形态固化而产生重构成本。

## 6. 分阶段实施路线图

### Phase A：两周内可完成的低风险高收益项

这一阶段的目标不是“重造系统”，而是快速把最明显的能力缺口补齐。建议优先完成统一 metadata schema、检索过滤参数、可追溯格式化上下文和检索日志增强。完成后，SmartAgent4 即便底层存储未大改，也能显著提升精准召回、错误排查与后续扩展性。

| 工作项 | 目标文件/模块 | 预期收益 |
| --- | --- | --- |
| 增加 `scope / run_id / agent_id / source_type / confidence / valid_to` 等字段 | memory schema、写入链路 | 为分层记忆和过滤器奠定基础 |
| 扩展 `searchMemories` 过滤对象 | `memorySystem.ts` 及相关查询模块 | 支持精确检索与时间/作用域裁剪 |
| 扩展 `formatMemoriesForContext` 输出头信息 | `memorySystem.ts` | 提升可追溯性与调试能力 |
| 增强检索日志 | `contextEnrichNode.ts`、检索编排入口 | 能观测命中率、早停率、误召回率 |

### Phase B：中期的检索编排升级

当 metadata 基础打好后，下一阶段建议引入 Retrieval Orchestrator，并将检索模式拆分为 Fast 与 Deep 两类。与此同时，加入最小版 Sufficiency Check，使系统在 profile / episode 两层就可能完成回答，而不必每次都深入原始来源层。该阶段的核心收益是 **降延迟、降噪声、控成本**。

| 工作项 | 目标文件/模块 | 预期收益 |
| --- | --- | --- |
| 新建检索编排器 | 新增 `retrievalOrchestrator.ts` | 统一控制分层检索与模式切换 |
| 引入 Fast / Deep 模式 | `contextEnrichNode.ts`、工具层 | 按问题复杂度匹配成本 |
| 加入 Sufficiency Check | 新增 `retrievalJudge.ts` 或等效模块 | 实现早停，减少无效下钻 |
| 为预取系统接入层级意识 | `proactiveEngine.ts` | 让预取不再只是扁平查询缓存 |

### Phase C：中长期的关系记忆与主动引擎化

当检索编排稳定后，再进入关系增强与主动记忆升级阶段。建议先实现轻量关系抽取与并行关系补充，再评估是否需要引入外部图数据库。与此同时，可将现有 proactive engine 从“预测后预取”扩展为“预测—分类—摘要—待办更新”的主动记忆代理，逐步吸收 MemU 的主动引擎思想。[7] [10]

| 工作项 | 目标文件/模块 | 预期收益 |
| --- | --- | --- |
| 轻量关系抽取与存储 | 写入链路、后台 consolidation | 补足人物/事件/对象关系问题 |
| 并行关系补充上下文 | 检索编排器 | 提升复杂问答的可解释性 |
| 主动记忆代理化 | `proactiveEngine.ts` | 从预取缓存升级为持续记忆运营 |
| 多模态记忆写入接口 | 写入 API、embedding pipeline | 支撑图片/音频/文档长期记忆 |

## 7. 对原计划的调整建议

原有 `MEMORY_SYSTEM_UPGRADE_PLAN.md` 强调“废弃每轮自动提取、把记忆能力工具化、由 Agent 主动决定何时存/搜/改/忘”，这一方向仍然成立，但需要从“单一范式替换”升级为“多层能力叠加”。[11] 换言之，**记忆技能化** 仍应保留，因为它解决的是“谁来决定何时写、何时查”的问题；但仅靠技能化还不足以解决“查什么层、查到哪一层停、如何约束、如何追溯”的问题。因此建议将原计划改写为“技能化 + 编排化 + 结构化”的三位一体方案。

| 原计划项 | 是否保留 | 更新建议 |
| --- | --- | --- |
| 降级逐轮自动提取 | 保留 | 继续推进，但要与异步写入和 consolidation 结合 |
| 记忆工具化 | 保留 | 工具参数中加入 scope、filters、retrieval_mode |
| Prompt 注入调用策略 | 保留 | 增加对 Fast/Deep 模式与可追溯输出的策略指导 |
| 后台服务适配 | 保留 | 额外接入层级意识、关系抽取和主动分类 |
| 仅围绕 Agent 主动存取改造 | 需要升级 | 扩展为“工具 + 编排 + 过滤 + 关系 + 追溯” |

## 8. 预期收益与评估指标

新的优化路线将比原计划更贴近生产可用性，因为它不是单点优化，而是把记忆系统改造成可治理、可观测、可扩展的基础设施。短期内，最直接的收益会体现在误召回下降、上下文噪声下降和检索可解释性增强；中期收益则体现在复杂问题下的回答稳定性和系统成本控制。

| 指标 | 当前问题 | 优化后期望 |
| --- | --- | --- |
| 无效检索率 | 闲聊和弱相关问题仍可能触发检索链路 | 通过分层编排与 sufficiency 降低 |
| 误召回率 | 不同生命周期记忆相互污染 | 通过 scope + metadata filter 下降 |
| 复杂问题完整率 | 多跳关系与旧事件问题易漏召回 | 通过 relation evidence + deep retrieval 提升 |
| 排障效率 | 难以解释“为什么召回了这条” | 通过 traceable context 明显提升 |
| 系统扩展性 | 新增多模态/多 agent 能力成本高 | 通过统一 schema 与接口预留降低 |

建议同步建立四类评测集：**闲聊免检索集、个性化短答集、跨会话追忆集、复杂关系推理集**。每次迭代至少比较回答质量、检索耗时、注入 token 数、无效召回比例和人工可解释性评分，从而避免“功能越来越多，但系统越来越不可控”的风险。

## 9. 最终建议

如果只能从 Mem0 和 MemU 中各拿一个最值得做的特性，我建议 SmartAgent4 **优先吸收 Mem0 的“作用域分层 + 元数据过滤”**，以及 **MemU 的“渐进式检索 + 充分性早停”**。前者解决的是“记忆边界不清、检索不准”的根问题，后者解决的是“检索链路不够聪明、经常搜过头”的效率问题。相比之下，图数据库重构、多模态全量落地、主动引擎全面升级都更适合作为第二阶段或第三阶段目标。

换言之，SmartAgent4 下一版记忆系统最值得追求的，不是“再多记一些”，而是 **更知道该搜什么、该停在哪里、该如何证明自己为什么这样搜到**。这会比单纯扩大记忆规模更快地产生实际产品价值。

## References

[1]: https://github.com/yangli0403/SmartAgent4/blob/windows-compat/server/agent/supervisor/contextEnrichNode.ts "SmartAgent4 contextEnrichNode.ts"
[2]: https://github.com/yangli0403/SmartAgent4/blob/windows-compat/server/memory/preRetrievalDecision.ts "SmartAgent4 preRetrievalDecision.ts"
[3]: https://github.com/yangli0403/SmartAgent4/blob/windows-compat/server/memory/memorySystem.ts "SmartAgent4 memorySystem.ts"
[4]: https://github.com/yangli0403/SmartAgent4/blob/windows-compat/server/memory/proactiveEngine.ts "SmartAgent4 proactiveEngine.ts"
[5]: https://docs.mem0.ai/open-source/overview "Mem0 Open Source Overview"
[6]: https://docs.mem0.ai/core-concepts/memory-types "Mem0 Memory Types"
[7]: https://docs.mem0.ai/open-source/features/graph-memory "Mem0 Graph Memory"
[8]: https://docs.mem0.ai/open-source/features/metadata-filtering#enhanced-metadata-filtering "Mem0 Enhanced Metadata Filtering"
[9]: https://memu.pro/ai-agent-memory-retrieval "MemU Memory Retrieval"
[10]: https://github.com/NevaMind-AI/memU "MemU GitHub Repository"
[11]: https://github.com/yangli0403/SmartAgent4/blob/windows-compat/MEMORY_SYSTEM_UPGRADE_PLAN.md "SmartAgent4 MEMORY_SYSTEM_UPGRADE_PLAN.md"
