/**
 * M2-02 验证：sceneActivation + classifyNode 串联
 *
 * 契约：
 * - sceneActivation 缓存命中 → classifyNode 路由到 scene 专用 agent（跳过 LLM）
 * - sceneActivation miss → classifyNode 走 LLM 或规则层
 *
 * 实际数据流：
 *   preAnalysisNode → 触发 sceneActivation 缓存填充（fire-and-forget）
 *                 ↓
 *   classifyNode → 读 SceneActivationCache → 命中则路由到 scene_agent
 */

import { describe, it, expect } from "vitest";
import {
  SceneActivationCache,
} from "../../server/agent/preAnalysis/cache/sceneActivationCache";
import type { SceneMatch } from "../../server/agent/preAnalysis/types/sceneActivationOutput";

/** 模拟 classifyNode 的 scene 路由决策 */
function mockClassifySceneRoute(sceneCacheHit: boolean, sceneMatches: SceneMatch[]) {
  if (sceneCacheHit && sceneMatches.length > 0) {
    return {
      route: "scene_agent",
      sceneName: sceneMatches[0].sceneName,
      skipLLM: true,
    };
  }
  return {
    route: "default",
    sceneName: null,
    skipLLM: false,
  };
}

/** 模拟 sceneEpisode 搜索（DB 查询） */
function mockSearchSceneEpisodes(userId: number, query: string): SceneMatch[] {
  // 业务规则：用户已保存的场景
  const scenes: Record<string, SceneMatch> = {
    "午睡模式": {
      memoryId: 100,
      sceneName: "午睡模式",
      summary: "关闭大灯、播放轻音乐、空调调至 24℃",
      domain: "iot",
      matchScore: 0.95,
    },
    "通勤模式": {
      memoryId: 101,
      sceneName: "通勤模式",
      summary: "导航到公司 + 播放新闻",
      domain: "navigation",
      matchScore: 0.9,
    },
  };
  for (const name in scenes) {
    if (query.includes(name)) return [scenes[name]];
  }
  return [];
}

describe("M2-02 sceneActivation + classifyNode 串联", () => {
  it("scene cache 命中 → 路由到 scene_agent", () => {
    const cache = new SceneActivationCache();
    cache.set(123, "打开午睡模式", [mockSearchSceneEpisodes(123, "打开午睡模式")[0]]);

    const cached = cache.get(123, "打开午睡模式");
    expect(cached.cacheHit).toBe(true);
    const route = mockClassifySceneRoute(cached.cacheHit, cached.matches);
    expect(route.route).toBe("scene_agent");
    expect(route.sceneName).toBe("午睡模式");
    expect(route.skipLLM).toBe(true);
  });

  it("scene cache miss → 走默认路由", () => {
    const cache = new SceneActivationCache();
    const cached = cache.get(123, "随便问个问题");
    expect(cached.cacheHit).toBe(false);
    expect(cached.dbFallback).toBe(true);
    const route = mockClassifySceneRoute(cached.cacheHit, cached.matches);
    expect(route.route).toBe("default");
    expect(route.skipLLM).toBe(false);
  });

  it("DB 异步填充 → 第二次查询命中缓存", async () => {
    const cache = new SceneActivationCache();
    // 模拟 fire-and-forget：第一次 miss → DB 异步填充 → 第二次命中
    const first = cache.get(123, "打开午睡模式");
    expect(first.cacheHit).toBe(false);
    expect(first.dbFallback).toBe(true);

    // 模拟异步 DB 查询完成后填充缓存
    const scenes = mockSearchSceneEpisodes(123, "打开午睡模式");
    cache.set(123, "打开午睡模式", scenes);

    const second = cache.get(123, "打开午睡模式");
    expect(second.cacheHit).toBe(true);
    expect(second.matches[0].sceneName).toBe("午睡模式");
  });

  it("多用户隔离 → user A 命中不影响 user B", () => {
    const cache = new SceneActivationCache();
    cache.set(1, "打开午睡模式", [mockSearchSceneEpisodes(1, "打开午睡模式")[0]]);
    const a = cache.get(1, "打开午睡模式");
    const b = cache.get(2, "打开午睡模式");
    expect(a.cacheHit).toBe(true);
    expect(b.cacheHit).toBe(false);
  });

  it("TTL 过期后 → miss + dbFallback", async () => {
    const cache = new SceneActivationCache({ defaultTtlMs: 30 });
    cache.set(1, "打开午睡模式", [mockSearchSceneEpisodes(1, "打开午睡模式")[0]]);
    expect(cache.get(1, "打开午睡模式").cacheHit).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    const expired = cache.get(1, "打开午睡模式");
    expect(expired.cacheHit).toBe(false);
    expect(expired.dbFallback).toBe(true);
    const route = mockClassifySceneRoute(expired.cacheHit, expired.matches);
    expect(route.route).toBe("default");
  });

  it("命中率统计用于评估缓存效果", () => {
    const cache = new SceneActivationCache();
    cache.set(1, "q1", [mockSearchSceneEpisodes(1, "q1")[0]]);
    cache.get(1, "q1");      // hit
    cache.get(1, "q1");      // hit
    cache.get(1, "q2");      // miss
    cache.get(2, "q3");      // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBe(0.5);
  });
});