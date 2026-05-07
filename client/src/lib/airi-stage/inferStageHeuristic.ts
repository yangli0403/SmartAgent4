/**
 * 短期方案：从助手纯文本推断表情/动作（无 [tag] 标签时的兜底）
 * 规则按顺序匹配，命中即返回。
 */

export interface StageHeuristicResult {
  expression: string;
  intensity: number;
  /** motionMapping 中的 key，未知动作会在派发层忽略 */
  motion?: string;
}

type Rule = {
  test: (t: string) => boolean;
  expression: string;
  intensity: number;
  motion?: string;
};

const RULES: Rule[] = [
  {
    test: (t) =>
      /对不起|抱歉|不好意思|请原谅|我的错|我错了/i.test(t) ||
      /\b(sorry|apologize|my bad|forgive me)\b/i.test(t),
    expression: "sad",
    intensity: 0.88,
    motion: "bow",
  },
  {
    test: (t) =>
      /谢谢|感谢|辛苦了|多谢|感激|承蒙/i.test(t) ||
      /\b(thank|thanks|appreciate|grateful)\b/i.test(t),
    expression: "smile",
    intensity: 0.85,
    motion: "nod",
  },
  {
    test: (t) =>
      /再见|拜拜|回见|下次见/i.test(t) ||
      /\b(bye|goodbye|see you)\b/i.test(t),
    expression: "smile",
    intensity: 0.78,
    motion: "wave",
  },
  {
    test: (t) =>
      /太好了|太棒了|开心|恭喜|棒棒|哈哈|耶|不错嘛/i.test(t) ||
      /\b(awesome|perfect|great|wonderful|yay|haha)\b/i.test(t),
    expression: "happy",
    intensity: 0.86,
    motion: "nod",
  },
  {
    test: (t) =>
      /气死|讨厌|可恶|愤怒|烦死了|难用|垃圾/i.test(t) ||
      /\b(hate|angry|wtf|damn)\b/i.test(t),
    expression: "angry",
    intensity: 0.9,
  },
  {
    test: (t) =>
      /什么？|竟然|没想到|原来如此|怎么会|真的假的/i.test(t) ||
      /\b(wow|really\?|what\?)\b/i.test(t),
    expression: "surprised",
    intensity: 0.85,
    motion: "head_tilt",
  },
  {
    test: (t) =>
      /担心|害怕|不安|糟糕|有点慌/i.test(t) ||
      /\b(worry|scared|afraid|nervous)\b/i.test(t),
    expression: "worried",
    intensity: 0.82,
  },
  {
    test: (t) =>
      /不懂|不明白|什么意思|不清楚|请问一下/i.test(t) ||
      /\b(don't understand|confused|what do you mean)\b/i.test(t),
    expression: "confused",
    intensity: 0.8,
    motion: "head_tilt",
  },
  {
    test: (t) =>
      /太牛|激动|兴奋|燃起来了/i.test(t) ||
      /\b(excited|pumped|let's go)\b/i.test(t),
    expression: "excited",
    intensity: 0.88,
    motion: "nod",
  },
  {
    test: (t) =>
      /爱你|喜欢你|么么|比心/i.test(t) || /\b(love you|❤)\b/i.test(t),
    expression: "love",
    intensity: 0.85,
  },
  {
    test: (t) =>
      /吗\s*[？?]?|[？?]\s*$|怎么|为什么|能否|能不能|可不可以|请问|如何/i.test(t) ||
      /\b(how to|why|could you|can you|please explain)\b/i.test(t),
    expression: "think",
    intensity: 0.62,
    motion: "head_tilt",
  },
];

/**
 * 根据助手回复纯文本推断表情与动作
 */
export function inferStageHeuristic(cleanText: string): StageHeuristicResult {
  const t = cleanText.trim();
  if (!t) {
    return { expression: "neutral", intensity: 0.5 };
  }

  for (const rule of RULES) {
    if (rule.test(t)) {
      return {
        expression: rule.expression,
        intensity: rule.intensity,
        motion: rule.motion,
      };
    }
  }

  return { expression: "neutral", intensity: 0.55 };
}
