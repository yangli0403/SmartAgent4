/**
 * US-4：Supervisor 事件总线测试
 *
 * 关联用户测试用例：U-EB-1 / U-EB-2 / U-EB-3 / U-EB-4
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  supervisorEventBus,
  publishSupervisorEvent,
} from "../supervisorEventBus";
import type { SupervisorEventEnvelope } from "@shared/supervisorEvents";

describe("US-4 supervisorEventBus", () => {
  beforeEach(() => {
    // 清理可能残留的订阅者，避免测试间相互影响
    supervisorEventBus.removeAllListeners();
  });

  it("U-EB-1：subscribe 仅接收匹配 requestId 的事件", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    supervisorEventBus.subscribe("req-A", handlerA);
    supervisorEventBus.subscribe("req-B", handlerB);

    publishSupervisorEvent({
      requestId: "req-A",
      type: "classified",
      phase: "classified",
      summary: "A 分类完成",
    });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });

  it("U-EB-2：unsubscribe 后不再接收事件", () => {
    const handler = vi.fn();
    const unsub = supervisorEventBus.subscribe("req-X", handler);

    publishSupervisorEvent({
      requestId: "req-X",
      type: "classified",
      phase: "classified",
      summary: "first",
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    publishSupervisorEvent({
      requestId: "req-X",
      type: "final",
      phase: "completed",
      summary: "second",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("U-EB-3：发布到无订阅者的 requestId 不抛异常", () => {
    expect(() =>
      publishSupervisorEvent({
        requestId: "req-orphan",
        type: "error",
        phase: "error",
        summary: "no listener",
      })
    ).not.toThrow();
  });

  it("U-EB-4：publishSupervisorEvent 自动填入 ts", () => {
    const handler = vi.fn();
    supervisorEventBus.subscribe("req-T", handler);

    const before = Date.now();
    publishSupervisorEvent({
      requestId: "req-T",
      type: "classified",
      phase: "classified",
      summary: "auto-ts",
    });
    const after = Date.now();

    expect(handler).toHaveBeenCalledTimes(1);
    const env = handler.mock.calls[0][0] as SupervisorEventEnvelope;
    expect(typeof env.ts).toBe("number");
    expect(env.ts).toBeGreaterThanOrEqual(before);
    expect(env.ts).toBeLessThanOrEqual(after);
  });

  it("U-EB-5：同一 requestId 的多个订阅者都会收到事件", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    supervisorEventBus.subscribe("req-multi", h1);
    supervisorEventBus.subscribe("req-multi", h2);

    publishSupervisorEvent({
      requestId: "req-multi",
      type: "plan_ready",
      phase: "plan_ready",
      summary: "multi",
    });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
