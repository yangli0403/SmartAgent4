/**
 * 参数动画引擎的测试用例
 */

import {
  ParameterAnimationEngine,
  ParameterAnimationManager,
  createParameterAnimationEngine,
  getGlobalParameterAnimationManager,
  destroyGlobalParameterAnimationManager,
} from "../parameterAnimationEngine";

// Mock Live2D coreModel
class MockCoreModel {
  private parameters: Map<string, number> = new Map();

  getParameterValueById(paramName: string): number {
    return this.parameters.get(paramName) ?? 0;
  }

  setParameterValueById(paramName: string, value: number): void {
    this.parameters.set(paramName, value);
  }

  getParameter(paramName: string): number {
    return this.parameters.get(paramName) ?? 0;
  }
}

describe("ParameterAnimationEngine", () => {
  let mockCoreModel: MockCoreModel;
  let engine: ParameterAnimationEngine;

  beforeEach(() => {
    mockCoreModel = new MockCoreModel();
    engine = new ParameterAnimationEngine(mockCoreModel);
  });

  afterEach(() => {
    engine.destroy();
  });

  describe("基础功能", () => {
    it("应该创建引擎实例", () => {
      expect(engine).toBeDefined();
      expect(engine.isAnimating()).toBe(false);
    });

    it("应该处理空的参数配置", (done) => {
      engine.animateParameters({}, () => {
        expect(engine.isAnimating()).toBe(false);
        done();
      });
    });

    it("应该处理无效的 coreModel", (done) => {
      const invalidEngine = new ParameterAnimationEngine(null);
      invalidEngine.animateParameters(
        {
          ParamTest: { target: 1, duration: 100 },
        },
        () => {
          expect(invalidEngine.isAnimating()).toBe(false);
          invalidEngine.destroy();
          done();
        }
      );
    });
  });

  describe("参数动画", () => {
    it("应该动画化单个参数", (done) => {
      const paramConfig = {
        ParamTest: {
          target: 1,
          duration: 100,
          easing: "linear" as const,
        },
      };

      engine.animateParameters(paramConfig, () => {
        const finalValue = mockCoreModel.getParameterValueById("ParamTest");
        expect(finalValue).toBeCloseTo(1, 1);
        done();
      });
    });

    it("应该动画化多个参数", (done) => {
      const paramConfig = {
        ParamTest1: {
          target: 0.5,
          duration: 100,
          easing: "linear" as const,
        },
        ParamTest2: {
          target: -0.5,
          duration: 100,
          easing: "linear" as const,
        },
      };

      engine.animateParameters(paramConfig, () => {
        expect(mockCoreModel.getParameterValueById("ParamTest1")).toBeCloseTo(
          0.5,
          1
        );
        expect(mockCoreModel.getParameterValueById("ParamTest2")).toBeCloseTo(
          -0.5,
          1
        );
        done();
      });
    });

    it("应该支持不同的缓动函数", (done) => {
      const paramConfig = {
        ParamQuad: {
          target: 1,
          duration: 100,
          easing: "easeInOutQuad" as const,
        },
        ParamCubic: {
          target: 1,
          duration: 100,
          easing: "easeInOutCubic" as const,
        },
      };

      engine.animateParameters(paramConfig, () => {
        expect(mockCoreModel.getParameterValueById("ParamQuad")).toBeCloseTo(
          1,
          1
        );
        expect(mockCoreModel.getParameterValueById("ParamCubic")).toBeCloseTo(
          1,
          1
        );
        done();
      });
    });
  });

  describe("动画状态", () => {
    it("应该在动画运行时返回 true", (done) => {
      const paramConfig = {
        ParamTest: {
          target: 1,
          duration: 200,
        },
      };

      engine.animateParameters(paramConfig, () => {
        expect(engine.isAnimating()).toBe(false);
        done();
      });

      // 在动画开始后立即检查
      setTimeout(() => {
        expect(engine.isAnimating()).toBe(true);
      }, 10);
    });

    it("应该返回正确的动画参数数量", (done) => {
      const paramConfig = {
        ParamTest1: { target: 1, duration: 100 },
        ParamTest2: { target: 0.5, duration: 100 },
        ParamTest3: { target: -1, duration: 100 },
      };

      engine.animateParameters(paramConfig, () => {
        expect(engine.getAnimatingParameterCount()).toBe(0);
        done();
      });

      setTimeout(() => {
        expect(engine.getAnimatingParameterCount()).toBe(3);
      }, 10);
    });
  });

  describe("取消动画", () => {
    it("应该能够取消动画", (done) => {
      const paramConfig = {
        ParamTest: {
          target: 1,
          duration: 500,
        },
      };

      let callbackCalled = false;
      engine.animateParameters(paramConfig, () => {
        callbackCalled = true;
      });

      setTimeout(() => {
        engine.cancel();
        expect(engine.isAnimating()).toBe(false);
        expect(callbackCalled).toBe(false);
        done();
      }, 100);
    });

    it("应该在取消后清空参数列表", (done) => {
      const paramConfig = {
        ParamTest1: { target: 1, duration: 500 },
        ParamTest2: { target: 0.5, duration: 500 },
      };

      engine.animateParameters(paramConfig, () => {});

      setTimeout(() => {
        engine.cancel();
        expect(engine.getAnimatingParameterCount()).toBe(0);
        done();
      }, 100);
    });
  });

  describe("销毁引擎", () => {
    it("应该能够销毁引擎", () => {
      engine.destroy();
      expect(engine.isAnimating()).toBe(false);
    });

    it("销毁后应该无法继续动画", (done) => {
      engine.destroy();
      engine.animateParameters(
        {
          ParamTest: { target: 1, duration: 100 },
        },
        () => {
          done();
        }
      );
    });
  });
});

describe("ParameterAnimationManager", () => {
  let manager: ParameterAnimationManager;
  let mockCoreModel: MockCoreModel;

  beforeEach(() => {
    manager = new ParameterAnimationManager();
    mockCoreModel = new MockCoreModel();
  });

  afterEach(() => {
    manager.destroyAll();
  });

  describe("引擎管理", () => {
    it("应该创建新引擎", () => {
      const engine = manager.getOrCreateEngine("test", mockCoreModel);
      expect(engine).toBeDefined();
      expect(engine instanceof ParameterAnimationEngine).toBe(true);
    });

    it("应该返回已存在的引擎", () => {
      const engine1 = manager.getOrCreateEngine("test", mockCoreModel);
      const engine2 = manager.getOrCreateEngine("test", mockCoreModel);
      expect(engine1).toBe(engine2);
    });

    it("应该能够获取引擎", () => {
      const engine = manager.getOrCreateEngine("test", mockCoreModel);
      const retrieved = manager.getEngine("test");
      expect(retrieved).toBe(engine);
    });

    it("不存在的引擎应该返回 null", () => {
      const retrieved = manager.getEngine("non_existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("引擎销毁", () => {
    it("应该能够销毁单个引擎", () => {
      manager.getOrCreateEngine("test1", mockCoreModel);
      manager.getOrCreateEngine("test2", mockCoreModel);

      manager.destroyEngine("test1");
      expect(manager.getEngine("test1")).toBeNull();
      expect(manager.getEngine("test2")).not.toBeNull();
    });

    it("应该能够销毁所有引擎", () => {
      manager.getOrCreateEngine("test1", mockCoreModel);
      manager.getOrCreateEngine("test2", mockCoreModel);
      manager.getOrCreateEngine("test3", mockCoreModel);

      manager.destroyAll();
      expect(manager.getEngineCount()).toBe(0);
    });
  });

  describe("引擎计数", () => {
    it("应该返回正确的引擎数量", () => {
      expect(manager.getEngineCount()).toBe(0);

      manager.getOrCreateEngine("test1", mockCoreModel);
      expect(manager.getEngineCount()).toBe(1);

      manager.getOrCreateEngine("test2", mockCoreModel);
      expect(manager.getEngineCount()).toBe(2);

      manager.destroyEngine("test1");
      expect(manager.getEngineCount()).toBe(1);
    });
  });
});

describe("全局参数动画管理器", () => {
  afterEach(() => {
    destroyGlobalParameterAnimationManager();
  });

  it("应该返回全局管理器实例", () => {
    const manager1 = getGlobalParameterAnimationManager();
    const manager2 = getGlobalParameterAnimationManager();
    expect(manager1).toBe(manager2);
  });

  it("应该能够销毁全局管理器", () => {
    const manager = getGlobalParameterAnimationManager();
    expect(manager).toBeDefined();

    destroyGlobalParameterAnimationManager();

    const newManager = getGlobalParameterAnimationManager();
    expect(newManager).not.toBe(manager);
  });
});

describe("工厂函数", () => {
  it("createParameterAnimationEngine 应该创建引擎", () => {
    const mockCoreModel = new MockCoreModel();
    const engine = createParameterAnimationEngine(mockCoreModel);
    expect(engine instanceof ParameterAnimationEngine).toBe(true);
    engine.destroy();
  });
});
