/**
 * US-3：AIRI 半身展示几何函数测试
 * 关联用户测试用例：U-FR-1 / U-FR-2 / U-FR-3 / U-FR-4
 */
import { describe, it, expect } from "vitest";
import { computeFraming } from "../framing";

const W = 800;
const H = 600;
// 模拟 Live2D 模型在缩放=1 下的固有像素尺寸
const MW = 1000;
const MH = 1000;

describe("US-3 computeFraming", () => {
  it("U-FR-1：fullBody 与现有公式一致 (scale=min(w/mw,h/mh)*0.85, y=h*0.92)", () => {
    const out = computeFraming("fullBody", W, H, MW, MH);
    const expectedScale = Math.min(W / MW, H / MH) * 0.85;
    expect(out.scale).toBeCloseTo(expectedScale, 6);
    expect(out.x).toBe(W / 2);
    expect(out.y).toBe(H * 0.92);
    expect(out.anchorY).toBe(1.0);
  });

  it("U-FR-2：halfBody 默认 scale = fullBody.scale * 1.6, y = h * 1.2", () => {
    const full = computeFraming("fullBody", W, H, MW, MH);
    const half = computeFraming("halfBody", W, H, MW, MH);
    expect(half.scale).toBeCloseTo(full.scale * 1.6, 6);
    expect(half.y).toBe(H * 1.2);
    expect(half.anchorY).toBe(1.0);
    expect(half.x).toBe(W / 2);
  });

  it("U-FR-3：override = 2.0 时按系数计算", () => {
    const full = computeFraming("fullBody", W, H, MW, MH);
    const half = computeFraming("halfBody", W, H, MW, MH, 2.0);
    expect(half.scale).toBeCloseTo(full.scale * 2.0, 6);
  });

  it("U-FR-4：宽高为 0 时安全降级到 0 缩放", () => {
    const out = computeFraming("halfBody", 0, 0, MW, MH);
    expect(out.scale).toBe(0);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
  });
});
