# SmartAgent4 飞书 OfficeAgent 凭证与权限配置指南

**作者**：Manus AI
**日期**：2026-04-27

本文档详细说明了在 SmartAgent4 项目中，为了将当前 Mock 版本的 OfficeAgent 升级为真实的飞书集成，需要获取的飞书凭证信息以及必须开启的权限清单。

## 1. 当前 OfficeAgent 状态分析

根据对项目代码库（特别是 `server/agent/tools/feishuTools.ts` 和 `server/agent/domains/officeAgent.ts`）的分析，当前的 OfficeAgent 处于 **Mock（模拟）状态**。

在 `mcp-config.json` 中，目前仅配置了高德地图和网易云音乐的 MCP 服务，**尚未配置真实的飞书 MCP 服务**。现有的飞书工具（`feishu_send_message`、`feishu_create_event`、`feishu_create_group`）均为内置的模拟实现，仅返回预设的成功响应，并未真正调用飞书 API。

根据 `REPO_ANALYSIS_V0.5_BATCH2.md` 和 `INTERFACE_DESIGN_V0.5_BATCH2.md` 的规划，项目计划接入官方的 `@larksuiteoapi/lark-mcp` 来实现真实的飞书协同功能。

## 2. 需要获取的飞书凭证信息

要启用真实的飞书 MCP 服务，您需要在飞书开放平台创建一个企业自建应用，并获取以下核心凭证：

| 凭证名称 | 说明 | 获取位置 |
| :--- | :--- | :--- |
| **App ID** | 飞书应用的唯一标识符 | 飞书开发者后台 -> 应用详情 -> 凭证与基础信息 |
| **App Secret** | 飞书应用的密钥，用于 API 认证 | 飞书开发者后台 -> 应用详情 -> 凭证与基础信息 |

### 2.1 身份认证模式选择

飞书 MCP 支持两种调用身份，您需要根据实际需求选择并配置：

1. **应用身份（Tenant Access Token）**：
   * **适用场景**：发送系统通知、管理公共群组、创建公共日程等。
   * **配置要求**：仅需 App ID 和 App Secret。
   * **限制**：无法读取用户的私有数据（如个人私聊消息、个人文档）。

2. **用户身份（User Access Token）**：
   * **适用场景**：以用户本人的名义发送消息、读取用户的个人日程、访问用户的私有文档等。
   * **配置要求**：除了 App ID 和 App Secret，还需要在飞书开发者后台配置 **OAuth 2.0 重定向 URL**（本地测试通常为 `http://localhost:3000/callback`），并在启动 MCP 时进行终端登录授权。

## 3. 需要开启的飞书权限清单 (Scope)

根据 OfficeAgent 的功能定义（发送消息、创建日程、创建群组），您需要在飞书开发者后台为应用申请以下权限。

### 3.1 消息与群组相关权限 (IM)

要实现 `feishu_send_message` 和 `feishu_create_group`（对应真实 MCP 工具 `im.v1.message.create` 和 `im.v1.chat.create`），需要申请以下权限：

| 权限名称 | 权限 Scope | 说明 |
| :--- | :--- | :--- |
| **获取与发送单聊、群组消息** | `im:message` | 允许应用发送文本、富文本等各类消息 |
| **以应用身份发送消息** | `im:message.send_as_bot` | 允许应用以机器人的身份发送消息 |
| **以用户身份发送消息** | `im:message.send_as_user` | （可选）如果需要以用户本人名义发送消息则必须开启 |
| **创建群组** | `im:chat:create` | 允许应用创建新的群聊 |
| **获取群组信息** | `im:chat` | 允许应用读取群组的基础信息 |

*注意：发送消息前，必须确保应用已开启“机器人”能力，并且接收消息的用户在应用的“可用范围”内。*

### 3.2 日程相关权限 (Calendar)

要实现 `feishu_create_event`（对应真实 MCP 工具 `calendar.v4.calendarEvent.create`），需要申请以下权限：

| 权限名称 | 权限 Scope | 说明 |
| :--- | :--- | :--- |
| **获取、创建、更新和删除日历及日程** | `calendar:calendar` | 允许应用管理日历和日程事件 |
| **以应用身份创建日程** | `calendar:calendar.event:create_as_bot` | 允许应用以机器人的身份创建日程 |
| **以用户身份创建日程** | `calendar:calendar.event:create_as_user` | （可选）如果需要以用户本人名义创建日程则必须开启 |

## 4. 接入配置步骤指引

当您准备好上述凭证并开通权限后，可以按照以下步骤在 SmartAgent4 中开启真实的飞书功能：

1. **安装依赖**：
   确保项目中已安装飞书官方 MCP 包：
   ```bash
   npm install @larksuiteoapi/lark-mcp
   ```

2. **修改 `mcp-config.json`**：
   在 `servers` 数组中添加飞书 MCP 的配置：
   ```json
   {
     "id": "feishu",
     "name": "飞书协同",
     "transport": "stdio",
     "enabled": true,
     "category": "office",
     "command": "npx",
     "args": [
       "-y",
       "@larksuiteoapi/lark-mcp",
       "mcp",
       "-a", "${FEISHU_APP_ID}",
       "-s", "${FEISHU_APP_SECRET}",
       "-t", "preset.im.default,preset.calendar.default"
     ]
   }
   ```

3. **配置环境变量**：
   在 `.env` 文件中添加您的凭证：
   ```env
   FEISHU_APP_ID=cli_xxxxxxxxxxxx
   FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. **更新 Agent Card**：
   修改 `server/agent/agent-cards/officeAgent.json`，将 `tools` 列表中的 Mock 工具名替换为真实的飞书 MCP 工具名（如 `im.v1.message.create`、`im.v1.chat.create`、`calendar.v4.calendarEvent.create`）。

5. **移除 Mock 实现**：
   在 `server/agent/smartAgentApp.ts` 中，移除或注释掉 `registerFeishuTools(this.toolRegistry)` 的调用，避免内置 Mock 工具与真实 MCP 工具冲突。

完成以上步骤后，重启服务，OfficeAgent 即可使用真实的飞书 API 执行跨域协同任务。
