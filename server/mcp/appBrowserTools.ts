/**
 * MCP应用和浏览器控制工具模块
 * 提供应用启动、浏览器控制等功能
 * 
 * 注意：这些工具设计为在本地MCP Server中运行
 * 在Web应用中，需要通过本地代理服务调用
 */

import { z } from 'zod';

// ============== 工具定义 ==============

/**
 * 启动应用工具
 * 场景：打开一个无痕模式的Chrome浏览器
 */
export const launchAppTool = {
  name: 'launch_app',
  description: '启动指定的应用程序，支持传递命令行参数。',
  parameters: z.object({
    appName: z.string().describe('应用程序名称或路径，例如：chrome、notepad、"C:\\\\Program Files\\\\...\\\\app.exe"'),
    args: z.array(z.string()).optional().describe('命令行参数数组'),
    workingDirectory: z.string().optional().describe('工作目录'),
    waitForExit: z.boolean().optional().default(false).describe('是否等待应用退出'),
  }),
};

/**
 * 浏览器控制工具
 * 场景：打开无痕模式的Chrome并打开5个manus窗口
 */
export const browserControlTool = {
  name: 'browser_control',
  description: '控制浏览器执行操作，如打开新窗口、新标签页、导航到URL等。',
  parameters: z.object({
    browser: z.enum(['chrome', 'edge', 'firefox', 'safari']).default('chrome').describe('浏览器类型'),
    action: z.enum([
      'open',           // 打开浏览器
      'open_incognito', // 打开无痕/隐私模式
      'new_window',     // 新建窗口
      'new_tab',        // 新建标签页
      'navigate',       // 导航到URL
      'close',          // 关闭浏览器
    ]).describe('要执行的操作'),
    url: z.string().optional().describe('要打开的URL（用于navigate、new_tab、open等操作）'),
    urls: z.array(z.string()).optional().describe('要打开的多个URL（用于批量打开）'),
    windowCount: z.number().optional().default(1).describe('要打开的窗口数量'),
    incognito: z.boolean().optional().default(false).describe('是否使用无痕/隐私模式'),
  }),
};

/**
 * 获取运行中的应用列表
 */
export const listRunningAppsTool = {
  name: 'list_running_apps',
  description: '获取当前运行中的应用程序列表。',
  parameters: z.object({
    filter: z.string().optional().describe('按名称过滤应用'),
  }),
};

/**
 * 关闭应用工具
 */
export const closeAppTool = {
  name: 'close_app',
  description: '关闭指定的应用程序。',
  parameters: z.object({
    appName: z.string().optional().describe('应用程序名称'),
    processId: z.number().optional().describe('进程ID'),
    force: z.boolean().optional().default(false).describe('是否强制关闭'),
  }),
};

/**
 * 窗口控制工具
 */
export const windowControlTool = {
  name: 'window_control',
  description: '控制应用程序窗口，如最小化、最大化、移动、调整大小等。',
  parameters: z.object({
    windowTitle: z.string().optional().describe('窗口标题（支持部分匹配）'),
    processName: z.string().optional().describe('进程名称'),
    action: z.enum([
      'minimize',    // 最小化
      'maximize',    // 最大化
      'restore',     // 还原
      'close',       // 关闭
      'focus',       // 聚焦
      'move',        // 移动
      'resize',      // 调整大小
    ]).describe('要执行的操作'),
    x: z.number().optional().describe('窗口X坐标（用于move操作）'),
    y: z.number().optional().describe('窗口Y坐标（用于move操作）'),
    width: z.number().optional().describe('窗口宽度（用于resize操作）'),
    height: z.number().optional().describe('窗口高度（用于resize操作）'),
  }),
};

// ============== 浏览器命令行参数配置 ==============

/**
 * 各浏览器的命令行参数
 */
export const browserConfigs = {
  chrome: {
    windows: {
      paths: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
      ],
      incognitoArg: '--incognito',
      newWindowArg: '--new-window',
    },
    mac: {
      paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      incognitoArg: '--incognito',
      newWindowArg: '--new-window',
    },
    linux: {
      paths: ['/usr/bin/google-chrome', '/usr/bin/chromium-browser'],
      incognitoArg: '--incognito',
      newWindowArg: '--new-window',
    },
  },
  edge: {
    windows: {
      paths: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
      incognitoArg: '--inprivate',
      newWindowArg: '--new-window',
    },
    mac: {
      paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      incognitoArg: '--inprivate',
      newWindowArg: '--new-window',
    },
    linux: {
      paths: ['/usr/bin/microsoft-edge'],
      incognitoArg: '--inprivate',
      newWindowArg: '--new-window',
    },
  },
  firefox: {
    windows: {
      paths: [
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      ],
      incognitoArg: '-private-window',
      newWindowArg: '-new-window',
    },
    mac: {
      paths: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
      incognitoArg: '-private-window',
      newWindowArg: '-new-window',
    },
    linux: {
      paths: ['/usr/bin/firefox'],
      incognitoArg: '-private-window',
      newWindowArg: '-new-window',
    },
  },
  safari: {
    mac: {
      paths: ['/Applications/Safari.app/Contents/MacOS/Safari'],
      incognitoArg: '', // Safari通过AppleScript控制
      newWindowArg: '',
    },
  },
};

// ============== MCP Server端执行代码示例 ==============

export const appBrowserToolsServerCode = `
// ============== 本地MCP Server实现代码 ==============
// 保存为: mcp-app-browser-server.js
// 运行: node mcp-app-browser-server.js

const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 浏览器配置
const browserConfigs = {
  chrome: {
    win32: {
      paths: [
        'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
        'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
        process.env.LOCALAPPDATA + '\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      ],
      incognitoArg: '--incognito',
      newWindowArg: '--new-window',
    },
    darwin: {
      paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      incognitoArg: '--incognito',
      newWindowArg: '--new-window',
    },
    linux: {
      paths: ['/usr/bin/google-chrome', '/usr/bin/chromium-browser'],
      incognitoArg: '--incognito',
      newWindowArg: '--new-window',
    },
  },
  edge: {
    win32: {
      paths: [
        'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
        'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
      ],
      incognitoArg: '--inprivate',
      newWindowArg: '--new-window',
    },
  },
  firefox: {
    win32: {
      paths: [
        'C:\\\\Program Files\\\\Mozilla Firefox\\\\firefox.exe',
        'C:\\\\Program Files (x86)\\\\Mozilla Firefox\\\\firefox.exe',
      ],
      incognitoArg: '-private-window',
      newWindowArg: '-new-window',
    },
  },
};

/**
 * 查找浏览器可执行文件路径
 */
function findBrowserPath(browser) {
  const platform = os.platform();
  const config = browserConfigs[browser]?.[platform];
  
  if (!config) {
    return null;
  }
  
  for (const browserPath of config.paths) {
    if (fs.existsSync(browserPath)) {
      return browserPath;
    }
  }
  
  return null;
}

/**
 * 启动应用程序
 */
async function launchApp(params) {
  const { appName, args = [], workingDirectory, waitForExit = false } = params;
  
  const platform = os.platform();
  let command;
  let spawnArgs = [];
  
  // 处理常见应用名称
  const appAliases = {
    notepad: platform === 'win32' ? 'notepad.exe' : 'gedit',
    calculator: platform === 'win32' ? 'calc.exe' : 'gnome-calculator',
    explorer: platform === 'win32' ? 'explorer.exe' : 'nautilus',
    terminal: platform === 'win32' ? 'cmd.exe' : 'gnome-terminal',
  };
  
  command = appAliases[appName.toLowerCase()] || appName;
  spawnArgs = args;
  
  const options = {};
  if (workingDirectory) {
    options.cwd = workingDirectory;
  }
  
  return new Promise((resolve) => {
    if (waitForExit) {
      const child = spawn(command, spawnArgs, { ...options, shell: true });
      child.on('close', (code) => {
        resolve({ success: true, exitCode: code });
      });
      child.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    } else {
      const child = spawn(command, spawnArgs, { 
        ...options, 
        shell: true,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      resolve({ success: true, message: \`已启动应用: \${appName}\` });
    }
  });
}

/**
 * 浏览器控制
 * 场景：打开无痕模式的Chrome并打开5个manus窗口
 */
async function browserControl(params) {
  const { 
    browser = 'chrome', 
    action, 
    url, 
    urls = [], 
    windowCount = 1,
    incognito = false,
  } = params;
  
  const platform = os.platform();
  const browserPath = findBrowserPath(browser);
  
  if (!browserPath) {
    return { 
      success: false, 
      error: \`未找到浏览器: \${browser}。请确保已安装该浏览器。\` 
    };
  }
  
  const config = browserConfigs[browser][platform];
  const results = [];
  
  switch (action) {
    case 'open':
    case 'open_incognito': {
      const args = [];
      
      // 添加无痕模式参数
      if (action === 'open_incognito' || incognito) {
        args.push(config.incognitoArg);
      }
      
      // 添加URL
      if (url) {
        args.push(url);
      }
      
      // 批量打开URL
      if (urls.length > 0) {
        args.push(...urls);
      }
      
      const child = spawn(browserPath, args, {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      child.unref();
      
      results.push({
        success: true,
        message: \`已打开\${incognito || action === 'open_incognito' ? '无痕模式' : ''}\${browser}浏览器\`,
        urls: url ? [url] : urls,
      });
      break;
    }
    
    case 'new_window': {
      // 打开多个新窗口
      for (let i = 0; i < windowCount; i++) {
        const args = [config.newWindowArg];
        
        if (incognito) {
          args.push(config.incognitoArg);
        }
        
        // 如果有URL，每个窗口打开对应的URL
        const targetUrl = urls[i] || url;
        if (targetUrl) {
          args.push(targetUrl);
        }
        
        const child = spawn(browserPath, args, {
          detached: true,
          stdio: 'ignore',
          shell: true,
        });
        child.unref();
        
        results.push({
          windowIndex: i + 1,
          url: targetUrl || '空白页',
          success: true,
        });
        
        // 稍微延迟，避免同时打开太多窗口
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      break;
    }
    
    case 'navigate': {
      if (!url) {
        return { success: false, error: '导航操作需要提供URL' };
      }
      
      const args = [url];
      if (incognito) {
        args.unshift(config.incognitoArg);
      }
      
      const child = spawn(browserPath, args, {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      child.unref();
      
      results.push({
        success: true,
        message: \`已导航到: \${url}\`,
      });
      break;
    }
    
    default:
      return { success: false, error: \`不支持的操作: \${action}\` };
  }
  
  return {
    success: true,
    browser,
    action,
    incognito: incognito || action === 'open_incognito',
    results,
    totalWindows: results.length,
  };
}

/**
 * 获取运行中的应用列表
 */
async function listRunningApps(params) {
  const { filter } = params;
  const platform = os.platform();
  
  return new Promise((resolve) => {
    let command;
    
    if (platform === 'win32') {
      command = 'tasklist /fo csv /nh';
    } else if (platform === 'darwin') {
      command = 'ps -eo pid,comm';
    } else {
      command = 'ps -eo pid,comm';
    }
    
    exec(command, (error, stdout) => {
      if (error) {
        resolve({ success: false, error: error.message });
        return;
      }
      
      const apps = [];
      const lines = stdout.trim().split('\\n');
      
      for (const line of lines) {
        if (platform === 'win32') {
          // Windows CSV格式: "进程名","PID","会话名","会话#","内存使用"
          const match = line.match(/"([^"]+)","(\\d+)"/);
          if (match) {
            const [, name, pid] = match;
            if (!filter || name.toLowerCase().includes(filter.toLowerCase())) {
              apps.push({ name, pid: parseInt(pid) });
            }
          }
        } else {
          // Unix格式: PID COMMAND
          const parts = line.trim().split(/\\s+/);
          if (parts.length >= 2) {
            const pid = parseInt(parts[0]);
            const name = parts.slice(1).join(' ');
            if (!isNaN(pid) && (!filter || name.toLowerCase().includes(filter.toLowerCase()))) {
              apps.push({ name, pid });
            }
          }
        }
      }
      
      resolve({ success: true, apps, total: apps.length });
    });
  });
}

/**
 * 关闭应用
 */
async function closeApp(params) {
  const { appName, processId, force = false } = params;
  const platform = os.platform();
  
  return new Promise((resolve) => {
    let command;
    
    if (platform === 'win32') {
      if (processId) {
        command = force ? \`taskkill /F /PID \${processId}\` : \`taskkill /PID \${processId}\`;
      } else if (appName) {
        command = force ? \`taskkill /F /IM \${appName}\` : \`taskkill /IM \${appName}\`;
      }
    } else {
      if (processId) {
        command = force ? \`kill -9 \${processId}\` : \`kill \${processId}\`;
      } else if (appName) {
        command = force ? \`pkill -9 \${appName}\` : \`pkill \${appName}\`;
      }
    }
    
    if (!command) {
      resolve({ success: false, error: '需要提供应用名称或进程ID' });
      return;
    }
    
    exec(command, (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, message: \`已关闭应用: \${appName || processId}\` });
      }
    });
  });
}

module.exports = { launchApp, browserControl, listRunningApps, closeApp };
`;

// ============== 场景示例 ==============

/**
 * 场景2的完整执行流程示例
 * 输入："帮我打开一个无痕模式的Chrome浏览器，并打开5个manus的窗口"
 */
export const scenario2Example = {
  userInput: '帮我打开一个无痕模式的Chrome浏览器，并打开5个manus的窗口',
  agentPlan: [
    {
      step: 1,
      thought: '用户想要打开无痕模式的Chrome浏览器，并打开5个manus.im的窗口',
      action: 'browser_control',
      parameters: {
        browser: 'chrome',
        action: 'open_incognito',
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
  expectedResult: {
    success: true,
    browser: 'chrome',
    action: 'open_incognito',
    incognito: true,
    totalWindows: 5,
    results: [
      { windowIndex: 1, url: 'https://manus.im', success: true },
      { windowIndex: 2, url: 'https://manus.im', success: true },
      { windowIndex: 3, url: 'https://manus.im', success: true },
      { windowIndex: 4, url: 'https://manus.im', success: true },
      { windowIndex: 5, url: 'https://manus.im', success: true },
    ],
  },
  agentResponse: '好的，我已经为您打开了Chrome浏览器的无痕模式，并打开了5个manus.im的窗口。所有窗口都已成功打开。',
};

// ============== 导出所有工具定义 ==============

export const appBrowserTools = [
  launchAppTool,
  browserControlTool,
  listRunningAppsTool,
  closeAppTool,
  windowControlTool,
];

export default appBrowserTools;
