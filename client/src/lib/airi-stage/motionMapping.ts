/**
 * 动作映射配置 — MotionMapping
 *
 * 定义每种动作指令对应的 Live2D Motion Group 和索引。
 * Live2D 模型的 motion3.json 中定义了多个 Motion Group，
 * 每个 Group 包含多个动作文件。此映射将语义化的动作名称映射到具体的 Group + Index。
 *
 * 当前模型 (haru_greeter_t03) 可用的 Motion Group：
 *   - Idle: 3 个动作 (index 0-2)  — haru_g_idle, haru_g_m07, haru_g_m15
 *   - Tap:  2 个动作 (index 0-1)  — haru_g_m14, haru_g_m05
 *
 * 注意：具体的 Group 名称和 Index 取决于所使用的 Live2D 模型。
 * 如果更换模型，需要同步更新此映射。
 */

import type { MotionMappingConfig } from "./types";

export const MOTION_MAPPING: MotionMappingConfig = {
  // ==================== 基础动作（映射到 Tap group）====================

  nod: {
    name: "点头",
    group: "Tap",
    index: 0,
    priority: 2,
  },

  wave: {
    name: "挥手",
    group: "Tap",
    index: 1,
    priority: 2,
  },

  shake_head: {
    name: "摇头",
    group: "Tap",
    index: 0,
    priority: 2,
  },

  bow: {
    name: "鞠躬",
    group: "Tap",
    index: 1,
    priority: 3,
  },

  head_tilt: {
    name: "歪头",
    group: "Tap",
    index: 0,
    priority: 1,
  },

  // ==================== 手势动作（映射到 Tap group）====================

  thumbs_up: {
    name: "赞同",
    group: "Tap",
    index: 1,
    priority: 1,
  },

  clap: {
    name: "鼓掌",
    group: "Tap",
    index: 0,
    priority: 2,
  },

  shrug: {
    name: "耸肩",
    group: "Tap",
    index: 1,
    priority: 1,
  },

  // ==================== 8 状态强反馈动作（语义别名，兼容当前 haru 模型动作组）====================

  listen_ear_forward: {
    name: "侧耳倾听",
    group: "Tap",
    index: 0,
    priority: 4,
  },

  think_chin_touch: {
    name: "托腮思考",
    group: "Tap",
    index: 0,
    priority: 4,
  },

  operate_virtual_panel: {
    name: "操作空中面板",
    group: "Tap",
    index: 1,
    priority: 5,
  },

  explain_with_hand: {
    name: "讲解手势",
    group: "Tap",
    index: 1,
    priority: 5,
  },

  confirm_ok: {
    name: "点头确认 / OK 手势",
    group: "Tap",
    index: 1,
    priority: 4,
  },

  error_shrug: {
    name: "摊手提示 / 轻微摇头",
    group: "Tap",
    index: 1,
    priority: 5,
  },

  // ==================== 闲置动作（映射到 Idle group）====================

  idle_breathe: {
    name: "呼吸",
    group: "Idle",
    index: 0,
    priority: 0,
  },

  idle_sway: {
    name: "轻微摇晉",
    group: "Idle",
    index: 1,
    priority: 0,
  },

  // ==================== 新增：参数驱动动作（无需单独 Motion 文件）====================

  thinking: {
    name: "托腮思考",
    group: "Tap",
    index: 0,
    priority: 3,
  },

  surprised: {
    name: "夸张惊讶",
    group: "Tap",
    index: 1,
    priority: 4,
  },

  excited: {
    name: "兴奋摇摆",
    group: "Tap",
    index: 1,
    priority: 3,
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
