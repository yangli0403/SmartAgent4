/**
 * AIRI 前端角色舞台 — 独立演示页面
 *
 * 提供完整的交互控制面板，用于测试：
 * - Live2D 模型加载与渲染
 * - 16 种表情驱动（含强度调节）
 * - 12 种动作播放（含优先级）
 * - 口型联动模拟
 * - 闲置状态管理
 * - 事件日志实时查看
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel, Live2DModel as Live2DModelCubism4 } from "pixi-live2d-display/cubism4";

// pixi-live2d-display 需要全局 PIXI 引用
(window as any).PIXI = PIXI;
import {
  stageEventBus,
  notifyThinking,
  notifyListening,
  notifyIdle,
  notifyTtsStart,
  notifyTtsStop,
  notifyTtsLevel,
  dispatchStageEventsFromTags,
} from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import { EXPRESSION_MAPPING, getExpressionParams } from "@/lib/airi-stage/expressionMapping";
import { MOTION_MAPPING, getMotionDef } from "@/lib/airi-stage/motionMapping";
import type { StageEvent, IdleState } from "@/lib/airi-stage/types";

// CDN 模型地址（Haru - Cubism 4 官方示例模型）
const MODEL_URL =
  "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json";

// 表情列表
const EXPRESSIONS = Object.keys(EXPRESSION_MAPPING);

// 动作列表
const MOTIONS = Object.keys(MOTION_MAPPING);

// 闲置状态列表
const IDLE_STATES: IdleState[] = ["idle", "thinking", "listening"];

interface EventLog {
  id: number;
  time: string;
  type: string;
  detail: string;
}

let logId = 0;

export default function AiriDemo() {
  // ===== 模型与画布 =====
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<any>(null);

  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  // ===== 控制面板状态 =====
  const [intensity, setIntensity] = useState(1.0);
  const [lipsyncActive, setLipsyncActive] = useState(false);
  const lipsyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ===== 事件日志 =====
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // ===== Store 状态（用于调试面板） =====
  const expression = useStageStore((s) => s.expression);
  const motion = useStageStore((s) => s.motion);
  const lipsync = useStageStore((s) => s.lipsync);
  const idle = useStageStore((s) => s.idle);

  // Store actions
  const setTargetExpression = useStageStore((s) => s.setTargetExpression);
  const updateCurrentExpression = useStageStore((s) => s.updateCurrentExpression);
  const finishExpressionTransition = useStageStore((s) => s.finishExpressionTransition);
  const setCurrentMotion = useStageStore((s) => s.setCurrentMotion);
  const finishMotion = useStageStore((s) => s.finishMotion);
  const setSpeaking = useStageStore((s) => s.setSpeaking);
  const updateLevel = useStageStore((s) => s.updateLevel);
  const setIdleState = useStageStore((s) => s.setIdleState);
  const recordActivity = useStageStore((s) => s.recordActivity);

  // ===== 添加事件日志 =====
  const addLog = useCallback((type: string, detail: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setEventLogs((prev) => {
      const newLogs = [{ id: ++logId, time, type, detail }, ...prev];
      return newLogs.slice(0, 100); // 最多保留 100 条
    });
  }, []);

  // ===== 监听所有事件总线事件用于日志 =====
  useEffect(() => {
    const handler = (type: string, event: any) => {
      addLog(type, JSON.stringify(event, null, 0));
    };
    stageEventBus.on("*", handler as any);
    return () => {
      stageEventBus.off("*", handler as any);
    };
  }, [addLog]);

  // ===== 表情驱动（监听事件并更新模型参数） =====
  useEffect(() => {
    const currentParams = new Map<string, number>();
    const targetParams = new Map<string, number>();
    let animFrameId: number | null = null;

    const LERP_SPEED = 0.08;

    const onExpression = (event: any) => {
      const paramSet = getExpressionParams(event.expression);
      const eventIntensity = event.intensity ?? 1.0;
      targetParams.clear();
      for (const [key, value] of Object.entries(paramSet.params)) {
        targetParams.set(key, (value as number) * eventIntensity);
      }
      setTargetExpression(event.expression, eventIntensity);
    };

    const animate = () => {
      const model = modelRef.current;
      if (model && model.internalModel?.coreModel) {
        const coreModel = model.internalModel.coreModel;
        let allDone = true;

        for (const [key, target] of targetParams.entries()) {
          const current = currentParams.get(key) ?? 0;
          const diff = target - current;
          if (Math.abs(diff) > 0.001) {
            const newVal = current + diff * LERP_SPEED;
            currentParams.set(key, newVal);
            try {
              coreModel.setParameterValueById(key, newVal);
            } catch {
              // 参数不存在，忽略
            }
            allDone = false;
          } else {
            currentParams.set(key, target);
            try {
              coreModel.setParameterValueById(key, target);
            } catch {
              // 参数不存在，忽略
            }
          }
        }

        if (allDone && targetParams.size > 0) {
          finishExpressionTransition();
        }
      }
      animFrameId = requestAnimationFrame(animate);
    };

    stageEventBus.on("expression", onExpression);
    animFrameId = requestAnimationFrame(animate);

    return () => {
      stageEventBus.off("expression", onExpression);
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };
  }, [setTargetExpression, updateCurrentExpression, finishExpressionTransition]);

  // ===== 动作驱动（监听事件并播放动作） =====
  useEffect(() => {
    const onMotion = async (event: any) => {
      const model = modelRef.current;
      if (!model) return;

      const def = getMotionDef(event.motion);
      if (!def) {
        // 未知动作，尝试直接用 Idle/Tap 组
        addLog("motion", `未知动作 "${event.motion}"，尝试播放 Tap[0]`);
        try {
          setCurrentMotion(event.motion, event.priority ?? 1);
          await model.motion("Tap", 0);
          finishMotion();
        } catch {
          finishMotion();
        }
        return;
      }

      try {
        setCurrentMotion(event.motion, def.priority);
        await model.motion(def.group, def.index, def.priority);
        finishMotion();
      } catch {
        finishMotion();
      }
    };

    stageEventBus.on("motion", onMotion);
    return () => {
      stageEventBus.off("motion", onMotion);
    };
  }, [addLog, setCurrentMotion, finishMotion]);

  // ===== 口型驱动（监听 TTS 事件） =====
  useEffect(() => {
    const SMOOTH_FACTOR = 0.3;
    let smoothedLevel = 0;

    const onTtsStart = () => {
      setSpeaking(true);
    };

    const onTtsStop = () => {
      setSpeaking(false);
      smoothedLevel = 0;
      const model = modelRef.current;
      if (model?.internalModel?.coreModel) {
        try {
          model.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
        } catch {}
      }
    };

    const onTtsLevel = (event: any) => {
      const model = modelRef.current;
      if (!model?.internalModel?.coreModel) return;

      smoothedLevel = smoothedLevel * (1 - SMOOTH_FACTOR) + event.level * SMOOTH_FACTOR;
      updateLevel(smoothedLevel);
      try {
        model.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", smoothedLevel);
      } catch {}
    };

    stageEventBus.on("tts_start", onTtsStart);
    stageEventBus.on("tts_stop", onTtsStop);
    stageEventBus.on("tts_level", onTtsLevel);

    return () => {
      stageEventBus.off("tts_start", onTtsStart);
      stageEventBus.off("tts_stop", onTtsStop);
      stageEventBus.off("tts_level", onTtsLevel);
    };
  }, [setSpeaking, updateLevel]);

  // ===== 闲置管理（监听 idle_state 事件） =====
  useEffect(() => {
    const onIdleState = (event: any) => {
      setIdleState(event.state);
    };

    // 呼吸动画
    let breathFrame: number | null = null;
    const breathAnimate = () => {
      const model = modelRef.current;
      if (model?.internalModel?.coreModel) {
        const t = Date.now() / 1000;
        const breathValue = (Math.sin(t * 2) + 1) / 2;
        try {
          model.internalModel.coreModel.setParameterValueById("ParamBreath", breathValue);
        } catch {}
      }
      breathFrame = requestAnimationFrame(breathAnimate);
    };

    stageEventBus.on("idle_state", onIdleState);
    breathFrame = requestAnimationFrame(breathAnimate);

    return () => {
      stageEventBus.off("idle_state", onIdleState);
      if (breathFrame) cancelAnimationFrame(breathFrame);
    };
  }, [setIdleState]);

  // ===== 初始化 Live2D 舞台 =====
  const initStage = useCallback(async () => {
    if (!canvasRef.current) return;

    setModelLoading(true);
    setModelError(null);

    try {
      // 清理旧实例
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }

      // 注册 Live2D Ticker（pixi-live2d-display v0.4 需要 shared ticker）
      Live2DModel.registerTicker(PIXI.Ticker);

      const container = canvasRef.current;
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 500;

      // 创建 PixiJS 应用（v6 API）
      const app = new PIXI.Application({
        width,
        height,
        transparent: true,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      container.innerHTML = "";
      container.appendChild(app.view as HTMLCanvasElement);
      appRef.current = app;

      addLog("system", "PixiJS 应用已创建，开始加载 Live2D 模型...");

      // 加载模型
      const model = await Live2DModel.from(MODEL_URL, {
        autoInteract: true,
        autoUpdate: true,
      });

      // 设置模型位置和缩放
      // Haru 模型较大，需要适当缩放并居中
      const scaleVal = Math.min(width / model.width, height / model.height) * 0.8;
      model.scale.set(scaleVal);
      model.x = width / 2;
      model.y = height * 0.9;
      model.anchor.set(0.5, 1.0);

      addLog("system", `模型原始尺寸: ${model.width.toFixed(0)}x${model.height.toFixed(0)}, 缩放: ${scaleVal.toFixed(3)}`);

      app.stage.addChild(model);
      modelRef.current = model;

      setModelLoaded(true);
      setModelLoading(false);

      stageEventBus.emit("model_loaded", {
        type: "model_loaded",
        modelId: MODEL_URL,
      });

      addLog("system", `模型加载成功！缩放: 0.15, 位置: (${width / 2}, ${height / 2 + 50})`);

      // 打印模型可用的 motion groups
      if (model.internalModel?.motionManager) {
        const groups = Object.keys(
          (model.internalModel as any).settings?.motions || {}
        );
        addLog("system", `可用动作组: ${groups.join(", ") || "无"}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "模型加载失败";
      setModelError(msg);
      setModelLoading(false);
      addLog("error", `模型加载失败: ${msg}`);
      stageEventBus.emit("model_error", { type: "model_error", error: msg });
    }
  }, [addLog]);

  // 组件挂载时自动初始化
  useEffect(() => {
    // 延迟一帧确保 DOM 已渲染
    const timer = setTimeout(() => initStage(), 100);
    return () => {
      clearTimeout(timer);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      modelRef.current = null;
    };
  }, [initStage]);

  // ===== 窗口大小变化自适应 =====
  useEffect(() => {
    const handleResize = () => {
      if (!appRef.current || !canvasRef.current) return;
      const w = canvasRef.current.clientWidth;
      const h = canvasRef.current.clientHeight;
      appRef.current.renderer.resize(w, h);
      if (modelRef.current) {
        modelRef.current.x = w / 2;
        modelRef.current.y = h / 2 + 50;
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ===== 操作函数 =====

  const handleExpression = (expr: string) => {
    stageEventBus.emit("expression", {
      type: "expression",
      expression: expr,
      intensity,
    });
    recordActivity();
  };

  const handleMotion = (motionName: string) => {
    const def = getMotionDef(motionName);
    stageEventBus.emit("motion", {
      type: "motion",
      motion: motionName,
      priority: def?.priority ?? 1,
    });
    recordActivity();
  };

  const handleIdleState = (state: IdleState) => {
    stageEventBus.emit("idle_state", {
      type: "idle_state",
      state,
    });
  };

  const toggleLipsync = () => {
    if (lipsyncActive) {
      // 停止口型模拟
      if (lipsyncIntervalRef.current) {
        clearInterval(lipsyncIntervalRef.current);
        lipsyncIntervalRef.current = null;
      }
      notifyTtsStop();
      setLipsyncActive(false);
    } else {
      // 开始口型模拟
      notifyTtsStart();
      setLipsyncActive(true);
      lipsyncIntervalRef.current = setInterval(() => {
        const level = Math.random() * 0.8 + 0.1;
        notifyTtsLevel(level);
      }, 50);
    }
  };

  // 清理口型模拟
  useEffect(() => {
    return () => {
      if (lipsyncIntervalRef.current) {
        clearInterval(lipsyncIntervalRef.current);
      }
    };
  }, []);

  const handleTagSimulation = () => {
    const tags = [
      { type: "expression", value: "happy" },
      { type: "animation", value: "nod" },
    ];
    dispatchStageEventsFromTags(tags);
    addLog("simulate", "模拟标签分发: [expression:happy] [animation:nod]");
  };

  const clearLogs = () => setEventLogs([]);

  // ===== 渲染 =====
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* 顶部标题栏 */}
      <header className="bg-black/30 backdrop-blur-sm border-b border-white/10 px-6 py-3">
        <div className="flex items-center justify-between max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold">
              A
            </div>
            <div>
              <h1 className="text-lg font-semibold">AIRI Stage Demo</h1>
              <p className="text-xs text-gray-400">SmartAgent4 第八轮迭代 — 前端角色舞台演示</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                modelLoaded
                  ? "bg-green-500/20 text-green-400"
                  : modelLoading
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  modelLoaded
                    ? "bg-green-400"
                    : modelLoading
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-red-400"
                }`}
              />
              {modelLoaded ? "模型已加载" : modelLoading ? "加载中..." : "未加载"}
            </span>
            <a
              href="/"
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded transition-colors"
            >
              返回主页
            </a>
          </div>
        </div>
      </header>

      {/* 主体内容 */}
      <div className="max-w-[1600px] mx-auto p-4 grid grid-cols-12 gap-4" style={{ height: "calc(100vh - 60px)" }}>
        {/* 左侧：Live2D 舞台 */}
        <div className="col-span-5 flex flex-col gap-4">
          {/* 舞台画布 */}
          <div className="relative flex-1 bg-gradient-to-b from-purple-900/40 to-black/40 rounded-xl border border-white/10 overflow-hidden">
            <div ref={canvasRef} className="w-full h-full" style={{ minHeight: 400 }} />

            {/* 加载状态 */}
            {modelLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-2 border-purple-500 border-t-transparent mx-auto mb-3" />
                  <p className="text-sm text-purple-300">加载 Live2D 模型中...</p>
                  <p className="text-xs text-gray-500 mt-1">首次加载可能需要几秒</p>
                </div>
              </div>
            )}

            {/* 错误状态 */}
            {modelError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="text-center p-6">
                  <div className="text-4xl mb-3">⚠️</div>
                  <p className="text-sm text-red-400 mb-2">模型加载失败</p>
                  <p className="text-xs text-gray-500 mb-4 max-w-xs">{modelError}</p>
                  <button
                    onClick={initStage}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm transition-colors"
                  >
                    重试加载
                  </button>
                </div>
              </div>
            )}

            {/* 调试信息叠加 */}
            <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-xs p-3 rounded-lg font-mono space-y-1 border border-white/5">
              <div className="text-purple-400">
                表情: <span className="text-white">{expression.currentExpression}</span>
                {expression.isTransitioning && <span className="text-yellow-400 ml-1">(过渡中)</span>}
              </div>
              <div className="text-blue-400">
                动作: <span className="text-white">{motion.currentMotion ?? "无"}</span>
                {motion.isPlaying && <span className="text-green-400 ml-1">(播放中)</span>}
              </div>
              <div className="text-green-400">
                口型: <span className="text-white">{lipsync.isSpeaking ? `说话中 (${lipsync.currentLevel.toFixed(2)})` : "静默"}</span>
              </div>
              <div className="text-orange-400">
                状态: <span className="text-white">{idle.currentState}</span>
                <span className={`ml-1 ${idle.isIdle ? "text-gray-400" : "text-green-400"}`}>
                  ({idle.isIdle ? "闲置" : "活跃"})
                </span>
              </div>
            </div>
          </div>

          {/* 快捷操作栏 */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">快捷操作</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleTagSimulation}
                className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-xs transition-all"
              >
                模拟 AI 回复标签
              </button>
              <button
                onClick={toggleLipsync}
                className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                  lipsyncActive
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-green-600 hover:bg-green-500"
                }`}
              >
                {lipsyncActive ? "停止口型模拟" : "开始口型模拟"}
              </button>
              <button
                onClick={initStage}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors"
              >
                重新加载模型
              </button>
              <button
                onClick={() => useStageStore.getState().reset()}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-colors"
              >
                重置状态
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：控制面板 */}
        <div className="col-span-7 flex flex-col gap-4 overflow-hidden">
          {/* 表情控制 */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                表情控制 ({EXPRESSIONS.length} 种)
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">强度:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  className="w-20 h-1 accent-purple-500"
                />
                <span className="text-xs text-purple-400 w-8">{intensity.toFixed(1)}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-1.5">
              {EXPRESSIONS.map((expr) => (
                <button
                  key={expr}
                  onClick={() => handleExpression(expr)}
                  className={`px-2 py-1.5 rounded text-xs transition-all border ${
                    expression.currentExpression === expr
                      ? "bg-purple-600 border-purple-400 text-white"
                      : "bg-white/5 border-white/10 hover:bg-white/10 text-gray-300"
                  }`}
                >
                  {expr}
                </button>
              ))}
            </div>
          </div>

          {/* 动作控制 */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              动作控制 ({MOTIONS.length} 种)
            </h3>
            <div className="grid grid-cols-5 gap-1.5">
              {MOTIONS.map((m) => {
                const def = getMotionDef(m);
                return (
                  <button
                    key={m}
                    onClick={() => handleMotion(m)}
                    className={`px-2 py-1.5 rounded text-xs transition-all border ${
                      motion.currentMotion === m
                        ? "bg-blue-600 border-blue-400 text-white"
                        : "bg-white/5 border-white/10 hover:bg-white/10 text-gray-300"
                    }`}
                  >
                    <div>{def?.name ?? m}</div>
                    <div className="text-[10px] text-gray-500">P{def?.priority ?? "?"} · {def?.group ?? "?"}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 闲置状态控制 */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              闲置状态
            </h3>
            <div className="flex gap-2">
              {IDLE_STATES.map((state) => (
                <button
                  key={state}
                  onClick={() => handleIdleState(state)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs transition-all border ${
                    idle.currentState === state
                      ? "bg-orange-600 border-orange-400 text-white"
                      : "bg-white/5 border-white/10 hover:bg-white/10 text-gray-300"
                  }`}
                >
                  <div className="font-medium">{state}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {state === "idle" ? "默认闲置" : state === "thinking" ? "AI 思考中" : "用户语音输入"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 事件日志 */}
          <div className="flex-1 bg-white/5 rounded-xl border border-white/10 p-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                事件日志 ({eventLogs.length})
              </h3>
              <button
                onClick={clearLogs}
                className="px-2 py-0.5 text-[10px] bg-white/10 hover:bg-white/20 rounded transition-colors"
              >
                清空
              </button>
            </div>
            <div
              ref={logContainerRef}
              className="flex-1 overflow-y-auto font-mono text-[11px] space-y-0.5 min-h-0"
            >
              {eventLogs.length === 0 ? (
                <div className="text-gray-600 text-center py-4">点击上方按钮触发事件...</div>
              ) : (
                eventLogs.map((log) => (
                  <div key={log.id} className="flex gap-2 py-0.5 border-b border-white/5">
                    <span className="text-gray-600 shrink-0">{log.time}</span>
                    <span
                      className={`shrink-0 px-1 rounded ${
                        log.type === "expression"
                          ? "bg-purple-500/20 text-purple-400"
                          : log.type === "motion"
                          ? "bg-blue-500/20 text-blue-400"
                          : log.type === "tts_start" || log.type === "tts_stop" || log.type === "tts_level"
                          ? "bg-green-500/20 text-green-400"
                          : log.type === "idle_state"
                          ? "bg-orange-500/20 text-orange-400"
                          : log.type === "error"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-gray-500/20 text-gray-400"
                      }`}
                    >
                      {log.type}
                    </span>
                    <span className="text-gray-400 truncate">{log.detail}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
