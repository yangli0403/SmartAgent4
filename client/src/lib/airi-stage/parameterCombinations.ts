/**
 * 参数驱动动作库 — ParameterCombinations
 *
 * 本模块定义了通过 Live2D 参数组合来模拟复杂动作的配置。
 * 这些参数组合与 Motion Group 配合使用，可以产生更丰富的视觉效果。
 *
 * 设计原则：
 * 1. 完全独立于其他模块，不修改 motionMapping.ts
 * 2. 参数组合是可选的增强，不影响系统的基础功能
 * 3. 每个动作可以有多个参数变化，支持序列化执行
 * 4. 参数值范围通常在 [-1, 1] 之间
 *
 * 使用方式：
 * const combo = PARAMETER_COMBINATIONS['spin'];
 * if (combo) {
 *   animateParameters(coreModel, combo.parameters, combo.duration);
 * }
 */

/**
 * 单个参数的动画配置
 */
export interface ParameterAnimation {
  /** 目标参数值 */
  target: number;
  /** 动画持续时间（毫秒） */
  duration: number;
  /** 可选的缓动函数类型 */
  easing?: 'linear' | 'easeInOutQuad' | 'easeInOutCubic';
}

/**
 * 动作的参数组合配置
 */
export interface ParameterCombinationConfig {
  /** 动作描述 */
  description: string;
  /** 参数映射表：参数名 -> 动画配置 */
  parameters: Record<string, ParameterAnimation>;
  /** 动作的总持续时间（毫秒），用于同步 Motion 播放 */
  totalDuration?: number;
  /** 如果参数驱动失败，回退到的 Motion 定义 */
  motionFallback?: {
    group: string;
    index: number;
  };
}

/**
 * 参数驱动动作库
 * 
 * 包含所有 Action Agent 所需的复杂动作参数组合
 */
export const PARAMETER_COMBINATIONS: Record<string, ParameterCombinationConfig> = {
  // ==================== 舞蹈表演相关 ====================

  /**
   * 转圈动作
   * 通过身体旋转参数模拟转圈效果
   */
  spin: {
    description: "转圈动作 - 通过身体旋转参数模拟",
    totalDuration: 800,
    parameters: {
      // 身体向右转
      ParamBodyAngleY: {
        target: 30,
        duration: 400,
        easing: 'easeInOutQuad',
      },
      // 头部跟随身体旋转
      ParamAngleY: {
        target: 25,
        duration: 400,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 1 },
  },

  /**
   * 跳跃动作
   * 通过身体前倾参数模拟跳跃的起跳动作
   */
  jump: {
    description: "跳跃动作 - 通过身体角度模拟",
    totalDuration: 600,
    parameters: {
      // 身体微微前倾（起跳准备）
      ParamBodyAngleX: {
        target: -8,
        duration: 300,
        easing: 'easeInOutQuad',
      },
      // 恢复到直立状态
      ParamBodyAngleX: {
        target: 0,
        duration: 300,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 0 },
  },

  // ==================== 惊讶相关 ====================

  /**
   * 后退一步
   * 通过身体后仰参数模拟后退的动作
   */
  step_back: {
    description: "后退一步 - 通过身体后仰模拟",
    totalDuration: 500,
    parameters: {
      // 身体后仰（后退姿态）
      ParamBodyAngleX: {
        target: 8,
        duration: 300,
        easing: 'easeInOutQuad',
      },
      // 头部跟随
      ParamAngleX: {
        target: 5,
        duration: 300,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 1 },
  },

  // ==================== 思考相关 ====================

  /**
   * 捂脸动作
   * 通过眼球和头部参数模拟捂脸的动作
   */
  facepalm: {
    description: "捂脸动作 - 通过眼球和头部参数模拟",
    totalDuration: 400,
    parameters: {
      // 头部向下
      ParamAngleX: {
        target: 20,
        duration: 200,
        easing: 'easeInOutQuad',
      },
      // 眼球向下看
      ParamEyeBallX: {
        target: -0.3,
        duration: 200,
        easing: 'easeInOutQuad',
      },
      ParamEyeBallY: {
        target: 0.5,
        duration: 200,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 0 },
  },

  /**
   * 身体前倾
   * 模拟思考或倾听时的身体前倾姿态
   */
  lean_forward: {
    description: "身体前倾 - 思考/倾听姿态",
    totalDuration: 600,
    parameters: {
      // 身体前倾
      ParamBodyAngleX: {
        target: -15,
        duration: 300,
        easing: 'easeInOutQuad',
      },
      // 头部跟随
      ParamAngleX: {
        target: -10,
        duration: 300,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 1 },
  },

  /**
   * 身体后仰
   * 模拟放松、如释重负或惊讶后的恢复姿态
   */
  lean_back: {
    description: "身体后仰 - 放松/如释重负",
    totalDuration: 600,
    parameters: {
      // 身体后仰
      ParamBodyAngleX: {
        target: 20,
        duration: 300,
        easing: 'easeInOutQuad',
      },
      // 头部跟随
      ParamAngleX: {
        target: 15,
        duration: 300,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 0 },
  },

  // ==================== 其他表演动作 ====================

  /**
   * 摊开双手
   * 通过身体角度模拟摊开双手的动作
   */
  open_palms: {
    description: "摊开双手 - 表示无奈或开放",
    totalDuration: 400,
    parameters: {
      // 身体向两侧打开
      ParamBodyAngleY: {
        target: 0,
        duration: 200,
        easing: 'linear',
      },
    },
    motionFallback: { group: "Tap", index: 1 },
  },

  /**
   * 挺胸站立
   * 通过身体角度模拟挺胸的自信姿态
   */
  stand_tall: {
    description: "挺胸站立 - 自信姿态",
    totalDuration: 400,
    parameters: {
      // 身体直立
      ParamBodyAngleX: {
        target: -5,
        duration: 200,
        easing: 'easeInOutQuad',
      },
      // 头部抬起
      ParamAngleX: {
        target: -8,
        duration: 200,
        easing: 'easeInOutQuad',
      },
    },
    motionFallback: { group: "Tap", index: 0 },
  },
};

/**
 * 获取参数组合配置
 * @param motionName 动作名称
 * @returns 参数组合配置，如果不存在则返回 null
 */
export function getParameterCombination(
  motionName: string
): ParameterCombinationConfig | null {
  return PARAMETER_COMBINATIONS[motionName] || null;
}

/**
 * 检查动作是否有参数驱动配置
 * @param motionName 动作名称
 * @returns 是否存在参数驱动配置
 */
export function hasParameterCombination(motionName: string): boolean {
  return motionName in PARAMETER_COMBINATIONS;
}

/**
 * 获取所有支持参数驱动的动作列表
 * @returns 动作名称数组
 */
export function getSupportedParameterDrivenMotions(): string[] {
  return Object.keys(PARAMETER_COMBINATIONS);
}

/**
 * 缓动函数实现
 */
export const easingFunctions = {
  linear: (t: number): number => t,

  easeInOutQuad: (t: number): number => {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  },

  easeInOutCubic: (t: number): number => {
    return t < 0.5
      ? 4 * t * t * t
      : 1 + (t - 1) * (2 * (t - 2)) * (2 * (t - 2));
  },
};

/**
 * 获取缓动函数
 * @param type 缓动函数类型
 * @returns 缓动函数
 */
export function getEasingFunction(
  type: 'linear' | 'easeInOutQuad' | 'easeInOutCubic' = 'linear'
): (t: number) => number {
  return easingFunctions[type];
}
