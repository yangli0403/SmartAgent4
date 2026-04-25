/**
 * AIRI 角色舞台容器 — AiriStageContainer
 *
 * 承载 Live2D 渲染画布，管理模型资源的加载、卸载和自适应缩放。
 * 集成所有驱动器 Hook（表情、动作、口型、闲置）。
 *
 * 关联用户测试用例：UTC-001, UTC-002, UTC-003
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useExpressionDriver } from "@/hooks/useExpressionDriver";
import { useMotionDriver } from "@/hooks/useMotionDriver";
import { useLipsyncDriver } from "@/hooks/useLipsyncDriver";
import { useIdleManager } from "@/hooks/useIdleManager";
import {
  computeFraming,
  type AiriViewMode,
} from "@/lib/airi-stage/framing";

// pixi-live2d-display 需要全局 PIXI 引用
(window as any).PIXI = PIXI;

/** 组件 Props */
interface AiriStageContainerProps {
  /** 是否启用舞台（false 时不渲染 Live2D，显示占位符） */
  enabled?: boolean;
  /** 模型 URL（覆盖默认配置） */
  modelUrl?: string;
  /** 容器 CSS 类名 */
  className?: string;
  /** 模型加载完成回调 */
  onModelLoaded?: () => void;
  /** 模型加载失败回调 */
  onModelError?: (error: string) => void;
  /**
   * v0.5 新增：视图模式
   * - fullBody（默认）：全身自适应、与 v0.4 行为一致
   * - halfBody：上半身特写，适合车载场景下胸位以上都不在画面里
   */
  viewMode?: AiriViewMode;
  /**
   * v0.5 新增：halfBody 底下的放大系数覆盖（默认 1.6，范围 [0.5, 3.0]）
   */
  framingRatio?: number;
}

/**
 * AIRI 角色舞台容器
 */
export function AiriStageContainer({
  enabled = true,
  modelUrl,
  className = "",
  onModelLoaded,
  onModelError,
  viewMode = "fullBody",
  framingRatio,
}: AiriStageContainerProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = useStageStore((s) => s.config);
  const { setModelLoaded, setModelError } = useStageStore();

  const resolvedModelUrl = modelUrl ?? config.modelUrl;

  // 注册所有驱动器
  useExpressionDriver(modelRef);
  useMotionDriver(modelRef);
  useLipsyncDriver(modelRef);
  useIdleManager(modelRef);

  /**
   * 初始化 PixiJS 应用和加载 Live2D 模型
   */
  const initStage = useCallback(async () => {
    if (!canvasContainerRef.current || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      // 清理旧实例
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }

      // 注册 Live2D Ticker
      Live2DModel.registerTicker(PIXI.Ticker);

      const container = canvasContainerRef.current;
      const width = container.clientWidth || config.canvasWidth;
      const height = container.clientHeight || config.canvasHeight;

      // 创建 PixiJS 应用（v6 API）
      const app = new PIXI.Application({
        width,
        height,
        transparent: true,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      // 挂载画布到 DOM
      container.innerHTML = "";
      container.appendChild(app.view as HTMLCanvasElement);
      appRef.current = app;

      // 加载 Live2D 模型
      const model = await Live2DModel.from(resolvedModelUrl, {
        autoInteract: true,
        autoUpdate: true,
      });

      // 自适应缩放：根据容器尺寸自动计算
      const framing = computeFraming(
        viewMode,
        width,
        height,
        model.width,
        model.height,
        framingRatio
      );
      model.scale.set(framing.scale);
      model.x = framing.x;
      model.y = framing.y;
      model.anchor.set(0.5, framing.anchorY);

      app.stage.addChild(model);
      modelRef.current = model;

      // 通知加载完成
      setModelLoaded(true);
      stageEventBus.emit("model_loaded", {
        type: "model_loaded",
        modelId: resolvedModelUrl,
      });
      onModelLoaded?.();
      setLoading(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Live2D 模型加载失败";
      setError(errorMsg);
      setModelError(errorMsg);
      stageEventBus.emit("model_error", {
        type: "model_error",
        error: errorMsg,
      });
      onModelError?.(errorMsg);
      setLoading(false);
    }
  }, [
    enabled,
    resolvedModelUrl,
    config.canvasWidth,
    config.canvasHeight,
    setModelLoaded,
    setModelError,
    onModelLoaded,
    onModelError,
    viewMode,
    framingRatio,
  ]);

  /**
   * 组件挂载时初始化，卸载时清理
   */
  useEffect(() => {
    // 延迟一帧确保 DOM 已渲染
    const timer = setTimeout(() => initStage(), 100);

    return () => {
      clearTimeout(timer);
      // 清理 PixiJS 应用
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      modelRef.current = null;
    };
  }, [initStage]);

  /**
   * 窗口大小变化时自适应
   */
  useEffect(() => {
    const handleResize = () => {
      if (!appRef.current || !canvasContainerRef.current || !modelRef.current) return;
      const container = canvasContainerRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      appRef.current.renderer.resize(width, height);

      const model = modelRef.current;
      const naturalWidth = model.width / model.scale.x;
      const naturalHeight = model.height / model.scale.y;
      const framing = computeFraming(
        viewMode,
        width,
        height,
        naturalWidth,
        naturalHeight,
        framingRatio
      );
      model.scale.set(framing.scale);
      model.x = framing.x;
      model.y = framing.y;
      model.anchor.set(0.5, framing.anchorY);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [viewMode, framingRatio]);

  // 未启用时显示占位符
  if (!enabled) {
    return (
      <div className={`flex items-center justify-center bg-gray-100/30 rounded-lg ${className}`}>
        <div className="text-center text-gray-400">
          <div className="text-4xl mb-2">🤖</div>
          <p className="text-sm">角色舞台未启用</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Live2D 渲染容器 */}
      <div
        ref={canvasContainerRef}
        className="w-full h-full"
      />

      {/* 加载状态 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2" />
            <p className="text-sm text-gray-500">加载角色模型中...</p>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50/50 rounded-lg">
          <div className="text-center p-4">
            <div className="text-3xl mb-2">⚠️</div>
            <p className="text-sm text-red-600 mb-2">模型加载失败</p>
            <p className="text-xs text-red-400 max-w-[200px]">{error}</p>
            <button
              onClick={initStage}
              className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* 调试信息（仅开发模式） */}
      {config.debug && (
        <DebugOverlay />
      )}
    </div>
  );
}

/**
 * 调试信息叠加层
 */
function DebugOverlay() {
  const expression = useStageStore((s) => s.expression);
  const motion = useStageStore((s) => s.motion);
  const lipsync = useStageStore((s) => s.lipsync);
  const idle = useStageStore((s) => s.idle);

  return (
    <div className="absolute top-2 left-2 bg-black/60 text-white text-xs p-2 rounded font-mono">
      <div>表情: {expression.currentExpression} ({expression.isTransitioning ? "过渡中" : "稳定"})</div>
      <div>动作: {motion.currentMotion ?? "无"} ({motion.isPlaying ? "播放中" : "空闲"})</div>
      <div>口型: {lipsync.isSpeaking ? `说话中 (${lipsync.currentLevel.toFixed(2)})` : "静默"}</div>
      <div>状态: {idle.currentState} ({idle.isIdle ? "闲置" : "活跃"})</div>
    </div>
  );
}
