# ============================================================
# SmartAgent4 — Windows 一键部署脚本
# SmartAgent4_demo 专用，含服务检测/启动/重启逻辑
#
# 使用方式（双击运行或右键用 PowerShell 运行）:
#   .\scripts\deploy.ps1
#
# 带参数用法:
#   .\scripts\deploy.ps1 -SkipDeps -Watch      # 跳过依赖安装，仅重启
#   .\scripts\deploy.ps1 -FullRestart         # 完整重启所有服务
# ============================================================

param(
    [switch]$SkipDeps,      # 跳过 pnpm install
    [switch]$Watch,         # 启动后持续监控
    [switch]$FullRestart    # 强制重启所有服务（忽略健康检查）
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "SmartAgent4 — 一键部署"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================
# 配置区
# ============================================================
$PROJECT_ROOT = $PSScriptRoot | Split-Path -Parent   # scripts 的父目录即项目根目录

$SERVICES = @{
    "PostgreSQL" = @{
        Port      = 5432
        CheckCmd  = { Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue }
        ProcessName = "postgres"
    }
    "主服务" = @{
        Port      = 3000
        CheckCmd  = { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue }
        ProcessName = "node"
        RestartAction = "pnpm dev"
        WorkingDir = $PROJECT_ROOT
    }
    "本地语音服务" = @{
        Port      = 8001
        CheckCmd  = { Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue }
        HealthUrl = "http://127.0.0.1:8001/health"
        RestartCmd = "python"
        RestartArgs = @("main.py")
        WorkingDir = "$PROJECT_ROOT\local-voice-service"
    }
    "Emotions System" = @{
        Port      = 8000
        CheckCmd  = { Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue }
        HealthUrl = "http://127.0.0.1:8000/health"
        RestartCmd = $null      # 暂不支持自动启动
    }
    "AIRI Server" = @{
        Port      = 6121
        CheckCmd  = { Get-NetTCPConnection -LocalPort 6121 -State Listen -ErrorAction SilentlyContinue }
        RestartCmd = $null      # 暂不支持自动启动
    }
}

# ============================================================
# 工具函数
# ============================================================

function Write-Step($msg) {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
}

function Write-Ok($msg)  { Write-Host "[✅ OK]  $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "[❌ FAIL]  $msg" -ForegroundColor Red }
function Write-Skip($msg) { Write-Host "[⏭ SKIP]  $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "[  INFO]  $msg" -ForegroundColor Gray }

function Get-ProcessForPort($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if ($conn) {
        Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    }
}

function Test-HealthEndpoint($url, $timeoutSec = 5) {
    try {
        $null = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec $timeoutSec -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function Stop-ServiceByPort($port) {
    $proc = Get-ProcessForPort $port
    if ($proc) {
        Write-Info "停止进程 $($proc.Name) (PID: $($proc.Id)) 监听端口 $port..."
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        Write-Info "端口 $port 已释放"
    }
}

function Start-SmartAgentService {
    param(
        [string]$Name,
        [scriptblock]$CheckCmd,
        [string]$HealthUrl = $null,
        [string]$RestartCmd = $null,
        [string[]]$RestartArgs = @(),
        [string]$WorkingDir = $null
    )
    $port = $SERVICES[$Name].Port

    Write-Host ""
    Write-Host "  正在检测 [$Name] (端口 $port)..." -NoNewline

    # 1. 检查端口是否已被占用
    $running = & $CheckCmd

    if ($FullRestart -and $running) {
        Write-Host ""
        Write-Info "FullRestart: 强制重启 $Name..."
        Stop-ServiceByPort $port
        $running = $null
    }

    if ($running) {
        # 2a. 有端口监听 → 进一步健康检查
        if ($HealthUrl) {
            $healthy = Test-HealthEndpoint $HealthUrl
            if ($healthy) {
                Write-Host " ✅ 已运行 (健康检查通过)" -ForegroundColor Green
                return
            } else {
                Write-Host ""
                Write-Info "端口监听中但健康检查失败，尝试重启..."
                Stop-ServiceByPort $port
            }
        } else {
            Write-Host " ✅ 已运行" -ForegroundColor Green
            return
        }
    }

    # 3. 启动服务
    if (-not $RestartCmd) {
        Write-Host ""
        Write-Skip "$Name 无法自动启动（需要手动启动或配置 RestartCmd）"
        return
    }

    Write-Host ""
    Write-Info "启动 $Name..."

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = $RestartCmd
    if ($RestartArgs) {
        $psi.Arguments = $RestartArgs -join " "
    }
    if ($WorkingDir) {
        $psi.WorkingDirectory = $WorkingDir
    }
    $psi.UseShellExecute  = $true        # Windows 下用 Shell 启动 GUI 进程
    $psi.WindowStyle      = "Minimized"

    [System.Diagnostics.Process]::Start($psi) | Out-Null

    # 等待端口就绪
    $attempts = 0
    $maxAttempts = 20
    $started = $false

    while ($attempts -lt $maxAttempts) {
        Start-Sleep -Seconds 2
        if (& $CheckCmd) {
            $started = $true
            break
        }
        $attempts++
        Write-Host "." -NoNewline
    }

    if ($started) {
        Write-Host ""
        Write-Ok "$Name 已启动 (端口 $port)"
    } else {
        Write-Host ""
        Write-Fail "$Name 启动超时，请检查日志"
    }
}

# ============================================================
# 主流程
# ============================================================

Clear-Host
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          SmartAgent4 — Windows 一键部署脚本                    ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Info "项目目录: $PROJECT_ROOT"
Write-Info "参数: SkipDeps=$SkipDeps  Watch=$Watch  FullRestart=$FullRestart"

# ============================================================
# Step 1: 环境检查
# ============================================================
Write-Step "Step 1 — 环境检查"

# Node.js
$nodeVersion = $null
try { $nodeVersion = node --version } catch {}
if (-not $nodeVersion) {
    Write-Fail "未检测到 Node.js，请先安装 Node 22 LTS"
    Write-Host "       下载地址: https://nodejs.org/"
    exit 1
}
$nodeMajor = [int](($nodeVersion -replace "^v", "").Split(".")[0])
if ($nodeMajor -lt 22) {
    Write-Fail "Node 版本 $nodeVersion 不符合要求（需要 >= 22）"
    exit 1
}
Write-Ok "Node.js $nodeVersion"

# pnpm
$pnpmVersion = $null
try { $pnpmVersion = pnpm --version } catch {}
if (-not $pnpmVersion) {
    Write-Info "未检测到 pnpm，正在安装..."
    npm install -g pnpm --silent
    $pnpmVersion = pnpm --version
}
Write-Ok "pnpm $pnpmVersion"

# .env
if (-not (Test-Path "$PROJECT_ROOT\.env")) {
    Write-Fail "未找到 .env 文件，请从 .env.example 创建并配置"
    Write-Host "       cp .env.example .env  &&  notepad .env"
    exit 1
}
Write-Ok ".env 已配置"

# ============================================================
# Step 2: 启动依赖服务（PostgreSQL + 可选 AI 服务）
# ============================================================
Write-Step "Step 2 — 启动依赖服务"

# PostgreSQL
$pgServices = Get-Service | Where-Object { $_.Name -match "postgresql|postgres" }
if ($pgServices) {
    $stoppedPg = $pgServices | Where-Object { $_.Status -ne "Running" }
    if ($stoppedPg) {
        Write-Info "正在启动 PostgreSQL..."
        foreach ($svc in $stoppedPg) {
            Start-Service -Name $svc.Name -ErrorAction SilentlyContinue
        }
        Start-Sleep 3
    }

    $pgRunning = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
    if ($pgRunning) {
        Write-Ok "PostgreSQL (端口 5432)"
    } else {
        Write-Fail "PostgreSQL 启动失败，请检查服务配置"
        exit 1
    }
} else {
    Write-Fail "未检测到 PostgreSQL，请先安装 PostgreSQL 16"
    exit 1
}

# ============================================================
# Step 3: 安装/更新依赖
# ============================================================
Write-Step "Step 3 — 依赖安装"

if (-not $SkipDeps) {
    if (Test-Path "$PROJECT_ROOT\node_modules") {
        Write-Info "node_modules 存在，跳过（强制重装请删除该目录）"
    } else {
        Write-Info "正在安装依赖 (pnpm install)..."
        Push-Location $PROJECT_ROOT
        pnpm install 2>&1 | Out-Null
        Pop-Location
        Write-Ok "依赖安装完成"
    }
} else {
    Write-Skip "跳过依赖安装 (SkipDeps)"
}

# ============================================================
# Step 4: 数据库迁移
# ============================================================
Write-Step "Step 4 — 数据库迁移"

Write-Info "执行 drizzle-kit push..."
Push-Location $PROJECT_ROOT
pnpm db:push *>&1 | ForEach-Object {
    if ($_ -match "error|failed|fail") {
        Write-Host $_ -ForegroundColor Red
    } else {
        Write-Host $_ -ForegroundColor Gray
    }
}
Pop-Location
Write-Ok "数据库迁移完成"

# ============================================================
# Step 5: 启动智能服务（Emotions / AIRI）
# ============================================================
Write-Step "Step 5 — 启动智能服务"

Write-Host ""
Write-Host "  [提示] 以下服务需要手动启动或配置自动启动脚本:" -ForegroundColor Yellow
Write-Host "         - Emotions System (port 8000): 情感渲染微服务" -ForegroundColor Gray
Write-Host "         - AIRI Server   (port 6121): Live2D 角色服务" -ForegroundColor Gray
Write-Host ""

# ============================================================
# Step 6: 启动 / 重启主应用
# ============================================================
Write-Step "Step 6 — 主应用"

$mainRunning = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($mainRunning) {
    if ($FullRestart) {
        Write-Info "停止旧主服务..."
        Stop-ServiceByPort 3000
    } else {
        Write-Skip "主服务已在运行 (端口 3000)，使用 Ctrl+C 停止后重新运行可更新代码"
        Write-Host ""
        goto :WatchSection
    }
}

Write-Info "启动主应用 (pnpm dev)..."
Write-Host ""

Push-Location $PROJECT_ROOT
pnpm dev
Pop-Location

:WatchSection
# ============================================================
# Watch 模式（持续监控 + 日志）
# ============================================================
if ($Watch) {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  监控模式: 每 30 秒检测服务健康状态" -ForegroundColor Cyan
    Write-Host "  按 Ctrl+C 停止" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray

    while ($true) {
        Start-Sleep -Seconds 30
        Clear-Host
        Write-Host ""
        Write-Host "[ $(Get-Date -Format 'HH:mm:ss') ] 服务健康检查" -ForegroundColor Cyan

        $allOk = $true
        foreach ($svc in $SERVICES.GetEnumerator()) {
            $port = $svc.Value.Port
            $running = & $svc.Value.CheckCmd
            $status = if ($running) { "✅ 运行中" } else { "⚠️  未运行"; $allOk = $false }
            Write-Host "  $($svc.Key.PadRight(20))  :  $status" -ForegroundColor $(if ($running) { "Green" } else { "Yellow" })
        }

        if (-not $allOk) {
            Write-Host ""
            Write-Host "[WARN] 部分服务不可用，重新运行本脚本以重启" -ForegroundColor Yellow
        }
    }
}
