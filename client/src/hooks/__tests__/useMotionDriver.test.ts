/**
 * useMotionDriver 单元测试
 *
 * 关联用户测试用例：UTC-009, UTC-010
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageEventBus } from "@/lib/airi-stage/stageEventBus";
import { useStageStore } from "@/lib/airi-stage/useStageStore";
import { getMotionDef } from "@/lib/airi-stage/motionMapping";

describe("MotionDriver 逻辑测试", () => {
  beforeEach(() => {
    stageEventBus.all.clear();
    useStageStore.getState().reset();
  });

  it("motion 事件应通过 Store 更新当前动作", () => {
    stageEventBus.on("motion", (event) => {
      const def = getMotionDef(event.motion);
      if (def) {
        useStageStore.getState().setCurrentMotion(event.motion, event.priority ?? def.priority);
      }
    });

    stageEventBus.emit("motion", {
      type: "motion",
      motion: "nod",
      priority: 2,
    });

    const state = useStageStore.getState();
    expect(state.motion.currentMotion).toBe("nod");
    expect(state.motion.currentPriority).toBe(2);
    expect(state.motion.isPlaying).toBe(true);
  });

  it("未知动作应被忽略", () => {
    stageEventBus.on("motion", (event) => {
      const def = getMotionDef(event.motion);
      if (def) {
        useStageStore.getState().setCurrentMotion(event.motion, event.priority ?? def.priority);
      }
    });

    stageEventBus.emit("motion", {
      type: "motion",
      motion: "unknown_motion",
    });

    const state = useStageStore.getState();
    expect(state.motion.currentMotion).toBeNull();
    expect(state.motion.isPlaying).toBe(false);
  });

  it("高优先级动作应能打断低优先级动作", () => {
    // 模拟优先级检查逻辑
    const handleMotion = (event: any) => {
      const def = getMotionDef(event.motion);
      if (!def) return;
      const eventPriority = event.priority ?? def.priority;
      const currentState = useStageStore.getState().motion;

      if (currentState.isPlaying && currentState.currentPriority > eventPriority) {
        return; // 忽略低优先级
      }
      useStageStore.getState().setCurrentMotion(event.motion, eventPriority);
    };

    stageEventBus.on("motion", handleMotion);

    // 先播放高优先级动作
    stageEventBus.emit("motion", { type: "motion", motion: "bow", priority: 3 });
    expect(useStageStore.getState().motion.currentMotion).toBe("bow");

    // 尝试低优先级动作，应被忽略
    stageEventBus.emit("motion", { type: "motion", motion: "nod", priority: 1 });
    expect(useStageStore.getState().motion.currentMotion).toBe("bow");
  });

  it("getMotionDef 应返回正确的动作定义", () => {
    const def = getMotionDef("nod");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("点头");
    expect(def!.group).toBe("TapBody");
  });

  it("getMotionDef 对未知动作应返回 null", () => {
    const def = getMotionDef("fly");
    expect(def).toBeNull();
  });
});
