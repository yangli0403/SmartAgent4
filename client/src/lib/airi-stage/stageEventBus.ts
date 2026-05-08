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
import type { StageEventMap, StageEvent, IdleState } from "./types";
import { getAiriStatusPreset, type AiriStatusKey } from "./statusPresets";

/** 全局舞台事件总线实例 */
export const stageEventBus = mitt<StageEventMap>();

let statusSequence = 0;

/**
 * 派发 AIRI 状态预设：统一驱动状态、表情和明显动作。
 * speaking 由 TTS 口型状态承载，不写入 idle_state，避免打断原有状态机。
 */
export function notifyAiriStatus(status: AiriStatusKey): number {
  const preset = getAiriStatusPreset(status);
  const sequence = ++statusSequence;

  if (status !== "speaking") {
    stageEventBus.emit("idle_state", {
      type: "idle_state",
      state: status as IdleState,
    });
  }

  stageEventBus.emit("expression", {
    type: "expression",
    expression: preset.expression,
    intensity: status === "idle" ? 0.65 : 1.0,
  });

  stageEventBus.emit("motion", {
    type: "motion",
    motion: preset.motion,
    priority: preset.priority,
  });

  return sequence;
}

function notifyTimedStatus(status: AiriStatusKey, autoResetMs = 1400): void {
  const sequence = notifyAiriStatus(status);
  globalThis.setTimeout(() => {
    if (statusSequence === sequence) notifyIdle();
  }, autoResetMs);
}

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
  notifyAiriStatus("thinking");
}

/**
 * 通知舞台进入 listening 状态（用户正在语音输入）
 */
export function notifyListening(): void {
  notifyAiriStatus("listening");
}

/**
 * 通知舞台进入工具执行状态
 */
export function notifyToolRunning(): void {
  notifyAiriStatus("tool_running");
}

/**
 * 通知舞台进入任务完成确认状态，并短暂停留后回到 idle
 */
export function notifySuccess(autoResetMs = 1400): void {
  notifyTimedStatus("success", autoResetMs);
}

/**
 * 通知舞台进入异常失败状态，并短暂停留后回到 idle
 */
export function notifyError(autoResetMs = 1800): void {
  notifyTimedStatus("error", autoResetMs);
}

/**
 * 通知舞台回到 idle 状态
 */
export function notifyIdle(): void {
  notifyAiriStatus("idle");
}

/**
 * 通知舞台 TTS 开始播放
 */
export function notifyTtsStart(durationMs?: number): void {
  notifyAiriStatus("speaking");
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
  notifyIdle();
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

/** 模拟朗读口型：定时发送音量电平，用于无 TTS 波形时的短期兜底 */
let simulatedLipsyncInterval: ReturnType<typeof setInterval> | null = null;
let simulatedLipsyncEndTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 取消正在进行的模拟口型（新一条助手消息到达时应先调用）
 */
export function cancelSimulatedSpeechLipsync(): void {
  if (simulatedLipsyncInterval) {
    clearInterval(simulatedLipsyncInterval);
    simulatedLipsyncInterval = null;
  }
  if (simulatedLipsyncEndTimer) {
    clearTimeout(simulatedLipsyncEndTimer);
    simulatedLipsyncEndTimer = null;
  }
  stageEventBus.emit("tts_stop", { type: "tts_stop" });
}

/**
 * 按文本长度估算“说话”时长，用正弦波模拟嘴部开合电平
 */
export function startSimulatedSpeechLipsync(cleanTextLength: number): void {
  cancelSimulatedSpeechLipsync();
  const durationMs = Math.min(
    12000,
    Math.max(800, Math.round(cleanTextLength * 45))
  );
  notifyTtsStart(durationMs);
  const startedAt = Date.now();
  simulatedLipsyncInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= durationMs) return;
    const wave = 0.32 + Math.sin(elapsed / 110) * 0.22;
    notifyTtsLevel(wave);
  }, 80);
  simulatedLipsyncEndTimer = setTimeout(() => {
    if (simulatedLipsyncInterval) {
      clearInterval(simulatedLipsyncInterval);
      simulatedLipsyncInterval = null;
    }
    simulatedLipsyncEndTimer = null;
    notifyTtsStop();
  }, durationMs);
}
