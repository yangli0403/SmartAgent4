import type { IdleState } from "./types";

export type AiriStatusKey = IdleState | "speaking";

export interface AiriStatusPreset {
  key: AiriStatusKey;
  label: string;
  headline: string;
  description: string;
  expression: string;
  motion: string;
  motionLabel: string;
  color: "sky" | "slate" | "blue" | "purple" | "orange" | "green" | "emerald" | "red";
  icon: string;
  priority: number;
}

export const AIRI_STATUS_PRESETS: Record<AiriStatusKey, AiriStatusPreset> = {
  loading: {
    key: "loading",
    label: "加载中",
    headline: "正在加载 AIRI",
    description: "模型与舞台正在准备，请稍候。",
    expression: "neutral",
    motion: "idle_breathe",
    motionLabel: "低头待命 / 胸前光点",
    color: "sky",
    icon: "◌",
    priority: 1,
  },
  idle: {
    key: "idle",
    label: "空闲待命",
    headline: "AIRI 已就绪，等待指令",
    description: "自然站姿与轻微待命呼吸，表示可以随时开始对话。",
    expression: "smile",
    motion: "idle_breathe",
    motionLabel: "自然站姿 / 待命呼吸",
    color: "slate",
    icon: "●",
    priority: 1,
  },
  listening: {
    key: "listening",
    label: "监听中",
    headline: "正在听你说话",
    description: "身体前倾并侧耳倾听，突出语音输入正在进行。",
    expression: "smile",
    motion: "listen_ear_forward",
    motionLabel: "侧耳倾听 / 身体前倾",
    color: "blue",
    icon: "♪",
    priority: 4,
  },
  thinking: {
    key: "thinking",
    label: "思考中",
    headline: "正在理解你的需求",
    description: "托腮或点下巴，表示正在分析上下文和规划回答。",
    expression: "think",
    motion: "think_chin_touch",
    motionLabel: "托腮思考 / 歪头判断",
    color: "purple",
    icon: "…",
    priority: 4,
  },
  tool_running: {
    key: "tool_running",
    label: "工具执行中",
    headline: "正在调用服务",
    description: "抬手操作空中面板，强调正在调用地图、音乐、办公或记忆工具。",
    expression: "proud",
    motion: "operate_virtual_panel",
    motionLabel: "操作空中面板",
    color: "orange",
    icon: "↯",
    priority: 5,
  },
  speaking: {
    key: "speaking",
    label: "说话中",
    headline: "正在为你回答",
    description: "面向用户做讲解手势，并配合声波反馈。",
    expression: "happy",
    motion: "explain_with_hand",
    motionLabel: "讲解手势 / 声波播报",
    color: "green",
    icon: "≋",
    priority: 5,
  },
  success: {
    key: "success",
    label: "完成确认",
    headline: "任务已完成",
    description: "点头确认或 OK 手势，给用户明确完成反馈。",
    expression: "relieved",
    motion: "confirm_ok",
    motionLabel: "点头确认 / OK 手势",
    color: "emerald",
    icon: "✓",
    priority: 4,
  },
  error: {
    key: "error",
    label: "异常失败",
    headline: "刚才没有成功，可以重试",
    description: "摊手或轻微摇头，提醒用户当前链路需要重试或切换输入方式。",
    expression: "confused",
    motion: "error_shrug",
    motionLabel: "摊手提示 / 轻微摇头",
    color: "red",
    icon: "!",
    priority: 5,
  },
};

export function getAiriStatusPreset(status: AiriStatusKey): AiriStatusPreset {
  return AIRI_STATUS_PRESETS[status] ?? AIRI_STATUS_PRESETS.idle;
}
