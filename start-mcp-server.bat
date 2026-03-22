@echo off
chcp 65001 >nul
title SmartAgent4 - MCP Local Server

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║       SmartAgent4 本地 MCP Server 启动脚本                  ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js
    pause
    exit /b 1
)

:: 检查 MCP Server 文件
if not exist "smartagent-mcp-server.js" (
    echo [提示] 未找到 smartagent-mcp-server.js
    echo        请先从 SmartAgent4 Web 界面导出 MCP Server 代码
    echo        或运行: node -e "require('./dist/index.js')" 生成
    pause
    exit /b 1
)

:: 检查依赖
if not exist "node_modules\express" (
    echo [提示] 安装 MCP Server 依赖...
    npm install express cors
)

echo 启动 MCP Server...
echo 地址: http://localhost:3100
echo.

node smartagent-mcp-server.js
