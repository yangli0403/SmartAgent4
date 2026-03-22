# SmartAgent4 Windows 本地运行指南

本文档指导您在 Windows 笔记本上从零开始运行 SmartAgent4 项目。

## 1. 环境准备

在开始之前，请确保您的 Windows 系统上已安装以下软件。

| 软件 | 最低版本 | 安装方式 | 说明 |
| :--- | :--- | :--- | :--- |
| **Node.js** | 18.0+ | [nodejs.org](https://nodejs.org/) 下载 LTS 版本 | 核心运行环境 |
| **pnpm** | 8.0+ | 安装 Node.js 后运行 `npm install -g pnpm` | 包管理器 |
| **MySQL** | 8.0+ | 方式一：[MySQL Installer](https://dev.mysql.com/downloads/installer/)；方式二：Docker Desktop | 数据库 |
| **Git** | 2.30+ | [git-scm.com](https://git-scm.com/) | 代码管理 |

如果您选择使用 Docker 来运行 MySQL（推荐），还需要安装 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)。

## 2. 克隆项目

打开 PowerShell 或 CMD，执行以下命令：

```powershell
git clone https://github.com/yangli0403/SmartAgent4.git
cd SmartAgent4
git checkout windows-compat
```

## 3. 启动数据库

**方式一：使用 Docker（推荐）**

项目根目录已提供 `docker-compose.yml`，一条命令即可启动 MySQL：

```powershell
docker-compose up -d
```

这将在本地 3306 端口启动一个 MySQL 8.0 实例，数据库名为 `smart_agent`，root 密码为 `password`。

**方式二：使用本地安装的 MySQL**

如果您已安装 MySQL，请手动创建数据库：

```sql
CREATE DATABASE smart_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 4. 配置环境变量

将 `.env.example` 复制为 `.env`，然后编辑：

```powershell
copy .env.example .env
notepad .env
```

**必须配置的项目：**

```env
# 数据库连接（根据您的实际情况修改）
DATABASE_URL=mysql://root:password@localhost:3306/smart_agent

# LLM API（至少配置一种）
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
```

如果您使用本地 Ollama 作为 LLM：

```env
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_DEFAULT_MODEL=qwen2.5:14b
```

## 5. 一键启动

**方式一：双击 `start.bat`**

直接在文件管理器中双击项目根目录下的 `start.bat`，脚本会自动完成依赖安装、数据库迁移和服务启动。

**方式二：PowerShell 启动**

```powershell
.\start.ps1
```

如果遇到 PowerShell 执行策略限制，请先运行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**方式三：手动启动**

```powershell
pnpm install
pnpm run db:push
pnpm run dev
```

## 6. 启动 MCP 本地 Server

MCP Server 需要在本地独立运行，用于执行文件系统操作和应用控制。请在另一个终端窗口中运行：

```powershell
# 方式一：双击 start-mcp-server.bat
# 方式二：手动启动
node smartagent-mcp-server.js
```

## 7. 访问应用

服务启动后，打开浏览器访问：

- **前端界面**：http://localhost:5173
- **后端 API**：http://localhost:3000
- **MCP Server**：http://localhost:3100

## 8. 可选：启动 Emotions-System 语音合成

如果需要语音合成功能，请在另一个终端中启动 Python 微服务：

```powershell
cd path\to\Emotions-System
pip install -r requirements.txt
python main.py
```

确保 `.env` 中 `EMOTIONS_SYSTEM_URL=http://localhost:8000` 已正确配置。

## 9. 常见问题

**Q: 启动时报 `vite-plugin-manus-runtime` 找不到？**

A: 请确保您在 `windows-compat` 分支上。该分支已移除了 Manus 平台专属插件。

**Q: 数据库连接失败？**

A: 请检查 MySQL 是否已启动，以及 `.env` 中的 `DATABASE_URL` 是否正确。如果使用 Docker，运行 `docker ps` 确认容器状态。

**Q: LLM 调用失败？**

A: 请确认 `.env` 中至少配置了一种 LLM API（OpenAI / ARK / OpenRouter / Ollama）。如果使用 OpenAI，请确保网络可以访问 `api.openai.com`。

**Q: MCP 工具无法执行？**

A: 请确保 MCP 本地 Server 已在另一个终端中启动（端口 3100）。
