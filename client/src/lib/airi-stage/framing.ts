/**
 * AIRI 舞台 — Framing（构图）几何工具
 *
 * 把原 AiriStageContainer 中分散在 initStage/handleResize 内的缩放与定位逻辑
 * 抽离为纯函数，便于：
 * - 在 viewMode = "halfBody" 下做"上半身特写"调参
 * - 单元测试（不依赖 PIXI/DOM）
 *
 * v0.5 引入。
 */

export type AiriViewMode = "fullBody" | "halfBody";

export interface FramingResult {
  /** 模型缩放比例 */
  scale: number;
  /** 模型在容器中的 X 坐标（默认水平居中） */
  x: number;
  /** 模型在容器中的 Y 坐标 */
  y: number;
  /** 模型锚点的 Y 比例（与 PIXI Live2D anchor.y 对齐） */
  anchorY: number;
}

/** halfBody 默认放大系数（让脚部裁出视口） */
export const HALF_BODY_DEFAULT_SCALE_FACTOR = 1.6;
/** fullBody 安全边距系数（与 v0.4 行为一致） */
export const FULL_BODY_FIT_FACTOR = 0.85;

/**
 * 根据视图模式与容器/模型尺寸计算 Live2D 渲染参数。
 *
 * - `fullBody`：scale = min(w/mw, h/mh) * 0.85，y = h * 0.92，anchorY = 1.0
 * - `halfBody`：scale = fullBody.scale * factor (默认 1.6)，y = h * 1.2，anchorY = 1.0
 *
 * 安全降级：当 width/height/modelWidth/modelHeight 任一 <= 0 时，scale = 0，
 * x/y 取容器中线，避免 NaN。
 *
 * @param viewMode 视图模式
 * @param containerWidth 容器宽（像素）
 * @param containerHeight 容器高（像素）
 * @param modelWidth Live2D 模型固有宽（像素）
 * @param modelHeight Live2D 模型固有高（像素）
 * @param halfBodyOverride 可选，覆盖 halfBody 系数（取值 [0.5, 3.0]）
 */
export function computeFraming(
  viewMode: AiriViewMode,
  containerWidth: number,
  containerHeight: number,
  modelWidth: number,
  modelHeight: number,
  halfBodyOverride?: number
): FramingResult {
  // 安全降级
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    modelWidth <= 0 ||
    modelHeight <= 0
  ) {
    return {
      scale: 0,
      x: containerWidth / 2 || 0,
      y: containerHeight / 2 || 0,
      anchorY: 1.0,
    };
  }

  const baseFitScale =
    Math.min(containerWidth / modelWidth, containerHeight / modelHeight) *
    FULL_BODY_FIT_FACTOR;

  if (viewMode === "fullBody") {
    return {
      scale: baseFitScale,
      x: containerWidth / 2,
      y: containerHeight * 0.92,
      anchorY: 1.0,
    };
  }

  // halfBody
  const factor = clampFactor(halfBodyOverride ?? HALF_BODY_DEFAULT_SCALE_FACTOR);
  return {
    scale: baseFitScale * factor,
    x: containerWidth / 2,
    y: containerHeight * 1.2,
    anchorY: 1.0,
  };
}

function clampFactor(v: number): number {
  if (!Number.isFinite(v)) return HALF_BODY_DEFAULT_SCALE_FACTOR;
  if (v < 0.5) return 0.5;
  if (v > 3.0) return 3.0;
  return v;
}
