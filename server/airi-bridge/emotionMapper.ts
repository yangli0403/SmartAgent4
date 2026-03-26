/**
 * Emotion Mapper — 情感映射器
 *
 * 将 SmartAgent4 的 EmotionType 和 EmotionAction
 * 转换为 AIRI 可消费的表情和动作指令。
 *
 * 映射策略：
 * 1. 基于预定义映射表将 EmotionType → AIRI Expression + Motion
 * 2. 将 EmotionAction 中的 expression/animation/gesture 类型映射为 AIRI 指令
 * 3. 支持自定义映射规则覆盖默认映射
 */

import type { EmotionType, EmotionAction } from "../emotions/types";
import type {
  AiriExpressionCommand,
  AiriMotionCommand,
  AiriMessageContentPart,
  AiriOutputMessage,
  EmotionMappingRule,
  EmotionMappingConfig,
} from "./types";
import type { MultimodalSegment } from "../emotions/types";

// ==================== 默认映射表 ====================

const DEFAULT_MAPPING: EmotionMappingConfig = [
  {
    emotion: "neutral",
    expressions: [{ expression: "default", intensity: 1.0 }],
    motions: [{ motion: "idle" }],
    mouthFormOffset: 0.0,
  },
  {
    emotion: "happy",
    expressions: [{ expression: "smile", intensity: 0.8 }],
    motions: [{ motion: "nod" }],
    mouthFormOffset: 0.2,
  },
  {
    emotion: "sad",
    expressions: [{ expression: "sad", intensity: 0.7 }],
    motions: [{ motion: "slow_sway" }],
    mouthFormOffset: -0.1,
  },
  {
    emotion: "angry",
    expressions: [{ expression: "angry", intensity: 0.8 }],
    motions: [{ motion: "shake" }],
    mouthFormOffset: 0.1,
  },
  {
    emotion: "surprised",
    expressions: [{ expression: "surprised", intensity: 0.9 }],
    motions: [{ motion: "jump_back" }],
    mouthFormOffset: 0.3,
  },
  {
    emotion: "fearful",
    expressions: [{ expression: "fear", intensity: 0.6 }],
    motions: [{ motion: "tremble" }],
    mouthFormOffset: -0.2,
  },
  {
    emotion: "disgusted",
    expressions: [{ expression: "disgust", intensity: 0.7 }],
    motions: [{ motion: "turn_away" }],
    mouthFormOffset: -0.1,
  },
];

// ==================== EmotionMapper 类 ====================

/**
 * 情感映射器
 *
 * 将 SmartAgent4 的情感数据转换为 AIRI 可消费的指令格式。
 */
export class EmotionMapper {
  private mapping: Map<EmotionType, EmotionMappingRule>;

  constructor(customMapping?: Partial<EmotionMappingConfig>) {
    this.mapping = new Map();

    // 加载默认映射
    for (const rule of DEFAULT_MAPPING) {
      this.mapping.set(rule.emotion, rule);
    }

    // 覆盖自定义映射
    if (customMapping) {
      for (const rule of customMapping) {
        if (rule) {
          this.mapping.set(rule.emotion, rule);
        }
      }
    }

    console.log(
      `[EmotionMapper] Initialized with ${this.mapping.size} emotion mappings`
    );
  }

  /**
   * 将 MultimodalSegment[] 转换为 AIRI 输出消息
   *
   * 转换逻辑：
   * 1. 合并所有 segment 的文本
   * 2. 提取第一个 segment 的情感作为主情感
   * 3. 将音频数据转换为 audio content part
   * 4. 将情感映射为 expression/motion content parts
   */
  mapSegmentsToAiriMessage(segments: MultimodalSegment[]): AiriOutputMessage {
    const contentParts: AiriMessageContentPart[] = [];

    if (segments.length === 0) {
      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "" }],
        },
      };
    }

    // 提取主情感（使用第一个 segment 的情感）
    const primaryEmotion = segments[0].emotion || "neutral";
    const expressionCommands = this.mapEmotion(primaryEmotion);
    const motionCommands = this.mapActions(
      segments.flatMap((s) => s.actions || [])
    );

    // 添加表情指令
    for (const cmd of expressionCommands) {
      contentParts.push({
        type: "expression",
        expression: cmd.expression,
        intensity: cmd.intensity,
      });
    }

    // 添加动作指令
    for (const cmd of motionCommands) {
      contentParts.push({
        type: "motion",
        motion: cmd.motion,
        index: cmd.index,
      });
    }

    // 逐 segment 添加文本和音频
    for (const segment of segments) {
      // 添加文本
      if (segment.text) {
        contentParts.push({ type: "text", text: segment.text });
      }

      // 添加音频
      if (segment.audioBase64) {
        contentParts.push({
          type: "audio",
          audioBase64: segment.audioBase64,
          format: segment.audioFormat || "wav",
        });
      }
    }

    return {
      message: {
        role: "assistant",
        content: contentParts,
      },
    };
  }

  /**
   * 将单个情感类型映射为 AIRI 表情指令
   */
  mapEmotion(emotion: EmotionType): AiriExpressionCommand[] {
    const rule = this.mapping.get(emotion);
    if (!rule) {
      console.warn(
        `[EmotionMapper] No mapping for emotion "${emotion}", using neutral`
      );
      return this.mapping.get("neutral")?.expressions || [
        { expression: "default", intensity: 1.0 },
      ];
    }
    return [...rule.expressions];
  }

  /**
   * 将 EmotionAction[] 映射为 AIRI 动作指令
   *
   * 映射规则：
   * - expression 类型 → AiriExpressionCommand（已在 mapEmotion 中处理）
   * - animation/gesture/posture/locomotion → AiriMotionCommand
   * - sound → 跳过（由音频层处理）
   * - pause → 跳过（由前端时序控制）
   */
  mapActions(actions: EmotionAction[]): AiriMotionCommand[] {
    const motionCommands: AiriMotionCommand[] = [];

    for (const action of actions) {
      switch (action.type) {
        case "animation":
        case "gesture":
        case "posture":
        case "locomotion":
          motionCommands.push({
            motion: action.value,
            index: 0,
          });
          break;
        case "expression":
          // 表情类型在 mapEmotion 中处理，此处跳过
          break;
        case "sound":
        case "pause":
          // 由其他层处理
          break;
        default:
          console.warn(
            `[EmotionMapper] Unknown action type: ${action.type}`
          );
      }
    }

    // 如果没有动作，使用主情感对应的默认动作
    if (motionCommands.length === 0) {
      return [];
    }

    return motionCommands;
  }

  /**
   * 获取指定情感的口型偏移量
   */
  getMouthFormOffset(emotion: EmotionType): number {
    return this.mapping.get(emotion)?.mouthFormOffset || 0.0;
  }

  /**
   * 获取当前映射配置
   */
  getMapping(): EmotionMappingConfig {
    return Array.from(this.mapping.values());
  }

  /**
   * 更新映射规则
   */
  updateMapping(rules: EmotionMappingRule[]): void {
    for (const rule of rules) {
      this.mapping.set(rule.emotion, rule);
    }
    console.log(
      `[EmotionMapper] Updated ${rules.length} mapping rules`
    );
  }

  /**
   * 将纯文本回复（含情感标签）转换为简化的 AIRI 消息
   *
   * 用于 Emotions-System 不可用时的降级模式。
   * 从文本中解析 [emotion:value] 标签并映射。
   */
  mapTextToAiriMessage(text: string): AiriOutputMessage {
    const contentParts: AiriMessageContentPart[] = [];

    // 解析文本中的情感标签
    const emotionMatch = text.match(/\[emotion:(\w+)\]/);
    const emotion = (emotionMatch?.[1] || "neutral") as EmotionType;

    // 映射表情
    const expressions = this.mapEmotion(emotion);
    for (const cmd of expressions) {
      contentParts.push({
        type: "expression",
        expression: cmd.expression,
        intensity: cmd.intensity,
      });
    }

    // 解析动作标签
    const actionRegex = /\[(expression|animation|gesture|posture):(\w+)\]/g;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      const [, actionType, value] = match;
      if (actionType !== "expression") {
        contentParts.push({
          type: "motion",
          motion: value,
        });
      }
    }

    // 清理标签后的纯文本
    const cleanText = text
      .replace(/\[\w+:\w+\]/g, "")
      .replace(/\[pause:[\d.]+\]/g, "")
      .trim();

    if (cleanText) {
      contentParts.push({ type: "text", text: cleanText });
    }

    return {
      message: {
        role: "assistant",
        content: contentParts,
      },
    };
  }
}
