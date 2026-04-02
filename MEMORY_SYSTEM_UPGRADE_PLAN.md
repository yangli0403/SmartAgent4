# SmartAgent4 记忆系统优化开发计划 (Phase 4 迭代)

## 1. 背景与目标

根据提供的《SmartAgent4 记忆系统优化开发计划》文档，当前系统存在多轮上下文割裂、提取时机僵化以及模糊指代处理困难等问题。本次迭代的核心目标是引入**"记忆技能化"（Skills-based Memory）**理念，将记忆的定义权和执行权交还给 Agent，实现从"被动捕获"到"主动调度"的范式转变。

## 2. 核心改造方案

### 2.1 废弃/降级现有四层过滤管道
- **目标文件**：`server/agent/supervisor/memoryExtractionNode.ts`
- **动作**：增加开关，默认关闭基于每轮对话的自动 `extractMemoriesFromConversation`。不再强求每轮对话都过一遍 LLM 提取，从而大幅降低 Token 消耗。

### 2.2 开发与注册记忆技能（Tools）
- **目标文件**：新建 `server/agent/tools/memoryTools.ts`
- **动作**：封装底层数据库操作为 Agent 可调用的 Tools。
  - `memory_store`：允许 Agent 主动写入一条结构化记忆（底层调用 `addMemory`）。
  - `memory_search`：允许 Agent 主动检索记忆（底层调用 `hybridSearch` 或 `searchMemories`）。
  - `memory_update`：允许 Agent 修正错误/过期的记忆（底层调用 `updateMemory`）。
  - `memory_forget`：允许 Agent 删除错误/过期的记忆（底层调用 `deleteMemory`）。
- **注册**：将这些 Tools 注册到 Agent 的执行环境（如 `ToolRegistry` 或 `GeneralAgent` 的可用工具列表中）。

### 2.3 System Prompt 策略注入
- **目标文件**：`server/personality/personalityEngine.ts` 或 `server/agent/domains/generalAgent.ts`
- **动作**：在 Agent 的 System Prompt 中注入明确的调用策略，赋予其"何时用"的判断力。
  - **任务总结（Store）**：完成多轮任务后主动调用 `memory_store`。
  - **模糊消解（Search）**：遇到模糊指代时主动调用 `memory_search`。
  - **状态更新（Update/Forget）**：用户指出记忆有误或状态改变时主动调用更新或删除技能。

### 2.4 后台服务适配
- **目标文件**：`server/memory/consolidationService.ts` 和 `server/memory/proactiveEngine.ts`
- **动作**：确保 Agent 主动存入的 episodic 记忆依然能被 consolidationService 识别并定期升华为 semantic 记忆；确保主动存入的行为和偏好依然能被 proactiveEngine 读取。

## 3. 实施步骤

1. **Phase 1：基础技能封装与注册**
   - 创建 `memoryTools.ts` 并实现四个核心工具。
   - 在 `smartAgentApp.ts` 或 `toolRegistry.ts` 中注册这些工具。
2. **Phase 2：Prompt 调优与多轮任务测试**
   - 修改 `personalityEngine.ts` 注入记忆技能使用策略。
   - 编写测试用例验证 Agent 是否能在正确的时间点主动调用记忆技能。
3. **Phase 3：旧管线剥离与后台服务适配**
   - 修改 `memoryExtractionNode.ts` 降级自动提取。
   - 确保与现有后台服务的兼容性。

## 4. 预期收益
- **成本下降**：废弃每轮自动提取后，LLM Token 消耗预计降低 50%-80%。
- **记忆质量提升**：由 Agent 结合全局任务上下文进行主动总结，彻底解决多轮对话割裂问题。
- **交互更智能**：Agent 具备了"遇到不懂自己查笔记"的能力，能自然应对跨时间线的模糊指代。

---
> **作者**：Manus AI
> **日期**：2026-04-02
