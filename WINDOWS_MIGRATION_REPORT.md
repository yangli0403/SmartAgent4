# SmartAgent4 Windows 本地化迁移评估报告

## 1. 评估概述

为了将 SmartAgent4 从 Manus 云端沙盒（Linux 环境）平滑迁移到本地 Windows 笔记本运行，我们对项目的代码库、环境依赖和工具链进行了全面扫描。

整体而言，SmartAgent4 的底层架构设计已经具备了良好的跨平台基础。核心的文件系统操作和进程管理模块（如 `appBrowserTools.ts` 和 `fileSystemTools.ts`）已经内置了 `win32` 平台的分支逻辑。然而，由于项目长期在 Manus 平台上开发和测试，代码中深度耦合了部分 Manus 特有的运行时插件、域名白名单以及云端 LLM 代理服务。

## 2. 核心修改项分析

为了在 Windows 本地成功运行，必须对以下几个关键领域进行修改。

### 2.1 移除 Manus 平台深度耦合

当前前端构建配置（`vite.config.ts`）强依赖于 `vite-plugin-manus-runtime` 插件，并且服务器的 `allowedHosts` 被硬编码为 Manus 的内部域名。在本地环境中，这些配置会导致构建失败或网络请求被拦截。必须将该插件移除或设为条件加载，并将本地的 `localhost` 和 `127.0.0.1` 作为主要的访问入口。

此外，系统的认证模块（`server/_core/oauth.ts`）包含了 Manus 特有的 OAuth 回调逻辑。在本地单机运行场景下，建议通过环境变量强制开启 `SKIP_AUTH=true`，以绕过复杂的云端鉴权流程。

### 2.2 LLM 服务本地化切换

目前代码中（如 `server/_core/llm.ts` 和 `langchainAdapter.ts`）默认将 `OPENAI_BASE_URL` 指向了 Manus 的内部代理网关（`https://forge.manus.im/v1/chat/completions`）。在脱离 Manus 环境后，该网关将不可访问。

必须修改代码逻辑，优先读取本地 `.env` 文件中配置的第三方大模型 API（如 OpenAI 官方接口、字节跳动 ARK 接口，或本地部署的 Ollama 服务），并更新 `.env.example` 提供清晰的本地化配置指引。

### 2.3 补全 MCP Server 路由注册

在之前的开发中，虽然我们实现了“文件整理大师”的底层逻辑，但在本地 MCP Server 的入口文件（`server/mcp/index.ts`）中，尚未将 `analyze_directory`、`find_duplicates` 等新工具注册到 `/execute` 路由的 `switch` 分支中。这会导致本地客户端调用这些工具时返回“未知工具”错误。必须在迁移分支中补全这部分路由映射。

## 3. 环境依赖与工具链差异

在 Windows 上运行该项目，需要准备以下基础环境：

| 依赖项 | Windows 方案 | 说明 |
| :--- | :--- | :--- |
| **Node.js** | Node.js 18+ (LTS) | 核心运行环境，建议使用 nvm-windows 管理版本。 |
| **包管理器** | pnpm | 项目使用 pnpm，需通过 `npm install -g pnpm` 全局安装。 |
| **数据库** | MySQL 8.0+ | 必须在本地安装 MySQL 服务，或使用 Docker Desktop 运行 MySQL 容器。 |
| **Python** | Python 3.10+ | 用于运行 Emotions-System 语音合成微服务。 |

值得庆幸的是，项目在 `package.json` 中已经使用了 `cross-env` 来处理跨平台的环境变量注入（如 `NODE_ENV=development`），这避免了 Windows 命令行不支持直接设置环境变量的问题。

## 4. 迁移技能（Skill）创建评估

鉴于您有 10 多个类似的项目需要从 Manus 迁移到 Windows 本地，**非常有必要创建一个通用的“Manus 到 Windows 迁移技能”**。

现有的 `YS_skills/system-dev` 技能主要面向 Linux/Bash 环境（其底层脚本如 `git_setup.sh` 和 `git_phase_commit.sh` 均强依赖 Bash）。新的迁移技能可以固化以下自动化流程：
1. 自动扫描并剥离 `vite-plugin-manus-runtime`。
2. 自动重写 LLM 代理地址为标准 OpenAI 格式。
3. 自动生成 Windows 友好的 `.env.example` 和 `start.bat` 启动脚本。
4. 自动检查并修复路径硬编码问题。

## 5. 下一步行动计划

我将在当前仓库中创建一个名为 `windows-compat` 的新分支，并实施上述所有必要的代码修改。修改完成后，我将为您编写一份详细的 Windows 本地启动指南。
