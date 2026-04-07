import { describe, it, expect } from "vitest";
import { appendGeneralAgentMemoryStepIfNeeded } from "../navigationMemoryPlan";
import type { SupervisorStateType, PlanStep } from "../state";

function minimalState(
  slots: SupervisorStateType["dialogueSlots"]
): SupervisorStateType {
  return {
    messages: [],
    taskClassification: null,
    plan: [],
    currentStepIndex: 0,
    stepResults: [],
    finalResponse: "",
    context: null,
    dynamicSystemPrompt: "",
    retrievedMemories: [],
    characterId: "xiaozhi",
    dialogueSlots: slots,
  };
}

describe("appendGeneralAgentMemoryStepIfNeeded", () => {
  const navStep: PlanStep = {
    id: 1,
    description: "规划路线",
    targetAgent: "navigationAgent",
    expectedTools: [],
    dependsOn: [],
    inputMapping: {},
  };

  it("起终点齐全且含导航步骤时应追加 generalAgent memory 步", () => {
    const state = minimalState({
      regionHint: "苏州",
      navOrigin: "太湖软件园",
      navDestination: "九龙仓",
    });
    const out = appendGeneralAgentMemoryStepIfNeeded(state, [navStep]);
    expect(out).toHaveLength(2);
    expect(out[1].targetAgent).toBe("generalAgent");
    expect(out[1].expectedTools).toContain("memory_store");
    expect(out[1].dependsOn).toEqual([1]);
  });

  it("仅有途经点也应追加", () => {
    const state = minimalState({
      navWaypoints: ["山姆超市"],
    });
    const out = appendGeneralAgentMemoryStepIfNeeded(state, [navStep]);
    expect(out).toHaveLength(2);
  });

  it("无路线槽位时不追加", () => {
    const state = minimalState({ regionHint: "苏州" });
    const out = appendGeneralAgentMemoryStepIfNeeded(state, [navStep]);
    expect(out).toHaveLength(1);
  });

  it("已含 memory 跟进步骤时不重复追加", () => {
    const state = minimalState({
      navOrigin: "A",
      navDestination: "B",
    });
    const withMemory: PlanStep[] = [
      navStep,
      {
        id: 2,
        description: "memory_store",
        targetAgent: "generalAgent",
        expectedTools: ["memory_store"],
        dependsOn: [1],
        inputMapping: {},
      },
    ];
    const out = appendGeneralAgentMemoryStepIfNeeded(state, withMemory);
    expect(out).toHaveLength(2);
  });
});
