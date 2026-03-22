/**
 * 情感标签解析器 — 前端版本
 *
 * 解析 LLM 回复中的 [tag:value] 格式标签，
 * 将其转换为 emoji + 中文标注，用于车机界面可视化展示。
 */

// ==================== 类型定义 ====================

export type EmotionTagType =
  | "expression"
  | "animation"
  | "gesture"
  | "posture"
  | "locomotion"
  | "sound"
  | "pause";

export interface EmotionTag {
  /** 标签类型 */
  type: EmotionTagType;
  /** 标签值 */
  value: string;
  /** 对应 emoji */
  emoji: string;
  /** 中文描述 */
  label: string;
  /** 原始标签文本 */
  raw: string;
}

export interface ParsedMessage {
  /** 纯文本（已去除标签） */
  cleanText: string;
  /** 解析出的所有情感标签 */
  tags: EmotionTag[];
  /** 主情感（取第一个 expression 标签） */
  primaryEmotion: { emoji: string; label: string } | null;
  /** 动作数量统计 */
  actionCount: number;
}

// ==================== Emoji 映射表 ====================

const EXPRESSION_MAP: Record<string, { emoji: string; label: string }> = {
  smile: { emoji: "😊", label: "开心" },
  sad: { emoji: "😢", label: "悲伤" },
  surprised: { emoji: "😲", label: "惊讶" },
  angry: { emoji: "😠", label: "生气" },
  fearful: { emoji: "😨", label: "害怕" },
  disgusted: { emoji: "🤢", label: "厌恶" },
  neutral: { emoji: "😐", label: "平静" },
  happy: { emoji: "😄", label: "快乐" },
  think: { emoji: "🤔", label: "思考" },
  shy: { emoji: "😳", label: "害羞" },
  love: { emoji: "🥰", label: "喜爱" },
  proud: { emoji: "😎", label: "自豪" },
  worried: { emoji: "😟", label: "担忧" },
  confused: { emoji: "😕", label: "困惑" },
  excited: { emoji: "🤩", label: "兴奋" },
  relieved: { emoji: "😌", label: "释然" },
};

const ANIMATION_MAP: Record<string, { emoji: string; label: string }> = {
  wave: { emoji: "👋", label: "挥手" },
  nod: { emoji: "🙂‍↕️", label: "点头" },
  head_tilt: { emoji: "🤨", label: "歪头" },
  bow: { emoji: "🙇", label: "鞠躬" },
  shake_head: { emoji: "🙅", label: "摇头" },
};

const GESTURE_MAP: Record<string, { emoji: string; label: string }> = {
  thumbs_up: { emoji: "👍", label: "赞同" },
  clap: { emoji: "👏", label: "鼓掌" },
  shrug: { emoji: "🤷", label: "耸肩" },
  facepalm: { emoji: "🤦", label: "捂脸" },
  open_palms: { emoji: "🤲", label: "摊手" },
  finger_wag: { emoji: "☝️", label: "摇手指" },
  peace: { emoji: "✌️", label: "比耶" },
  ok: { emoji: "👌", label: "OK" },
  point: { emoji: "👉", label: "指向" },
};

const POSTURE_MAP: Record<string, { emoji: string; label: string }> = {
  lean_forward: { emoji: "🫡", label: "前倾" },
  lean_back: { emoji: "😌", label: "后仰" },
  stand_tall: { emoji: "🧍", label: "挺胸" },
  slouch: { emoji: "😔", label: "垂肩" },
  arms_crossed: { emoji: "🤔", label: "抱臂" },
  hands_on_hips: { emoji: "🦸", label: "叉腰" },
  head_down: { emoji: "😞", label: "低头" },
};

const LOCOMOTION_MAP: Record<string, { emoji: string; label: string }> = {
  step_forward: { emoji: "🚶", label: "前进" },
  step_back: { emoji: "🔙", label: "后退" },
  jump: { emoji: "🤸", label: "跳跃" },
  spin: { emoji: "💫", label: "转圈" },
};

const SOUND_MAP: Record<string, { emoji: string; label: string }> = {
  laugh: { emoji: "🔊", label: "笑声" },
  sigh: { emoji: "💨", label: "叹气" },
  gasp: { emoji: "😮‍💨", label: "吸气" },
  applause: { emoji: "👏", label: "掌声" },
  hum: { emoji: "🎵", label: "哼歌" },
};

const TAG_TYPE_MAP: Record<string, Record<string, { emoji: string; label: string }>> = {
  expression: EXPRESSION_MAP,
  animation: ANIMATION_MAP,
  gesture: GESTURE_MAP,
  posture: POSTURE_MAP,
  locomotion: LOCOMOTION_MAP,
  sound: SOUND_MAP,
};

const TAG_TYPE_LABELS: Record<string, string> = {
  expression: "表情",
  animation: "动画",
  gesture: "手势",
  posture: "姿态",
  locomotion: "移动",
  sound: "音效",
  pause: "停顿",
};

// ==================== 标签正则 ====================

const TAG_REGEX = /\[(\w+):([^\]]+)\]/g;

// ==================== 解析函数 ====================

/**
 * 解析单个标签
 */
function parseTag(type: string, value: string, raw: string): EmotionTag | null {
  const typeMap = TAG_TYPE_MAP[type];

  if (type === "pause") {
    return {
      type: "pause",
      value,
      emoji: "⏸️",
      label: `停顿${value}秒`,
      raw,
    };
  }

  if (!typeMap) return null;

  const mapped = typeMap[value];
  if (mapped) {
    return {
      type: type as EmotionTagType,
      value,
      emoji: mapped.emoji,
      label: mapped.label,
      raw,
    };
  }

  // 未知值，使用默认
  const typeLabel = TAG_TYPE_LABELS[type] || type;
  return {
    type: type as EmotionTagType,
    value,
    emoji: "🔹",
    label: `${typeLabel}:${value}`,
    raw,
  };
}

/**
 * 解析消息中的所有情感标签
 *
 * @param content - LLM 回复原始文本（含 [tag:value] 标签）
 * @returns 解析结果，包含纯文本、标签列表、主情感、动作数量
 */
export function parseEmotionTags(content: string): ParsedMessage {
  const tags: EmotionTag[] = [];
  let match: RegExpExecArray | null;

  // 重置正则
  TAG_REGEX.lastIndex = 0;

  while ((match = TAG_REGEX.exec(content)) !== null) {
    const [raw, type, value] = match;
    const tag = parseTag(type, value, raw);
    if (tag) {
      tags.push(tag);
    }
  }

  // 去除标签，得到纯文本
  const cleanText = content
    .replace(TAG_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 主情感：取第一个 expression 标签
  const primaryExpression = tags.find((t) => t.type === "expression");
  const primaryEmotion = primaryExpression
    ? { emoji: primaryExpression.emoji, label: primaryExpression.label }
    : null;

  // 动作数量：非 expression 和 pause 的标签
  const actionCount = tags.filter(
    (t) => t.type !== "expression" && t.type !== "pause"
  ).length;

  return {
    cleanText,
    tags,
    primaryEmotion,
    actionCount,
  };
}

/**
 * 获取情感对应的背景色 class（用于气泡背景）
 */
export function getEmotionBgClass(emotion: string | null): string {
  switch (emotion) {
    case "开心":
    case "快乐":
    case "兴奋":
      return "bg-amber-50 border-amber-200";
    case "悲伤":
      return "bg-blue-50 border-blue-200";
    case "生气":
      return "bg-red-50 border-red-200";
    case "惊讶":
      return "bg-purple-50 border-purple-200";
    case "害怕":
    case "担忧":
      return "bg-gray-50 border-gray-200";
    case "思考":
    case "困惑":
      return "bg-indigo-50 border-indigo-200";
    case "喜爱":
      return "bg-pink-50 border-pink-200";
    default:
      return "bg-white border-gray-200";
  }
}

/**
 * 将标签按类型分组
 */
export function groupTagsByType(tags: EmotionTag[]): Record<string, EmotionTag[]> {
  const groups: Record<string, EmotionTag[]> = {};
  for (const tag of tags) {
    const key = TAG_TYPE_LABELS[tag.type] || tag.type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(tag);
  }
  return groups;
}
