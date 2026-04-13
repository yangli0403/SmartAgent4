/**
 * 舞台事件总线 — StageEventBus
 *
 * 基于 mitt 的轻量级事件总线，用于解耦 UI 组件与舞台驱动层。
 * 所有舞台事件（表情、动作、口型、闲置状态）均通过此总线分发。
 *
 * 使用方式：
 *   import { stageEventBus } from './stageEventBus';
 *   stageEventBus.emit('expression', { type: 'expression', expression: 'happy', intensity: 0.8 });
 *   stageEventBus.on('expression', (event) => { ... });
 */

import mitt from "mitt";
import type { StageEventMap, StageEvent } from "./types";

/** 全局舞台事件总线实例 */
export const stageEventBus = mitt<StageEventMap>();

/**
 * 从 emotionParser 的解析结果中提取舞台事件并分发
 *
 * @param tags - emotionParser 解析出的标签列表
 */
export function dispatchStageEventsFromTags(
  tags: Array<{ type: string; value: string }>
): void {
  for (const tag of tags) {
    switch (tag.type) {
      case "expression":
        stageEventBus.emit("expression", {
          type: "expression",
          expression: tag.value,
          intensity: 1.0,
        });
        break;

      case "animation":
        stageEventBus.emit("motion", {
          type: "motion",
          motion: tag.value,
          priority: 1,
        });
        break;

      case "gesture":
        stageEventBus.emit("motion", {
          type: "motion",
          motion: tag.value,
          priority: 1,
        });
        break;

      case "posture":
        stageEventBus.emit("motion", {
          type: "motion",
          motion: tag.value,
          priority: 0,
        });
        break;

      case "locomotion":
        stageEventBus.emit("motion", {
          type: "motion",
          motion: tag.value,
          priority: 0,
        });
        break;

      case "pause":
        // pause 标签暂不分发到舞台，由文本渲染层处理
        break;

      case "sound":
        // sound 标签暂不分发到舞台
        break;

      default:
        if (import.meta.env.DEV) {
          console.warn(`[StageEventBus] 未知标签类型: ${tag.type}:${tag.value}`);
        }
    }
  }
}

/**
 * 通知舞台进入 thinking 状态（AI 正在处理）
 */
export function notifyThinking(): void {
  stageEventBus.emit("idle_state", {
    type: "idle_state",
    state: "thinking",
  });
}

/**
 * 通知舞台进入 listening 状态（用户正在语音输入）
 */
export function notifyListening(): void {
  stageEventBus.emit("idle_state", {
    type: "idle_state",
    state: "listening",
  });
}

/**
 * 通知舞台回到 idle 状态
 */
export function notifyIdle(): void {
  stageEventBus.emit("idle_state", {
    type: "idle_state",
    state: "idle",
  });
}

/**
 * 通知舞台 TTS 开始播放
 */
export function notifyTtsStart(durationMs?: number): void {
  stageEventBus.emit("tts_start", {
    type: "tts_start",
    durationMs,
  });
}

/**
 * 通知舞台 TTS 停止播放
 */
export function notifyTtsStop(): void {
  stageEventBus.emit("tts_stop", {
    type: "tts_stop",
  });
}

/**
 * 通知舞台 TTS 音量电平更新
 */
export function notifyTtsLevel(level: number): void {
  stageEventBus.emit("tts_level", {
    type: "tts_level",
    level: Math.max(0, Math.min(1, level)),
  });
}
