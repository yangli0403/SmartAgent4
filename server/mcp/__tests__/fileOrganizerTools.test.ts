/**
 * File Organizer Tools — 单元测试
 *
 * 测试工具定义的正确性和注册机制。
 */

import { describe, it, expect } from "vitest";
import {
  analyzeDirectoryTool,
  findDuplicatesTool,
  deleteFilesTool,
  moveFilesTool,
  getDiskHealthTool,
  scanSystemJunkTool,
  executeAdvancedCleanupTool,
} from "../fileOrganizerTools";
import { registerFileOrganizerTools } from "../fileOrganizerRegistration";
import { ToolRegistry } from "../toolRegistry";

// ==================== 工具定义测试 ====================

describe("File Organizer Tool Definitions", () => {
  it("analyze_directory 工具应有正确的名称和参数", () => {
    expect(analyzeDirectoryTool.name).toBe("analyze_directory");
    expect(analyzeDirectoryTool.description).toBeTruthy();

    // 验证参数 Schema
    const parsed = analyzeDirectoryTool.parameters.safeParse({
      directory: "~/Downloads",
    });
    expect(parsed.success).toBe(true);
  });

  it("analyze_directory 应接受所有可选参数", () => {
    const parsed = analyzeDirectoryTool.parameters.safeParse({
      directory: "~/Downloads",
      topLargeFiles: 20,
      olderThanDays: 60,
      recursive: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.topLargeFiles).toBe(20);
      expect(parsed.data.olderThanDays).toBe(60);
      expect(parsed.data.recursive).toBe(false);
    }
  });

  it("find_duplicates 工具应支持三种匹配类型", () => {
    expect(findDuplicatesTool.name).toBe("find_duplicates");

    for (const matchType of ["name", "hash", "both"]) {
      const parsed = findDuplicatesTool.parameters.safeParse({
        directory: "~/Downloads",
        matchType,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("find_duplicates 应拒绝无效的匹配类型", () => {
    const parsed = findDuplicatesTool.parameters.safeParse({
      directory: "~/Downloads",
      matchType: "invalid",
    });
    expect(parsed.success).toBe(false);
  });

  it("delete_files 工具应要求文件路径列表", () => {
    expect(deleteFilesTool.name).toBe("delete_files");

    // 缺少必填参数
    const parsed1 = deleteFilesTool.parameters.safeParse({});
    expect(parsed1.success).toBe(false);

    // 正确参数
    const parsed2 = deleteFilesTool.parameters.safeParse({
      filePaths: ["/home/user/Downloads/file1.txt", "/home/user/Downloads/file2.pdf"],
      moveToTrash: true,
    });
    expect(parsed2.success).toBe(true);
  });

  it("delete_files 描述中应包含安全警告", () => {
    expect(deleteFilesTool.description).toContain("确认");
  });

  it("move_files 工具应要求源路径和目标目录", () => {
    expect(moveFilesTool.name).toBe("move_files");

    const parsed = moveFilesTool.parameters.safeParse({
      sourcePaths: ["/home/user/Downloads/file1.txt"],
      destinationDir: "/home/user/Documents/归档",
    });
    expect(parsed.success).toBe(true);
  });

  it("get_disk_health 应接受可选盘符", () => {
    expect(getDiskHealthTool.name).toBe("get_disk_health");
    const p = getDiskHealthTool.parameters.safeParse({ driveLetter: "D" });
    expect(p.success).toBe(true);
  });

  it("scan_system_junk 应支持浏览器缓存开关", () => {
    expect(scanSystemJunkTool.name).toBe("scan_system_junk");
    const p = scanSystemJunkTool.parameters.safeParse({
      maxFilesPerRoot: 1000,
      includeBrowserCaches: true,
    });
    expect(p.success).toBe(true);
  });

  it("execute_advanced_cleanup 为预览模式", () => {
    expect(executeAdvancedCleanupTool.name).toBe("execute_advanced_cleanup");
    expect(executeAdvancedCleanupTool.description).toContain("不执行");
  });
});

// ==================== 工具注册测试 ====================

describe("File Organizer Registration", () => {
  it("应该成功注册 7 个文件整理相关工具", () => {
    const registry = new ToolRegistry();
    registerFileOrganizerTools(registry);

    expect(registry.size()).toBe(7);
    expect(registry.get("analyze_directory")).toBeDefined();
    expect(registry.get("find_duplicates")).toBeDefined();
    expect(registry.get("delete_files")).toBeDefined();
    expect(registry.get("move_files")).toBeDefined();
    expect(registry.get("get_disk_health")).toBeDefined();
    expect(registry.get("scan_system_junk")).toBeDefined();
    expect(registry.get("execute_advanced_cleanup")).toBeDefined();
  });

  it("注册的工具应属于 file_system 类别", () => {
    const registry = new ToolRegistry();
    registerFileOrganizerTools(registry);

    const tools = registry.getByCategory("file_system");
    expect(tools.length).toBe(7);
  });

  it("注册的工具应属于 builtin-file-organizer 服务", () => {
    const registry = new ToolRegistry();
    registerFileOrganizerTools(registry);

    const tools = registry.getByServer("builtin-file-organizer");
    expect(tools.length).toBe(7);
  });

  it("注册的工具应包含有效的 inputSchema", () => {
    const registry = new ToolRegistry();
    registerFileOrganizerTools(registry);

    const tool = registry.get("analyze_directory");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema).toHaveProperty("type", "object");
    expect(tool!.inputSchema).toHaveProperty("properties");
  });
});
