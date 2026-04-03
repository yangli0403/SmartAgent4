/**
 * 路径安全策略 — 白名单读写范围（C 盘维护 / 垃圾扫描）
 */

import path from "node:path";
import os from "node:os";

const home = () => path.resolve(os.homedir());

/** 允许读取扫描的路径前缀（规范化后比较） */
export function getAllowedReadRoots(): string[] {
  const roots: string[] = [home()];

  const tmp = path.resolve(os.tmpdir());
  roots.push(tmp);

  if (process.platform === "win32") {
    roots.push(path.resolve("C:\\Windows\\Temp"));
    const local = process.env.LOCALAPPDATA;
    if (local) roots.push(path.resolve(local, "Temp"));
    const programData = process.env.ProgramData;
    if (programData) roots.push(path.resolve(programData));
  }

  return [...new Set(roots.map((r) => path.resolve(r)))];
}

function normalize(p: string): string {
  return path.resolve(path.normalize(p.trim()));
}

/**
 * 路径是否允许读取（目录列举、统计大小等）
 */
export function isPathAllowedForRead(inputPath: string): boolean {
  const resolved = normalize(expandTilde(inputPath));
  const roots = getAllowedReadRoots();
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/**
 * 路径是否允许写入（删除、移动目标等）— 默认仅用户主目录内
 */
export function isPathAllowedForWrite(inputPath: string): boolean {
  const resolved = normalize(expandTilde(inputPath));
  const h = home();
  return resolved === h || resolved.startsWith(h + path.sep);
}

function expandTilde(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1).replace(/^[\\/]+/, ""));
  }
  return p;
}

/**
 * 兼容旧名：原 isPathSafe 仅 home；现读操作用 isPathAllowedForRead，写操作用 isPathAllowedForWrite
 */
export function isPathSafeLegacyHomeOnly(filePath: string): boolean {
  const resolved = normalize(expandTilde(filePath));
  const h = home();
  return resolved === h || resolved.startsWith(h + path.sep);
}
