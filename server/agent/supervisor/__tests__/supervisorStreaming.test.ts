/**
 * US-4：runSupervisorStreaming 单测
 *
 * 不依赖真实 LangGraph：mock graph.stream 产出有序的 partial states，
 * 验证事件序列、payload 形状、防抖（同一 stepId 不重复发布 step_started）等。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  publishEventsFromUpdates,
  type StreamUpdate,
} from "../supervisorStreaming";
import {
  publishSupervisorEvent,
  supervisorEventBus,
} from "../supervisorEventBus";
import type { SupervisorEventEnvelope } from "@shared/supervisorEvents";

vi.mock("../supervisorEventBus", async () => {
  const real = await vi.importActual<
    typeof import("../supervisorEventBus")
  >("../supervisorEventBus");
  return {
    ...real,
    publishSupervisorEvent: vi.fn(real.publishSupervisorEvent),
  };
});

describe("US-4 publishEventsFromUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supervisorEventBus.removeAllListeners();
  });

  it("典型流：classified → plan_ready → step_started ×2 → step_finished ×2 → final", () => {
    const events: SupervisorEventEnvelope[] = [];
    supervisorEventBus.subscribe("req-1", (e) => events.push(e));

    const updates: StreamUpdate[] = [
      // 第一个 update：分类完成
      {
        taskClassification: {
          domain: "navigation",
          complexity: "complex",
          reasoning: "复杂行程规划",
        },
      },
      // 第二个：计划生成
      {
        plan: [
          { id: 1, description: "查路线", targetAgent: "navigationAgent" },
          { id: 2, description: "建群", targetAgent: "officeAgent" },
        ],
      },
      // 第三个：第一步开始
      {
        currentStepId: 1,
      },
      // 第四个：第一步完成
      {
        stepResults: [
          {
            stepId: 1,
            status: "success",
            durationMs: 200,
            toolCalls: [{ name: "search_route" }],
          },
        ],
      },
      // 第五个：第二步开始
      {
        currentStepId: 2,
      },
      // 第六个：第二步完成
      {
        stepResults: [
          { stepId: 1, status: "success", durationMs: 200, toolCalls: [] },
          { stepId: 2, status: "success", durationMs: 300, toolCalls: [] },
        ],
      },
      // 第七个：最终回复
      {
        finalResponse: "已为您规划好",
      },
    ];

    const ctx = { requestId: "req-1" };
    for (const u of updates) {
      publishEventsFromUpdates(u, ctx);
    }

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "classified",
      "plan_ready",
      "step_started",
      "step_finished",
      "step_started",
      "step_finished",
      "responding",
      "reflecting",
      "final",
    ]);

    const finalEv = events[events.length - 1];
    expect(finalEv.summary).toContain("已为您规划好".slice(0, 4));
  });

  it("防抖：相同 stepId 不会重复发布 step_started", () => {
    const events: SupervisorEventEnvelope[] = [];
    supervisorEventBus.subscribe("req-2", (e) => events.push(e));
    const ctx = { requestId: "req-2" };

    publishEventsFromUpdates({ currentStepId: 1 }, ctx);
    publishEventsFromUpdates({ currentStepId: 1 }, ctx); // 重复
    publishEventsFromUpdates({ currentStepId: 1 }, ctx);

    expect(events.filter((e) => e.type === "step_started")).toHaveLength(1);
  });

  it("replan：replanCount 增加时发布 replan 事件", () => {
    const events: SupervisorEventEnvelope[] = [];
    supervisorEventBus.subscribe("req-3", (e) => events.push(e));
    const ctx = { requestId: "req-3" };

    publishEventsFromUpdates({ replanCount: 0 }, ctx);
    publishEventsFromUpdates({ replanCount: 1, replanReason: "工具失败" }, ctx);

    expect(events.filter((e) => e.type === "replan")).toHaveLength(1);
    const ev = events.find((e) => e.type === "replan");
    expect(ev?.summary).toContain("工具失败");
  });
});
