# 分类器 Follow-up 误判根因分析

## 问题场景

1. 用户第一轮："给智能座舱的陈威发消息，安排下午14点讨论AI周会的事"
   → 分类为 office·simple → officeAgent → Agent 询问"请提供陈威的邮箱或手机号"

2. 用户第二轮："陈威的邮箱账号是：chenwei4@dreame.tech"
   → 分类为 general·simple → generalAgent → 仅回复"我已确认邮箱是..."，没有继续发消息

## 根因分析

### classifyNode 的输入
- `classifyNode` 从 `state.messages` 中只取**最后一条** HumanMessage 作为分类输入
- 虽然 `supervisorGraph.ts` 会把完整 conversationHistory 传入 state.messages，
  但 classifyNode 第 248-255 行只提取 `lastUserMessage`
- 分类 Prompt 中没有"最近对话摘要"或"上一轮任务域"信息

### LLM 分类视角
- LLM 只看到："陈威的邮箱账号是：chenwei4@dreame.tech"
- 这句话确实只是"陈述个人信息"，没有任何操作动词
- 按照 Prompt 中的规则，"仅陈述个人信息" → general·simple
- LLM 判断完全合理，问题在于缺少上下文

### 核心缺陷
**classifyNode 没有多轮对话的"意图延续"机制。**
每轮都是独立分类，不考虑上一轮的任务域和未完成状态。

## 优化方案

### 方案：在 classifyNode 中注入最近对话摘要

**原理**：将最近 N 条消息的摘要拼接到分类输入中，让 LLM 能看到上下文。

**具体改动**：

1. **classifyNode.ts**：
   - 在提取 `lastUserMessage` 后，额外构建最近对话摘要（最近 6 条消息）
   - 将摘要作为 `[对话上下文]` 拼接到 `fullMessage` 中
   
2. **分类 Prompt（CLASSIFY_SYSTEM_PROMPT + DynamicPromptAssembler.buildClassifyPrompt）**：
   - 新增规则：当用户消息是对上一轮 Agent 追问的回复（补充信息），应沿用上一轮的领域分类
   - 新增"意图延续"判断指引

3. **新增 refineClassificationForFollowUp 规则纠偏函数**：
   - 类似现有的 refineClassificationForMusicIntent 模式
   - 检测：如果上一轮是非 general 域，且当前轮被判为 general，且当前消息看起来是在补充信息（包含邮箱、手机号、ID 等），则沿用上一轮的域
