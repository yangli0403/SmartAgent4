/**
 * MCP文件系统工具模块
 * 提供文件搜索、属性读取、打开文件等功能
 * 
 * 注意：这些工具设计为在本地MCP Server中运行
 * 在Web应用中，需要通过本地代理服务调用
 */

import { z } from 'zod';

// ============== 工具定义 ==============

/**
 * 文件搜索工具
 * 场景：帮我找一下昨天下载的ppt文件
 */
export const searchFilesTool = {
  name: 'search_files',
  description: '在指定目录中搜索文件。支持按文件名、扩展名、修改时间等条件搜索。',
  parameters: z.object({
    directory: z.string().describe('搜索目录路径，例如：C:\\Users\\Username\\Downloads 或 ~/Downloads'),
    pattern: z.string().optional().describe('文件名匹配模式，支持通配符，例如：*.ppt、*.pptx、report*'),
    extension: z.string().optional().describe('文件扩展名，例如：ppt、pptx、pdf'),
    modifiedAfter: z.string().optional().describe('修改时间在此之后，ISO格式，例如：2026-01-16T00:00:00'),
    modifiedBefore: z.string().optional().describe('修改时间在此之前，ISO格式'),
    sortBy: z.enum(['name', 'modified', 'size', 'created']).optional().default('modified').describe('排序方式'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc').describe('排序顺序'),
    limit: z.number().optional().default(20).describe('返回结果数量限制'),
  }),
};

/**
 * 获取文件信息工具
 * 场景：获取文件的详细属性
 */
export const getFileInfoTool = {
  name: 'get_file_info',
  description: '获取指定文件的详细信息，包括大小、创建时间、修改时间、类型等。',
  parameters: z.object({
    filePath: z.string().describe('文件的完整路径'),
  }),
};

/**
 * 打开文件工具
 * 场景：打开修改时间最新的一个PPT
 */
export const openFileTool = {
  name: 'open_file',
  description: '使用系统默认程序或指定程序打开文件。',
  parameters: z.object({
    filePath: z.string().describe('要打开的文件的完整路径'),
    application: z.string().optional().describe('指定打开文件的应用程序路径（可选，默认使用系统默认程序）'),
  }),
};

/**
 * 列出目录内容工具
 */
export const listDirectoryTool = {
  name: 'list_directory',
  description: '列出指定目录下的所有文件和子目录。',
  parameters: z.object({
    directory: z.string().describe('目录路径'),
    includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件'),
    recursive: z.boolean().optional().default(false).describe('是否递归列出子目录'),
    maxDepth: z.number().optional().default(1).describe('递归深度限制'),
  }),
};

/**
 * 创建文件夹工具（仅目录）
 */
export const createFolderTool = {
  name: 'create_folder',
  description: '创建文件夹（目录）。路径必须指向要创建的目录，例如：C:\\Users\\Username\\Downloads\\记忆文件备份',
  parameters: z.object({
    dirPath: z.string().describe('要创建的文件夹完整路径，例如：~/Documents/备份 或 C:\\Users\\Username\\Downloads\\记忆文件备份'),
  }),
};

/**
 * 创建文件工具（仅文件，路径需带扩展名）
 */
export const createFileTool = {
  name: 'create_file',
  description: '在指定路径创建新文件（路径必须带扩展名，如 .txt、.docx）。可写入初始文本内容。创建文件夹请使用 create_folder。',
  parameters: z.object({
    filePath: z.string().describe('新文件的完整路径，必须带扩展名，例如：~/Documents/报告.docx'),
    content: z.string().optional().describe('可选：写入文件的初始文本内容；不传则创建空文件'),
  }),
};

/**
 * 将一个或多个文件拷贝到目标文件夹
 * 场景：把多个 Word 文件拷贝到某个文件夹
 */
export const copyFilesTool = {
  name: 'copy_files',
  description: '将一个或多个文件拷贝到指定目标文件夹。支持批量拷贝。',
  parameters: z.object({
    sourcePaths: z.array(z.string()).describe('要拷贝的源文件完整路径列表'),
    destinationDir: z.string().describe('目标文件夹路径，例如：~/Documents/备份 或 C:\\Users\\Username\\Desktop\\汇总'),
  }),
};

// ============== 工具执行逻辑（本地MCP Server实现） ==============

/**
 * 文件搜索结果类型
 */
export interface FileSearchResult {
  name: string;
  path: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  modifiedAt: string;
  isDirectory: boolean;
}

/**
 * 文件信息类型
 */
export interface FileInfo {
  name: string;
  path: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  modifiedAt: string;
  accessedAt: string;
  isDirectory: boolean;
  isReadOnly: boolean;
  mimeType: string;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 获取昨天的日期（用于场景1）
 */
export function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday.toISOString();
}

/**
 * 获取常用目录路径
 */
export function getCommonDirectories(platform: 'windows' | 'mac' | 'linux' = 'windows'): Record<string, string> {
  const home = platform === 'windows' ? 'C:\\Users\\Username' : '/home/username';
  
  if (platform === 'windows') {
    return {
      downloads: `${home}\\Downloads`,
      documents: `${home}\\Documents`,
      desktop: `${home}\\Desktop`,
      pictures: `${home}\\Pictures`,
      videos: `${home}\\Videos`,
      music: `${home}\\Music`,
    };
  } else {
    return {
      downloads: `${home}/Downloads`,
      documents: `${home}/Documents`,
      desktop: `${home}/Desktop`,
      pictures: `${home}/Pictures`,
      videos: `${home}/Videos`,
      music: `${home}/Music`,
    };
  }
}

// ============== MCP Server端执行代码示例 ==============

/**
 * 以下代码需要在本地MCP Server中运行
 * 这里提供参考实现，实际部署时需要在用户本地运行
 */

export const fileSystemToolsServerCode = `
// ============== 本地MCP Server实现代码 ==============
// 保存为: mcp-file-server.js 或 mcp-file-server.ts
// 运行: node mcp-file-server.js

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

/**
 * 搜索文件
 */
async function searchFiles(params) {
  const {
    directory,
    pattern,
    extension,
    modifiedAfter,
    modifiedBefore,
    sortBy = 'modified',
    sortOrder = 'desc',
    limit = 20,
  } = params;

  // 展开路径中的 ~ 符号
  const expandedDir = directory.replace(/^~/, os.homedir());
  
  if (!fs.existsSync(expandedDir)) {
    return { error: \`目录不存在: \${directory}\`, files: [] };
  }

  const results = [];
  
  function scanDirectory(dir) {
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        
        try {
          const stats = fs.statSync(fullPath);
          
          // 跳过目录（只搜索文件）
          if (stats.isDirectory()) continue;
          
          // 检查扩展名
          const ext = path.extname(item).toLowerCase().replace('.', '');
          if (extension && ext !== extension.toLowerCase()) continue;
          
          // 检查文件名模式
          if (pattern) {
            const regex = new RegExp(pattern.replace(/\\*/g, '.*').replace(/\\?/g, '.'), 'i');
            if (!regex.test(item)) continue;
          }
          
          // 检查修改时间
          const modifiedTime = stats.mtime;
          if (modifiedAfter && modifiedTime < new Date(modifiedAfter)) continue;
          if (modifiedBefore && modifiedTime > new Date(modifiedBefore)) continue;
          
          results.push({
            name: item,
            path: fullPath,
            extension: ext,
            size: stats.size,
            sizeFormatted: formatFileSize(stats.size),
            createdAt: stats.birthtime.toISOString(),
            modifiedAt: stats.mtime.toISOString(),
            isDirectory: false,
          });
        } catch (e) {
          // 跳过无法访问的文件
        }
      }
    } catch (e) {
      // 跳过无法访问的目录
    }
  }
  
  scanDirectory(expandedDir);
  
  // 排序
  results.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'modified':
        comparison = new Date(a.modifiedAt) - new Date(b.modifiedAt);
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'created':
        comparison = new Date(a.createdAt) - new Date(b.createdAt);
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });
  
  return {
    total: results.length,
    files: results.slice(0, limit),
  };
}

/**
 * 获取文件信息
 */
async function getFileInfo(params) {
  const { filePath } = params;
  const expandedPath = filePath.replace(/^~/, os.homedir());
  
  if (!fs.existsSync(expandedPath)) {
    return { error: \`文件不存在: \${filePath}\` };
  }
  
  const stats = fs.statSync(expandedPath);
  const ext = path.extname(expandedPath).toLowerCase().replace('.', '');
  
  return {
    name: path.basename(expandedPath),
    path: expandedPath,
    extension: ext,
    size: stats.size,
    sizeFormatted: formatFileSize(stats.size),
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
    accessedAt: stats.atime.toISOString(),
    isDirectory: stats.isDirectory(),
    isReadOnly: !(stats.mode & 0o200),
    mimeType: getMimeType(ext),
  };
}

/**
 * 打开文件
 */
async function openFile(params) {
  const { filePath, application } = params;
  const expandedPath = filePath.replace(/^~/, os.homedir());
  
  if (!fs.existsSync(expandedPath)) {
    return { error: \`文件不存在: \${filePath}\` };
  }
  
  const platform = os.platform();
  let command;
  
  if (application) {
    // 使用指定应用程序打开
    if (platform === 'win32') {
      command = \`"\${application}" "\${expandedPath}"\`;
    } else if (platform === 'darwin') {
      command = \`open -a "\${application}" "\${expandedPath}"\`;
    } else {
      command = \`"\${application}" "\${expandedPath}"\`;
    }
  } else {
    // 使用系统默认程序打开
    if (platform === 'win32') {
      command = \`start "" "\${expandedPath}"\`;
    } else if (platform === 'darwin') {
      command = \`open "\${expandedPath}"\`;
    } else {
      command = \`xdg-open "\${expandedPath}"\`;
    }
  }
  
  return new Promise((resolve) => {
    exec(command, (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, message: \`已打开文件: \${path.basename(expandedPath)}\` });
      }
    });
  });
}

/**
 * 创建新文件（支持 .docx、.txt 等；可写初始内容）
 */
async function createFile(params) {
  const { filePath: rawPath, content = '' } = params;
  const expandedPath = rawPath.replace(/^~/, os.homedir());
  const dir = path.dirname(expandedPath);
  
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(expandedPath, content, 'utf8');
    return {
      success: true,
      message: \`已创建文件: \${path.basename(expandedPath)}\`,
      path: expandedPath,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 将一个或多个文件拷贝到目标文件夹
 */
async function copyFiles(params) {
  const { sourcePaths, destinationDir } = params;
  const expandedDest = destinationDir.replace(/^~/, os.homedir());
  
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { success: false, error: 'sourcePaths 必须为非空数组' };
  }
  
  try {
    if (!fs.existsSync(expandedDest)) {
      fs.mkdirSync(expandedDest, { recursive: true });
    }
    const copied = [];
    for (const src of sourcePaths) {
      const expandedSrc = src.replace(/^~/, os.homedir());
      if (!fs.existsSync(expandedSrc)) {
        return { success: false, error: \`源文件不存在: \${src}\`, copied };
      }
      const name = path.basename(expandedSrc);
      const destPath = path.join(expandedDest, name);
      fs.copyFileSync(expandedSrc, destPath);
      copied.push({ source: expandedSrc, destination: destPath });
    }
    return {
      success: true,
      message: \`已拷贝 \${copied.length} 个文件到 \${expandedDest}\`,
      copied,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getMimeType(ext) {
  const mimeTypes = {
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = { searchFiles, getFileInfo, openFile, createFile, copyFiles };
`;

// ============== 导出所有工具定义 ==============

export const fileSystemTools = [
  searchFilesTool,
  getFileInfoTool,
  openFileTool,
  listDirectoryTool,
  createFileTool,
  copyFilesTool,
];

export default fileSystemTools;
