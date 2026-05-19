#!/bin/bash
#
# SmartAgent4 (demo_0423) — Manus 沙箱一键部署脚本
# 使用方法: bash scripts/manus-deploy.sh
#
# 此脚本会自动完成以下工作：
#   1. 安装并启动 PostgreSQL
#   2. 创建数据库和用户
#   3. 生成 .env 配置文件
#   4. 安装 Node.js 依赖
#   5. 推送数据库表结构
#   6. 启动开发服务器
#
set -e

# ============================================================
# 颜色定义
# ============================================================
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# 可配置变量（可通过环境变量覆盖）
# ============================================================
DB_USER="${DB_USER:-smartagent}"
DB_PASS="${DB_PASS:-smartagent123}"
DB_NAME="${DB_NAME:-smart_agent}"
DB_PORT="${DB_PORT:-5432}"
APP_PORT="${APP_PORT:-3000}"
JWT_SECRET="${JWT_SECRET:-manus-sandbox-test-secret-key-2026}"

# LLM 配置：优先使用沙箱预设的环境变量
LLM_API_KEY="${OPENAI_API_KEY:-sk-placeholder}"
LLM_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
LLM_MODEL="${OPENAI_DEFAULT_MODEL:-deepseek-v4-flash}"

# 其他 API Keys
DASHSCOPE_API_KEY_VAL="${DASHSCOPE_API_KEY:-}"
NEWSDATA_API_KEY_VAL="${NEWSDATA_API_KEY:-}"
AMAP_API_KEY_VAL="${AMAP_API_KEY:-}"
FEISHU_APP_ID_VAL="${FEISHU_APP_ID:-}"
FEISHU_APP_SECRET_VAL="${FEISHU_APP_SECRET:-}"

# ============================================================
# 项目根目录
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"
log_info "项目目录: $PROJECT_DIR"

# ============================================================
# Step 1: 安装 PostgreSQL
# ============================================================
if command -v psql &>/dev/null; then
    log_info "PostgreSQL 已安装，跳过安装步骤"
else
    log_info "正在安装 PostgreSQL..."
    sudo apt-get update -y -qq
    sudo apt-get install -y -qq postgresql postgresql-contrib
fi

# 启动 PostgreSQL
if pg_isready -q 2>/dev/null; then
    log_info "PostgreSQL 已在运行"
else
    log_info "正在启动 PostgreSQL..."
    sudo pg_ctlcluster 14 main start 2>/dev/null || sudo service postgresql start
    sleep 2
    if pg_isready -q; then
        log_info "PostgreSQL 启动成功"
    else
        log_error "PostgreSQL 启动失败"
        exit 1
    fi
fi

# ============================================================
# Step 2: 创建数据库和用户
# ============================================================
log_info "配置数据库..."

# 创建用户（如果不存在）
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

# 创建数据库（如果不存在）
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# 授权
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;" 2>/dev/null

# 确保 pg_hba.conf 允许密码认证
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file;" | xargs)
if ! sudo grep -q "host.*all.*all.*127.0.0.1.*md5\|host.*all.*all.*127.0.0.1.*scram" "$PG_HBA" 2>/dev/null; then
    log_warn "pg_hba.conf 可能需要手动添加密码认证规则"
fi

log_info "数据库配置完成: $DB_NAME (用户: $DB_USER)"

# ============================================================
# Step 3: 生成 .env 文件
# ============================================================
ENV_FILE="$PROJECT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    log_warn ".env 文件已存在，将备份为 .env.bak"
    cp "$ENV_FILE" "$ENV_FILE.bak"
fi

cat > "$ENV_FILE" << EOF
# ===== SmartAgent4 Manus 沙箱部署配置 =====
# 由 manus-deploy.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')

# 数据库配置
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}

# JWT 密钥
JWT_SECRET=${JWT_SECRET}

# LLM 配置（阿里百炼 DeepSeek）
OPENAI_API_KEY=${LLM_API_KEY}
OPENAI_BASE_URL=${LLM_BASE_URL}
OPENAI_MODEL=${LLM_MODEL}
OPENAI_DEFAULT_MODEL=${LLM_MODEL}

# 认证配置 — 跳过 OAuth（沙箱测试模式）
SKIP_AUTH=true
VITE_SKIP_OAUTH=true

# Emotions-System（禁用，沙箱中无此微服务）
EMOTIONS_SYSTEM_ENABLED=true

# DashScope（百炼 API Key）
DASHSCOPE_API_KEY=${DASHSCOPE_API_KEY_VAL}

# LangSmith（禁用）
LANGSMITH_TRACING=false

# 服务端口
PORT=${APP_PORT}
NODE_ENV=development

# 默认人格
DEFAULT_CHARACTER_ID=xiaozhi

# 新闻数据
NEWSDATA_API_KEY=${NEWSDATA_API_KEY_VAL}

# 高德地图
AMAP_API_KEY=${AMAP_API_KEY_VAL}

# 飞书 officeAgent
FEISHU_APP_ID=${FEISHU_APP_ID_VAL}
FEISHU_APP_SECRET=${FEISHU_APP_SECRET_VAL}
EOF

log_info ".env 文件已生成"

# ============================================================
# Step 4: 安装 Node.js 依赖
# ============================================================
if [ -d "$PROJECT_DIR/node_modules" ] && [ -f "$PROJECT_DIR/node_modules/.pnpm/lock.yaml" ]; then
    log_info "node_modules 已存在，跳过安装（如需重装请先删除 node_modules）"
else
    log_info "正在安装依赖 (pnpm install)..."
    pnpm install --frozen-lockfile 2>&1 | tail -5
    log_info "依赖安装完成"
fi

# ============================================================
# Step 5: 推送数据库表结构
# ============================================================
log_info "正在同步数据库表结构 (drizzle-kit push)..."
npx drizzle-kit push --force 2>&1 | tail -5
log_info "数据库表结构同步完成"

# ============================================================
# Step 6: 启动开发服务器
# ============================================================
log_info "========================================"
log_info "  部署完成！正在启动开发服务器..."
log_info "  访问地址: http://localhost:${APP_PORT}"
log_info "========================================"

# ============================================================
# 注意：必须通过 env 命令将关键变量注入到进程环境中
# 原因：ESM 模块中的模块级常量（如 SKIP_AUTH）在 dotenv.config 执行之前就被评估
#       如果这些变量只在 .env 中而不在进程环境中，模块加载时会读取到 undefined
# ============================================================
exec env \
  SKIP_AUTH=true \
  VITE_SKIP_OAUTH=true \
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}" \
  JWT_SECRET="${JWT_SECRET}" \
  OPENAI_API_KEY="${LLM_API_KEY}" \
  OPENAI_BASE_URL="${LLM_BASE_URL}" \
  OPENAI_MODEL="${LLM_MODEL}" \
  OPENAI_DEFAULT_MODEL="${LLM_MODEL}" \
  DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY_VAL}" \
  NEWSDATA_API_KEY="${NEWSDATA_API_KEY_VAL}" \
  AMAP_API_KEY="${AMAP_API_KEY_VAL}" \
  FEISHU_APP_ID="${FEISHU_APP_ID_VAL}" \
  FEISHU_APP_SECRET="${FEISHU_APP_SECRET_VAL}" \
  NODE_ENV=development \
  PORT="${APP_PORT}" \
  pnpm dev
