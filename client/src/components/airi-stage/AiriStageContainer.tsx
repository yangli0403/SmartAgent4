/**
 * AIRI 角色舞台容器 — AiriStageContainer
 *
 * 承载 Live2D 渲染画布，管理模型资源的加载、卸载和自适应缩放。
 * 集成所有驱动器 Hook（表情、动作、口型、闲置）。
 *
 * 关联用户测试用例：UTC-001, UTC-002, UTC-003
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useExpressionDriver } from "@/hooks/useExpressionDriver";
import { useMotionDriver } from "@/hooks/useMotionDriver";
import { useLipsyncDriver } from "@/hooks/useLipsyncDriver";
import { useIdleManager } from "@/hooks/useIdleManager";

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
}: AiriStageContainerProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);
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
      // 动态导入 PixiJS 和 pixi-live2d-display（避免 SSR 问题）
      const PIXI = await import("pixi.js");
      const { Live2DModel } = await import("pixi-live2d-display");

      // 注册 Live2D 到 PIXI
      Live2DModel.registerTicker(PIXI.Ticker);

      // 创建 PixiJS 应用
      const app = new PIXI.Application({
        width: config.canvasWidth,
        height: config.canvasHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      // 挂载画布到 DOM
      canvasContainerRef.current.innerHTML = "";
      canvasContainerRef.current.appendChild(app.view as HTMLCanvasElement);
      appRef.current = app;

      // 加载 Live2D 模型
      const model = await Live2DModel.from(resolvedModelUrl, {
        autoInteract: false,
        autoUpdate: true,
      });

      // 设置模型位置和缩放
      model.scale.set(config.modelScale);
      model.x = config.canvasWidth / 2 + config.modelOffsetX;
      model.y = config.canvasHeight / 2 + config.modelOffsetY;
      model.anchor.set(0.5, 0.5);

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
    config.modelScale,
    config.modelOffsetX,
    config.modelOffsetY,
    setModelLoaded,
    setModelError,
    onModelLoaded,
    onModelError,
  ]);

  /**
   * 组件挂载时初始化，卸载时清理
   */
  useEffect(() => {
    initStage();

    return () => {
      // 清理 PixiJS 应用
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
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
      if (!appRef.current || !canvasContainerRef.current) return;
      const container = canvasContainerRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      appRef.current.renderer.resize(width, height);

      if (modelRef.current) {
        modelRef.current.x = width / 2 + config.modelOffsetX;
        modelRef.current.y = height / 2 + config.modelOffsetY;
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [config.modelOffsetX, config.modelOffsetY]);

  // 未启用时显示占位符
  if (!enabled) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`}>
        <div className="text-center text-gray-400">
          <div className="text-4xl mb-2">🤖</div>
          <p className="text-sm">角色舞台未启用</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      {/* Live2D 渲染容器 */}
      <div
        ref={canvasContainerRef}
        className="w-full h-full"
        style={{ minHeight: config.canvasHeight }}
      />

      {/* 加载状态 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600">加载角色模型中...</p>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50/80">
          <div className="text-center p-4">
            <div className="text-3xl mb-2">⚠️</div>
            <p className="text-sm text-red-600 mb-2">模型加载失败</p>
            <p className="text-xs text-red-400">{error}</p>
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
