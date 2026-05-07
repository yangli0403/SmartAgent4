$ErrorActionPreference = "Stop"

function Fail([string]$message) {
  Write-Host ""
  Write-Host "[ERROR] $message" -ForegroundColor Red
  exit 1
}

function Info([string]$message) {
  Write-Host "[INFO] $message" -ForegroundColor Cyan
}

$nodeVersion = node -v
if (-not $nodeVersion) {
  Fail "未检测到 Node.js，请先安装 Node 22 LTS。"
}

$nodeMajor = [int](($nodeVersion -replace "^v", "").Split(".")[0])
if ($nodeMajor -lt 22) {
  Fail "当前 Node 版本为 $nodeVersion，项目要求 >= 22。请先升级 Node 再运行。"
}
Info "Node 版本检查通过：$nodeVersion"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Fail "未检测到 pnpm，请先安装 pnpm。"
}
Info "pnpm 已安装：$(pnpm -v)"

if (-not (Test-Path ".env")) {
  Fail "未找到 .env，请先配置环境变量。"
}
Info "检测到 .env"

$postgresServices = Get-Service | Where-Object { $_.Name -match "postgre|postgres" }
if (-not $postgresServices) {
  Fail "未检测到 PostgreSQL 服务，请先安装 PostgreSQL 16。"
}

$stopped = $postgresServices | Where-Object { $_.Status -ne "Running" }
foreach ($svc in $stopped) {
  Info "尝试启动 PostgreSQL 服务：$($svc.Name)"
  Start-Service -Name $svc.Name
}

Info "执行数据库迁移..."
pnpm db:push

Info "启动开发服务..."
pnpm dev
