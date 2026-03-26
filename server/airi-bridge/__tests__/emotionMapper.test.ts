/**
 * EmotionMapper 单元测试
 *
 * 测试情感映射器的核心功能：
 * 1. 默认映射表覆盖所有 7 种情感
 * 2. MultimodalSegment → AiriOutputMessage 转换
 * 3. 纯文本降级模式（标签解析）
 * 4. 自定义映射规则覆盖
 * 5. 未知情感的降级处理
 */

import { EmotionMapper } from "../emotionMapper";
import type { MultimodalSegment, EmotionType } from "../../emotions/types";

describe("EmotionMapper", () => {
  let mapper: EmotionMapper;

  beforeEach(() => {
    mapper = new EmotionMapper();
  });

  // ==================== 默认映射表测试 ====================

  describe("默认映射表", () => {
    const allEmotions: EmotionType[] = [
      "neutral",
      "happy",
      "sad",
      "angry",
      "surprised",
      "fearful",
      "disgusted",
    ];

    test("应覆盖所有 7 种情感类型", () => {
      const mapping = mapper.getMapping();
      expect(mapping.length).toBe(7);

      for (const emotion of allEmotions) {
        const rule = mapping.find((r) => r.emotion === emotion);
        expect(rule).toBeDefined();
        expect(rule!.expressions.length).toBeGreaterThan(0);
        expect(rule!.motions.length).toBeGreaterThan(0);
      }
    });

    test.each(allEmotions)("mapEmotion('%s') 应返回非空表情指令", (emotion) => {
      const expressions = mapper.mapEmotion(emotion);
      expect(expressions.length).toBeGreaterThan(0);
      expect(expressions[0].expression).toBeTruthy();
      expect(expressions[0].intensity).toBeGreaterThan(0);
      expect(expressions[0].intensity).toBeLessThanOrEqual(1);
    });
  });

  // ==================== mapSegmentsToAiriMessage 测试 ====================

  describe("mapSegmentsToAiriMessage", () => {
    test("空 segments 应返回空文本消息", () => {
      const result = mapper.mapSegmentsToAiriMessage([]);
      expect(result.message.role).toBe("assistant");
      expect(result.message.content).toHaveLength(1);
      expect(result.message.content[0]).toEqual({ type: "text", text: "" });
    });

    test("单个文本 segment 应正确转换", () => {
      const segments: MultimodalSegment[] = [
        {
          text: "你好！",
          emotion: "happy",
          audioFormat: "wav",
          actions: [],
        },
      ];

      const result = mapper.mapSegmentsToAiriMessage(segments);
      expect(result.message.role).toBe("assistant");

      // 应包含表情指令
      const expressionParts = result.message.content.filter(
        (p) => p.type === "expression"
      );
      expect(expressionParts.length).toBeGreaterThan(0);

      // 应包含文本
      const textParts = result.message.content.filter(
        (p) => p.type === "text"
      );
      expect(textParts.length).toBe(1);
      expect((textParts[0] as any).text).toBe("你好！");
    });

    test("带音频的 segment 应包含 audio content part", () => {
      const segments: MultimodalSegment[] = [
        {
          text: "你好！",
          audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
          audioFormat: "wav",
          emotion: "neutral",
          actions: [],
        },
      ];

      const result = mapper.mapSegmentsToAiriMessage(segments);
      const audioParts = result.message.content.filter(
        (p) => p.type === "audio"
      );
      expect(audioParts.length).toBe(1);
      expect((audioParts[0] as any).format).toBe("wav");
    });

    test("带动作的 segment 应包含 motion content part", () => {
      const segments: MultimodalSegment[] = [
        {
          text: "让我想想",
          emotion: "neutral",
          audioFormat: "wav",
          actions: [
            { type: "animation", value: "thinking" },
            { type: "gesture", value: "chin_touch" },
          ],
        },
      ];

      const result = mapper.mapSegmentsToAiriMessage(segments);
      const motionParts = result.message.content.filter(
        (p) => p.type === "motion"
      );
      expect(motionParts.length).toBe(2);
      expect((motionParts[0] as any).motion).toBe("thinking");
      expect((motionParts[1] as any).motion).toBe("chin_touch");
    });

    test("多个 segments 应合并为单个消息", () => {
      const segments: MultimodalSegment[] = [
        {
          text: "第一段",
          emotion: "happy",
          audioFormat: "wav",
          actions: [],
        },
        {
          text: "第二段",
          emotion: "neutral",
          audioFormat: "wav",
          actions: [],
        },
      ];

      const result = mapper.mapSegmentsToAiriMessage(segments);
      const textParts = result.message.content.filter(
        (p) => p.type === "text"
      );
      expect(textParts.length).toBe(2);

      // 主情感应使用第一个 segment 的情感
      const expressionParts = result.message.content.filter(
        (p) => p.type === "expression"
      );
      expect((expressionParts[0] as any).expression).toBe("smile"); // happy → smile
    });
  });

  // ==================== mapTextToAiriMessage 降级模式测试 ====================

  describe("mapTextToAiriMessage（降级模式）", () => {
    test("应解析 [emotion:happy] 标签", () => {
      const result = mapper.mapTextToAiriMessage(
        "[emotion:happy]今天天气真好！"
      );

      const expressionParts = result.message.content.filter(
        (p) => p.type === "expression"
      );
      expect(expressionParts.length).toBeGreaterThan(0);
      expect((expressionParts[0] as any).expression).toBe("smile");

      const textParts = result.message.content.filter(
        (p) => p.type === "text"
      );
      expect((textParts[0] as any).text).toBe("今天天气真好！");
    });

    test("应解析 [animation:nod] 动作标签", () => {
      const result = mapper.mapTextToAiriMessage(
        "[animation:nod]好的，我明白了。"
      );

      const motionParts = result.message.content.filter(
        (p) => p.type === "motion"
      );
      expect(motionParts.length).toBe(1);
      expect((motionParts[0] as any).motion).toBe("nod");
    });

    test("无标签文本应使用 neutral 情感", () => {
      const result = mapper.mapTextToAiriMessage("普通的回复文本");

      const expressionParts = result.message.content.filter(
        (p) => p.type === "expression"
      );
      expect((expressionParts[0] as any).expression).toBe("default");
    });

    test("应清除所有标签后输出纯文本", () => {
      const result = mapper.mapTextToAiriMessage(
        "[emotion:sad][expression:cry][pause:0.5]我很抱歉听到这个消息。[gesture:open_palms]"
      );

      const textParts = result.message.content.filter(
        (p) => p.type === "text"
      );
      expect((textParts[0] as any).text).toBe("我很抱歉听到这个消息。");
    });
  });

  // ==================== 自定义映射测试 ====================

  describe("自定义映射", () => {
    test("应支持覆盖默认映射", () => {
      const customMapper = new EmotionMapper([
        {
          emotion: "happy",
          expressions: [{ expression: "custom_joy", intensity: 1.0 }],
          motions: [{ motion: "custom_dance" }],
          mouthFormOffset: 0.5,
        },
      ]);

      const expressions = customMapper.mapEmotion("happy");
      expect(expressions[0].expression).toBe("custom_joy");
      expect(expressions[0].intensity).toBe(1.0);
    });

    test("updateMapping 应更新映射规则", () => {
      mapper.updateMapping([
        {
          emotion: "angry",
          expressions: [{ expression: "rage", intensity: 1.0 }],
          motions: [{ motion: "slam" }],
        },
      ]);

      const expressions = mapper.mapEmotion("angry");
      expect(expressions[0].expression).toBe("rage");
    });
  });

  // ==================== 边界情况测试 ====================

  describe("边界情况", () => {
    test("未知情感应降级到 neutral", () => {
      const expressions = mapper.mapEmotion("unknown_emotion" as EmotionType);
      expect(expressions[0].expression).toBe("default");
    });

    test("getMouthFormOffset 应返回正确的偏移值", () => {
      expect(mapper.getMouthFormOffset("happy")).toBe(0.2);
      expect(mapper.getMouthFormOffset("sad")).toBe(-0.1);
      expect(mapper.getMouthFormOffset("neutral")).toBe(0.0);
    });

    test("mapActions 应忽略 expression/sound/pause 类型", () => {
      const motions = mapper.mapActions([
        { type: "expression", value: "smile" },
        { type: "sound", value: "ding" },
        { type: "pause", value: "1.0", duration: 1000 },
        { type: "animation", value: "wave" },
      ]);

      expect(motions.length).toBe(1);
      expect(motions[0].motion).toBe("wave");
    });
  });
});
