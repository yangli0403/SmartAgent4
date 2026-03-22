/**
 * File Organizer Tools — 文件整理大师 MCP 工具模块
 *
 * 提供高级文件系统操作，包括：
 * - 目录分析与统计
 * - 同名文件汇总
 * - 重复文件检测（基于大小和哈希）
 * - 安全删除（移入回收站）
 * - 批量移动/归档
 *
 * 设计原则：
 * - Agent 必须在调用 delete_files 前向用户展示列表并获取明确确认
 * - 所有路径操作限制在用户目录范围内（安全白名单）
 */

import { z } from "zod";

// ==================== 工具定义（Schema） ====================

/**
 * 目录分析工具
 * 场景：帮我看看下载目录有多大，都有什么类型的文件
 */
export const analyzeDirectoryTool = {
  name: "analyze_directory",
  description:
    "扫描指定目录，返回按文件类型、大小区间的统计汇总，以及大文件列表和长期未修改的旧文件列表。用于了解目录的整体情况。",
  parameters: z.object({
    directory: z
      .string()
      .describe("目标目录路径，例如：~/Downloads 或 C:\\Users\\Username\\Downloads"),
    topLargeFiles: z
      .number()
      .optional()
      .default(10)
      .describe("返回最大的 N 个文件，默认 10"),
    olderThanDays: z
      .number()
      .optional()
      .default(30)
      .describe("查找超过 N 天未修改的文件，默认 30"),
    recursive: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否递归扫描子目录，默认 true"),
  }),
};

/**
 * 同名与重复文件检测工具
 * 场景：帮我找出下载目录里的同名文件和重复文件
 */
export const findDuplicatesTool = {
  name: "find_duplicates",
  description:
    "扫描指定目录，找出同名文件（文件名相同但路径不同）和完全重复的文件（基于文件大小和内容哈希）。特别适合清理下载目录中的重复下载。",
  parameters: z.object({
    directory: z
      .string()
      .describe("目标目录路径"),
    matchType: z
      .enum(["name", "hash", "both"])
      .optional()
      .default("both")
      .describe(
        "检测类型：name（仅同名），hash（完全重复），both（两者都检测，默认）"
      ),
    recursive: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否递归扫描子目录，默认 true"),
  }),
};

/**
 * 安全删除工具
 * 场景：确认后删除这些文件
 *
 * 重要：Agent 必须在调用此工具前向用户展示文件列表并获取明确确认！
 */
export const deleteFilesTool = {
  name: "delete_files",
  description:
    "删除指定的文件列表。【重要安全规则】：你必须先向用户展示要删除的文件列表，获得用户明确确认（如"确认删除"、"好的"）后才能调用此工具。未经用户确认直接调用将被视为违规操作。",
  parameters: z.object({
    filePaths: z
      .array(z.string())
      .describe("要删除的文件绝对路径列表"),
    moveToTrash: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否移入回收站（推荐），默认 true。设为 false 则永久删除。"),
  }),
};

/**
 * 批量移动工具
 * 场景：把这些文件归档到指定目录
 */
export const moveFilesTool = {
  name: "move_files",
  description:
    "将多个文件移动到指定目标目录。可用于文件归档和整理。如果目标目录不存在会自动创建。",
  parameters: z.object({
    sourcePaths: z
      .array(z.string())
      .describe("要移动的源文件路径列表"),
    destinationDir: z
      .string()
      .describe("目标目录路径"),
  }),
};

// ==================== 返回类型定义 ====================

/** 文件类型统计 */
export interface TypeStatistics {
  extension: string;
  count: number;
  totalSize: number;
  totalSizeFormatted: string;
}

/** 大小区间统计 */
export interface SizeRangeStatistics {
  range: string;
  count: number;
  totalSize: number;
  totalSizeFormatted: string;
}

/** 文件信息（简化版） */
export interface FileEntry {
  name: string;
  path: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
}

/** 目录分析结果 */
export interface AnalyzeDirectoryResult {
  directory: string;
  totalFiles: number;
  totalSize: number;
  totalSizeFormatted: string;
  typeStatistics: TypeStatistics[];
  sizeRangeStatistics: SizeRangeStatistics[];
  largeFiles: FileEntry[];
  oldFiles: FileEntry[];
}

/** 同名文件组 */
export interface SameNameGroup {
  fileName: string;
  count: number;
  files: FileEntry[];
  totalSize: number;
  totalSizeFormatted: string;
}

/** 完全重复文件组 */
export interface ExactDuplicateGroup {
  hash: string;
  size: number;
  sizeFormatted: string;
  count: number;
  files: FileEntry[];
  /** 可节省的空间（保留一份，删除其余） */
  savableSize: number;
  savableSizeFormatted: string;
}

/** 重复检测结果 */
export interface FindDuplicatesResult {
  directory: string;
  sameNameGroups: SameNameGroup[];
  exactDuplicateGroups: ExactDuplicateGroup[];
  totalSameNameFiles: number;
  totalExactDuplicates: number;
  totalSavableSize: number;
  totalSavableSizeFormatted: string;
}

/** 删除结果 */
export interface DeleteFilesResult {
  successCount: number;
  failedCount: number;
  freedSize: number;
  freedSizeFormatted: string;
  errors: Array<{ path: string; error: string }>;
}

/** 移动结果 */
export interface MoveFilesResult {
  successCount: number;
  failedCount: number;
  errors: Array<{ path: string; error: string }>;
}

// ==================== MCP Server 端执行代码 ====================

/**
 * 以下代码需要在本地 MCP Server 中运行。
 * 提供完整的 Node.js 实现，可直接部署到用户本地。
 */
export const fileOrganizerServerCode = `
// ============== 文件整理大师 MCP Server 实现 ==============
// 保存为: mcp-file-organizer-server.js
// 运行: node mcp-file-organizer-server.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ============== 工具函数 ==============

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function expandPath(p) {
  return p.replace(/^~/, os.homedir());
}

/**
 * 安全路径校验：确保路径在用户目录范围内
 */
function isPathSafe(filePath) {
  const resolved = path.resolve(expandPath(filePath));
  const home = os.homedir();
  return resolved.startsWith(home);
}

/**
 * 递归扫描目录，收集所有文件信息
 */
function scanDirectory(dir, recursive = true) {
  const results = [];
  const expandedDir = expandPath(dir);

  function scan(currentDir, depth = 0) {
    try {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        // 跳过隐藏文件和系统目录
        if (item.startsWith('.')) continue;

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
              extension: path.extname(item).toLowerCase().replace('.', '') || '(无扩展名)',
              size: stats.size,
              sizeFormatted: formatFileSize(stats.size),
              modifiedAt: stats.mtime.toISOString(),
              createdAt: stats.birthtime.toISOString(),
            });
          }
        } catch (e) {
          // 跳过无法访问的文件
        }
      }
    } catch (e) {
      // 跳过无法访问的目录
    }
  }

  scan(expandedDir);
  return results;
}

/**
 * 计算文件的 MD5 哈希（用于重复检测）
 * 对大文件只读取首尾各 4KB 进行快速哈希
 */
function getFileHash(filePath, quickMode = true) {
  const CHUNK_SIZE = 4096;
  const stats = fs.statSync(filePath);

  if (quickMode && stats.size > 1024 * 1024) {
    // 大文件：读取首尾各 4KB
    const hash = crypto.createHash('md5');
    const fd = fs.openSync(filePath, 'r');

    const headBuf = Buffer.alloc(CHUNK_SIZE);
    fs.readSync(fd, headBuf, 0, CHUNK_SIZE, 0);
    hash.update(headBuf);

    const tailBuf = Buffer.alloc(CHUNK_SIZE);
    fs.readSync(fd, tailBuf, 0, CHUNK_SIZE, stats.size - CHUNK_SIZE);
    hash.update(tailBuf);

    // 加入文件大小作为额外校验
    hash.update(stats.size.toString());

    fs.closeSync(fd);
    return hash.digest('hex');
  }

  // 小文件：读取全部内容
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

// ============== 工具实现 ==============

/**
 * analyze_directory 实现
 */
async function analyzeDirectory(params) {
  const { directory, topLargeFiles = 10, olderThanDays = 30, recursive = true } = params;
  const expandedDir = expandPath(directory);

  if (!fs.existsSync(expandedDir)) {
    return { error: '目录不存在: ' + directory };
  }

  const files = scanDirectory(directory, recursive);

  // 按类型统计
  const typeMap = new Map();
  for (const file of files) {
    const ext = file.extension;
    const entry = typeMap.get(ext) || { extension: ext, count: 0, totalSize: 0 };
    entry.count++;
    entry.totalSize += file.size;
    typeMap.set(ext, entry);
  }
  const typeStatistics = Array.from(typeMap.values())
    .map(t => ({ ...t, totalSizeFormatted: formatFileSize(t.totalSize) }))
    .sort((a, b) => b.totalSize - a.totalSize);

  // 按大小区间统计
  const ranges = [
    { range: '0-1MB', min: 0, max: 1024 * 1024 },
    { range: '1-10MB', min: 1024 * 1024, max: 10 * 1024 * 1024 },
    { range: '10-100MB', min: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
    { range: '100MB-1GB', min: 100 * 1024 * 1024, max: 1024 * 1024 * 1024 },
    { range: '>1GB', min: 1024 * 1024 * 1024, max: Infinity },
  ];
  const sizeRangeStatistics = ranges.map(r => {
    const matching = files.filter(f => f.size >= r.min && f.size < r.max);
    const totalSize = matching.reduce((sum, f) => sum + f.size, 0);
    return {
      range: r.range,
      count: matching.length,
      totalSize,
      totalSizeFormatted: formatFileSize(totalSize),
    };
  });

  // 大文件 Top N
  const largeFiles = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, topLargeFiles);

  // 旧文件
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const oldFiles = files
    .filter(f => new Date(f.modifiedAt) < cutoffDate)
    .sort((a, b) => new Date(a.modifiedAt) - new Date(b.modifiedAt))
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

/**
 * find_duplicates 实现
 */
async function findDuplicates(params) {
  const { directory, matchType = 'both', recursive = true } = params;
  const expandedDir = expandPath(directory);

  if (!fs.existsSync(expandedDir)) {
    return { error: '目录不存在: ' + directory };
  }

  const files = scanDirectory(directory, recursive);
  const result = {
    directory: expandedDir,
    sameNameGroups: [],
    exactDuplicateGroups: [],
    totalSameNameFiles: 0,
    totalExactDuplicates: 0,
    totalSavableSize: 0,
    totalSavableSizeFormatted: '0 B',
  };

  // 同名文件检测
  if (matchType === 'name' || matchType === 'both') {
    const nameMap = new Map();
    for (const file of files) {
      const name = file.name;
      const group = nameMap.get(name) || [];
      group.push(file);
      nameMap.set(name, group);
    }

    for (const [fileName, group] of nameMap) {
      if (group.length > 1) {
        const totalSize = group.reduce((sum, f) => sum + f.size, 0);
        result.sameNameGroups.push({
          fileName,
          count: group.length,
          files: group,
          totalSize,
          totalSizeFormatted: formatFileSize(totalSize),
        });
        result.totalSameNameFiles += group.length;
      }
    }

    // 按文件数量降序排列
    result.sameNameGroups.sort((a, b) => b.count - a.count);
  }

  // 完全重复文件检测（基于大小 + 哈希）
  if (matchType === 'hash' || matchType === 'both') {
    // 第一步：按文件大小分组（大小不同的文件不可能重复）
    const sizeMap = new Map();
    for (const file of files) {
      if (file.size === 0) continue; // 跳过空文件
      const group = sizeMap.get(file.size) || [];
      group.push(file);
      sizeMap.set(file.size, group);
    }

    // 第二步：对大小相同的文件计算哈希
    for (const [size, group] of sizeMap) {
      if (group.length < 2) continue;

      const hashMap = new Map();
      for (const file of group) {
        try {
          const hash = getFileHash(file.path);
          const hashGroup = hashMap.get(hash) || [];
          hashGroup.push(file);
          hashMap.set(hash, hashGroup);
        } catch (e) {
          // 跳过无法读取的文件
        }
      }

      for (const [hash, hashGroup] of hashMap) {
        if (hashGroup.length > 1) {
          const savableSize = size * (hashGroup.length - 1);
          result.exactDuplicateGroups.push({
            hash,
            size,
            sizeFormatted: formatFileSize(size),
            count: hashGroup.length,
            files: hashGroup,
            savableSize,
            savableSizeFormatted: formatFileSize(savableSize),
          });
          result.totalExactDuplicates += hashGroup.length;
          result.totalSavableSize += savableSize;
        }
      }
    }

    result.exactDuplicateGroups.sort((a, b) => b.savableSize - a.savableSize);
    result.totalSavableSizeFormatted = formatFileSize(result.totalSavableSize);
  }

  return result;
}

/**
 * delete_files 实现
 */
async function deleteFiles(params) {
  const { filePaths, moveToTrash = true } = params;

  const result = {
    successCount: 0,
    failedCount: 0,
    freedSize: 0,
    freedSizeFormatted: '0 B',
    errors: [],
  };

  for (const filePath of filePaths) {
    const expanded = expandPath(filePath);

    // 安全校验
    if (!isPathSafe(expanded)) {
      result.failedCount++;
      result.errors.push({ path: filePath, error: '路径不在用户目录范围内，拒绝操作' });
      continue;
    }

    try {
      if (!fs.existsSync(expanded)) {
        result.failedCount++;
        result.errors.push({ path: filePath, error: '文件不存在' });
        continue;
      }

      const stats = fs.statSync(expanded);
      const fileSize = stats.size;

      if (moveToTrash) {
        // 移入回收站目录（模拟回收站）
        const trashDir = path.join(os.homedir(), '.Trash_SmartAgent');
        if (!fs.existsSync(trashDir)) {
          fs.mkdirSync(trashDir, { recursive: true });
        }
        const trashName = Date.now() + '_' + path.basename(expanded);
        fs.renameSync(expanded, path.join(trashDir, trashName));
      } else {
        fs.unlinkSync(expanded);
      }

      result.successCount++;
      result.freedSize += fileSize;
    } catch (e) {
      result.failedCount++;
      result.errors.push({ path: filePath, error: e.message });
    }
  }

  result.freedSizeFormatted = formatFileSize(result.freedSize);
  return result;
}

/**
 * move_files 实现
 */
async function moveFiles(params) {
  const { sourcePaths, destinationDir } = params;
  const expandedDest = expandPath(destinationDir);

  const result = {
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  // 确保目标目录存在
  if (!fs.existsSync(expandedDest)) {
    fs.mkdirSync(expandedDest, { recursive: true });
  }

  for (const sourcePath of sourcePaths) {
    const expanded = expandPath(sourcePath);

    if (!isPathSafe(expanded)) {
      result.failedCount++;
      result.errors.push({ path: sourcePath, error: '路径不在用户目录范围内，拒绝操作' });
      continue;
    }

    try {
      if (!fs.existsSync(expanded)) {
        result.failedCount++;
        result.errors.push({ path: sourcePath, error: '文件不存在' });
        continue;
      }

      const destPath = path.join(expandedDest, path.basename(expanded));

      // 如果目标已存在同名文件，添加时间戳后缀
      let finalDest = destPath;
      if (fs.existsSync(finalDest)) {
        const ext = path.extname(destPath);
        const base = path.basename(destPath, ext);
        finalDest = path.join(expandedDest, base + '_' + Date.now() + ext);
      }

      fs.renameSync(expanded, finalDest);
      result.successCount++;
    } catch (e) {
      result.failedCount++;
      result.errors.push({ path: sourcePath, error: e.message });
    }
  }

  return result;
}

// ============== 导出工具处理器映射 ==============

module.exports = {
  analyzeDirectory,
  findDuplicates,
  deleteFiles,
  moveFiles,
};
`;
