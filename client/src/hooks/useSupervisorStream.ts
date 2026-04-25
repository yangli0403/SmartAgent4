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

export type SupervisorStreamStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface SupervisorStreamState {
  status: SupervisorStreamStatus;
  details: ChatThinkingDetail[];
  finalResponse?: string;
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

  useEffect(() => {
    if (!requestId) {
      setState({ status: "idle", details: [] });
      return;
    }

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
      } catch {
        // ignore malformed
      }
    };

    const onFinal = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as SupervisorEventEnvelope;
        append(env);
        const payload = (env as { payload?: { response?: string } }).payload;
        setState((prev) => ({
          ...prev,
          status: "completed",
          finalResponse: payload?.response,
        }));
        es.close();
      } catch {
        // ignore
      }
    };

    const onError = () => {
      setState((prev) => ({ ...prev, status: "failed" }));
      es.close();
    };

    const eventNames: SupervisorEventType[] = [
      "classified",
      "plan_ready",
      "step_running",
      "step_finished",
      "replan",
      "error",
    ];

    es.addEventListener("connected", onConnected as EventListener);
    es.addEventListener("final", onFinal as EventListener);
    es.addEventListener("error", onError as EventListener);
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
      es.close();
      esRef.current = null;
    };
  }, [requestId]);

  return state;
}
