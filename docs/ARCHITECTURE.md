# ARCHITECTURE.md — 架构与设计

**阶段**：Phase 2 — 架构与设计
**日期**：2026-03-26
**目标**：定义 AIRI 形象集成到 SmartAgent4 的系统架构

---

## 1. 架构概览

### 1.1 设计原则

1. **最小侵入**：不修改 AIRI 前端代码，不修改 SmartAgent4 Supervisor 核心逻辑
2. **协议兼容**：通过 AIRI 标准 Plugin Protocol 通信，SmartAgent4 作为合法 Plugin Module
3. **渐进增强**：现有 SmartAgent4 Cockpit 前端继续可用，AIRI 形象作为可选增强
4. **关注点分离**：Bridge 层仅负责协议转换和数据映射，不包含业务逻辑

### 1.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        AIRI 前端层                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Live2D Model │  │  VRM Model   │  │  Audio Playback      │   │
│  │  (Vue组件)   │  │  (Vue组件)   │  │  (WebAudio API)      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│  ┌──────┴─────────────────┴──────────────────────┴───────────┐  │
│  │              AIRI Stage UI (表情/口型/动作消费)             │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                             │ Plugin Protocol Events             │
│  ┌──────────────────────────┴────────────────────────────────┐  │
│  │              AIRI Server Runtime (WebSocket Hub)            │  │
│  └──────────────────────────┬────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │ WebSocket (Plugin Protocol)
┌─────────────────────────────┼───────────────────────────────────┐
│                    SmartAgent4 服务层                             │
│  ┌──────────────────────────┴────────────────────────────────┐  │
│  │                  AIRI Bridge Service                        │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────────┐  │  │
│  │  │ WS Client   │ │ Emotion Map  │ │ Audio Converter    │  │  │
│  │  │ (server-sdk)│ │ (映射层)     │ │ (Base64→AudioBuf)  │  │  │
│  │  └──────┬──────┘ └──────┬───────┘ └────────┬───────────┘  │  │
│  └─────────┼───────────────┼──────────────────┼──────────────┘  │
│            │               │                  │                  │
│  ┌─────────┴───────────────┴──────────────────┴──────────────┐  │
│  │              SmartAgent4 Core                               │  │
│  │  ┌───────────────┐ ┌──────────────┐ ┌──────────────────┐  │  │
│  │  │ SmartAgentApp │ │ Emotions     │ │ Personality      │  │  │
│  │  │ (chat入口)    │ │ Client       │ │ Engine           │  │  │
│  │  └───────┬───────┘ └──────┬───────┘ └──────────────────┘  │  │
│  │          │                │                                │  │
│  │  ┌───────┴────────────────┴───────────────────────────┐   │  │
│  │  │         Supervisor Graph (LangGraph)                │   │  │
│  │  │  contextEnrich→classify→plan→execute→replan→respond │   │  │
│  │  └────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 模块设计

### 2.1 新增模块：AIRI Bridge Service

**位置**：`server/airi-bridge/`

**职责**：
1. 作为 AIRI Plugin Module 连接 AIRI Server Runtime
2. 监听 AIRI 的 `input:text` 和 `input:text:voice` 事件
3. 将输入转发到 SmartAgent4 的 `chat()` 接口
4. 将 SmartAgent4 的输出转换为 AIRI 的 `output:gen-ai:chat:message` 事件
5. 管理 Bridge 连接的生命周期

**子模块**：

```
server/airi-bridge/
├── index.ts              # 模块导出
├── airiBridgeService.ts  # Bridge 服务主类
├── emotionMapper.ts      # 情感映射层
├── audioConverter.ts     # 音频格式转换
├── types.ts              # Bridge 专用类型
└── config.ts             # Bridge 配置
```

### 2.2 修改模块：SupervisorOutput 扩展

**位置**：`server/agent/supervisor/supervisorGraph.ts`

**变更**：在 `SupervisorOutput` 接口中新增 `multimodalSegments` 可选字段，使 Supervisor 可选择性地输出结构化多模态数据。

**影响范围**：
- `supervisorGraph.ts`：类型扩展 + `runSupervisor()` 输出增强
- `routers.ts`：`chat.sendMessage` 返回值扩展

### 2.3 新增 tRPC 路由：airi.*

**位置**：`server/routers.ts`

**新增路由**：
- `airi.status`：查询 Bridge 连接状态
- `airi.connect`：手动触发连接 AIRI Server
- `airi.disconnect`：断开连接
- `airi.config`：获取/更新 Bridge 配置

---

## 3. 数据流设计

### 3.1 用户输入流（AIRI → SmartAgent4）

```
1. 用户在 AIRI 前端说话或打字
2. AIRI 前端发送 input:text 或 input:text:voice 事件到 AIRI Server Runtime
3. AIRI Server Runtime 广播事件到所有已连接的 Plugin Module
4. SmartAgent4 AIRI Bridge 收到事件
5. Bridge 提取文本，调用 SmartAgentApp.chat(text, options)
6. Supervisor Graph 执行完整的 AI 编排流程
7. 返回 SupervisorOutput（含 response 和可选的 multimodalSegments）
```

### 3.2 AI 回复流（SmartAgent4 → AIRI）

```
1. Supervisor 返回 SupervisorOutput
2. Bridge 调用 EmotionsSystemClient.render(response, sessionId)
3. 获得 MultimodalSegment[]（文本 + 音频 + 情感 + 动作）
4. Bridge 通过 emotionMapper 将 SmartAgent4 情感映射为 AIRI 表情指令
5. Bridge 构造 output:gen-ai:chat:message 事件
6. 通过 WebSocket 发送到 AIRI Server Runtime
7. AIRI Server Runtime 广播到前端
8. AIRI 前端消费：
   - 文本 → 聊天气泡
   - 音频 → AudioContext 播放 + 口型同步
   - 表情 → Live2D/VRM 表情控制
   - 动作 → Live2D motion / VRM animation
```

### 3.3 情感映射流

```
SmartAgent4 EmotionType    →    AIRI 表情/动作
─────────────────────────────────────────────
neutral                    →    idle / default expression
happy                      →    smile expression + nod motion
sad                        →    sad expression + slow motion
angry                      →    angry expression + shake motion
surprised                  →    surprised expression + jump motion
fearful                    →    fear expression + tremble motion
disgusted                  →    disgust expression + turn_away motion
```

---

## 4. 配置设计

### 4.1 Bridge 配置项

```typescript
interface AiriBridgeConfig {
  /** AIRI Server Runtime WebSocket URL */
  airiServerUrl: string;           // 默认: "ws://localhost:6121/ws"
  /** 认证 Token */
  airiToken?: string;
  /** 是否自动连接 */
  autoConnect: boolean;            // 默认: true
  /** 是否自动重连 */
  autoReconnect: boolean;          // 默认: true
  /** 最大重连次数 (-1 无限) */
  maxReconnectAttempts: number;    // 默认: -1
  /** 是否启用情感渲染 */
  enableEmotionRendering: boolean; // 默认: true
  /** 是否启用 TTS 音频 */
  enableTTS: boolean;              // 默认: true
  /** 默认角色 ID */
  defaultCharacterId: string;      // 默认: "xiaozhi"
}
```

### 4.2 环境变量

```
AIRI_SERVER_URL=ws://localhost:6121/ws
AIRI_TOKEN=
AIRI_AUTO_CONNECT=true
AIRI_ENABLE_EMOTION=true
AIRI_ENABLE_TTS=true
AIRI_DEFAULT_CHARACTER=xiaozhi
```

---

## 5. 错误处理策略

### 5.1 连接层

| 场景 | 处理方式 |
|------|----------|
| AIRI Server 不可用 | 自动重连，SmartAgent4 核心功能不受影响 |
| WebSocket 断开 | Server SDK 内置重连机制，Bridge 记录状态 |
| 认证失败 | 标记为 `failed` 状态，通过 tRPC 路由暴露错误信息 |

### 5.2 数据层

| 场景 | 处理方式 |
|------|----------|
| Emotions-System 不可用 | 降级为纯文本模式，不发送音频 |
| 情感标签解析失败 | 使用 `neutral` 作为默认情感 |
| 音频转换失败 | 跳过音频，仅发送文本和表情 |

### 5.3 业务层

| 场景 | 处理方式 |
|------|----------|
| Supervisor 执行超时 | 返回超时提示，AIRI 显示等待动画 |
| 工具调用失败 | Supervisor 内部 replan，对 AIRI 透明 |
| 角色 ID 不存在 | 降级到默认角色 `xiaozhi` |

---

## 6. 性能考量

### 6.1 延迟预算

| 环节 | 目标延迟 | 说明 |
|------|----------|------|
| WebSocket 传输 | < 10ms | 本地网络 |
| Supervisor 执行 | 500ms - 5s | 取决于任务复杂度 |
| Emotions TTS 渲染 | 200ms - 2s | 取决于文本长度 |
| 情感映射 | < 1ms | 纯内存查表 |
| **端到端** | **1s - 8s** | 从用户输入到角色开始回复 |

### 6.2 优化策略

1. **流式输出**：未来可扩展为流式发送 MultimodalSegment，实现"边说边动"
2. **TTS 预热**：Bridge 启动时预热 Emotions-System 连接
3. **事件批量处理**：合并短时间内的多个输入事件，避免重复触发 Supervisor
