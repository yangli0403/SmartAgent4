# INTERFACE_DESIGN.md — 接口与数据结构定义

**阶段**：Phase 3 — 接口与数据结构定义
**日期**：2026-03-26
**目标**：定义 AIRI Bridge 集成所有接口、类型和数据结构

---

## 1. 新增类型定义

### 1.1 Bridge 配置类型 (`server/airi-bridge/types.ts`)

```typescript
/**
 * AIRI Bridge 连接状态
 */
export type AiriBridgeStatus =
  | "disconnected"    // 未连接
  | "connecting"      // 正在连接
  | "authenticating"  // 正在认证
  | "announcing"      // 正在注册模块
  | "ready"           // 已就绪，可收发事件
  | "reconnecting"    // 正在重连
  | "failed";         // 连接失败

/**
 * AIRI Bridge 配置
 */
export interface AiriBridgeConfig {
  /** AIRI Server Runtime WebSocket URL */
  airiServerUrl: string;
  /** 认证 Token（可选） */
  airiToken?: string;
  /** 是否自动连接 */
  autoConnect: boolean;
  /** 是否自动重连 */
  autoReconnect: boolean;
  /** 最大重连次数（-1 为无限） */
  maxReconnectAttempts: number;
  /** 是否启用情感渲染（调用 Emotions-System） */
  enableEmotionRendering: boolean;
  /** 是否启用 TTS 音频合成 */
  enableTTS: boolean;
  /** 默认角色 ID */
  defaultCharacterId: string;
}

/**
 * AIRI Bridge 状态信息（用于 tRPC 查询）
 */
export interface AiriBridgeStatusInfo {
  /** 当前连接状态 */
  status: AiriBridgeStatus;
  /** 连接的 AIRI Server URL */
  serverUrl: string;
  /** 最后一次成功连接时间 */
  lastConnectedAt?: string;
  /** 最后一次错误信息 */
  lastError?: string;
  /** 已处理的消息计数 */
  messageCount: number;
  /** 当前使用的角色 ID */
  activeCharacterId: string;
}
```

### 1.2 情感映射类型 (`server/airi-bridge/types.ts`)

```typescript
import type { EmotionType, ActionType } from "../emotions/types";

/**
 * AIRI 表情指令
 *
 * 对应 AIRI Live2D 的 expression/motion 或 VRM 的 blendShape/animation
 */
export interface AiriExpressionCommand {
  /** 表情名称（如 "smile", "sad", "angry"） */
  expression: string;
  /** 表情强度 0.0 - 1.0 */
  intensity: number;
}

/**
 * AIRI 动作指令
 *
 * 对应 AIRI Live2D 的 motion 或 VRM 的 animation clip
 */
export interface AiriMotionCommand {
  /** 动作名称（如 "nod", "shake", "idle"） */
  motion: string;
  /** 动作组索引 */
  index?: number;
}

/**
 * 情感映射规则
 *
 * 定义 SmartAgent4 EmotionType 到 AIRI 表情/动作的映射关系
 */
export interface EmotionMappingRule {
  /** SmartAgent4 情感类型 */
  emotion: EmotionType;
  /** 对应的 AIRI 表情指令 */
  expressions: AiriExpressionCommand[];
  /** 对应的 AIRI 动作指令 */
  motions: AiriMotionCommand[];
  /** 口型参数调整（Live2D ParamMouthForm 偏移） */
  mouthFormOffset?: number;
}

/**
 * 完整的情感映射配置
 */
export type EmotionMappingConfig = EmotionMappingRule[];
```

### 1.3 音频转换类型 (`server/airi-bridge/types.ts`)

```typescript
/**
 * 音频数据包
 *
 * 用于在 Bridge 和 AIRI 之间传递音频数据
 */
export interface AudioPacket {
  /** Base64 编码的音频数据 */
  audioBase64: string;
  /** 音频格式 */
  format: "wav" | "mp3" | "pcm";
  /** 采样率 */
  sampleRate?: number;
  /** 声道数 */
  channels?: number;
  /** 音频时长（毫秒） */
  durationMs?: number;
}
```

---

## 2. 扩展现有类型

### 2.1 SupervisorOutput 扩展 (`server/agent/supervisor/supervisorGraph.ts`)

```typescript
// 在现有 SupervisorOutput 接口中新增字段
export interface SupervisorOutput {
  // ... 现有字段保持不变 ...
  response: string;
  classification: { domain: string; complexity: string };
  stepsExecuted: number;
  totalToolCalls: number;
  totalDurationMs: number;
  characterId: string;

  // ===== 新增：多模态输出（可选） =====
  /**
   * 多模态片段列表
   * 当 AIRI Bridge 启用且 Emotions-System 可用时填充
   */
  multimodalSegments?: MultimodalSegment[];
}
```

### 2.2 tRPC Router 扩展 (`server/routers.ts`)

```typescript
// chat.sendMessage 返回值扩展
// 在现有返回值基础上新增可选字段
{
  response: string;
  persisted: boolean;
  // ===== 新增 =====
  multimodalSegments?: MultimodalSegment[];
  characterId?: string;
}
```

---

## 3. 核心类接口

### 3.1 AiriBridgeService 类

```typescript
/**
 * AIRI Bridge 服务
 *
 * 管理与 AIRI Server Runtime 的 WebSocket 连接，
 * 负责输入转发和输出映射。
 */
export class AiriBridgeService {
  /**
   * 构造函数
   * @param config - Bridge 配置
   */
  constructor(config?: Partial<AiriBridgeConfig>);

  /**
   * 初始化 Bridge 服务
   * 建立 WebSocket 连接，注册事件监听器
   */
  async initialize(): Promise<void>;

  /**
   * 获取当前连接状态
   */
  getStatus(): AiriBridgeStatusInfo;

  /**
   * 手动连接到 AIRI Server
   */
  async connect(): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): void;

  /**
   * 发送 AI 回复到 AIRI
   *
   * @param response - SmartAgent4 的回复文本
   * @param segments - 多模态片段（可选，如果已经渲染过）
   * @param sessionId - 会话 ID
   */
  async sendResponse(
    response: string,
    segments?: MultimodalSegment[],
    sessionId?: string
  ): Promise<void>;

  /**
   * 注册输入事件回调
   *
   * 当 AIRI 前端发送文本/语音输入时触发
   */
  onInput(callback: (input: AiriBridgeInput) => Promise<void>): () => void;

  /**
   * 关闭 Bridge 服务
   */
  async shutdown(): Promise<void>;
}
```

### 3.2 EmotionMapper 类

```typescript
/**
 * 情感映射器
 *
 * 将 SmartAgent4 的 EmotionType 和 EmotionAction
 * 转换为 AIRI 可消费的表情和动作指令
 */
export class EmotionMapper {
  /**
   * 构造函数
   * @param customMapping - 自定义映射规则（覆盖默认映射）
   */
  constructor(customMapping?: Partial<EmotionMappingConfig>);

  /**
   * 将 MultimodalSegment 转换为 AIRI 消息格式
   *
   * @param segments - SmartAgent4 的多模态片段
   * @returns AIRI Plugin Protocol 兼容的消息内容
   */
  mapSegmentsToAiriMessage(
    segments: MultimodalSegment[]
  ): AiriOutputMessage;

  /**
   * 将单个情感类型映射为 AIRI 表情指令
   */
  mapEmotion(emotion: EmotionType): AiriExpressionCommand[];

  /**
   * 将动作列表映射为 AIRI 动作指令
   */
  mapActions(actions: EmotionAction[]): AiriMotionCommand[];

  /**
   * 获取当前映射配置
   */
  getMapping(): EmotionMappingConfig;

  /**
   * 更新映射规则
   */
  updateMapping(rules: Partial<EmotionMappingConfig>): void;
}
```

### 3.3 AudioConverter 工具类

```typescript
/**
 * 音频格式转换器
 *
 * 将 SmartAgent4 Emotions-System 输出的 Base64 音频
 * 转换为 AIRI 前端可消费的格式
 */
export class AudioConverter {
  /**
   * 将 Base64 音频数据转换为 AudioPacket
   *
   * @param audioBase64 - Base64 编码的音频
   * @param format - 源音频格式
   * @returns 标准化的音频数据包
   */
  static toAudioPacket(
    audioBase64: string,
    format: string
  ): AudioPacket;

  /**
   * 估算音频时长
   *
   * @param audioBase64 - Base64 编码的音频
   * @param format - 音频格式
   * @returns 估算时长（毫秒）
   */
  static estimateDuration(
    audioBase64: string,
    format: string
  ): number;

  /**
   * 验证音频数据有效性
   */
  static validate(audioBase64: string): boolean;
}
```

---

## 4. AIRI Plugin Protocol 事件映射

### 4.1 Bridge 监听的事件（AIRI → SmartAgent4）

```typescript
/**
 * Bridge 输入事件处理
 */
interface AiriBridgeInput {
  /** 输入类型 */
  type: "text" | "text_voice" | "voice";
  /** 文本内容 */
  text: string;
  /** 原始文本（语音识别前） */
  textRaw?: string;
  /** 来源标识 */
  source?: "stage-web" | "stage-tamagotchi" | "discord";
}

// Bridge 监听的 AIRI 事件列表：
// 'input:text'       → 处理文本输入
// 'input:text:voice' → 处理语音转文本输入
```

### 4.2 Bridge 发送的事件（SmartAgent4 → AIRI）

```typescript
/**
 * Bridge 输出消息格式
 *
 * 符合 AIRI Plugin Protocol 的 output:gen-ai:chat:message 事件
 */
interface AiriOutputMessage {
  message: {
    role: "assistant";
    content: AiriMessageContent[];
  };
}

/**
 * AIRI 消息内容块
 */
type AiriMessageContent =
  | { type: "text"; text: string }
  | { type: "audio"; audioBase64: string; format: string }
  | { type: "expression"; expression: string; intensity: number }
  | { type: "motion"; motion: string; index?: number };
```

---

## 5. tRPC 路由接口定义

### 5.1 airi.status

```typescript
// 查询 Bridge 状态
airi.status: publicProcedure
  .query(() => AiriBridgeStatusInfo)
```

### 5.2 airi.connect

```typescript
// 手动连接
airi.connect: protectedProcedure
  .input(z.object({
    serverUrl: z.string().url().optional(),
    token: z.string().optional(),
  }))
  .mutation(() => { success: boolean; status: AiriBridgeStatus })
```

### 5.3 airi.disconnect

```typescript
// 断开连接
airi.disconnect: protectedProcedure
  .mutation(() => { success: boolean })
```

### 5.4 airi.config

```typescript
// 获取配置
airi.getConfig: protectedProcedure
  .query(() => AiriBridgeConfig)

// 更新配置
airi.updateConfig: protectedProcedure
  .input(z.object({
    airiServerUrl: z.string().url().optional(),
    autoConnect: z.boolean().optional(),
    enableEmotionRendering: z.boolean().optional(),
    enableTTS: z.boolean().optional(),
    defaultCharacterId: z.string().optional(),
  }))
  .mutation(() => { success: boolean; config: AiriBridgeConfig })
```

---

## 6. 默认情感映射表

| SmartAgent4 EmotionType | AIRI Expression | Intensity | AIRI Motion | MouthForm Offset |
|------------------------|-----------------|-----------|-------------|-----------------|
| `neutral` | `default` | 1.0 | `idle` | 0.0 |
| `happy` | `smile` | 0.8 | `nod` | +0.2 |
| `sad` | `sad` | 0.7 | `slow_sway` | -0.1 |
| `angry` | `angry` | 0.8 | `shake` | +0.1 |
| `surprised` | `surprised` | 0.9 | `jump_back` | +0.3 |
| `fearful` | `fear` | 0.6 | `tremble` | -0.2 |
| `disgusted` | `disgust` | 0.7 | `turn_away` | -0.1 |

---

## 7. 配置文件格式

### 7.1 Bridge 配置文件 (`config/airi-bridge.json`)

```json
{
  "airiServerUrl": "ws://localhost:6121/ws",
  "airiToken": "",
  "autoConnect": true,
  "autoReconnect": true,
  "maxReconnectAttempts": -1,
  "enableEmotionRendering": true,
  "enableTTS": true,
  "defaultCharacterId": "xiaozhi",
  "emotionMapping": {
    "neutral": {
      "expressions": [{ "expression": "default", "intensity": 1.0 }],
      "motions": [{ "motion": "idle" }]
    },
    "happy": {
      "expressions": [{ "expression": "smile", "intensity": 0.8 }],
      "motions": [{ "motion": "nod" }],
      "mouthFormOffset": 0.2
    }
  }
}
```
