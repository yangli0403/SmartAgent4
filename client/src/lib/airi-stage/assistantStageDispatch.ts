/**
 * 短期方案：助手回复 → 舞台事件（显式标签优先，否则启发式 + 模拟口型）
 */

import { parseEmotionTags } from "@/lib/emotionParser";
import {
  stageEventBus,
  dispatchStageEventsFromTags,
  startSimulatedSpeechLipsync,
  cancelSimulatedSpeechLipsync,
} from "./stageEventBus";
import { inferStageHeuristic } from "./inferStageHeuristic";
import { getMotionDef } from "./motionMapping";

const STAGE_TAG_TYPES = new Set([
  "expression",
  "animation",
  "gesture",
  "posture",
  "locomotion",
]);

/**
 * 将一次助手完整回复映射到舞台：表情、动作、模拟朗读口型
 */
export type DispatchAssistantStageReplyOptions = {
  /** 是否分发正文中提取/推断出的身体动作。TTS 未真正开始播放前应关闭，避免动作早于声音。 */
  includeMotion?: boolean;
  /** 是否启用无真实音频时的模拟口型。真实 TTS 链路应关闭，改由音频播放生命周期触发。 */
  simulateSpeech?: boolean;
};

export function dispatchAssistantStageReply(
  rawText: string,
  options: DispatchAssistantStageReplyOptions = {}
): void {
  const includeMotion = options.includeMotion ?? true;
  const simulateSpeech = options.simulateSpeech ?? true;

  cancelSimulatedSpeechLipsync();

  const parsed = parseEmotionTags(rawText);
  const stageTags = parsed.tags.filter(
    (tag) => tag.type === "expression" || (includeMotion && STAGE_TAG_TYPES.has(tag.type))
  );

  if (stageTags.length > 0) {
    dispatchStageEventsFromTags(
      stageTags.map((tag) => ({ type: tag.type, value: tag.value }))
    );
  } else {
    const h = inferStageHeuristic(parsed.cleanText);
    stageEventBus.emit("expression", {
      type: "expression",
      expression: h.expression,
      intensity: h.intensity,
    });
    if (includeMotion && h.motion && getMotionDef(h.motion)) {
      stageEventBus.emit("motion", {
        type: "motion",
        motion: h.motion,
        priority: 2,
      });
    }
  }

  if (simulateSpeech) {
    startSimulatedSpeechLipsync(parsed.cleanText.length);
  }
}
