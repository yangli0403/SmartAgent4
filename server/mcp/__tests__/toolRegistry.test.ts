/**
 * ToolRegistry 单元测试（v2 — 含效用分数）
 *
 * 测试动态工具注册表的所有核心方法，
 * 包括 Phase 4 新增的 updateUtility 和 getRankedTools。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, type RegisteredTool, type ToolCategory } from "../toolRegistry";

function createTool(overrides: Partial<RegisteredTool> = {}): RegisteredTool {
  return {
    name: overrides.name || "test_tool",
    description: overrides.description || "A test tool",
    inputSchema: overrides.inputSchema || { type: "object", properties: {} },
    serverId: overrides.serverId || "server-1",
    category: overrides.category || "file_system",
    registeredAt: overrides.registeredAt || new Date(),
    utilityScore: overrides.utilityScore ?? 0.5,
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    avgExecutionTimeMs: overrides.avgExecutionTimeMs ?? 0,
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ==================== register ====================

  describe("register", () => {
    it("应成功注册一个工具", () => {
      const tool = createTool({ name: "search_files" });
      registry.register(tool);
      expect(registry.size()).toBe(1);
      expect(registry.get("search_files")).toBeDefined();
      expect(registry.get("search_files")!.name).toBe("search_files");
    });

    it("应覆盖同名工具", () => {
      const tool1 = createTool({ name: "search_files", description: "v1" });
      const tool2 = createTool({ name: "search_files", description: "v2" });
      registry.register(tool1);
      registry.register(tool2);
      expect(registry.size()).toBe(1);
      expect(registry.get("search_files")!.description).toBe("v2");
    });

    it("注册时应自动更新 registeredAt", () => {
      const oldDate = new Date("2020-01-01");
      const tool = createTool({ name: "test", registeredAt: oldDate });
      registry.register(tool);
      const registered = registry.get("test");
      expect(registered!.registeredAt.getTime()).toBeGreaterThan(oldDate.getTime());
    });

    it("注册时应初始化效用字段默认值", () => {
      const tool = createTool({ name: "new_tool" });
      registry.register(tool);
      const registered = registry.get("new_tool")!;
      expect(registered.utilityScore).toBe(0.5);
      expect(registered.successCount).toBe(0);
      expect(registered.failureCount).toBe(0);
      expect(registered.avgExecutionTimeMs).toBe(0);
    });
  });

  // ==================== registerBatch ====================

  describe("registerBatch", () => {
    it("应批量注册多个工具", () => {
      const tools = [
        createTool({ name: "tool_a" }),
        createTool({ name: "tool_b" }),
        createTool({ name: "tool_c" }),
      ];
      registry.registerBatch(tools);
      expect(registry.size()).toBe(3);
    });

    it("批量注册空数组不应报错", () => {
      registry.registerBatch([]);
      expect(registry.size()).toBe(0);
    });
  });

  // ==================== unregister ====================

  describe("unregister", () => {
    it("应成功注销已注册的工具", () => {
      registry.register(createTool({ name: "to_remove" }));
      expect(registry.size()).toBe(1);
      registry.unregister("to_remove");
      expect(registry.size()).toBe(0);
      expect(registry.get("to_remove")).toBeUndefined();
    });

    it("注销不存在的工具不应报错", () => {
      expect(() => registry.unregister("nonexistent")).not.toThrow();
    });
  });

  // ==================== unregisterByServer ====================

  describe("unregisterByServer", () => {
    it("应注销指定 Server 的所有工具", () => {
      registry.registerBatch([
        createTool({ name: "a", serverId: "server-1" }),
        createTool({ name: "b", serverId: "server-1" }),
        createTool({ name: "c", serverId: "server-2" }),
      ]);
      expect(registry.size()).toBe(3);
      registry.unregisterByServer("server-1");
      expect(registry.size()).toBe(1);
      expect(registry.get("c")).toBeDefined();
      expect(registry.get("a")).toBeUndefined();
    });
  });

  // ==================== get ====================

  describe("get", () => {
    it("应返回已注册的工具", () => {
      registry.register(createTool({ name: "my_tool", description: "desc" }));
      const tool = registry.get("my_tool");
      expect(tool).toBeDefined();
      expect(tool!.description).toBe("desc");
    });

    it("不存在的工具应返回 undefined", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  // ==================== getByCategory ====================

  describe("getByCategory", () => {
    it("应按类别筛选工具", () => {
      registry.registerBatch([
        createTool({ name: "nav1", category: "navigation" }),
        createTool({ name: "nav2", category: "navigation" }),
        createTool({ name: "file1", category: "file_system" }),
        createTool({ name: "music1", category: "multimedia" }),
      ]);
      const navTools = registry.getByCategory("navigation");
      expect(navTools.length).toBe(2);
      expect(navTools.every((t) => t.category === "navigation")).toBe(true);
    });

    it("无匹配类别应返回空数组", () => {
      registry.register(createTool({ name: "a", category: "file_system" }));
      expect(registry.getByCategory("navigation").length).toBe(0);
    });
  });

  // ==================== getByServer ====================

  describe("getByServer", () => {
    it("应按 Server ID 筛选工具", () => {
      registry.registerBatch([
        createTool({ name: "a", serverId: "amap" }),
        createTool({ name: "b", serverId: "amap" }),
        createTool({ name: "c", serverId: "local" }),
      ]);
      const amapTools = registry.getByServer("amap");
      expect(amapTools.length).toBe(2);
    });
  });

  // ==================== getByNames ====================

  describe("getByNames", () => {
    it("应按名称列表获取工具", () => {
      registry.registerBatch([
        createTool({ name: "a" }),
        createTool({ name: "b" }),
        createTool({ name: "c" }),
      ]);
      const tools = registry.getByNames(["a", "c"]);
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name)).toEqual(["a", "c"]);
    });

    it("不存在的名称应被过滤", () => {
      registry.register(createTool({ name: "a" }));
      const tools = registry.getByNames(["a", "nonexistent"]);
      expect(tools.length).toBe(1);
    });

    it("空名称列表应返回空数组", () => {
      expect(registry.getByNames([]).length).toBe(0);
    });
  });

  // ==================== getAll ====================

  describe("getAll", () => {
    it("应返回所有已注册工具", () => {
      registry.registerBatch([
        createTool({ name: "a" }),
        createTool({ name: "b" }),
      ]);
      expect(registry.getAll().length).toBe(2);
    });

    it("空注册表应返回空数组", () => {
      expect(registry.getAll().length).toBe(0);
    });
  });

  // ==================== toLangGraphTools ====================

  describe("toLangGraphTools", () => {
    it("应将工具转换为 LangGraph 兼容格式", () => {
      registry.register(
        createTool({
          name: "search_files",
          description: "搜索文件",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        })
      );

      const lgTools = registry.toLangGraphTools(["search_files"]);
      expect(lgTools.length).toBe(1);
      expect(lgTools[0].type).toBe("function");
      expect(lgTools[0].function.name).toBe("search_files");
      expect(lgTools[0].function.description).toBe("搜索文件");
      expect(lgTools[0].function.parameters).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
      });
    });

    it("不存在的工具名应被过滤", () => {
      registry.register(createTool({ name: "a" }));
      const lgTools = registry.toLangGraphTools(["a", "nonexistent"]);
      expect(lgTools.length).toBe(1);
    });
  });

  // ==================== size & clear ====================

  describe("size & clear", () => {
    it("size 应返回正确的工具数量", () => {
      expect(registry.size()).toBe(0);
      registry.register(createTool({ name: "a" }));
      expect(registry.size()).toBe(1);
    });

    it("clear 应清空所有注册", () => {
      registry.registerBatch([
        createTool({ name: "a" }),
        createTool({ name: "b" }),
      ]);
      expect(registry.size()).toBe(2);
      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.getAll().length).toBe(0);
    });
  });

  // ==================== updateUtility (Phase 4 新增) ====================

  describe("updateUtility", () => {
    it("成功调用应提升效用分数", () => {
      registry.register(createTool({ name: "fast_tool" }));
      registry.updateUtility({
        toolName: "fast_tool",
        success: true,
        executionTimeMs: 100,
      });
      const tool = registry.get("fast_tool")!;
      expect(tool.utilityScore).toBeGreaterThan(0.5);
      expect(tool.successCount).toBe(1);
      expect(tool.failureCount).toBe(0);
      expect(tool.avgExecutionTimeMs).toBe(100);
    });

    it("失败调用应降低效用分数", () => {
      registry.register(createTool({ name: "bad_tool" }));
      registry.updateUtility({
        toolName: "bad_tool",
        success: false,
        executionTimeMs: 5000,
        errorMessage: "Connection timeout",
      });
      const tool = registry.get("bad_tool")!;
      expect(tool.utilityScore).toBeLessThan(0.5);
      expect(tool.successCount).toBe(0);
      expect(tool.failureCount).toBe(1);
    });

    it("慢但成功的调用应适度提升效用分数", () => {
      registry.register(createTool({ name: "slow_tool" }));
      registry.updateUtility({
        toolName: "slow_tool",
        success: true,
        executionTimeMs: 15000, // > 10s
      });
      const tool = registry.get("slow_tool")!;
      // 0.3 * 0.7 + 0.7 * 0.5 = 0.21 + 0.35 = 0.56
      expect(tool.utilityScore).toBeGreaterThan(0.5);
      expect(tool.utilityScore).toBeLessThan(0.65);
    });

    it("多次调用应累积更新", () => {
      registry.register(createTool({ name: "mixed_tool" }));
      // 3次成功
      for (let i = 0; i < 3; i++) {
        registry.updateUtility({
          toolName: "mixed_tool",
          success: true,
          executionTimeMs: 200,
        });
      }
      // 1次失败
      registry.updateUtility({
        toolName: "mixed_tool",
        success: false,
        executionTimeMs: 1000,
      });
      const tool = registry.get("mixed_tool")!;
      expect(tool.successCount).toBe(3);
      expect(tool.failureCount).toBe(1);
      // 效用分数应该仍然较高（3次成功 vs 1次失败）
      expect(tool.utilityScore).toBeGreaterThan(0.3);
    });

    it("效用分数不应低于 0.05", () => {
      registry.register(createTool({ name: "terrible_tool" }));
      // 连续失败 20 次
      for (let i = 0; i < 20; i++) {
        registry.updateUtility({
          toolName: "terrible_tool",
          success: false,
          executionTimeMs: 100,
        });
      }
      const tool = registry.get("terrible_tool")!;
      expect(tool.utilityScore).toBeGreaterThanOrEqual(0.05);
    });

    it("不存在的工具应静默跳过", () => {
      expect(() =>
        registry.updateUtility({
          toolName: "nonexistent",
          success: true,
          executionTimeMs: 100,
        })
      ).not.toThrow();
    });
  });

  // ==================== getRankedTools (Phase 4 新增) ====================

  describe("getRankedTools", () => {
    it("应按效用分数降序排列", () => {
      registry.register(createTool({ name: "low", utilityScore: 0.2 }));
      registry.register(createTool({ name: "high", utilityScore: 0.9 }));
      registry.register(createTool({ name: "mid", utilityScore: 0.5 }));

      const ranked = registry.getRankedTools();
      expect(ranked.length).toBe(3);
      expect(ranked[0].name).toBe("high");
      expect(ranked[1].name).toBe("mid");
      expect(ranked[2].name).toBe("low");
    });

    it("应支持按类别过滤", () => {
      registry.register(
        createTool({ name: "nav_high", category: "navigation", utilityScore: 0.9 })
      );
      registry.register(
        createTool({ name: "nav_low", category: "navigation", utilityScore: 0.3 })
      );
      registry.register(
        createTool({ name: "file_mid", category: "file_system", utilityScore: 0.6 })
      );

      const navRanked = registry.getRankedTools("navigation");
      expect(navRanked.length).toBe(2);
      expect(navRanked[0].name).toBe("nav_high");
      expect(navRanked[1].name).toBe("nav_low");
    });

    it("空注册表应返回空数组", () => {
      expect(registry.getRankedTools().length).toBe(0);
    });
  });
});
