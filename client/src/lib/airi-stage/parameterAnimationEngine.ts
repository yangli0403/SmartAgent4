/**
 * 参数动画引擎 — ParameterAnimationEngine
 *
 * 本模块提供 Live2D 参数动画的执行引擎。
 * 负责平滑地动画化参数值，支持多个参数并行动画。
 *
 * 设计特点：
 * 1. 独立于 AiriDemo 和其他组件
 * 2. 支持参数的平滑过渡和缓动
 * 3. 支持多个参数的并行动画
 * 4. 提供动画完成回调
 * 5. 支持动画取消和中断
 *
 * 使用示例：
 * const engine = new ParameterAnimationEngine(coreModel);
 * engine.animateParameters(parameterConfigs, () => {
 *   console.log('Animation complete');
 * });
 */

import {
  ParameterAnimation,
  getEasingFunction,
} from './parameterCombinations';

/**
 * 参数动画状态
 */
interface AnimatingParameter {
  /** 参数名称 */
  paramName: string;
  /** 起始值 */
  startValue: number;
  /** 目标值 */
  targetValue: number;
  /** 动画持续时间（毫秒） */
  duration: number;
  /** 开始时间戳 */
  startTime: number;
  /** 缓动函数 */
  easing: (t: number) => number;
}

/**
 * 参数动画引擎
 */
export class ParameterAnimationEngine {
  private coreModel: any;
  private animatingParameters: Map<string, AnimatingParameter> = new Map();
  private animationFrameId: number | null = null;
  private onCompleteCallback: (() => void) | null = null;
  private isRunning: boolean = false;

  constructor(coreModel: any) {
    this.coreModel = coreModel;
  }

  /**
   * 动画化参数
   * @param parameterConfigs 参数配置表：参数名 -> 动画配置
   * @param onComplete 动画完成时的回调函数
   */
  public animateParameters(
    parameterConfigs: Record<string, ParameterAnimation>,
    onComplete?: () => void
  ): void {
    if (!this.coreModel) {
      console.warn('[ParameterAnimationEngine] coreModel is not available');
      onComplete?.();
      return;
    }

    // 清除之前的动画
    this.cancel();

    this.onCompleteCallback = onComplete || null;
    const now = Date.now();

    // 初始化所有参数的动画状态
    for (const [paramName, config] of Object.entries(parameterConfigs)) {
      try {
        const startValue = this.coreModel.getParameterValueById(paramName) ?? 0;
        const easing = getEasingFunction(config.easing || 'linear');

        this.animatingParameters.set(paramName, {
          paramName,
          startValue,
          targetValue: config.target,
          duration: config.duration,
          startTime: now,
          easing,
        });
      } catch (error) {
        console.warn(
          `[ParameterAnimationEngine] Failed to get initial value for parameter: ${paramName}`,
          error
        );
      }
    }

    if (this.animatingParameters.size === 0) {
      console.warn('[ParameterAnimationEngine] No valid parameters to animate');
      onComplete?.();
      return;
    }

    this.isRunning = true;
    this.animate();
  }

  /**
   * 动画循环
   */
  private animate = (): void => {
    if (!this.isRunning || this.animatingParameters.size === 0) {
      this.isRunning = false;
      this.onCompleteCallback?.();
      return;
    }

    const now = Date.now();
    let allComplete = true;

    // 更新所有正在动画的参数
    for (const [paramName, state] of this.animatingParameters.entries()) {
      const elapsed = now - state.startTime;
      const progress = Math.min(elapsed / state.duration, 1);
      const easedProgress = state.easing(progress);

      const currentValue =
        state.startValue +
        (state.targetValue - state.startValue) * easedProgress;

      try {
        this.coreModel.setParameterValueById(paramName, currentValue);
      } catch (error) {
        console.warn(
          `[ParameterAnimationEngine] Failed to set parameter: ${paramName}`,
          error
        );
      }

      // 检查是否完成
      if (progress < 1) {
        allComplete = false;
      } else {
        // 确保最终值精确
        try {
          this.coreModel.setParameterValueById(paramName, state.targetValue);
        } catch {}
      }
    }

    if (allComplete) {
      this.isRunning = false;
      this.animatingParameters.clear();
      this.onCompleteCallback?.();
    } else {
      this.animationFrameId = requestAnimationFrame(this.animate);
    }
  };

  /**
   * 取消动画
   */
  public cancel(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isRunning = false;
    this.animatingParameters.clear();
    this.onCompleteCallback = null;
  }

  /**
   * 检查是否正在运行动画
   */
  public isAnimating(): boolean {
    return this.isRunning;
  }

  /**
   * 获取当前动画的参数数量
   */
  public getAnimatingParameterCount(): number {
    return this.animatingParameters.size;
  }

  /**
   * 销毁引擎
   */
  public destroy(): void {
    this.cancel();
    this.coreModel = null;
  }
}

/**
 * 创建参数动画引擎的工厂函数
 * @param coreModel Live2D 核心模型
 * @returns 参数动画引擎实例
 */
export function createParameterAnimationEngine(
  coreModel: any
): ParameterAnimationEngine {
  return new ParameterAnimationEngine(coreModel);
}

/**
 * 参数动画管理器
 * 用于管理多个参数动画引擎的生命周期
 */
export class ParameterAnimationManager {
  private engines: Map<string, ParameterAnimationEngine> = new Map();

  /**
   * 获取或创建参数动画引擎
   * @param id 引擎 ID
   * @param coreModel Live2D 核心模型
   * @returns 参数动画引擎实例
   */
  public getOrCreateEngine(id: string, coreModel: any): ParameterAnimationEngine {
    if (!this.engines.has(id)) {
      this.engines.set(id, new ParameterAnimationEngine(coreModel));
    }
    return this.engines.get(id)!;
  }

  /**
   * 获取引擎
   * @param id 引擎 ID
   * @returns 参数动画引擎实例，如果不存在则返回 null
   */
  public getEngine(id: string): ParameterAnimationEngine | null {
    return this.engines.get(id) || null;
  }

  /**
   * 销毁引擎
   * @param id 引擎 ID
   */
  public destroyEngine(id: string): void {
    const engine = this.engines.get(id);
    if (engine) {
      engine.destroy();
      this.engines.delete(id);
    }
  }

  /**
   * 销毁所有引擎
   */
  public destroyAll(): void {
    for (const engine of this.engines.values()) {
      engine.destroy();
    }
    this.engines.clear();
  }

  /**
   * 获取所有活跃的引擎数量
   */
  public getEngineCount(): number {
    return this.engines.size;
  }
}

/**
 * 全局参数动画管理器实例
 */
let globalAnimationManager: ParameterAnimationManager | null = null;

/**
 * 获取全局参数动画管理器
 */
export function getGlobalParameterAnimationManager(): ParameterAnimationManager {
  if (!globalAnimationManager) {
    globalAnimationManager = new ParameterAnimationManager();
  }
  return globalAnimationManager;
}

/**
 * 销毁全局参数动画管理器
 */
export function destroyGlobalParameterAnimationManager(): void {
  if (globalAnimationManager) {
    globalAnimationManager.destroyAll();
    globalAnimationManager = null;
  }
}
