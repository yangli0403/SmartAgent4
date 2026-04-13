/**
 * 动作映射配置 — MotionMapping
 *
 * 定义每种动作指令对应的 Live2D Motion Group 和索引。
 * Live2D 模型的 motion3.json 中定义了多个 Motion Group（如 Idle, TapBody 等），
 * 每个 Group 包含多个动作文件。此映射将语义化的动作名称映射到具体的 Group + Index。
 *
 * 注意：具体的 Group 名称和 Index 取决于所使用的 Live2D 模型。
 * 以下配置基于 Hiyori 模型的 Motion Group 结构。
 */

import type { MotionMappingConfig } from "./types";

export const MOTION_MAPPING: MotionMappingConfig = {
  // ==================== 基础动作 ====================

  nod: {
    name: "点头",
    group: "TapBody",
    index: 0,
    priority: 2,
  },

  wave: {
    name: "挥手",
    group: "TapBody",
    index: 1,
    priority: 2,
  },

  shake_head: {
    name: "摇头",
    group: "TapBody",
    index: 2,
    priority: 2,
  },

  bow: {
    name: "鞠躬",
    group: "TapBody",
    index: 3,
    priority: 3,
  },

  head_tilt: {
    name: "歪头",
    group: "TapBody",
    index: 4,
    priority: 1,
  },

  // ==================== 手势动作 ====================

  thumbs_up: {
    name: "赞同",
    group: "TapBody",
    index: 5,
    priority: 1,
  },

  clap: {
    name: "鼓掌",
    group: "TapBody",
    index: 6,
    priority: 2,
  },

  shrug: {
    name: "耸肩",
    group: "TapBody",
    index: 7,
    priority: 1,
  },

  // ==================== 闲置动作 ====================

  idle_breathe: {
    name: "呼吸",
    group: "Idle",
    index: 0,
    priority: 0,
  },

  idle_sway: {
    name: "轻微摇晃",
    group: "Idle",
    index: 1,
    priority: 0,
  },
};

/**
 * 获取动作定义，未知动作返回 null
 */
export function getMotionDef(motion: string): MotionMappingConfig[string] | null {
  const def = MOTION_MAPPING[motion];
  if (def) return def;

  if (import.meta.env.DEV) {
    console.warn(`[MotionMapping] 未知动作 "${motion}"，将忽略`);
  }
  return null;
}
