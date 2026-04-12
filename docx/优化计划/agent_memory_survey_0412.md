# 智能体记忆系统综述检索与相关性整理（2026-04-12）

**作者：Manus AI**

本文面向你当前的 **SmartAgent4 多智能体、路由、规划与记忆系统** 场景，筛选了与 **Agent Memory / LLM Agent Memory / Multi-Agent Memory** 最相关的资料。英文部分优先选择真正的综述论文；中文部分由于可稳定访问的正式中文学术综述较少，因此我采用了“**中文可读综述入口**”的口径，既包含中文技术综述页，也包含能直接跳转原始论文的中文解读页面。这样做的目的，是保证你既能快速阅读中文内容，又能顺手进入原文 PDF 继续深挖。[1] [2] [3] [4]

## 一、总览结论

如果你是要为 **SmartAgent4** 的下一阶段记忆系统演进找理论基础，我建议把英文部分的三篇作为主阅读材料，其中 **多智能体记忆综述** 最直接对应你的 supervisor-routing、shared context、跨 agent 状态共享与协作调度；而 **自主智能体记忆机制与评测综述** 更适合指导工程实现，例如记忆写入策略、冲突消解、评测基准和延迟预算。[1] [2] [4]

中文部分更适合做快速进入与内部沟通材料。尤其是两篇中文解读页，已经把英文长文的结构和核心概念转成中文框架，便于团队先建立共识，再回到原文做细读；而两篇工程向中文综述则更贴近你当前系统可能会做的 **Memory Store、Reflection、Context Compression、经验写回、会话级与任务级记忆分层** 等设计。[3] [5] [6]

## 二、英文综述论文（3 篇）

| 序号 | 题名 | 类型 | 下载地址 | 与当前系统的相关性 |
|---|---|---|---|---|
| 1 | *A Survey on the Memory Mechanism of Large Language Model based Agents* | 学术综述 | [PDF 下载][1] | 适合做单智能体与通用 Agent Memory 基础框架 |
| 2 | *Memory in LLM-based Multi-agent Systems: Mechanisms, Challenges, and Collective Intelligence* | 学术综述 | [PDF 下载][2] | 与多智能体协作、共享记忆、权限与一致性最相关 |
| 3 | *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers* | 学术综述 | [PDF 下载][4] | 与工程落地、记忆评测、写入-管理-读取闭环最相关 |

### 1. A Survey on the Memory Mechanism of Large Language Model based Agents

这篇论文是当前 **LLM-based Agent 记忆机制** 的基础综述之一。论文从记忆的定义、必要性、结构设计、存储与检索方式、评测方式以及应用场景出发，对基于大模型的智能体为何需要 memory，以及 memory 应该如何嵌入 agent 生命周期，做了较系统的梳理。[1]

对于 **SmartAgent4** 而言，这篇文章最有价值的地方不在于“教你怎么做多智能体”，而在于它为你提供了一个较稳定的 **通用记忆抽象基座**。如果你未来要把当前系统中的 conversation history、task state、tool trace、user preference、reflection note 等信息收敛成统一记忆层，这篇文章适合作为第一性框架参考。[1]

建议重点关注文中关于 **memory taxonomy、retrieval、updating、evaluation** 的讨论，因为这恰好能对接你当前项目里可能要补强的几个问题：什么信息值得写入，写到哪里，何时读取，如何证明记忆真的提升了任务完成率而不是仅仅增加上下文噪声。[1]

### 2. Memory in LLM-based Multi-agent Systems: Mechanisms, Challenges, and Collective Intelligence

这篇综述是目前与你系统贴合度最高的一篇。它不是把 memory 当作单个 agent 的附属能力，而是把它视作 **多智能体系统的共享认知基础设施**。论文明确强调，在多智能体场景下，记忆不仅仅是“存下来”，更涉及 **共享、同步、权限控制、演化、一致性、安全性、可扩展性** 等系统级问题。[2]

> 该文将多智能体记忆视为 *shared cognitive infrastructure*，系统覆盖 memory architectures、management and operations、evaluation、application，并特别讨论 synchronization、access control、scalability、alignment 与 safety 等挑战。[2]

这与 **SmartAgent4** 当前的 supervisor + domain agent 结构高度相关。你的系统一旦从“分类后交给单 agent 处理”走向“多个 agent 协同执行”，就会立刻遇到几个记忆层难题：第一，哪些记忆是全局共享的，哪些只能局部可见；第二，某个 agent 写入的经验是否会污染其他 agent；第三，多个 agent 观察到互相矛盾的事实时如何处理；第四，长期记忆如何参与路由与规划，而不只是作为聊天历史的附属记录。[2]

如果你只选一篇和当前系统做深度对照，这篇应当排第一。

### 3. Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers

这篇论文的强项是把记忆视作一个 **write-manage-read** 的闭环，而不是单点能力。它不仅讨论记忆如何存，还讨论记忆如何被筛选、组织、压缩、更新、淘汰、评测，以及如何在真实系统中面对 latency、privacy、cost 与 reliability 的工程约束。[4]

对于你的系统，这篇文章尤其适合支撑“从架构设计走向实现细则”的那一步。例如，你可以据此把记忆系统拆成三个子模块：**写入门控器**、**记忆管理器**、**检索注入器**。前者判断事件是否值得持久化，中间层负责聚合、压缩、去重和冲突管理，后者则按当前任务阶段把最相关记忆注入 planner 或 executor。[4]

如果你后续准备为 SmartAgent4 建立记忆评测集，例如考察 **跨轮一致性、长期任务恢复、用户偏好保持、跨 agent 共享成功率、错误记忆抑制率**，这篇论文会很有帮助。[4]

## 三、中文综述入口（3 篇）

| 序号 | 中文入口 | 类型 | 可访问/下载地址 | 与当前系统的相关性 |
|---|---|---|---|---|
| 1 | 《Memory for Autonomous LLM Agents》中文解读页 | 中文综述解读 | [中文页][5] / [原文 PDF][4] | 适合团队快速理解工程型记忆闭环 |
| 2 | 《A Survey on the Memory Mechanism of Large Language Model-based Agents》中文解读页 | 中文综述解读 | [中文页][6] / [原文 PDF][1] | 适合快速建立记忆机制全景框架 |
| 3 | 《从无状态到有记忆：AI Agent 记忆系统的演进与 Cortex Memory 的实践》 | 中文工程综述 | [文章地址][7] | 更贴近记忆工程化与系统改造实践 |

### 1. 《Memory for Autonomous LLM Agents》中文解读页

这一中文页面对英文原综述做了较完整的技术摘要，内容覆盖 **写入—管理—读取闭环、三维记忆分类、五类核心技术、评测问题与工程挑战**，适合团队成员先用中文建立概念框架，再进入英文原文。[5]

它与 SmartAgent4 的关系，在于它强调的并不是某一种具体数据库或向量库，而是 **memory pipeline**。这很适合你当前的系统改造路径：先在 supervisor 层决定是否需要 memory，再在 planner/executor 过程中决定读什么记忆、写什么记忆，而不是把 memory 简化成一次向量检索。[4] [5]

### 2. 《A Survey on the Memory Mechanism of Large Language Model-based Agents》中文解读页

这个中文入口的价值在于它直接围绕原论文进行中文化重述，并提供进入原始论文与 PDF 的入口，适合做“快速通读 + 原文跳转”。虽然页面本身更像解读站而非正式期刊页面，但对于阅读效率很友好。[6]

如果你要向非论文型读者解释“为什么 Agent 不等于简单聊天上下文、为什么需要长期记忆与结构化记忆”，这一中文页比直接扔原文更合适。它也适合作为你团队内记忆系统方案讨论时的先读材料。[1] [6]

### 3. 《从无状态到有记忆：AI Agent 记忆系统的演进与 Cortex Memory 的实践》

这篇中文工程综述不是严格意义上的学术综述论文，但它有一个明显优势：它把 Agent Memory 放进了 **真实系统实现** 语境，讨论了无状态到有记忆的演进、Agent Memory 与 RAG/Context Engineering 的边界，以及工程实践中的设计取舍。[7]

如果你的目标不是写论文，而是改造 SmartAgent4，那么这类文章反而很有现实价值。它能帮助你更快判断：哪些能力应该做成“显式记忆层”，哪些其实只需要更好的任务状态管理，哪些又应由 planner 自己完成而非落库。[7]

## 四、一个可作为补充的中文入口

除了以上三篇，我还建议把《【综述】AI智能体时代下的记忆》作为补充阅读。该页面本身是中文综述文章，且直接给出了英文原综述 *Memory in the Age of AI Agents* 的 PDF 链接，适合作为第四篇备用入口。[3] [8]

这篇原始英文综述的特点，是从 **forms、functions、dynamics** 三个维度重构了 memory taxonomy，并覆盖 token-level、parametric、latent memory、多模态记忆、多智能体记忆、benchmark 与可信性问题。若你要设计一个更统一的记忆抽象层，它比单纯的“长期记忆/短期记忆”二分法更有启发性。[3]

## 五、与 SmartAgent4 的直接映射建议

为了避免“看完综述很多，但不知道怎么落到代码里”，我把六篇材料和你当前系统的改造方向做一个直接映射。

| SmartAgent4 改造点 | 最应优先阅读的材料 | 原因 |
|---|---|---|
| 单 agent 记忆抽象与基础 taxonomy | 英文 1 | 适合建立统一记忆层概念模型 |
| 多 agent 共享记忆、权限、同步、一致性 | 英文 2 | 与 supervisor + domain agent 结构最贴近 |
| 写入门控、压缩、淘汰、评测 | 英文 3 | 最适合工程实现与指标设计 |
| 团队内部中文沟通与快速对齐 | 中文 1、中文 2 | 便于先建立概念，再读原文 |
| 记忆系统工程落地与实践改造 | 中文 3 | 更贴近系统设计与落地讨论 |
| 统一记忆分类框架与前沿扩展 | 补充阅读《Memory in the Age of AI Agents》 | 适合设计更强泛化的 memory schema |

结合你当前系统，我的建议是：**先读英文 2，再读英文 3，然后用英文 1 校准基础概念；中文部分则优先读中文 1 和中文 3。** 这样能最快从“知道要做记忆”过渡到“知道应该把记忆加在哪一层、以什么结构加入、如何评估是否有效”。[1] [2] [4] [5] [7]

## 六、最终推荐阅读顺序

| 顺序 | 材料 | 目的 |
|---|---|---|
| 1 | 英文 2：多智能体记忆综述 | 先解决与你当前系统最相关的问题 |
| 2 | 英文 3：自主智能体记忆与评测 | 再解决落地与评测问题 |
| 3 | 中文 1：Autonomous LLM Agents 中文解读 | 帮助团队快速同步工程概念 |
| 4 | 中文 3：Cortex Memory 实践综述 | 连接理论与工程落地 |
| 5 | 英文 1：LLM-based Agents 记忆机制综述 | 回补基础分类与完整框架 |
| 6 | 补充：Memory in the Age of AI Agents | 扩展到更统一、更前沿的 taxonomy |

## References

[1]: https://arxiv.org/pdf/2404.13501 "A Survey on the Memory Mechanism of Large Language Model based Agents - PDF"
[2]: https://www.techrxiv.org/doi/pdf/10.36227/techrxiv.176539617.79044553/v1 "Memory in LLM-based Multi-agent Systems: Mechanisms, Challenges, and Collective Intelligence - PDF"
[3]: https://arxiv.org/pdf/2512.13564 "Memory in the Age of AI Agents - PDF"
[4]: https://arxiv.org/pdf/2603.07670 "Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers - PDF"
[5]: https://gist.science/zh/paper/2603.07670 "Memory for Autonomous LLM Agents 中文解读页"
[6]: https://www.themoonlight.io/zh/review/a-survey-on-the-memory-mechanism-of-large-language-model-based-agents "A Survey on the Memory Mechanism of Large Language Model-based Agents 中文解读页"
[7]: https://www.cnblogs.com/wJiang/p/19412169 "从无状态到有记忆：AI Agent 记忆系统的演进与 Cortex Memory 的实践"
[8]: https://www.cnblogs.com/emergence/p/19435071 "【综述】AI智能体时代下的记忆"
