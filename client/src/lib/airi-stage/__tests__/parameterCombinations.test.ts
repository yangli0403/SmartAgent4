/**
 * 参数驱动动作库的测试用例
 */

import {
  PARAMETER_COMBINATIONS,
  getParameterCombination,
  hasParameterCombination,
  getSupportedParameterDrivenMotions,
  easingFunctions,
  getEasingFunction,
} from "../parameterCombinations";

describe("ParameterCombinations", () => {
  describe("getParameterCombination", () => {
    it("应该返回存在的参数组合配置", () => {
      const combo = getParameterCombination("spin");
      expect(combo).not.toBeNull();
      expect(combo?.description).toContain("转圈");
      expect(combo?.parameters).toBeDefined();
    });

    it("应该返回 null 对于不存在的动作", () => {
      const combo = getParameterCombination("non_existent_motion");
      expect(combo).toBeNull();
    });

    it("应该包含所有必要的参数配置", () => {
      const combo = getParameterCombination("spin");
      expect(combo?.parameters).toBeDefined();
      expect(Object.keys(combo?.parameters || {}).length).toBeGreaterThan(0);
    });

    it("参数配置应该包含 target 和 duration", () => {
      const combo = getParameterCombination("jump");
      if (combo) {
        for (const [, config] of Object.entries(combo.parameters)) {
          expect(config.target).toBeDefined();
          expect(typeof config.target).toBe("number");
          expect(config.duration).toBeDefined();
          expect(typeof config.duration).toBe("number");
        }
      }
    });
  });

  describe("hasParameterCombination", () => {
    it("应该对存在的动作返回 true", () => {
      expect(hasParameterCombination("spin")).toBe(true);
      expect(hasParameterCombination("jump")).toBe(true);
      expect(hasParameterCombination("lean_forward")).toBe(true);
    });

    it("应该对不存在的动作返回 false", () => {
      expect(hasParameterCombination("non_existent")).toBe(false);
      expect(hasParameterCombination("")).toBe(false);
    });
  });

  describe("getSupportedParameterDrivenMotions", () => {
    it("应该返回所有支持的动作列表", () => {
      const motions = getSupportedParameterDrivenMotions();
      expect(Array.isArray(motions)).toBe(true);
      expect(motions.length).toBeGreaterThan(0);
    });

    it("返回的列表应该包含已知的动作", () => {
      const motions = getSupportedParameterDrivenMotions();
      expect(motions).toContain("spin");
      expect(motions).toContain("jump");
      expect(motions).toContain("lean_forward");
    });

    it("返回的列表应该与 PARAMETER_COMBINATIONS 的键一致", () => {
      const motions = getSupportedParameterDrivenMotions();
      const expectedMotions = Object.keys(PARAMETER_COMBINATIONS);
      expect(motions.sort()).toEqual(expectedMotions.sort());
    });
  });

  describe("缓动函数", () => {
    describe("linear", () => {
      it("应该返回线性缓动值", () => {
        expect(easingFunctions.linear(0)).toBe(0);
        expect(easingFunctions.linear(0.5)).toBe(0.5);
        expect(easingFunctions.linear(1)).toBe(1);
      });
    });

    describe("easeInOutQuad", () => {
      it("应该返回缓动值在 0 到 1 之间", () => {
        for (let t = 0; t <= 1; t += 0.1) {
          const value = easingFunctions.easeInOutQuad(t);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      });

      it("应该在 t=0 时返回 0，t=1 时返回 1", () => {
        expect(easingFunctions.easeInOutQuad(0)).toBe(0);
        expect(easingFunctions.easeInOutQuad(1)).toBe(1);
      });

      it("应该在中点时返回接近 0.5 的值", () => {
        const value = easingFunctions.easeInOutQuad(0.5);
        expect(value).toBeCloseTo(0.5, 1);
      });
    });

    describe("easeInOutCubic", () => {
      it("应该返回缓动值在 0 到 1 之间", () => {
        for (let t = 0; t <= 1; t += 0.1) {
          const value = easingFunctions.easeInOutCubic(t);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      });

      it("应该在 t=0 时返回 0，t=1 时返回 1", () => {
        expect(easingFunctions.easeInOutCubic(0)).toBe(0);
        expect(easingFunctions.easeInOutCubic(1)).toBe(1);
      });
    });
  });

  describe("getEasingFunction", () => {
    it("应该返回正确的缓动函数", () => {
      const linearFn = getEasingFunction("linear");
      expect(linearFn(0.5)).toBe(0.5);

      const quadFn = getEasingFunction("easeInOutQuad");
      expect(typeof quadFn(0.5)).toBe("number");

      const cubicFn = getEasingFunction("easeInOutCubic");
      expect(typeof cubicFn(0.5)).toBe("number");
    });

    it("应该默认返回 linear 缓动函数", () => {
      const fn = getEasingFunction();
      expect(fn(0.5)).toBe(0.5);
    });
  });

  describe("参数组合的完整性检查", () => {
    it("所有参数组合应该有 description", () => {
      for (const [motionName, combo] of Object.entries(PARAMETER_COMBINATIONS)) {
        expect(combo.description).toBeDefined();
        expect(typeof combo.description).toBe("string");
        expect(combo.description.length).toBeGreaterThan(0);
      }
    });

    it("所有参数组合应该有 parameters", () => {
      for (const [motionName, combo] of Object.entries(PARAMETER_COMBINATIONS)) {
        expect(combo.parameters).toBeDefined();
        expect(typeof combo.parameters).toBe("object");
        expect(Object.keys(combo.parameters).length).toBeGreaterThan(0);
      }
    });

    it("所有参数应该有有效的 target 和 duration", () => {
      for (const [motionName, combo] of Object.entries(PARAMETER_COMBINATIONS)) {
        for (const [paramName, config] of Object.entries(combo.parameters)) {
          expect(typeof config.target).toBe("number");
          expect(typeof config.duration).toBe("number");
          expect(config.duration).toBeGreaterThan(0);
        }
      }
    });

    it("所有参数组合应该有 motionFallback", () => {
      for (const [motionName, combo] of Object.entries(PARAMETER_COMBINATIONS)) {
        expect(combo.motionFallback).toBeDefined();
        expect(combo.motionFallback?.group).toBeDefined();
        expect(combo.motionFallback?.index).toBeDefined();
      }
    });
  });

  describe("特定动作的参数验证", () => {
    it("spin 动作应该有身体旋转参数", () => {
      const combo = getParameterCombination("spin");
      expect(combo?.parameters["ParamBodyAngleY"]).toBeDefined();
      expect(combo?.parameters["ParamAngleY"]).toBeDefined();
    });

    it("lean_forward 动作应该有身体前倾参数", () => {
      const combo = getParameterCombination("lean_forward");
      expect(combo?.parameters["ParamBodyAngleX"]).toBeDefined();
      expect(combo?.parameters["ParamAngleX"]).toBeDefined();
    });

    it("facepalm 动作应该有眼球参数", () => {
      const combo = getParameterCombination("facepalm");
      expect(combo?.parameters["ParamEyeBallX"]).toBeDefined();
      expect(combo?.parameters["ParamEyeBallY"]).toBeDefined();
    });
  });
});
