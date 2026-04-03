/**
 * 文件整理大师 — 进程内执行实现（与 fileOrganizerTools 中 Server 模板逻辑一致）
 * 供 MCPManager 在 builtin-file-organizer 上直接调用，无需单独子进程。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  isPathAllowedForRead,
  isPathAllowedForWrite,
} from "./pathPolicy";

export const BUILTIN_FILE_ORGANIZER_SERVER_ID = "builtin-file-organizer";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

interface FileEntry {
  name: string;
  path: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
  createdAt: string;
}

function scanDirectory(dir: string, recursive = true): FileEntry[] {
  const results: FileEntry[] = [];
  const expandedDir = expandPath(dir);

  function scan(currentDir: string, depth = 0): void {
    try {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        if (item.startsWith(".")) continue;
        const fullPath = path.join(currentDir, item);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            if (recursive && depth < 10) {
              scan(fullPath, depth + 1);
            }
          } else {
            results.push({
              name: item,
              path: fullPath,
              extension:
                path.extname(item).toLowerCase().replace(".", "") || "(无扩展名)",
              size: stats.size,
              sizeFormatted: formatFileSize(stats.size),
              modifiedAt: stats.mtime.toISOString(),
              createdAt: stats.birthtime.toISOString(),
            });
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }

  scan(expandedDir);
  return results;
}

function getFileHash(filePath: string, quickMode = true): string {
  const CHUNK_SIZE = 4096;
  const stats = fs.statSync(filePath);

  if (quickMode && stats.size > 1024 * 1024) {
    const hash = crypto.createHash("md5");
    const fd = fs.openSync(filePath, "r");
    const headBuf = Buffer.alloc(CHUNK_SIZE);
    fs.readSync(fd, headBuf, 0, CHUNK_SIZE, 0);
    hash.update(headBuf);
    const tailBuf = Buffer.alloc(CHUNK_SIZE);
    fs.readSync(fd, tailBuf, 0, CHUNK_SIZE, stats.size - CHUNK_SIZE);
    hash.update(tailBuf);
    hash.update(stats.size.toString());
    fs.closeSync(fd);
    return hash.digest("hex");
  }

  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

async function analyzeDirectory(params: Record<string, unknown>) {
  const directory = params.directory as string;
  const topLargeFiles = (params.topLargeFiles as number) ?? 10;
  const olderThanDays = (params.olderThanDays as number) ?? 30;
  const recursive = (params.recursive as boolean) ?? true;

  const expandedDir = expandPath(directory);
  if (!isPathAllowedForRead(expandedDir)) {
    return {
      error:
        "路径不在允许扫描的范围内（用户主目录、系统临时目录等白名单）。请调整路径后重试。",
    };
  }
  if (!fs.existsSync(expandedDir)) {
    return { error: `目录不存在: ${directory}` };
  }

  const files = scanDirectory(directory, recursive);
  const typeMap = new Map<
    string,
    { extension: string; count: number; totalSize: number }
  >();
  for (const file of files) {
    const ext = file.extension;
    const entry = typeMap.get(ext) || { extension: ext, count: 0, totalSize: 0 };
    entry.count++;
    entry.totalSize += file.size;
    typeMap.set(ext, entry);
  }
  const typeStatistics = Array.from(typeMap.values())
    .map((t) => ({ ...t, totalSizeFormatted: formatFileSize(t.totalSize) }))
    .sort((a, b) => b.totalSize - a.totalSize);

  const ranges = [
    { range: "0-1MB", min: 0, max: 1024 * 1024 },
    { range: "1-10MB", min: 1024 * 1024, max: 10 * 1024 * 1024 },
    { range: "10-100MB", min: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
    { range: "100MB-1GB", min: 100 * 1024 * 1024, max: 1024 * 1024 * 1024 },
    { range: ">1GB", min: 1024 * 1024 * 1024, max: Infinity },
  ];
  const sizeRangeStatistics = ranges.map((r) => {
    const matching = files.filter((f) => f.size >= r.min && f.size < r.max);
    const totalSize = matching.reduce((sum, f) => sum + f.size, 0);
    return {
      range: r.range,
      count: matching.length,
      totalSize,
      totalSizeFormatted: formatFileSize(totalSize),
    };
  });

  const largeFiles = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, topLargeFiles);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const oldFiles = files
    .filter((f) => new Date(f.modifiedAt) < cutoffDate)
    .sort(
      (a, b) =>
        new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
    )
    .slice(0, 20);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    directory: expandedDir,
    totalFiles: files.length,
    totalSize,
    totalSizeFormatted: formatFileSize(totalSize),
    typeStatistics,
    sizeRangeStatistics,
    largeFiles,
    oldFiles,
  };
}

async function findDuplicates(params: Record<string, unknown>) {
  const directory = params.directory as string;
  const matchType = (params.matchType as string) ?? "both";
  const recursive = (params.recursive as boolean) ?? true;
  const expandedDir = expandPath(directory);

  if (!isPathAllowedForRead(expandedDir)) {
    return {
      error:
        "路径不在允许扫描的范围内（用户主目录、系统临时目录等白名单）。",
    };
  }

  if (!fs.existsSync(expandedDir)) {
    return { error: `目录不存在: ${directory}` };
  }

  const files = scanDirectory(directory, recursive);
  const result: Record<string, unknown> = {
    directory: expandedDir,
    sameNameGroups: [] as unknown[],
    exactDuplicateGroups: [] as unknown[],
    totalSameNameFiles: 0,
    totalExactDuplicates: 0,
    totalSavableSize: 0,
    totalSavableSizeFormatted: "0 B",
  };

  if (matchType === "name" || matchType === "both") {
    const nameMap = new Map<string, FileEntry[]>();
    for (const file of files) {
      const name = file.name;
      const group = nameMap.get(name) || [];
      group.push(file);
      nameMap.set(name, group);
    }
    const sameNameGroups: unknown[] = [];
    for (const [, group] of nameMap) {
      if (group.length > 1) {
        const totalSize = group.reduce((sum, f) => sum + f.size, 0);
        sameNameGroups.push({
          fileName: group[0].name,
          count: group.length,
          files: group,
          totalSize,
          totalSizeFormatted: formatFileSize(totalSize),
        });
        result.totalSameNameFiles =
          (result.totalSameNameFiles as number) + group.length;
      }
    }
    sameNameGroups.sort(
      (a: { count: number }, b: { count: number }) => b.count - a.count
    );
    result.sameNameGroups = sameNameGroups;
  }

  if (matchType === "hash" || matchType === "both") {
    const sizeMap = new Map<number, FileEntry[]>();
    for (const file of files) {
      if (file.size === 0) continue;
      const group = sizeMap.get(file.size) || [];
      group.push(file);
      sizeMap.set(file.size, group);
    }
    const exactDuplicateGroups: unknown[] = [];
    let totalSavableSize = 0;
    for (const [size, group] of sizeMap) {
      if (group.length < 2) continue;
      const hashMap = new Map<string, FileEntry[]>();
      for (const file of group) {
        try {
          const hash = getFileHash(file.path);
          const hg = hashMap.get(hash) || [];
          hg.push(file);
          hashMap.set(hash, hg);
        } catch {
          /* skip */
        }
      }
      for (const [fileHash, hashGroup] of hashMap) {
        if (hashGroup.length > 1) {
          const savableSize = size * (hashGroup.length - 1);
          exactDuplicateGroups.push({
            hash: fileHash,
            size,
            sizeFormatted: formatFileSize(size),
            count: hashGroup.length,
            files: hashGroup,
            savableSize,
            savableSizeFormatted: formatFileSize(savableSize),
          });
          result.totalExactDuplicates =
            (result.totalExactDuplicates as number) + hashGroup.length;
          totalSavableSize += savableSize;
        }
      }
    }
    exactDuplicateGroups.sort(
      (a: { savableSize: number }, b: { savableSize: number }) =>
        b.savableSize - a.savableSize
    );
    result.exactDuplicateGroups = exactDuplicateGroups;
    result.totalSavableSize = totalSavableSize;
    result.totalSavableSizeFormatted = formatFileSize(totalSavableSize);
  }

  return result;
}

async function deleteFiles(params: Record<string, unknown>) {
  const filePaths = params.filePaths as string[];
  const moveToTrash = (params.moveToTrash as boolean) ?? true;
  const result = {
    successCount: 0,
    failedCount: 0,
    freedSize: 0,
    freedSizeFormatted: "0 B",
    errors: [] as { path: string; error: string }[],
  };

  for (const filePath of filePaths) {
    const expanded = expandPath(filePath);
    if (!isPathAllowedForWrite(expanded)) {
      result.failedCount++;
      result.errors.push({
        path: filePath,
        error: "路径不在允许删除/移动的范围内（当前策略：仅用户主目录内）。",
      });
      continue;
    }
    try {
      if (!fs.existsSync(expanded)) {
        result.failedCount++;
        result.errors.push({ path: filePath, error: "文件不存在" });
        continue;
      }
      const stats = fs.statSync(expanded);
      const fileSize = stats.size;
      if (moveToTrash) {
        const trashDir = path.join(os.homedir(), ".Trash_SmartAgent");
        if (!fs.existsSync(trashDir)) {
          fs.mkdirSync(trashDir, { recursive: true });
        }
        const trashName = `${Date.now()}_${path.basename(expanded)}`;
        fs.renameSync(expanded, path.join(trashDir, trashName));
      } else {
        fs.unlinkSync(expanded);
      }
      result.successCount++;
      result.freedSize += fileSize;
    } catch (e) {
      result.failedCount++;
      result.errors.push({
        path: filePath,
        error: (e as Error).message,
      });
    }
  }
  result.freedSizeFormatted = formatFileSize(result.freedSize);
  return result;
}

async function moveFiles(params: Record<string, unknown>) {
  const sourcePaths = params.sourcePaths as string[];
  const destinationDir = params.destinationDir as string;
  const expandedDest = expandPath(destinationDir);
  const result = {
    successCount: 0,
    failedCount: 0,
    errors: [] as { path: string; error: string }[],
  };

  if (!isPathAllowedForWrite(expandedDest)) {
    return {
      successCount: 0,
      failedCount: sourcePaths.length,
      errors: [
        {
          path: destinationDir,
          error: "目标目录必须在用户主目录内（安全策略）。",
        },
      ],
    };
  }

  if (!fs.existsSync(expandedDest)) {
    fs.mkdirSync(expandedDest, { recursive: true });
  }

  for (const sourcePath of sourcePaths) {
    const expanded = expandPath(sourcePath);
    if (!isPathAllowedForWrite(expanded)) {
      result.failedCount++;
      result.errors.push({
        path: sourcePath,
        error: "源路径不在允许移动的范围内（当前策略：仅用户主目录内）。",
      });
      continue;
    }
    try {
      if (!fs.existsSync(expanded)) {
        result.failedCount++;
        result.errors.push({ path: sourcePath, error: "文件不存在" });
        continue;
      }
      let destPath = path.join(expandedDest, path.basename(expanded));
      if (fs.existsSync(destPath)) {
        const ext = path.extname(destPath);
        const base = path.basename(destPath, ext);
        destPath = path.join(expandedDest, `${base}_${Date.now()}${ext}`);
      }
      fs.renameSync(expanded, destPath);
      result.successCount++;
    } catch (e) {
      result.failedCount++;
      result.errors.push({
        path: sourcePath,
        error: (e as Error).message,
      });
    }
  }
  return result;
}

function getDiskHealth(params: Record<string, unknown>) {
  const raw = ((params.driveLetter as string) || "C").replace(/[:\\]/g, "");
  const driveLetter = (raw || "C").toUpperCase().slice(0, 1);

  if (process.platform !== "win32") {
    try {
      const out = execFileSync("df", ["-h", "/"], {
        encoding: "utf-8",
        timeout: 5000,
      });
      return {
        platform: process.platform,
        df: out.trim(),
        note: "非 Windows：已返回根分区 df 摘要",
      };
    } catch (e) {
      return { platform: process.platform, error: (e as Error).message };
    }
  }

  try {
    const script = `$d = Get-PSDrive -Name '${driveLetter}' -ErrorAction Stop; $cap = $d.Used + $d.Free; [PSCustomObject]@{ UsedGB = [math]::Round($d.Used/1GB,2); FreeGB = [math]::Round($d.Free/1GB,2); CapacityGB = [math]::Round($cap/1GB,2); PercentFree = if($cap -gt 0){[math]::Round(100*$d.Free/$cap,1)}else{0} } | ConvertTo-Json`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf-8",
      timeout: 20000,
    });
    const j = JSON.parse(out.trim()) as {
      UsedGB: number;
      FreeGB: number;
      CapacityGB: number;
      PercentFree: number;
    };
    const pct = j.PercentFree ?? 0;
    let health: "good" | "low_space" | "critical" = "good";
    if (pct < 10) health = "low_space";
    if (pct < 5) health = "critical";
    return {
      drive: `${driveLetter}:`,
      usedGB: j.UsedGB,
      freeGB: j.FreeGB,
      capacityGB: j.CapacityGB,
      percentFree: pct,
      health,
      message:
        health === "good"
          ? "剩余空间充足"
          : health === "low_space"
            ? "剩余空间偏低，建议清理"
            : "剩余空间极少，请尽快清理",
    };
  } catch (e) {
    return { error: (e as Error).message, drive: `${driveLetter}:` };
  }
}

function roughDirSize(dir: string, maxFiles: number): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  function walk(d: string, depth: number): void {
    if (files >= maxFiles) return;
    try {
      const list = fs.readdirSync(d);
      for (const name of list) {
        if (files >= maxFiles) return;
        const p = path.join(d, name);
        try {
          const st = fs.statSync(p);
          if (st.isDirectory()) {
            if (depth < 5) walk(p, depth + 1);
          } else {
            files++;
            bytes += st.size;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }
  walk(dir, 0);
  return { files, bytes };
}

function scanSystemJunk(params: Record<string, unknown>) {
  const maxFilesPerRoot = (params.maxFilesPerRoot as number) ?? 8000;
  const includeBrowserCaches = (params.includeBrowserCaches as boolean) ?? false;

  const roots: { label: string; path: string }[] = [];
  roots.push({ label: "os.tmpdir", path: os.tmpdir() });
  roots.push({ label: "用户下载", path: path.join(os.homedir(), "Downloads") });

  if (process.platform === "win32") {
    roots.push({ label: "Windows\\Temp", path: "C:\\Windows\\Temp" });
    if (process.env.LOCALAPPDATA) {
      roots.push({
        label: "LocalAppData\\Temp",
        path: path.join(process.env.LOCALAPPDATA, "Temp"),
      });
      if (includeBrowserCaches) {
        roots.push({
          label: "Chrome\\Default\\Cache",
          path: path.join(
            process.env.LOCALAPPDATA,
            "Google",
            "Chrome",
            "User Data",
            "Default",
            "Cache"
          ),
        });
      }
    }
  }

  const locations: unknown[] = [];
  for (const { label, path: dir } of roots) {
    const exp = path.resolve(expandPath(dir));
    if (!isPathAllowedForRead(exp)) continue;
    if (!fs.existsSync(exp)) {
      locations.push({
        label,
        path: exp,
        skipped: true,
        reason: "路径不存在或不可访问",
      });
      continue;
    }
    const { files, bytes } = roughDirSize(exp, maxFilesPerRoot);
    locations.push({
      label,
      path: exp,
      scannedFileCount: files,
      estimatedBytes: bytes,
      estimatedSize: formatFileSize(bytes),
      truncated: files >= maxFilesPerRoot,
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    platform: process.platform,
    locations,
  };
}

function executeAdvancedCleanup(_params: Record<string, unknown>) {
  return {
    mode: "preview_only",
    requiresAdmin: true,
    warnings: [
      "以下命令可能影响系统更新与稳定性，仅限有经验用户在管理员终端手动执行。",
      "本工具不会自动运行 cleanmgr / DISM / 任何提权操作。",
    ],
    windowsSuggestions: [
      { step: 1, title: "磁盘清理向导", command: "cleanmgr /d C:" },
      {
        step: 2,
        title: "分析组件存储 (只读分析)",
        command: "DISM /Online /Cleanup-Image /AnalyzeComponentStore",
      },
      {
        step: 3,
        title: "组件存储清理（高风险，谨慎）",
        command: "DISM /Online /Cleanup-Image /StartComponentCleanup",
      },
    ],
    note: "WinSxS 相关清理请先备份重要数据并查阅微软官方文档。",
  };
}

/**
 * 供 MCPManager 调用的统一入口
 */
export async function callFileOrganizerTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  let data: unknown;
  switch (toolName) {
    case "analyze_directory":
      data = await analyzeDirectory(args);
      break;
    case "find_duplicates":
      data = await findDuplicates(args);
      break;
    case "delete_files":
      data = await deleteFiles(args);
      break;
    case "move_files":
      data = await moveFiles(args);
      break;
    case "get_disk_health":
      data = getDiskHealth(args);
      break;
    case "scan_system_junk":
      data = scanSystemJunk(args);
      break;
    case "execute_advanced_cleanup":
      data = executeAdvancedCleanup(args);
      break;
    default:
      throw new Error(`Unknown file organizer tool: ${toolName}`);
  }
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}
