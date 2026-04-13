/**
 * useStageStore 补充测试 — 覆盖 Phase 6 中发现的未覆盖行
 *
 * 补充 setConfig, setModelLoaded, setModelError, updateCurrentExpression 等方法
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useStageStore } from "../useStageStore";

describe("useStageStore 补充测试", () => {
  beforeEach(() => {
    useStageStore.getState().reset();
  });

  // ==================== 配置管理 ====================

  it("setConfig 应合并更新配置", () => {
    useStageStore.getState().setConfig({ modelScale: 0.5 });
    const state = useStageStore.getState();
    expect(state.config.modelScale).toBe(0.5);
    // 其他配置应保持默认值
    expect(state.config.canvasWidth).toBe(800);
  });

  it("setConfig 应支持多字段同时更新", () => {
    useStageStore.getState().setConfig({
      canvasWidth: 1024,
      canvasHeight: 768,
      debug: true,
    });
    const state = useStageStore.getState();
    expect(state.config.canvasWidth).toBe(1024);
    expect(state.config.canvasHeight).toBe(768);
    expect(state.config.debug).toBe(true);
  });

  // ==================== 模型加载状态 ====================

  it("setModelLoaded(true) 应标记模型已加载并清除错误", () => {
    // 先设置一个错误
    useStageStore.getState().setModelError("test error");
    // 然后标记加载成功
    useStageStore.getState().setModelLoaded(true);
    const state = useStageStore.getState();
    expect(state.modelLoaded).toBe(true);
    expect(state.modelError).toBeNull();
  });

  it("setModelLoaded(false) 应标记模型未加载", () => {
    useStageStore.getState().setModelLoaded(true);
    useStageStore.getState().setModelLoaded(false);
    const state = useStageStore.getState();
    expect(state.modelLoaded).toBe(false);
  });

  it("setModelError 应记录错误并标记模型未加载", () => {
    useStageStore.getState().setModelLoaded(true);
    useStageStore.getState().setModelError("加载失败");
    const state = useStageStore.getState();
    expect(state.modelError).toBe("加载失败");
    expect(state.modelLoaded).toBe(false);
  });

  // ==================== 表情中间状态更新 ====================

  it("updateCurrentExpression 应更新当前表情和强度", () => {
    useStageStore.getState().updateCurrentExpression("happy", 0.5);
    const state = useStageStore.getState();
    expect(state.expression.currentExpression).toBe("happy");
    expect(state.expression.currentIntensity).toBe(0.5);
  });

  it("updateCurrentExpression 不应影响过渡状态", () => {
    useStageStore.getState().setTargetExpression("sad");
    useStageStore.getState().updateCurrentExpression("sad", 0.3);
    const state = useStageStore.getState();
    expect(state.expression.isTransitioning).toBe(true);
    expect(state.expression.currentExpression).toBe("sad");
    expect(state.expression.currentIntensity).toBe(0.3);
  });
});
