# ============================================================
# SmartAgent4 Windows PowerShell 启动脚本
# 用法: 右键 -> 使用 PowerShell 运行
# ============================================================

$Host.UI.RawUI.WindowTitle = "SmartAgent4 - Windows Launcher"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           SmartAgent4 Windows 启动脚本 (PowerShell)        ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# 1. 环境检查
# ============================================================

Write-Host "[1/5] 检查 Node.js 环境..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "       Node.js 版本: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[错误] 未找到 Node.js，请先安装 Node.js 18+" -ForegroundColor Red
    Write-Host "       下载地址: https://nodejs.org/" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

Write-Host "[1/5] 检查 pnpm..." -ForegroundColor Yellow
try {
    $pnpmVersion = pnpm --version
    Write-Host "       pnpm 版本: $pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "[提示] 未找到 pnpm，正在自动安装..." -ForegroundColor Yellow
    npm install -g pnpm
}

# ============================================================
# 2. 检查 PostgreSQL 连接
# ============================================================

Write-Host ""
Write-Host "[2/5] 检查环境变量配置..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Write-Host "[提示] 未找到 .env 文件，正在从模板创建..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "[重要] 请编辑 .env 文件，填入您的配置" -ForegroundColor Red
    notepad .env
    Read-Host "编辑完成后按 Enter 继续"
}

# 读取 .env 文件
Get-Content ".env" | ForEach-Object {
    if ($_ -match "^\s*([^#][^=]+)=(.+)$") {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}
Write-Host "       .env 已加载" -ForegroundColor Green

# ============================================================
# 3. 安装依赖
# ============================================================

Write-Host ""
Write-Host "[3/5] 安装项目依赖..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    pnpm install
} else {
    Write-Host "       node_modules 已存在，跳过安装" -ForegroundColor Green
}

# ============================================================
# 4. 数据库迁移
# ============================================================

Write-Host ""
Write-Host "[4/5] 执行数据库迁移..." -ForegroundColor Yellow
try {
    pnpm run db:push 2>$null
    Write-Host "       数据库迁移完成" -ForegroundColor Green
} catch {
    Write-Host "[警告] 数据库迁移失败，请确认 PostgreSQL 已启动" -ForegroundColor Yellow
}

# ============================================================
# 5. 启动服务
# ============================================================

Write-Host ""
Write-Host "[5/5] 启动 SmartAgent4 开发服务器..." -ForegroundColor Yellow
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  前端地址: http://localhost:5173                            ║" -ForegroundColor Green
Write-Host "║  后端地址: http://localhost:3000                            ║" -ForegroundColor Green
Write-Host "║  按 Ctrl+C 停止服务                                        ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

pnpm run dev
