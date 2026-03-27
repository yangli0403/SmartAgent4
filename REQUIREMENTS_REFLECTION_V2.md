# 第5阶段：需求反思 — 第三轮迭代（多智能体协同架构）

> **版本**：V2（架构解耦迭代）
> **日期**：2026-03-27
> **基于**：《SmartAgent4 架构分析与演进报告 V2：从"单体编排"走向"多智能体协同"》

## 1. 目标回顾

本轮迭代的核心目标是实现修改可行报告中"第二阶段：架构解耦"的三个关键机制：

1. **Agent Card 动态发现**：打破硬编码注册表，引入 JSON 配置文件 + AgentCardRegistry 动态注册表
2. **动态 Prompt 组装**：classifyNode 和 planNode 的 Prompt 不再写死 Agent 列表，运行时自动拼接
3. **并行执行引擎 + 委托协议**：基于 DAG 的 Promise.all 并行分发 + Agent 间横向委托

## 2. 实现与设计的对比验证

### 2.1 Agent Card 动态发现机制

| 设计要求 | 实际实现 | 一致性 |
|----------|----------|--------|
| Agent Card JSON 文件存储在 `agent-cards/` 目录 | 4 个 JSON 文件已创建 | 完全一致 |
| AgentCardRegistry 启动时扫描目录加载 | `loadFromDirectory()` 实现 | 完全一致 |
| Zod Schema 校验 JSON 格式 | `AgentCardSchema` 定义完整 | 完全一致 |
| 支持注册、注销、按能力查询 | `register()`、`unregister()`、`findByCapability()` | 完全一致 |
| 单例模式 | `getAgentCardRegistry()` | 完全一致 |
| 错误隔离（坏文件不影响其他 Agent） | `loadFromDirectory()` 中 try-catch 跳过错误文件 | 完全一致 |

### 2.2 动态 Prompt 组装

| 设计要求 | 实际实现 | 一致性 |
|----------|----------|--------|
| classifyNode Prompt 动态生成 | `DynamicPromptAssembler.buildClassifyPrompt()` 注入 | 完全一致 |
| planNode Prompt 动态生成 | `DynamicPromptAssembler.buildPlanPrompt()` 注入 | 完全一致 |
| Prompt 包含 Agent 名称、描述和工具列表 | `formatAgentSection()` 渲染完整信息 | 完全一致 |
| 支持 `dependsOn` 并行提示 | Prompt 中明确指导"无依赖步骤置空 dependsOn" | 完全一致 |

### 2.3 并行执行引擎

| 设计要求 | 实际实现 | 一致性 |
|----------|----------|--------|
| 基于 `PlanStep.dependsOn` 构建 DAG | Kahn 算法拓扑排序 | 完全一致 |
| 无依赖步骤 Promise.all 并行 | `createParallelExecuteNode()` 实现 | 完全一致 |
| 循环依赖检测和降级 | 检测后将未处理步骤作为最后批次 | 完全一致 |
| `inputMapping` 解析 | `resolveInputMapping()` 支持 `step_N.field` 格式 | 完全一致 |

### 2.4 委托协议

| 设计要求 | 实际实现 | 一致性 |
|----------|----------|--------|
| BaseAgent 新增 `delegate()` 方法 | 已实现 | 完全一致 |
| 通过 AgentCardRegistry 查找目标 Agent | `findByCapability()` 按能力匹配 | 完全一致 |
| 委托深度限制（默认3层） | `MAX_DELEGATE_DEPTH = 3` | 完全一致 |
| 同步直接方法调用 | 直接调用 `agent.execute()` | 完全一致 |

### 2.5 核心模块改造

| 设计要求 | 实际实现 | 一致性 |
|----------|----------|--------|
| `targetAgent` 从联合字面量改为 `string` | `state.ts` 已改造 | 完全一致 |
| `smartAgentApp.ts` 使用 AgentCardRegistry | 初始化流程完整改造 | 完全一致 |
| `supervisorGraph.ts` 支持双模式 | `IAgentCardRegistry \| AgentRegistry` 类型联合 | 完全一致 |
| 旧 AgentRegistry 兼容降级 | `isNewRegistry` 判断后降级 | 完全一致 |

## 3. 发现的问题列表

### 问题1（严重）：navigationAgent.json 工具名与真实实现严重不匹配

**描述**：`agent-cards/navigationAgent.json` 中声明的工具名与 `domains/navigationAgent.ts` 中的真实工具名存在大量偏差。

| Agent Card 中的工具名（错误） | 真实实现中的工具名（正确） |
|-------------------------------|---------------------------|
| `maps_search_around` | `maps_around_search` |
| `maps_search_keyword` | `maps_text_search` |
| `maps_direction_transit` | `maps_direction_transit_integrated` |
| `maps_geocode` | `maps_geo` |
| `maps_navigation` | `maps_schema_navi` |
| `maps_riding_taxi` | `maps_schema_take_taxi` |
| `maps_poi_detail` | `maps_search_detail` |
| `maps_static_map`（不存在） | — |
| `maps_coordinate_convert`（不存在） | — |
| — | `free_weather_by_city`（缺失） |
| — | `free_weather_by_coords`（缺失） |
| — | `free_ip_location`（缺失） |
| — | `free_geocode_city`（缺失） |
| — | `maps_schema_personal_map`（缺失） |

**影响**：`DynamicPromptAssembler` 会将错误的工具名注入到 LLM 规划 Prompt 中，导致 LLM 生成引用不存在工具的执行计划。

**严重级别**：严重

### 问题2（中等）：fileAgent.json 缺少文件整理工具和能力标签

**描述**：`agent-cards/fileAgent.json` 只声明了 11 个基础工具，但真实实现还包含 4 个文件整理工具（`analyze_directory`、`find_duplicates`、`delete_files`、`move_files`）。同时缺少 `file_organization` 和 `duplicate_detection` 能力标签。

**影响**：文件整理功能无法被动态 Prompt 暴露给 LLM，也无法通过委托协议被发现。

**严重级别**：中等

### 问题3（中等）：Agent Card 的 llmConfig 与真实实现不一致

**描述**：`navigationAgent.json` 和 `fileAgent.json` 的 `maxIterations: 5`，但真实实现均为 `8`；`maxTokens` 也存在偏差。

**影响**：当前无运行时影响（Agent 实例仍使用自身配置），但存在潜在风险。

**严重级别**：中等

### 问题4（低）：findByCapability 使用 includes 模糊匹配

**描述**：`AgentCardRegistry.findByCapability()` 使用 `includes()` 子串匹配，可能导致 `"search"` 同时匹配 `"poi_search"`、`"music_search"`、`"file_search"` 三个不相关的 Agent。

**影响**：委托协议中按能力查找可能返回不相关结果。

**严重级别**：低

## 4. 采取的纠正措施

### 修复1：navigationAgent.json 工具名对齐

将所有工具名替换为与 `navigationAgent.ts` 中 `toolNames` 完全一致的名称，新增免费内置工具，移除不存在的工具，更新 `llmConfig`。

### 修复2：fileAgent.json 补充文件整理工具

新增 4 个文件整理工具和 2 个能力标签，更新 `description` 和 `llmConfig`。

### 修复3：findByCapability 改为精确匹配

将 `.includes()` 改为 `===` 精确匹配（大小写不敏感），确保委托协议的能力查找精确可靠。

## 5. 最终验证结果

### 5.1 Agent Card 与实现对齐验证

| Agent | Card 工具数 | 实现工具数 | 一致性 |
|-------|------------|------------|--------|
| navigationAgent | 19 | 19 | 完全一致 |
| fileAgent | 15 | 15 | 完全一致 |
| multimediaAgent | 8 | 8 | 完全一致 |
| generalAgent | 0 | 0 | 完全一致 |

### 5.2 接口实现完整性

所有 `INTERFACE_DESIGN.md` 中定义的接口和方法均已在代码中实现，无遗漏。

### 5.3 架构设计符合性

所有 `ARCHITECTURE.md` 中的设计决策均已在代码中体现。

### 5.4 TypeScript 编译检查

所有新增和修改的文件通过编译检查，零错误。现有编译错误全部来自之前就存在的文件。

### 5.5 总结

本次需求反思发现了 **4 个问题**（1 个严重、2 个中等、1 个低），全部已修复。系统已准备好进入测试阶段。
