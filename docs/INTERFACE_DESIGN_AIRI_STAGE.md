# SmartAgent4 AIRI 前端舞台集成 — 接口设计文档

> **迭代轮次**：第八轮（AIRI 前端角色舞台）
> **最后更新**：2026-04-13

## 1. 接口总览

本文档定义了 AIRI 前端舞台集成的所有代码级契约，包括类型定义、事件协议、状态管理接口和组件 Props 接口。

### 1.1 新增文件清单

| 文件路径 | 模块 | 说明 |
|----------|------|------|
| `client/src/lib/airi-stage/types.ts` | 类型定义 | 舞台事件协议、Live2D 参数、驱动器状态、配置项 |
| `client/src/lib/airi-stage/stageEventBus.ts` | 事件总线 | 基于 mitt 的事件分发，含便捷通知函数 |
| `client/src/lib/airi-stage/expressionMapping.ts` | 表情映射 | 16 种情感到 Live2D 参数的映射配置 |
| `client/src/lib/airi-stage/motionMapping.ts` | 动作映射 | 动作名称到 Live2D Motion Group 的映射 |
| `client/src/lib/airi-stage/useStageStore.ts` | 状态管理 | Zustand Store，管理全部舞台状态 |
| `client/src/lib/airi-stage/index.ts` | 模块入口 | 统一导出 |

### 1.2 待实现文件清单（Phase 4）

| 文件路径 | 模块 | 说明 |
|----------|------|------|
| `client/src/components/airi-stage/AiriStageContainer.tsx` | 舞台容器 | Live2D 渲染容器 React 组件 |
| `client/src/components/airi-stage/BridgeStatusPanel.tsx` | Bridge 面板 | AIRI Bridge 连接状态面板 |
| `client/src/hooks/useExpressionDriver.ts` | 表情驱动 | 监听表情事件，平滑插值更新 Live2D 参数 |
| `client/src/hooks/useMotionDriver.ts` | 动作驱动 | 监听动作事件，播放 Live2D 动作组 |
| `client/src/hooks/useLipsyncDriver.ts` | 口型驱动 | 监听 TTS 播放，Web Audio 分析驱动口型 |
| `client/src/hooks/useIdleManager.ts` | 闲置管理 | 监控空闲时间，管理 idle/thinking/listening 状态 |

## 2. 舞台事件协议（StageEvent）

舞台事件是 UI 组件与 Live2D 驱动层之间的通信契约。所有事件通过 `stageEventBus`（mitt 实例）分发。

### 2.1 事件类型

| 事件类型 | 触发时机 | 消费者 | 数据字段 |
|----------|----------|--------|----------|
| `expression` | AI 回复包含表情标签时 | ExpressionDriver | `expression: string, intensity?: number` |
| `motion` | AI 回复包含动作标签时 | MotionDriver | `motion: string, priority?: number` |
| `tts_start` | TTS 音频开始播放时 | LipsyncDriver | `durationMs?: number` |
| `tts_stop` | TTS 音频播放结束时 | LipsyncDriver | 无 |
| `tts_level` | TTS 播放中每帧触发 | LipsyncDriver | `level: number (0.0-1.0)` |
| `idle_state` | 交互状态切换时 | IdleStateManager | `state: 'idle' \| 'thinking' \| 'listening'` |
| `model_loaded` | Live2D 模型加载完成 | AiriStageContainer | `modelId: string` |
| `model_error` | Live2D 模型加载失败 | AiriStageContainer | `error: string` |

### 2.2 事件分发流程

```
emotionParser.parseEmotionTags(content)
    ↓ 返回 tags[]
dispatchStageEventsFromTags(tags)
    ↓ 遍历 tags，按 type 分发
stageEventBus.emit('expression', { ... })
stageEventBus.emit('motion', { ... })
    ↓ 驱动器监听
ExpressionDriver → 更新 Live2D 参数
MotionDriver → 播放 Live2D 动作
```

## 3. 组件 Props 接口

### 3.1 AiriStageContainer

```typescript
interface AiriStageContainerProps {
  /** 是否启用舞台（false 时不渲染 Live2D，显示占位符） */
  enabled?: boolean;
  /** 模型 URL（覆盖默认配置） */
  modelUrl?: string;
  /** 容器 CSS 类名 */
  className?: string;
  /** 模型加载完成回调 */
  onModelLoaded?: () => void;
  /** 模型加载失败回调 */
  onModelError?: (error: string) => void;
}
```

### 3.2 BridgeStatusPanel

```typescript
interface BridgeStatusPanelProps {
  /** 是否默认展开 */
  defaultExpanded?: boolean;
  /** 容器 CSS 类名 */
  className?: string;
}
```

## 4. 驱动器 Hook 接口

### 4.1 useExpressionDriver

```typescript
/**
 * 表情驱动 Hook
 * 监听 stageEventBus 的 expression 事件，
 * 通过 requestAnimationFrame 平滑插值更新 Live2D 模型参数。
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前表情驱动器状态
 */
function useExpressionDriver(
  modelRef: React.RefObject<Live2DModel | null>
): ExpressionDriverState;
```

### 4.2 useMotionDriver

```typescript
/**
 * 动作驱动 Hook
 * 监听 stageEventBus 的 motion 事件，
 * 调用 Live2D 模型的 motion() 方法播放预设动作。
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前动作驱动器状态
 */
function useMotionDriver(
  modelRef: React.RefObject<Live2DModel | null>
): MotionDriverState;
```

### 4.3 useLipsyncDriver

```typescript
/**
 * 口型驱动 Hook
 * 监听 stageEventBus 的 tts_start/tts_stop/tts_level 事件，
 * 将音量电平映射为 Live2D 的 ParamMouthOpenY 参数。
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前口型驱动器状态
 */
function useLipsyncDriver(
  modelRef: React.RefObject<Live2DModel | null>
): LipsyncDriverState;
```

### 4.4 useIdleManager

```typescript
/**
 * 闲置状态管理 Hook
 * 监控舞台空闲时间，自动切换 idle/thinking/listening 状态，
 * 在闲置时播放呼吸动画和随机眨眼。
 *
 * @param modelRef - Live2D 模型实例的 ref
 * @returns 当前闲置管理器状态
 */
function useIdleManager(
  modelRef: React.RefObject<Live2DModel | null>
): IdleManagerState;
```

## 5. 状态管理（Zustand Store）

### 5.1 Store 结构

```typescript
interface StageStore {
  // 配置
  config: AiriStageConfig;
  setConfig(config: Partial<AiriStageConfig>): void;

  // 模型状态
  modelLoaded: boolean;
  modelError: string | null;
  setModelLoaded(loaded: boolean): void;
  setModelError(error: string | null): void;

  // 表情驱动
  expression: ExpressionDriverState;
  setTargetExpression(expression: string, intensity?: number): void;
  updateCurrentExpression(expression: string, intensity: number): void;
  finishExpressionTransition(): void;

  // 动作驱动
  motion: MotionDriverState;
  setCurrentMotion(motion: string | null, priority?: number): void;
  finishMotion(): void;

  // 口型驱动
  lipsync: LipsyncDriverState;
  setSpeaking(speaking: boolean): void;
  updateLevel(level: number): void;

  // 闲置管理
  idle: IdleManagerState;
  setIdleState(state: IdleState): void;
  recordActivity(): void;

  // 全局
  reset(): void;
}
```

## 6. 表情映射配置

共 16 种表情映射，每种表情对应一组 Live2D 参数目标值。

| 表情 | ParamEyeLOpen | ParamBrowLY | ParamMouthForm | ParamMouthOpenY | ParamCheek | 其他 |
|------|:---:|:---:|:---:|:---:|:---:|------|
| neutral | 1.0 | 0 | 0 | 0 | 0 | — |
| happy | 0.8 | 0.3 | 1.0 | 0.2 | 0.3 | — |
| sad | 0.6 | -0.5 | -0.5 | 0 | — | AngleY: -5 |
| angry | 1.0 | -0.8 | -0.3 | 0.1 | — | — |
| surprised | 1.3 | 0.8 | 0 | 0.6 | — | — |
| fearful | 1.2 | 0.5 | -0.2 | 0.3 | — | AngleX: -5 |
| disgusted | 0.7 | -0.4 | -0.7 | 0.1 | — | — |
| smile | 0.85 | 0.2 | 0.8 | 0.1 | 0.2 | — |
| think | 0.9 | 0.1 | -0.1 | — | — | AngleZ: 8, AngleY: 5 |
| shy | 0.6 | 0.1 | 0.3 | — | 0.8 | AngleY: -8 |
| love | 0.7 | 0.3 | 0.9 | 0.15 | 0.6 | — |
| proud | 0.9 | 0.4 | 0.6 | — | — | AngleY: 5 |
| worried | 0.85 | 0.3 | -0.3 | 0.05 | — | — |
| confused | 1.0 | 0.4 | -0.1 | — | — | AngleZ: 10 |
| excited | 1.2 | 0.6 | 0.9 | 0.4 | 0.4 | — |
| relieved | 0.6 | 0.1 | 0.4 | 0.05 | — | — |

## 7. 新增依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `pixi.js` | ^7.x | Live2D 渲染底层引擎 |
| `pixi-live2d-display` | ^0.4.x | Live2D Cubism 模型加载与渲染 |
| `mitt` | ^3.x | 轻量级事件总线 |
| `zustand` | ^4.x | 状态管理（已在项目中使用） |

## 8. 错误处理策略

| 错误场景 | 处理方式 | 用户感知 |
|----------|----------|----------|
| Live2D 模型加载失败 | 设置 `modelError`，显示占位符 | 看到角色头像占位符，页面其他功能正常 |
| 未知表情类型 | 降级为 neutral，控制台警告 | 角色保持平静表情 |
| 未知动作名称 | 忽略事件，控制台警告 | 角色无动作变化 |
| Web Audio API 不可用 | 禁用口型驱动，控制台警告 | 角色说话时嘴巴不动，但音频正常播放 |
| pixi-live2d-display 加载失败 | 整个舞台降级为占位符模式 | 看到静态角色图片 |
