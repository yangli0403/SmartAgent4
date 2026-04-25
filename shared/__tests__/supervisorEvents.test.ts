/**
 * US-1：SupervisorEventEnvelope 共享类型测试
 */
import { describe, it, expect } from "vitest";
import type {
  SupervisorEventEnvelope,
  SupervisorEventType,
  ClassifiedPayload,
  PlanReadyPayload,
  FinalPayload,
} from "../supervisorEvents";

describe("US-1 SupervisorEventEnvelope", () => {
  it("classified 事件具备强类型 payload", () => {
    const env: SupervisorEventEnvelope<ClassifiedPayload> = {
      requestId: "req-1",
      type: "classified" satisfies SupervisorEventType,
      phase: "classified",
      summary: "任务被分类为导航·复杂",
      ts: 1,
      payload: {
        domain: "navigation",
        complexity: "complex",
        reasoning: "用户请求多步行程规划",
      },
    };
    expect(env.payload?.complexity).toBe("complex");
    expect(env.type).toBe("classified");
  });

  it("plan_ready 事件 payload.steps 是数组", () => {
    const env: SupervisorEventEnvelope<PlanReadyPayload> = {
      requestId: "r",
      type: "plan_ready",
      phase: "plan_ready",
      summary: "3 步计划已就绪",
      ts: 2,
      payload: {
        goal: "明天上海行程",
        steps: [
          { id: 1, description: "查路线", targetAgent: "navigationAgent", expectedTools: ["search_route"] },
        ],
      },
    };
    expect(env.payload?.steps).toHaveLength(1);
  });

  it("final 事件包含完整结果摘要", () => {
    const env: SupervisorEventEnvelope<FinalPayload> = {
      requestId: "r",
      type: "final",
      phase: "completed",
      summary: "任务完成",
      ts: 3,
      payload: {
        response: "已为您规划好",
        classification: { domain: "navigation", complexity: "complex" },
        stepsExecuted: 3,
        totalToolCalls: 2,
        totalDurationMs: 1234,
      },
    };
    expect(env.payload?.totalDurationMs).toBe(1234);
  });
});
