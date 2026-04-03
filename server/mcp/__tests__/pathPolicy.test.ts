/**
 * pathPolicy — 白名单路径策略
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  getAllowedReadRoots,
  isPathAllowedForRead,
  isPathAllowedForWrite,
} from "../pathPolicy";

describe("pathPolicy", () => {
  it("getAllowedReadRoots 应包含用户主目录与临时目录", () => {
    const roots = getAllowedReadRoots();
    const home = path.resolve(os.homedir());
    const tmp = path.resolve(os.tmpdir());
    expect(roots).toContain(home);
    expect(roots).toContain(tmp);
  });

  it("主目录下路径应允许读与写", () => {
    const sub = path.join(os.homedir(), "Documents", "test-sub");
    expect(isPathAllowedForRead(sub)).toBe(true);
    expect(isPathAllowedForWrite(sub)).toBe(true);
  });

  it("Windows 系统目录可读时应在白名单内（若存在）", () => {
    if (process.platform !== "win32") {
      expect(true).toBe(true);
      return;
    }
    const winTemp = "C:\\Windows\\Temp";
    expect(isPathAllowedForRead(winTemp)).toBe(true);
    expect(isPathAllowedForWrite(winTemp)).toBe(false);
  });
});
