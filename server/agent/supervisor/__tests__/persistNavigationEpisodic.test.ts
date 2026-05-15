/**
 * persistNavigationEpisodicIfNeeded 单元测试（0423 升级版）
 *
 * 目标：
 * 1. 仅在导航成功 + 未触发 memory_store 时写入
 * 2. 写入的记忆必须是 SceneEpisode（episodic+behavior）并带完整 metadata
 * 3. 必须严格保留 confirm_before_execute 默认安全策略
 * 4. 缺少 slots 或 userId 时应静默跳过
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠️ 在 import 被测模块前 mock memorySystem
vi.mock("../../../memory/memorySystem", () => ({
  addMemory: vi.fn(),
  searchMemories: vi.fn(),
}));

import { persistNavigationEpisodicIfNeeded } from "../persistNavigationEpisodic";
import { addMemory } from "../../../memory/memorySystem";
import type { SupervisorStateType } from "../state";

const addMemoryMock = vi.mocked(addMemory);

beforeEach(() => {
  vi.clearAllMocks();
  addMemoryMock.mockResolvedValue({
    id: 999,
    kind: "episodic",
    type: "behavior",
  } as never);
});

function makeState(
  overrides: Partial<SupervisorStateType> = {}
): SupervisorStateType {
  return {
    messages: [],
    taskClassification: null,
    plan: [
      {
        id: 1,
        description: "导航",
        targetAgent: "navigationAgent",
        expectedTools: ["maps_direction_driving"],
        dependencies: [],
      } as never,
    ],
    currentStepIndex: 0,
    stepResults: [
      {
        stepId: 1,
        status: "success",
        output: "已规划路线 30 公里 1 小时",
        durationMs: 1200,
        toolCalls: [],
      },
    ],
    finalResponse: "",
    context: { userId: "42" } as never,
    dynamicSystemPrompt: "",
    retrievedMemories: [],
    characterId: "xiaozhi",
    dialogueSlots: {
      navOrigin: "太湖软件园",
      navDestination: "上海虹桥机场",
      navWaypoints: ["山姆", "苏州北站"],
    },
    ...overrides,
  } as SupervisorStateType;
}

describe("persistNavigationEpisodicIfNeeded", () => {
  it("当导航成功且无 memory_store 时，应写入 SceneEpisode", async () => {
    await persistNavigationEpisodicIfNeeded(makeState());
    expect(addMemoryMock).toHaveBeenCalledTimes(1);
    const arg = addMemoryMock.mock.calls[0][0];
    expect(arg.kind).toBe("episodic");
    expect(arg.type).toBe("behavior");
    expect(arg.source).toBe("scene_episode");
    expect(arg.tags).toContain("scene");
    expect(arg.tags).toContain("scene:navigation");

    const meta = arg.metadata as Record<string, unknown>;
    expect(meta.domain).toBe("navigation");
    expect(meta.sceneName).toBe("太湖软件园 → 上海虹桥机场");
    expect(meta.navOrigin).toBe("太湖软件园");
    expect(meta.navDestination).toBe("上海虹桥机场");
    expect(meta.navWaypoints).toEqual(["山姆", "苏州北站"]);
    expect(meta.safetyLevel).toBe("confirm_before_execute");
    expect(Array.isArray(meta.actions)).toBe(true);
    expect((meta.actions as unknown[]).length).toBe(1);
    expect(Array.isArray(meta.triggerPhrases)).toBe(true);
    expect((meta.triggerPhrases as string[])).toContain("通勤路线");
  });

  it("当本轮已成功调用 memory_store 时，应跳过写入", async () => {
    const state = makeState({
      stepResults: [
        {
          stepId: 1,
          status: "success",
          output: "ok",
          durationMs: 1,
          toolCalls: [
            {
              toolName: "memory_store",
              serverId: "builtin-memory-tools",
              input: {},
              output: "ok",
              status: "success",
              durationMs: 1,
            },
          ],
        },
      ],
    });
    await persistNavigationEpisodicIfNeeded(state);
    expect(addMemoryMock).not.toHaveBeenCalled();
  });

  it("当无导航成功步骤时，应跳过写入", async () => {
    const state = makeState({
      plan: [
        {
          id: 1,
          description: "聊天",
          targetAgent: "generalAgent",
          expectedTools: [],
          dependencies: [],
        } as never,
      ],
      stepResults: [
        {
          stepId: 1,
          status: "success",
          output: "ok",
          durationMs: 1,
          toolCalls: [],
        },
      ],
    });
    await persistNavigationEpisodicIfNeeded(state);
    expect(addMemoryMock).not.toHaveBeenCalled();
  });

  it("无 dialogueSlots 或 userId 时应跳过", async () => {
    const noSlots = makeState({ dialogueSlots: undefined });
    await persistNavigationEpisodicIfNeeded(noSlots);
    expect(addMemoryMock).not.toHaveBeenCalled();

    addMemoryMock.mockClear();
    const noUser = makeState({ context: null });
    await persistNavigationEpisodicIfNeeded(noUser);
    expect(addMemoryMock).not.toHaveBeenCalled();
  });

  it("仅 waypoints 也能触发写入，生成默认 sceneName", async () => {
    const state = makeState({
      dialogueSlots: {
        navWaypoints: ["本邦中心"],
      },
    });
    await persistNavigationEpisodicIfNeeded(state);
    expect(addMemoryMock).toHaveBeenCalledTimes(1);
    const meta = addMemoryMock.mock.calls[0][0].metadata as Record<
      string,
      unknown
    >;
    expect(meta.sceneName).toBe("通勤路线");
    expect((meta.triggerPhrases as string[])).toContain("经过本邦中心的路");
  });
});
