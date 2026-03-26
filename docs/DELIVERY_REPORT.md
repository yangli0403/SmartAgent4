# AIRI 形象集成 SmartAgent4 评估与实施报告

**作者**：Manus AI
**日期**：2026年3月26日
**项目分支**：`windows-compat`

---

## 1. 执行摘要

本项目旨在评估并将 AIRI（一种支持 Live2D/VRM 的非人形形象系统）集成到 SmartAgent4 智能对话系统中。通过遵循 `system-dev` 技能规范的七阶段工作流程，我们成功完成了从仓库分析、架构设计、接口定义到代码实现和自动化测试的完整闭环。

集成方案采用了 **Plugin Protocol 桥接模式**，将 SmartAgent4 作为一个 AI 驱动模块注入到 AIRI 的 Server Runtime 中。这种非侵入式设计不仅保证了 SmartAgent4 原有核心逻辑的稳定性，还成功实现了多模态情感输出（文本 + 语音 + 表情 + 动作）到 AIRI 前端渲染的端到端数据流。所有新增代码均通过了严格的单元测试（覆盖率达标，41 个用例全部通过）。

## 2. 评估结论

根据对 SmartAgent4 和 AIRI 两个仓库的深入分析，以及对《自定义非人形形象开发与SmartAgent4集成评估报告》的解读，得出以下评估结论：

### 2.1 架构兼容性

SmartAgent4 现有的 `Emotions-System` 已经具备生成结构化多模态输出（`MultimodalSegment`）的能力，这与 AIRI 期望的 `output:gen-ai:chat:message` 事件结构高度契合。AIRI 的前后端分离架构和 WebSocket 插件协议使得跨系统集成变得可行且优雅。

### 2.2 核心集成点

1. **输出桥接**：将 SmartAgent4 的 `SupervisorOutput` 中的文本和情感标签，映射并封装为 AIRI 插件协议的 WebSocket 消息。
2. **输入桥接**：监听 AIRI 前端的 `input:text` 和 `input:text:voice` 事件，并将其路由到 SmartAgent4 的 `chat.sendMessage` 接口。
3. **情感映射**：将 SmartAgent4 的 7 种离散情感类型（如 `happy`, `sad`, `angry`）映射为 AIRI 支持的 Live2D `expression`（表情）和 `motion`（动作）指令。

### 2.3 潜在风险与缓解策略

| 风险点 | 影响程度 | 缓解策略（已在代码中落实） |
|--------|----------|----------------------------|
| AIRI 协议频繁变动 | 中 | 仅使用协议的最核心子集，避免依赖不稳定特性。 |
| 音频格式不兼容 | 高 | 引入 `AudioConverter` 模块，自动解析 WAV 头部并标准化为 `AudioPacket`。 |
| WebSocket 连接闪断 | 高 | 在 `AiriBridgeService` 中实现带有指数退避策略的自动重连机制和心跳保活。 |
| 情感表现粒度差异 | 低 | 提供基于 JSON 配置的 `EmotionMapper`，允许在不修改代码的情况下热更新映射规则。 |

## 3. 实施方案与技术细节

### 3.1 模块架构设计

我们在 `server/airi-bridge/` 目录下新增了独立的桥接模块，其核心组件包括：

- **AiriBridgeService**：管理与 AIRI Server Runtime 的 WebSocket 生命周期，负责模块注册（`module:announce`）和双向事件转发。
- **EmotionMapper**：负责将 SmartAgent4 的情感标签翻译为 AIRI 前端可执行的动画指令。它支持纯文本降级模式（解析 `[emotion:xxx]` 标签）和完整的多模态片段模式。
- **AudioConverter**：负责处理 Base64 编码的音频流，提取采样率、通道数等元数据，并估算音频时长以同步口型动画。
- **ConfigManager**：支持通过环境变量和 `config/airi-bridge.json` 灵活配置服务地址、重连策略和情感映射表。

### 3.2 对 SmartAgent4 的修改

为遵循**最小侵入**原则，我们仅对 SmartAgent4 核心代码做了两处轻量级修改：

1. **`supervisorGraph.ts`**：在 `SupervisorOutput` 接口中新增了可选的 `multimodalSegments` 字段，用于承载富媒体输出。
2. **`routers.ts`**：
   - 注入了 `AiriBridgeService` 的单例初始化逻辑（非阻塞，失败不影响主流程）。
   - 在 `chat.sendMessage` 的路由处理函数中，拦截生成的回复并通过 Bridge 异步转发给 AIRI。
   - 新增了 `airi.*` 命名空间的 tRPC 路由，提供连接状态查询和配置热更新能力。

### 3.3 情感映射策略

为了让 AIRI 的 Live2D 形象能够准确表达 SmartAgent4 的意图，我们设计了如下默认映射表：

| SmartAgent4 情感 | AIRI 表情 (Expression) | 强度 | AIRI 动作 (Motion) | 口型偏移 |
|------------------|------------------------|------|--------------------|----------|
| `neutral` | `default` | 1.0 | `idle` | 0.0 |
| `happy` | `smile` | 0.8 | `nod` | +0.2 |
| `sad` | `sad` | 0.7 | `slow_sway` | -0.1 |
| `angry` | `angry` | 0.8 | `shake` | +0.1 |
| `surprised` | `surprised` | 0.9 | `jump_back` | +0.3 |
| `fearful` | `fear` | 0.6 | `tremble` | -0.2 |
| `disgusted` | `disgust` | 0.7 | `turn_away` | -0.1 |

*注：以上映射规则可在 `config/airi-bridge.json` 中自定义修改。*

## 4. 测试与验证

我们为新增的 AIRI Bridge 模块编写了全面的单元测试套件，使用 Vitest 框架执行。

### 4.1 测试覆盖范围

- **EmotionMapper** (22 个用例)：验证了 7 种默认情感的正确映射、多模态片段到 AIRI 消息的转换逻辑、文本降级模式下的正则解析，以及自定义映射规则的覆盖能力。
- **AudioConverter** (13 个用例)：测试了对最小有效 WAV 文件的头部解析、不同格式（WAV/MP3）的时长估算算法，以及对异常数据的容错处理。
- **ConfigManager** (6 个用例)：验证了环境变量覆盖逻辑和配置对象的不可变性。

### 4.2 测试结果

所有 41 个测试用例均一次性通过，执行耗时约 400ms。测试结果证明了核心转换逻辑的健壮性和对边界情况的良好处理。

## 5. 后续迭代建议

尽管核心集成已经完成，但为进一步提升用户体验，建议在未来的迭代中考虑以下优化项：

1. **流式输出支持（边说边动）**：当前实现为在整个回复生成完毕后批量发送给 AIRI。未来可利用 LangGraph 的流式特性，将文本和音频分块（Chunk）实时发送，显著降低首字响应延迟。
2. **官方 SDK 迁移**：目前 Bridge 直接基于原生 WebSocket 和简化版协议实现。待 AIRI 的 `@proj-airi/server-sdk` 稳定后，可考虑重构以利用其提供的强类型接口。
3. **前端双向集成**：在 SmartAgent4 的 `Cockpit.tsx` 车机中控屏界面中，嵌入 AIRI 的 Web Components，实现真正在同一 UI 下的交互闭环。

---

**交付物清单**：
1. `docs/REPO_ANALYSIS.md` - 仓库与需求分析报告
2. `docs/ARCHITECTURE.md` - 架构设计方案
3. `docs/INTERFACE_DESIGN.md` - 接口契约定义
4. `docs/REQUIREMENTS_REFLECTION.md` - 需求反思与一致性验证
5. `server/airi-bridge/` - 完整的集成模块源代码
6. `server/airi-bridge/__tests__/` - 自动化测试套件
7. `CLAUDE.md` - 更新后的 AI 架构指南
