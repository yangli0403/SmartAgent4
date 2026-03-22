/**
 * MCP工具模块索引
 * 
 * 本模块汇总所有MCP工具定义和执行代码
 * 
 * 架构说明：
 * 1. 工具定义（Tool Definitions）：在Web应用中使用，供Agent引擎理解和规划
 * 2. 工具执行代码（Server Code）：需要在用户本地的MCP Server中运行
 * 
 * 部署方式：
 * - Web应用：使用工具定义，通过HTTP/WebSocket调用本地MCP Server
 * - 本地MCP Server：运行工具执行代码，实际操作用户的文件系统和应用
 */

// 导入工具模块
import { fileSystemTools, fileSystemToolsServerCode } from './fileSystemTools';
import { appBrowserTools, appBrowserToolsServerCode } from './appBrowserTools';
import { analyzeDirectoryTool, findDuplicatesTool, deleteFilesTool, moveFilesTool, fileOrganizerServerCode } from './fileOrganizerTools';

// 文件整理大师工具列表
export const fileOrganizerTools = [
  analyzeDirectoryTool,
  findDuplicatesTool,
  deleteFilesTool,
  moveFilesTool,
];

// ============== 工具定义汇总 ==============

/**
 * 所有MCP工具定义
 */
export const allTools = [
  ...fileSystemTools,
  ...appBrowserTools,
  ...fileOrganizerTools,
];

/**
 * 按类别分组的工具
 */
export const toolsByCategory = {
  fileSystem: fileSystemTools,
  appBrowser: appBrowserTools,
  fileOrganizer: fileOrganizerTools,
};

/**
 * 工具名称到定义的映射
 */
export const toolsMap = allTools.reduce((map, tool) => {
  map[tool.name] = tool;
  return map;
}, {} as Record<string, typeof allTools[number]>);

// ============== 工具执行代码汇总 ==============

/**
 * 本地MCP Server的完整代码
 * 用户需要在本地运行此代码以支持工具执行
 */
export const localMCPServerCode = `
// ============================================================
// SmartAgent 本地MCP Server
// ============================================================
// 
// 安装依赖：npm install express cors
// 运行：node smartagent-mcp-server.js
// 
// 此服务器在本地运行，接收来自SmartAgent Web应用的工具调用请求
// 并在用户的本地环境中执行相应操作
// ============================================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

// ============== 文件系统工具实现 ==============

${fileSystemToolsServerCode}

// ============== 应用和浏览器工具实现 ==============

${appBrowserToolsServerCode}

// ============== 文件整理大师工具实现 ==============

${fileOrganizerServerCode}

// ============== API路由 ==============

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    platform: os.platform(),
    hostname: os.hostname(),
    uptime: os.uptime(),
  });
});

/**
 * 获取可用工具列表
 */
app.get('/tools', (req, res) => {
  res.json({
    tools: [
      { name: 'search_files', category: 'fileSystem', description: '搜索文件' },
      { name: 'get_file_info', category: 'fileSystem', description: '获取文件信息' },
      { name: 'open_file', category: 'fileSystem', description: '打开文件' },
      { name: 'create_file', category: 'fileSystem', description: '创建新文件' },
      { name: 'copy_files', category: 'fileSystem', description: '拷贝文件到目标文件夹' },
      { name: 'launch_app', category: 'appBrowser', description: '启动应用' },
      { name: 'browser_control', category: 'appBrowser', description: '浏览器控制' },
      { name: 'list_running_apps', category: 'appBrowser', description: '列出运行中的应用' },
      { name: 'close_app', category: 'appBrowser', description: '关闭应用' },
      { name: 'analyze_directory', category: 'fileOrganizer', description: '分析目录文件分布' },
      { name: 'find_duplicates', category: 'fileOrganizer', description: '查找重复/同名文件' },
      { name: 'delete_files', category: 'fileOrganizer', description: '安全删除文件' },
      { name: 'move_files', category: 'fileOrganizer', description: '批量移动文件' },
    ],
  });
});

/**
 * 执行工具
 */
app.post('/execute', async (req, res) => {
  const { tool, params } = req.body;
  
  try {
    let result;
    
    switch (tool) {
      case 'search_files':
        result = await searchFiles(params);
        break;
      case 'get_file_info':
        result = await getFileInfo(params);
        break;
      case 'open_file':
        result = await openFile(params);
        break;
      case 'create_file':
        result = await createFile(params);
        break;
      case 'copy_files':
        result = await copyFiles(params);
        break;
      case 'launch_app':
        result = await launchApp(params);
        break;
      case 'browser_control':
        result = await browserControl(params);
        break;
      case 'list_running_apps':
        result = await listRunningApps(params);
        break;
      case 'close_app':
        result = await closeApp(params);
        break;
      case 'analyze_directory':
        result = await analyzeDirectory(params);
        break;
      case 'find_duplicates':
        result = await findDuplicates(params);
        break;
      case 'delete_files':
        result = await deleteFiles(params);
        break;
      case 'move_files':
        result = await moveFiles(params);
        break;
      default:
        result = { error: \`未知工具: \${tool}\` };
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== 启动服务器 ==============

const PORT = process.env.MCP_PORT || 3100;

app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         SmartAgent 本地MCP Server 已启动                    ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(\`║  地址: http://localhost:\${PORT}                              ║\`);
  console.log('║  平台: ' + os.platform().padEnd(50) + '║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  可用工具:                                                  ║');
  console.log('║  - search_files     搜索文件                               ║');
  console.log('║  - get_file_info    获取文件信息                           ║');
  console.log('║  - open_file        打开文件                               ║');
  console.log('║  - create_file      创建新文件                               ║');
  console.log('║  - copy_files       拷贝文件到目标文件夹                     ║');
  console.log('║  - launch_app       启动应用                               ║');
  console.log('║  - browser_control  浏览器控制                             ║');
  console.log('║  - list_running_apps 列出运行中的应用                      ║');
  console.log('║  - close_app        关闭应用                               ║');
  console.log('║  - analyze_directory 分析目录文件分布                     ║');
  console.log('║  - find_duplicates   查找重复/同名文件                     ║');
  console.log('║  - delete_files      安全删除文件                           ║');
  console.log('║  - move_files        批量移动文件                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});
`;

// ============== 场景示例 ==============

/**
 * 场景1：帮我找一下昨天下载的ppt文件并打开修改时间最新的一个
 */
export const scenario1 = {
  userInput: '帮我找一下昨天下载的ppt文件并打开修改时间最新的一个',
  agentPlan: [
    {
      step: 1,
      thought: '用户想要找到昨天下载的PPT文件，我需要先搜索Downloads目录中的PPT文件',
      tool: 'search_files',
      parameters: {
        directory: '~/Downloads',
        extension: 'pptx',
        modifiedAfter: '2026-01-16T00:00:00',
        modifiedBefore: '2026-01-17T00:00:00',
        sortBy: 'modified',
        sortOrder: 'desc',
        limit: 10,
      },
    },
    {
      step: 2,
      thought: '找到了文件列表，现在打开修改时间最新的那个',
      tool: 'open_file',
      parameters: {
        filePath: '~/Downloads/presentation.pptx', // 从搜索结果中获取
      },
    },
  ],
  expectedResponse: '我找到了昨天下载的PPT文件，共有3个。已为您打开修改时间最新的文件：presentation.pptx（修改时间：2026-01-16 15:30）',
};

/**
 * 场景2：帮我打开一个无痕模式的Chrome浏览器，并打开5个manus的窗口
 */
export const scenario2 = {
  userInput: '帮我打开一个无痕模式的Chrome浏览器，并打开5个manus的窗口',
  agentPlan: [
    {
      step: 1,
      thought: '用户想要打开无痕模式的Chrome，并打开5个manus.im的窗口',
      tool: 'browser_control',
      parameters: {
        browser: 'chrome',
        action: 'new_window',
        windowCount: 5,
        urls: [
          'https://manus.im',
          'https://manus.im',
          'https://manus.im',
          'https://manus.im',
          'https://manus.im',
        ],
        incognito: true,
      },
    },
  ],
  expectedResponse: '好的，我已经为您打开了Chrome浏览器的无痕模式，并打开了5个manus.im的窗口。所有窗口都已成功打开。',
};

// ============== 导出 ==============

export {
  fileSystemTools,
  fileSystemToolsServerCode,
  appBrowserTools,
  appBrowserToolsServerCode,
};

export default {
  allTools,
  toolsByCategory,
  toolsMap,
  localMCPServerCode,
  scenarios: {
    scenario1,
    scenario2,
  },
};
