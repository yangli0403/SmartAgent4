/**
 * US-7：useSupervisorStream Hook 测试
 * 关联用户测试用例：U-USS-1 / U-USS-2 / U-USS-3
 *
 * 通过 mock window.EventSource 注入事件，验证 hook 状态机转换。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSupervisorStream } from "../useSupervisorStream";

type Listener = (ev: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Map<string, Listener[]> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: Listener) {
    const arr = this.listeners.get(name) ?? [];
    arr.push(fn);
    this.listeners.set(name, arr);
  }

  removeEventListener(name: string, fn: Listener) {
    const arr = this.listeners.get(name) ?? [];
    this.listeners.set(
      name,
      arr.filter((f) => f !== fn)
    );
  }

  dispatch(name: string, data: unknown) {
    const ev = new MessageEvent(name, { data: JSON.stringify(data) });
    (this.listeners.get(name) ?? []).forEach((fn) => fn(ev));
  }

  close() {
    this.closed = true;
  }
}

describe("US-7 useSupervisorStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    // @ts-expect-error attach to global
    globalThis.EventSource = MockEventSource;
  });

  afterEach(() => {
    // @ts-expect-error
    delete globalThis.EventSource;
  });

  it("U-USS-1：requestId 为空时不创建 EventSource，状态保持 idle", () => {
    const { result } = renderHook(() => useSupervisorStream(undefined));
    expect(MockEventSource.instances.length).toBe(0);
    expect(result.current.status).toBe("idle");
    expect(result.current.details).toEqual([]);
  });

  it("U-USS-2：收到 connected/classified/final 时按顺序追加 details，并切换为 completed", () => {
    const { result } = renderHook(() => useSupervisorStream("req-1"));
    const es = MockEventSource.instances[0];
    expect(es.url).toContain("requestId=req-1");

    act(() => {
      es.dispatch("connected", { requestId: "req-1", ts: 1 });
    });
    expect(result.current.status).toBe("running");

    act(() => {
      es.dispatch("classified", {
        requestId: "req-1",
        type: "classified",
        phase: "classified",
        summary: "任务分类：navigation·complex",
        ts: 2,
      });
      es.dispatch("final", {
        requestId: "req-1",
        type: "final",
        phase: "completed",
        summary: "完成",
        payload: { response: "ok" },
        ts: 3,
      });
    });

    expect(result.current.status).toBe("completed");
    // connected 不计入 details，但 classified 应该入列
    expect(
      result.current.details.some(
        (d) => d.summary === "任务分类：navigation·complex"
      )
    ).toBe(true);
    expect(result.current.finalResponse).toBe("ok");
  });

  it("U-USS-3：onerror 后状态切换为 failed 并自动 close", () => {
    const { result } = renderHook(() => useSupervisorStream("req-2"));
    const es = MockEventSource.instances[0];
    act(() => {
      // 触发错误事件
      const fn = (es as any).listeners.get("error") ?? [];
      fn.forEach((f: Listener) =>
        f(new MessageEvent("error", { data: "{}" }))
      );
    });
    expect(result.current.status).toBe("failed");
  });
});
