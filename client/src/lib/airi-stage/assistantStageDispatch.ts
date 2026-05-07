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
export function dispatchAssistantStageReply(rawText: string): void {
  cancelSimulatedSpeechLipsync();

  const parsed = parseEmotionTags(rawText);
  const stageTags = parsed.tags.filter((tag) => STAGE_TAG_TYPES.has(tag.type));

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
    if (h.motion && getMotionDef(h.motion)) {
      stageEventBus.emit("motion", {
        type: "motion",
        motion: h.motion,
        priority: 2,
      });
    }
  }

  startSimulatedSpeechLipsync(parsed.cleanText.length);
}
