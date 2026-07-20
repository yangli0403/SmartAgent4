/**
 * server/observability/tracing.ts — OpenTelemetry trace span
 *
 * 对齐 02-架构设计.md §11 Observability
 * 简化版：内存中维护 spans，导出为数组供测试断言
 */

import { randomUUID } from "crypto";

// ============================================================
// Span 模型
// ============================================================

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export type SpanStatus = "OK" | "ERROR";

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

export interface StartSpanOptions {
  name: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
}

export interface EndSpanOptions {
  status?: SpanStatus;
  attributes?: Record<string, unknown>;
  exception?: Error;
}

// ============================================================
// Tracer
// ============================================================

class Tracer {
  private spans: Span[] = [];
  private activeStack: Span[] = [];

  /** 启动新 span，返回 context */
  startSpan(options: StartSpanOptions): SpanContext {
    const parent =
      this.activeStack[this.activeStack.length - 1] ?? null;
    const spanId = randomUUID().replace(/-/g, "").slice(0, 16);
    const traceId = parent?.traceId ?? randomUUID().replace(/-/g, "");

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: parent?.spanId ?? options.parentSpanId,
      name: options.name,
      startTime: Date.now(),
      status: "OK",
      attributes: options.attributes ?? {},
      events: [],
    };
    this.spans.push(span);
    this.activeStack.push(span);

    return { traceId, spanId, parentSpanId: span.parentSpanId };
  }

  /** 结束最近启动的 span（或指定 spanId） */
  endSpan(spanId: string, options: EndSpanOptions = {}): void {
    const span = this.spans.find((s) => s.spanId === spanId);
    if (!span) return;
    span.endTime = Date.now();
    span.status = options.status ?? span.status;
    if (options.attributes) {
      span.attributes = { ...span.attributes, ...options.attributes };
    }
    if (options.exception) {
      span.status = "ERROR";
      span.events.push({
        name: "exception",
        timestamp: Date.now(),
        attributes: {
          message: options.exception.message,
          stack: options.exception.stack,
        },
      });
    }
    // 弹出 activeStack
    const idx = this.activeStack.findIndex((s) => s.spanId === spanId);
    if (idx >= 0) this.activeStack.splice(idx, 1);
  }

  /** 当前所有 span（测试用） */
  getSpans(): readonly Span[] {
    return this.spans;
  }

  /** 按 traceId 过滤 */
  getSpansByTrace(traceId: string): Span[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }

  reset(): void {
    this.spans = [];
    this.activeStack = [];
  }

  /** 便捷：在 scope 内启动 span，自动结束 */
  async inSpan<T>(
    options: StartSpanOptions,
    fn: (ctx: SpanContext) => Promise<T> | T
  ): Promise<T> {
    const ctx = this.startSpan(options);
    try {
      const result = await fn(ctx);
      this.endSpan(ctx.spanId, { status: "OK" });
      return result;
    } catch (err) {
      this.endSpan(ctx.spanId, {
        status: "ERROR",
        exception: err instanceof Error ? err : new Error(String(err)),
      });
      throw err;
    }
  }
}

export const tracer = new Tracer();

/** 便捷：捕获 fn 执行期间产生的所有 spans */
export async function captureSpans<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T; spans: readonly Span[] }> {
  tracer.reset();
  const result = await fn();
  const spans = tracer.getSpans();
  return { result, spans };
}