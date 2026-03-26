# REPO_ANALYSIS.md — 仓库分析与范围界定

**阶段**：Phase 1 — 分析与范围界定
**日期**：2026-03-26
**目标**：将 AIRI 形象（Live2D/VRM）集成到 SmartAgent4（windows-compat 分支）

---

## 1. SmartAgent4（windows-compat 分支）仓库概况

### 1.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端框架 | React 18 + TypeScript + Vite |
| UI 组件 | shadcn/ui + Tailwind CSS |
| 后端框架 | Express + tRPC |
| AI 编排 | LangGraph (StateGraph) + LangChain |
| 数据库 | MySQL + Drizzle ORM |
| 认证 | OAuth2（Manus Auth） |
| 语音 | DashScope ASR (WebSocket) |
| 情感 | Emotions-System 微服务 (Python, HTTP) |

### 1.2 核心架构

SmartAgent4 采用 **Supervisor-Agent** 编排模式：

```
START → contextEnrich → classify → [plan|execute] → execute → replan → [execute|respond] → memoryExtract → reflection → END
```

关键模块：

- **SmartAgentApp** (`server/agent/smartAgentApp.ts`)：应用入口单例，提供 `chat()` 统一接口
- **SupervisorGraph** (`server/agent/supervisor/supervisorGraph.ts`)：LangGraph 编排图
- **EmotionsSystemClient** (`server/emotions/emotionsClient.ts`)：情感/TTS 客户端
- **PersonalityEngine** (`server/personality/personalityEngine.ts`)：人格引擎
- **tRPC Router** (`server/routers.ts`)：API 路由层

### 1.3 关键接口

**SupervisorOutput**（当前输出契约）：
```typescript
interface SupervisorOutput {
  response: string;          // 文本回复（含 [tag:value] 情感标签）
  classification: { domain: string; complexity: string };
  stepsExecuted: number;
  totalToolCalls: number;
  totalDurationMs: number;
  characterId: string;
}
```

**MultimodalSegment**（情感层已定义但未暴露到主流程）：
```typescript
interface MultimodalSegment {
  text: string;
  audioBase64?: string;
  audioFormat: string;
  emotion: EmotionType;      // "neutral"|"happy"|"sad"|"angry"|"surprised"|"fearful"|"disgusted"
  actions: EmotionAction[];  // { type: ActionType, value: string, duration?: number }
}
```

### 1.4 关键发现

1. **Supervisor 输出仅为纯文本**：`SupervisorOutput.response` 是 `string` 类型，虽然文本中包含 `[emotion:happy]`、`[expression:smile]` 等标签，但并未被解析为结构化多模态数据
2. **EmotionsSystemClient 已具备多模态渲染能力**：`render()` 方法可将带标签文本转换为 `MultimodalSegment[]`，但此能力未被 `chat.sendMessage` tRPC 路由使用
3. **前端仅消费纯文本**：`Cockpit.tsx` 只读取 `data.response` 字符串，不处理音频或表情数据
4. **人格系统完善**：支持 ElizaOS Characterfile 格式，已有 xiaozhi/jarvis/alfred 三个预设角色

---

## 2. AIRI 仓库概况

### 2.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端框架 | Vue 3 + TypeScript |
| 3D 渲染 | Three.js + @pixiv/three-vrm (VRM) |
| 2D 渲染 | pixi-live2d-display (Live2D) |
| 桌面端 | Tauri (Rust) + Electron |
| 移动端 | Capacitor (PWA) |
| 后端 | Hono (TypeScript) |
| 通信协议 | WebSocket (plugin-protocol) |
| 口型同步 | wlipsync (WebAssembly) |

### 2.2 核心架构

AIRI 采用 **模块化插件架构**：

- **Plugin Protocol** (`packages/plugin-protocol`)：定义所有事件类型的 WebSocket 协议
- **Server SDK** (`packages/server-sdk`)：WebSocket 客户端，支持模块认证、心跳、事件收发
- **Stage UI - Live2D** (`packages/stage-ui-live2d`)：Live2D 模型渲染、口型、表情控制
- **Stage UI - Three** (`packages/stage-ui-three`)：VRM 模型渲染、口型同步、表情驱动
- **Model Driver Lipsync** (`packages/model-driver-lipsync`)：口型同步引擎

### 2.3 关键接口

**Plugin Protocol 事件体系**（核心通信协议）：
```typescript
// 输入事件
'input:text':       { text: string; overrides?: InputMessageOverrides }
'input:text:voice': { transcription: string; textRaw?: string }
'input:voice':      { audio: ArrayBuffer }

// 输出事件
'output:gen-ai:chat:message':  { message: AssistantMessage }
'output:gen-ai:chat:complete': { message: AssistantMessage; toolCalls: ToolMessage[]; usage: OutputGenAiChatUsage }
```

**VRM 模型控制接口**（`VRMModel.vue` expose）：
```typescript
setExpression(expression: string, intensity: number): void
lookAtUpdate(target: Vector3): void
setVrmFrameHook(hook: Function): void
// 口型同步：通过 currentAudioSource prop 传入 AudioBufferSourceNode
```

**Live2D 模型控制接口**（`Model.vue`）：
```typescript
// 通过 props 驱动
mouthOpenSize: number          // 嘴巴开合度
focusAt: { x: number, y: number }  // 注视方向
// 通过 store 驱动
modelParameters.mouthOpen      // → ParamMouthOpenY
modelParameters.mouthForm      // → ParamMouthForm
setMotion(motionName, index)   // 触发动作
```

### 2.4 关键发现

1. **Live2D 层已完全就绪**：支持口型参数驱动（`ParamMouthOpenY`）、motion 触发、表情控制，且不依赖骨骼结构，天然支持非人形角色
2. **VRM 层支持完善但有限制**：VRM 强制要求人形骨骼，非人形角色需"伪人形绑定"
3. **Plugin Protocol 是标准集成点**：AIRI 的所有模块通过 WebSocket 事件通信，SmartAgent4 可作为一个 Plugin Module 接入
4. **Server SDK 提供完整的客户端实现**：`@proj-airi/server-sdk` 的 `Client` 类支持认证、心跳、事件监听/发送

---

## 3. 集成范围界定

### 3.1 集成目标

将 SmartAgent4 作为 **"大脑"（AI 后端）**，将 AIRI 作为 **"身体"（形象前端）**，实现：

1. SmartAgent4 的 AI 回复驱动 AIRI 角色的语音、表情和动作
2. AIRI 前端的用户语音/文本输入转发到 SmartAgent4 处理
3. SmartAgent4 的情感标签映射到 AIRI 角色的表情和动作

### 3.2 集成策略：SmartAgent4 Plugin Bridge

**核心思路**：在 SmartAgent4 侧开发一个 **AIRI Bridge 模块**，通过 AIRI 的 Plugin Protocol（WebSocket）与 AIRI 前端通信。

```
[AIRI 前端] ←WebSocket→ [AIRI Server Runtime] ←WebSocket→ [SmartAgent4 AIRI Bridge]
                                                                    ↓
                                                            [SmartAgent4 Supervisor]
                                                                    ↓
                                                            [LangGraph 编排 + MCP 工具]
```

### 3.3 范围内（In Scope）

| 编号 | 工作项 | 说明 |
|------|--------|------|
| S1 | **扩展 SupervisorOutput** | 在 Supervisor 输出中增加 `multimodalSegments` 字段 |
| S2 | **AIRI Bridge 服务** | 实现 AIRI Plugin Protocol 的 WebSocket 客户端 |
| S3 | **情感映射层** | SmartAgent4 EmotionType → AIRI 表情/动作映射 |
| S4 | **音频桥接** | 将 SmartAgent4 的 audioBase64 转换为 AIRI 可消费的音频流 |
| S5 | **输入转发** | 将 AIRI 的 input:text/input:text:voice 转发到 SmartAgent4 chat() |
| S6 | **tRPC 路由扩展** | 新增 airi.* 路由用于管理 Bridge 连接状态 |

### 3.4 范围外（Out of Scope）

| 编号 | 排除项 | 原因 |
|------|--------|------|
| O1 | AIRI 前端 Vue 组件修改 | AIRI 前端通过标准 Plugin Protocol 消费数据，无需修改 |
| O2 | Live2D/VRM 模型制作 | 属于美术资产范畴，不在代码集成范围内 |
| O3 | AIRI Server Runtime 修改 | Bridge 作为标准 Plugin Module 接入，不修改 AIRI 核心 |
| O4 | SmartAgent4 前端 Cockpit 修改 | 集成后 AIRI 前端替代 Cockpit 作为展示层 |

### 3.5 技术风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| AIRI Plugin Protocol 快速迭代 | 中 | 使用 @proj-airi/server-sdk 抽象层，减少直接协议依赖 |
| 音频格式兼容性 | 低 | SmartAgent4 输出 WAV base64，AIRI 可直接解码为 AudioBuffer |
| 情感标签粒度不匹配 | 低 | 建立映射表，SmartAgent4 的 7 种情感可覆盖 AIRI 常用表情 |
| WebSocket 连接稳定性 | 中 | Server SDK 内置自动重连和心跳机制 |

---

## 4. 依赖关系

### 4.1 SmartAgent4 侧新增依赖

```
@proj-airi/server-sdk    — AIRI WebSocket 客户端
@proj-airi/server-shared — 共享类型定义
crossws                  — 跨平台 WebSocket（server-sdk 依赖）
superjson                — 序列化（server-sdk 依赖）
```

### 4.2 无需修改的现有模块

- SmartAgent4 Supervisor Graph（仅扩展输出类型）
- SmartAgent4 EmotionsSystemClient（已有 render() 能力）
- SmartAgent4 PersonalityEngine（角色系统保持不变）
- AIRI 前端所有组件（通过标准协议消费）
