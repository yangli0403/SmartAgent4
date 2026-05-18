/**
 * useSupervisorStream（v0.5 引入）
 *
 * 订阅 GET /api/supervisor/stream?requestId=xxx，将事件聚合为
 * ChatUiThinkingMessage 消费需要的 details / status / finalResponse。
 *
 * 设计：
 * - requestId 为空字符串/undefined 时不连接（避免开发模式无意义连接）
 * - connected 事件不写入 details，只把 status 切到 running
 * - final 事件 → completed，其它非 error 事件追加到 details
 * - error 事件或 EventSource onerror → failed
 */
import { useEffect, useRef, useState } from "react";
import type {
  SupervisorEventEnvelope,
  SupervisorEventType,
} from "@shared/supervisorEvents";
import type { ChatThinkingDetail } from "@shared/chatTts";
import {
  playInterimAudio,
  stopInterimAudio,
} from "../lib/interimAudioPlayer";

export type SupervisorStreamStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface ProactiveSuggestion {
  patternDescription: string;
  patternType: string;
  frequency: number;
  suggestedSceneName: string;
  suggestedSteps: string[];
  requestId: string;
}

export interface SupervisorStreamState {
  status: SupervisorStreamStatus;
  details: ChatThinkingDetail[];
  finalResponse?: string;
  proactiveSuggestion?: ProactiveSuggestion;
}

const NON_DETAIL_EVENTS: SupervisorEventType[] = ["connected" as never];

function envelopeToDetail(
  env: SupervisorEventEnvelope
): ChatThinkingDetail | null {
  // connected 事件没有 phase，跳过
  if ((env.type as string) === "connected") return null;
  return {
    ts: env.ts ?? Date.now(),
    phase: env.phase as ChatThinkingDetail["phase"],
    summary: env.summary ?? env.type,
    payload: (env as { payload?: Record<string, unknown> }).payload,
  };
}

export function useSupervisorStream(
  requestId: string | undefined
): SupervisorStreamState {
  const [state, setState] = useState<SupervisorStreamState>({
    status: "idle",
    details: [],
  });
  const esRef = useRef<EventSource | null>(null);
  const completedRef = useRef(false);
  const finalCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!requestId) {
      setState({ status: "idle", details: [] });
      return;
    }

    if (finalCloseTimerRef.current) {
      clearTimeout(finalCloseTimerRef.current);
      finalCloseTimerRef.current = null;
    }
    completedRef.current = false;

    const url = `/api/supervisor/stream?requestId=${encodeURIComponent(requestId)}`;
    const es = new EventSource(url);
    esRef.current = es;
    setState({ status: "running", details: [] });

    const append = (env: SupervisorEventEnvelope) => {
      const detail = envelopeToDetail(env);
      if (!detail) return;
      setState((prev) => ({
        ...prev,
        details: [...prev.details, detail],
      }));
    };

    const onConnected = () => {
      setState((prev) => ({ ...prev, status: "running" }));
    };

    const onAny = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as SupervisorEventEnvelope;
        append(env);

        // ✨ 过渡音频：收到 classified 事件时，立即播放对应分类域的女声过渡音频
        if (env.type === "classified") {
          const payload = (env as { payload?: { domain?: string; complexity?: string } }).payload;
          const domain = payload?.domain || "general";
          // 所有任务均播放过渡音频（simple 任务虽快，但天气/导航等仍需等待工具调用）
          playInterimAudio(domain).catch(() => {});
        }
      } catch {
        // ignore malformed
      }
    };

    const onFinal = (ev: MessageEvent) => {
      try {
        // ✨ 主结果返回时，立即停止过渡音频
        stopInterimAudio();

        const env = JSON.parse(ev.data) as SupervisorEventEnvelope;
        append(env);
        const payload = (env as { payload?: { response?: string } }).payload;
        completedRef.current = true;
        setState((prev) => ({
          ...prev,
          status: "completed",
          finalResponse: payload?.response,
        }));

        // 后端的主动建议可能在 final 之后异步发布。这里保留短暂 SSE 窗口，
        // 避免“三次重复操作已落库但 proactive_suggest 事件被 final 关闭连接截断”。
        if (finalCloseTimerRef.current) clearTimeout(finalCloseTimerRef.current);
        finalCloseTimerRef.current = setTimeout(() => {
          es.close();
          if (esRef.current === es) esRef.current = null;
        }, 5000);
      } catch {
        // ignore
      }
    };

    const onError = () => {
      if (completedRef.current) {
        es.close();
        return;
      }
      setState((prev) => ({ ...prev, status: "failed" }));
      es.close();
    };

    // 处理主动建议事件
    const onProactiveSuggest = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as SupervisorEventEnvelope;
        const payload = (env as { payload?: {
          patternDescription?: string;
          patternType?: string;
          frequency?: number;
          suggestedSceneName?: string;
          suggestedSteps?: string[];
        } }).payload;
        const suggestedSceneName = payload?.suggestedSceneName;
        if (suggestedSceneName) {
          setState((prev) => ({
            ...prev,
            proactiveSuggestion: {
              patternDescription: payload.patternDescription || "",
              patternType: payload.patternType || "",
              frequency: payload.frequency || 3,
              suggestedSceneName,
              suggestedSteps: payload.suggestedSteps || [],
              requestId: env.requestId,
            },
          }));
        }
      } catch {
        // ignore
      }
    };

    const eventNames: SupervisorEventType[] = [
      "classified",
      "memory_recalled",
      "plan_ready",
      "step_started",
      "step_finished",
      "replan",
      "reflected",
      "memory_extracted",
      "proactive_suggest",
      "error",
    ];

    es.addEventListener("connected", onConnected as EventListener);
    es.addEventListener("final", onFinal as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.addEventListener("proactive_suggest", onProactiveSuggest as EventListener);
    eventNames.forEach((name) =>
      es.addEventListener(name, onAny as EventListener)
    );

    return () => {
      eventNames.forEach((name) =>
        es.removeEventListener(name, onAny as EventListener)
      );
      es.removeEventListener("connected", onConnected as EventListener);
      es.removeEventListener("final", onFinal as EventListener);
      es.removeEventListener("error", onError as EventListener);
      es.removeEventListener("proactive_suggest", onProactiveSuggest as EventListener);
      if (finalCloseTimerRef.current) {
        clearTimeout(finalCloseTimerRef.current);
        finalCloseTimerRef.current = null;
      }
      es.close();
      esRef.current = null;
    };
  }, [requestId]);

  return state;
}
