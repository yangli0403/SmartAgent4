/**
 * SceneEpisode 单元测试
 *
 * 覆盖：buildSceneTags / persistSceneEpisode / searchSceneEpisodes /
 *      buildExecutionPlanFromMemory 四个公共 API。
 *
 * 通过 vi.mock 替换底层 memorySystem，避免依赖真实数据库。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠️ 在 import sceneEpisode 之前 mock memorySystem
vi.mock("../memorySystem", () => ({
  addMemory: vi.fn(),
  searchMemories: vi.fn(),
}));

import {
  buildSceneTags,
  persistSceneEpisode,
  searchSceneEpisodes,
  buildExecutionPlanFromMemory,
  SCENE_EPISODE_SOURCE,
} from "../sceneEpisode";
import { addMemory, searchMemories } from "../memorySystem";
import type { Memory } from "../../../drizzle/schema";

const addMemoryMock = vi.mocked(addMemory);
const searchMemoriesMock = vi.mocked(searchMemories);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sceneEpisode", () => {
  describe("buildSceneTags", () => {
    it("默认应返回 [scene, scene:{domain}]", () => {
      const tags = buildSceneTags("vehicle_control");
      expect(tags).toEqual(["scene", "scene:vehicle_control"]);
    });

    it("应保留额外标签并去重", () => {
      const tags = buildSceneTags("navigation", ["通勤", "scene"]);
      // 顺序：默认 + 额外，去重
      expect(tags).toContain("scene");
      expect(tags).toContain("scene:navigation");
      expect(tags).toContain("通勤");
      expect(tags.filter((t) => t === "scene")).toHaveLength(1);
    });
  });

  describe("persistSceneEpisode", () => {
    it("缺少 userId 应抛错", async () => {
      await expect(
        persistSceneEpisode({
          userId: 0,
          domain: "vehicle_control",
          sceneName: "午睡模式",
          summary: "测试",
        })
      ).rejects.toThrow(/userId/);
    });

    it("缺少 sceneName / summary 应抛错", async () => {
      await expect(
        persistSceneEpisode({
          userId: 1,
          domain: "navigation",
          sceneName: "",
          summary: "",
        })
      ).rejects.toThrow(/sceneName/);
    });

    it("应写入 episodic+behavior，并注入完整 metadata 与默认安全策略", async () => {
      addMemoryMock.mockResolvedValueOnce({
        id: 101,
        kind: "episodic",
        type: "behavior",
      } as unknown as Memory);

      const result = await persistSceneEpisode({
        userId: 42,
        domain: "vehicle_control",
        sceneName: "午睡模式",
        summary: "关大灯、调温度到24度、放白噪音",
        triggerPhrases: ["午睡模式", "中午休息"],
        timePattern: "weekday 12:00-14:00",
        actions: [
          { tool: "vehicle.lights", command: "off" },
          {
            tool: "vehicle.ac",
            command: "set",
            args: { temperature: 24 },
          },
        ],
      });

      expect(result?.id).toBe(101);
      expect(addMemoryMock).toHaveBeenCalledTimes(1);
      const arg = addMemoryMock.mock.calls[0][0];
      expect(arg.kind).toBe("episodic");
      expect(arg.type).toBe("behavior");
      expect(arg.source).toBe(SCENE_EPISODE_SOURCE);
      expect(arg.tags).toContain("scene");
      expect(arg.tags).toContain("scene:vehicle_control");
      const meta = arg.metadata as Record<string, unknown>;
      expect(meta.sceneName).toBe("午睡模式");
      expect(meta.domain).toBe("vehicle_control");
      expect(meta.safetyLevel).toBe("confirm_before_execute");
      expect((meta.actions as unknown[]).length).toBe(2);
    });

    it("显式 auto_execute 应被保留", async () => {
      addMemoryMock.mockResolvedValueOnce({ id: 102 } as unknown as Memory);
      await persistSceneEpisode({
        userId: 1,
        domain: "multimedia",
        sceneName: "晨间播报",
        summary: "播放新闻摘要",
        safetyLevel: "auto_execute",
      });
      const arg = addMemoryMock.mock.calls[0][0];
      const meta = arg.metadata as Record<string, unknown>;
      expect(meta.safetyLevel).toBe("auto_execute");
    });

    it("importance 应被 clamp 到 [0,1]", async () => {
      addMemoryMock.mockResolvedValueOnce({ id: 103 } as unknown as Memory);
      await persistSceneEpisode({
        userId: 1,
        domain: "navigation",
        sceneName: "测试",
        summary: "x",
        importance: 5,
        confidence: -1,
      });
      const arg = addMemoryMock.mock.calls[0][0];
      expect(arg.importance).toBe(1);
      expect(arg.confidence).toBe(0);
    });
  });

  describe("searchSceneEpisodes", () => {
    it("应使用 episodic+behavior 检索并按 domain 过滤", async () => {
      const navMemo = {
        id: 1,
        metadata: { domain: "navigation", sceneName: "上班路线" },
      } as unknown as Memory;
      const carMemo = {
        id: 2,
        metadata: { domain: "vehicle_control", sceneName: "午睡模式" },
      } as unknown as Memory;
      searchMemoriesMock.mockResolvedValueOnce([navMemo, carMemo]);

      const results = await searchSceneEpisodes({
        userId: 1,
        query: "通勤",
        domain: "navigation",
      });

      expect(results).toEqual([navMemo]);
      const callArg = searchMemoriesMock.mock.calls[0][0];
      expect(callArg.kind).toBe("episodic");
      expect(callArg.type).toBe("behavior");
      expect(callArg.useHybridSearch).toBe(true);
    });

    it("无 domain 时应返回全部场景记忆", async () => {
      const m1 = { id: 1, metadata: { domain: "navigation" } } as unknown as Memory;
      const m2 = { id: 2, metadata: { domain: "vehicle_control" } } as unknown as Memory;
      searchMemoriesMock.mockResolvedValueOnce([m1, m2]);
      const results = await searchSceneEpisodes({ userId: 1, query: "通勤" });
      expect(results).toHaveLength(2);
    });
  });

  describe("buildExecutionPlanFromMemory", () => {
    it("缺少必要字段时应返回 null", () => {
      const m = {
        id: 1,
        metadata: { sceneName: "x" },
      } as unknown as Memory;
      expect(buildExecutionPlanFromMemory(m)).toBeNull();
    });

    it("默认场景应要求执行前确认", () => {
      const m = {
        id: 1,
        metadata: {
          domain: "vehicle_control",
          sceneName: "午睡模式",
          actions: [{ tool: "vehicle.lights", command: "off" }],
          safetyLevel: "confirm_before_execute",
        },
      } as unknown as Memory;
      const plan = buildExecutionPlanFromMemory(m);
      expect(plan).not.toBeNull();
      expect(plan!.requiresConfirmation).toBe(true);
      expect(plan!.actions).toHaveLength(1);
      expect(plan!.summary).toContain("午睡模式");
      expect(plan!.summary).toContain("vehicle.lights");
    });

    it("auto_execute 不应要求确认", () => {
      const m = {
        id: 2,
        metadata: {
          domain: "multimedia",
          sceneName: "晨间播报",
          actions: [{ tool: "tts", command: "play" }],
          safetyLevel: "auto_execute",
        },
      } as unknown as Memory;
      const plan = buildExecutionPlanFromMemory(m);
      expect(plan!.requiresConfirmation).toBe(false);
    });

    it("summary 应包含动作参数渲染", () => {
      const m = {
        id: 3,
        metadata: {
          domain: "vehicle_control",
          sceneName: "夏日午睡",
          actions: [
            {
              tool: "vehicle.ac",
              command: "set",
              args: { temperature: 24, mode: "cool" },
            },
          ],
        },
      } as unknown as Memory;
      const plan = buildExecutionPlanFromMemory(m);
      expect(plan!.summary).toContain("temperature=24");
      expect(plan!.summary).toContain('mode="cool"');
    });
  });
});
