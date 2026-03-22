@echo off
chcp 65001 >nul
title SmartAgent4 - Windows Launcher

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║           SmartAgent4 Windows 一键启动脚本                  ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: ============================================================
:: 1. 检查环境
:: ============================================================

echo [1/5] 检查 Node.js 环境...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    echo        下载地址: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo        Node.js 版本: %%i

echo [1/5] 检查 pnpm...
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 未找到 pnpm，正在自动安装...
    npm install -g pnpm
)
for /f "tokens=*" %%i in ('pnpm --version') do echo        pnpm 版本: %%i

:: ============================================================
:: 2. 检查 .env 配置
:: ============================================================

echo.
echo [2/5] 检查环境变量配置...
if not exist ".env" (
    echo [提示] 未找到 .env 文件，正在从模板创建...
    copy .env.example .env >nul
    echo [重要] 请编辑 .env 文件，填入您的 LLM API Key 和数据库配置
    echo        然后重新运行此脚本
    notepad .env
    pause
    exit /b 0
)
echo        .env 文件已存在

:: ============================================================
:: 3. 安装依赖
:: ============================================================

echo.
echo [3/5] 安装项目依赖（首次运行可能需要几分钟）...
if not exist "node_modules" (
    pnpm install
) else (
    echo        node_modules 已存在，跳过安装
)

:: ============================================================
:: 4. 数据库迁移
:: ============================================================

echo.
echo [4/5] 执行数据库迁移...
pnpm run db:push 2>nul
if %errorlevel% neq 0 (
    echo [警告] 数据库迁移失败，请确认 MySQL 已启动且 DATABASE_URL 配置正确
    echo        如果是首次运行，请先创建数据库: CREATE DATABASE smart_agent;
)

:: ============================================================
:: 5. 启动服务
:: ============================================================

echo.
echo [5/5] 启动 SmartAgent4 开发服务器...
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  服务启动中...                                              ║
echo ║  前端地址: http://localhost:5173                            ║
echo ║  后端地址: http://localhost:3000                            ║
echo ║                                                            ║
echo ║  按 Ctrl+C 停止服务                                        ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

pnpm run dev
