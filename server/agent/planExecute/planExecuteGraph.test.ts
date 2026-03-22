/**
 * Plan-and-Execute 改造验收测试
 * 使用测试样例中的「约束搜索」「跨域任务」数据，验证图编排与执行结果。
 *
 * 数据来源：
 * - 约束搜索：MCP_TEST_SCENARIOS.md 场景1
 * - 跨域任务：MCP_TEST_SCENARIOS.md 场景7
 */

import { describe, it, expect } from "vitest";
import { detectTaskType } from "../tasks";
import { createPlanExecuteGraph } from "./planExecuteGraph";
import type { ToolExecutor } from "../tasks/types";

/** 约束搜索 - 来自 MCP_TEST_SCENARIOS 场景1 */
const CONSTRAINT_SEARCH_INPUT = "帮我找一下昨天下载的ppt文件并打开修改时间最新的一个";

/** 跨域任务 - 来自 MCP_TEST_SCENARIOS 场景7（文件 + 浏览器） */
const CROSS_DOMAIN_INPUT = "帮我找一下桌面上的所有PDF文件，打开最大的那个，然后用Chrome打开";

/** 创建 mock executor：记录调用并返回合理结果，便于断言 */
function createMockExecutor(callLog: { tool: string; params: Record<string, unknown> }[]) {
  const executor: ToolExecutor = {
    executeTool: async (toolName: string, params: Record<string, unknown>) => {
      callLog.push({ tool: toolName, params: { ...params } });
      if (toolName === "search_files") {
        return { success: true, total: 1, files: [{ path: "C:\\Users\\Test\\Downloads\\demo.pptx", name: "demo.pptx" }] };
      }
      if (toolName === "open_file") {
        return { success: true, message: "已打开文件" };
      }
      if (toolName === "create_folder") {
        return { success: true, path: "C:\\Users\\Test\\Downloads\\备份", message: "已创建文件夹" };
      }
      if (toolName === "copy_files") {
        return { success: true, copied: [], message: "已拷贝" };
      }
      if (toolName === "browser_control") {
        return { success: true, message: "浏览器已打开" };
      }
      return { success: true };
    },
  };
  return executor;
}

describe("Plan-Execute 改造验收", () => {
  describe("任务类型检测", () => {
    it("约束搜索样例应识别为 complex_conditional", () => {
      const type = detectTaskType(CONSTRAINT_SEARCH_INPUT);
      expect(type).toBe("complex_conditional");
    });

    it("跨域任务样例应识别为 cross_domain", () => {
      const type = detectTaskType(CROSS_DOMAIN_INPUT);
      expect(type).toBe("cross_domain");
    });
  });

  describe("约束搜索（complex_conditional）", () => {
    it("图应产出 search_files + open_file 步骤并顺序执行成功", async () => {
      const callLog: { tool: string; params: Record<string, unknown> }[] = [];
      const executor = createMockExecutor(callLog);
      const graph = createPlanExecuteGraph(executor);

      const finalState = await graph.invoke({
        taskType: "complex_conditional",
        userInput: CONSTRAINT_SEARCH_INPUT,
        options: { defaultSearchDirectory: "~/Downloads" },
      });

      expect(finalState.plan).toBeDefined();
      expect(Array.isArray(finalState.plan)).toBe(true);
      const toolNames = (finalState.plan ?? []).map((s: { tool: string }) => s.tool);
      expect(toolNames).toContain("search_files");
      expect(toolNames).toContain("open_file");

      expect(finalState.success).toBe(true);
      expect(finalState.outputs).toBeDefined();
      expect(Array.isArray(finalState.outputs)).toBe(true);
      expect((finalState.outputs ?? []).length).toBe(finalState.plan?.length ?? 0);

      expect(callLog.length).toBe(finalState.plan?.length ?? 0);
      expect(callLog.map(c => c.tool)).toEqual(toolNames);
      expect(callLog[0].tool).toBe("search_files");
      expect(callLog[1].tool).toBe("open_file");
      expect(finalState.summary).toBeDefined();
      expect(typeof finalState.summary).toBe("string");
    });
  });

  describe("跨域任务（cross_domain）", () => {
    it("图应产出 plan 与 stepsByDomain，并顺序执行成功", async () => {
      const callLog: { tool: string; params: Record<string, unknown> }[] = [];
      const executor = createMockExecutor(callLog);
      const graph = createPlanExecuteGraph(executor);

      const finalState = await graph.invoke({
        taskType: "cross_domain",
        userInput: CROSS_DOMAIN_INPUT,
        options: { defaultSearchDirectory: "~/Downloads", domains: ["fileSystem", "appBrowser"] },
      });

      expect(finalState.plan).toBeDefined();
      expect(Array.isArray(finalState.plan)).toBe(true);
      expect((finalState.plan ?? []).length).toBeGreaterThan(0);

      expect(finalState.stepsByDomain).toBeDefined();
      expect(typeof finalState.stepsByDomain).toBe("object");

      expect(finalState.success).toBe(true);
      expect(finalState.outputs).toBeDefined();
      expect((finalState.outputs ?? []).length).toBe(finalState.plan?.length ?? 0);

      expect(callLog.length).toBe(finalState.plan?.length ?? 0);
      expect(finalState.summary).toBeDefined();
    });
  });
});
