/**
 * Supervisor 进程内事件总线（v0.5 引入）
 *
 * 用于把 LangGraph supervisor pipeline 在执行过程中产生的关键事件
 * （classified / plan_ready / step_started / step_finished / replan / final / error）
 * 转发给 SSE 端点，从而让前端 ThinkingBubble 能实时展示"Metris Agent 思考中..."。
 *
 * 设计要点：
 * - 仅供同进程使用（Express 内）：基于 Node EventEmitter 而非 Redis Pub/Sub
 * - 按 requestId 路由，避免不同对话的事件互串
 * - publish 时自动填入 ts，发布者无需关心时间戳
 * - 订阅者获得 unsubscribe 函数，避免内存泄漏
 */
import { EventEmitter } from "events";
import type {
  SupervisorEventEnvelope,
  SupervisorEventType,
} from "@shared/supervisorEvents";
import type { ChatThinkingPhase } from "@shared/chatTts";

class SupervisorEventBus extends EventEmitter {
  constructor() {
    super();
    // 单进程多对话场景下默认 listener 上限可能不够，主动放宽
    this.setMaxListeners(64);
  }

  /**
   * 订阅指定 requestId 的事件流
   * @returns 取消订阅函数
   */
  subscribe(
    requestId: string,
    handler: (env: SupervisorEventEnvelope) => void
  ): () => void {
    const channel = SupervisorEventBus.channelOf(requestId);
    this.on(channel, handler);
    return () => {
      this.off(channel, handler);
    };
  }

  /** 发布事件到指定 requestId 的所有订阅者 */
  publish(env: SupervisorEventEnvelope): void {
    const channel = SupervisorEventBus.channelOf(env.requestId);
    this.emit(channel, env);
  }

  static channelOf(requestId: string): string {
    return `supervisor:${requestId}`;
  }
}

/** 单例 */
export const supervisorEventBus = new SupervisorEventBus();

/**
 * 便捷发布函数：自动填入 ts
 */
export function publishSupervisorEvent<P = unknown>(args: {
  requestId: string;
  type: SupervisorEventType;
  phase: ChatThinkingPhase;
  summary: string;
  payload?: P;
}): void {
  const env: SupervisorEventEnvelope<P> = {
    requestId: args.requestId,
    type: args.type,
    phase: args.phase,
    summary: args.summary,
    payload: args.payload,
    ts: Date.now(),
  };
  supervisorEventBus.publish(env);
}
