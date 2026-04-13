/**
 * 表情映射配置 — ExpressionMapping
 *
 * 定义每种情感类型对应的 Live2D 参数目标值。
 * 这些参数将被 ExpressionDriver 用于平滑插值过渡。
 *
 * 参数说明：
 * - ParamEyeLOpen / ParamEyeROpen: 眼睛开合 (0=闭, 1=开)
 * - ParamBrowLY / ParamBrowRY: 眉毛高度 (-1=皱眉, 1=挑眉)
 * - ParamMouthForm: 嘴型 (-1=嘟嘴, 1=微笑)
 * - ParamMouthOpenY: 嘴巴张合 (0=闭, 1=张开)
 * - ParamAngleX/Y/Z: 头部角度
 * - ParamCheek: 脸红 (0=无, 1=满)
 * - ParamBreath: 呼吸 (0-1 循环)
 */

import type { ExpressionMappingConfig } from "./types";

export const EXPRESSION_MAPPING: ExpressionMappingConfig = {
  // ==================== 基础 7 种情感 ====================

  neutral: {
    name: "neutral",
    params: {
      ParamEyeLOpen: 1.0,
      ParamEyeROpen: 1.0,
      ParamBrowLY: 0,
      ParamBrowRY: 0,
      ParamMouthForm: 0,
      ParamMouthOpenY: 0,
      ParamCheek: 0,
    },
  },

  happy: {
    name: "happy",
    params: {
      ParamEyeLOpen: 0.8,
      ParamEyeROpen: 0.8,
      ParamBrowLY: 0.3,
      ParamBrowRY: 0.3,
      ParamMouthForm: 1.0,
      ParamMouthOpenY: 0.2,
      ParamCheek: 0.3,
    },
  },

  sad: {
    name: "sad",
    params: {
      ParamEyeLOpen: 0.6,
      ParamEyeROpen: 0.6,
      ParamBrowLY: -0.5,
      ParamBrowRY: -0.5,
      ParamMouthForm: -0.5,
      ParamMouthOpenY: 0,
      ParamAngleY: -5,
    },
  },

  angry: {
    name: "angry",
    params: {
      ParamEyeLOpen: 1.0,
      ParamEyeROpen: 1.0,
      ParamBrowLY: -0.8,
      ParamBrowRY: -0.8,
      ParamMouthForm: -0.3,
      ParamMouthOpenY: 0.1,
    },
  },

  surprised: {
    name: "surprised",
    params: {
      ParamEyeLOpen: 1.3,
      ParamEyeROpen: 1.3,
      ParamBrowLY: 0.8,
      ParamBrowRY: 0.8,
      ParamMouthForm: 0,
      ParamMouthOpenY: 0.6,
    },
  },

  fearful: {
    name: "fearful",
    params: {
      ParamEyeLOpen: 1.2,
      ParamEyeROpen: 1.2,
      ParamBrowLY: 0.5,
      ParamBrowRY: -0.3,
      ParamMouthForm: -0.2,
      ParamMouthOpenY: 0.3,
      ParamAngleX: -5,
    },
  },

  disgusted: {
    name: "disgusted",
    params: {
      ParamEyeLOpen: 0.7,
      ParamEyeROpen: 0.5,
      ParamBrowLY: -0.4,
      ParamBrowRY: -0.6,
      ParamMouthForm: -0.7,
      ParamMouthOpenY: 0.1,
    },
  },

  // ==================== 扩展 9 种情感 ====================

  smile: {
    name: "smile",
    params: {
      ParamEyeLOpen: 0.85,
      ParamEyeROpen: 0.85,
      ParamBrowLY: 0.2,
      ParamBrowRY: 0.2,
      ParamMouthForm: 0.8,
      ParamMouthOpenY: 0.1,
      ParamCheek: 0.2,
    },
  },

  think: {
    name: "think",
    params: {
      ParamEyeLOpen: 0.9,
      ParamEyeROpen: 0.7,
      ParamBrowLY: 0.1,
      ParamBrowRY: -0.2,
      ParamMouthForm: -0.1,
      ParamAngleZ: 8,
      ParamAngleY: 5,
    },
  },

  shy: {
    name: "shy",
    params: {
      ParamEyeLOpen: 0.6,
      ParamEyeROpen: 0.6,
      ParamBrowLY: 0.1,
      ParamBrowRY: 0.1,
      ParamMouthForm: 0.3,
      ParamCheek: 0.8,
      ParamAngleY: -8,
    },
  },

  love: {
    name: "love",
    params: {
      ParamEyeLOpen: 0.7,
      ParamEyeROpen: 0.7,
      ParamBrowLY: 0.3,
      ParamBrowRY: 0.3,
      ParamMouthForm: 0.9,
      ParamMouthOpenY: 0.15,
      ParamCheek: 0.6,
    },
  },

  proud: {
    name: "proud",
    params: {
      ParamEyeLOpen: 0.9,
      ParamEyeROpen: 0.9,
      ParamBrowLY: 0.4,
      ParamBrowRY: 0.4,
      ParamMouthForm: 0.6,
      ParamAngleY: 5,
    },
  },

  worried: {
    name: "worried",
    params: {
      ParamEyeLOpen: 0.85,
      ParamEyeROpen: 0.85,
      ParamBrowLY: 0.3,
      ParamBrowRY: -0.3,
      ParamMouthForm: -0.3,
      ParamMouthOpenY: 0.05,
    },
  },

  confused: {
    name: "confused",
    params: {
      ParamEyeLOpen: 1.0,
      ParamEyeROpen: 0.8,
      ParamBrowLY: 0.4,
      ParamBrowRY: -0.2,
      ParamMouthForm: -0.1,
      ParamAngleZ: 10,
    },
  },

  excited: {
    name: "excited",
    params: {
      ParamEyeLOpen: 1.2,
      ParamEyeROpen: 1.2,
      ParamBrowLY: 0.6,
      ParamBrowRY: 0.6,
      ParamMouthForm: 0.9,
      ParamMouthOpenY: 0.4,
      ParamCheek: 0.4,
    },
  },

  relieved: {
    name: "relieved",
    params: {
      ParamEyeLOpen: 0.6,
      ParamEyeROpen: 0.6,
      ParamBrowLY: 0.1,
      ParamBrowRY: 0.1,
      ParamMouthForm: 0.4,
      ParamMouthOpenY: 0.05,
    },
  },
};

/**
 * 获取表情参数集，未知表情降级为 neutral
 */
export function getExpressionParams(expression: string): ExpressionMappingConfig[string] {
  const mapping = EXPRESSION_MAPPING[expression];
  if (mapping) return mapping;

  if (import.meta.env.DEV) {
    console.warn(`[ExpressionMapping] 未知表情 "${expression}"，降级为 neutral`);
  }
  return EXPRESSION_MAPPING.neutral;
}
