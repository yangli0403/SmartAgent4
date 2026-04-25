# SmartAgent4 v0.5 第二批迭代 — 仓库分析与用户故事

**作者**：Manus AI
**日期**：2026-04-25
**分支**：`demo_0423`
**对应方案文档**：`SmartAgent4智能座舱创新产品Demo优化迭代方案v0.5`

---

## 一、分析目标

在第一批迭代（可视化思考框架、方言 ASR、虚拟人半身）已完成的基础上，本次分析聚焦 v0.5 方案中 **尚未落地的第二批功能**，目标是：

1. 梳理现有代码库中可复用的模块与扩展点
2. 按技术依赖顺序拆解用户故事
3. 为每个故事定义机器可验证的验收标准

---

## 二、现有架构关键扩展点

### 2.1 Agent 注册机制

项目采用 **Agent Card + Registry** 模式。新增 Agent 需要：

1. 在 `server/agent/agent-cards/` 下新增 JSON 配置（定义 id、domain、tools、implementationClass）
2. 在 `server/agent/domains/` 下新增 Agent 类（继承 `BaseAgent`）
3. 在 `server/agent/domains/index.ts` 中导出
4. 在 `server/agent/smartAgentApp.ts` 的 `AGENT_MODULE_LOADERS` 中注册动态加载器

`classifyNode.ts` 的领域分类 Prompt 会通过 `DynamicPromptAssembler` 从 Registry 动态生成，新增 Agent Card 后分类器自动感知。

### 2.2 MCP 工具注册机制

外部 MCP 服务在 `mcp-config.json` 中声明（SSE 或 stdio 传输）。内置工具（如 `freeWeatherTools`、`memoryTools`）通过 `ToolRegistry.registerBuiltinTool()` 注册。新增工具只需：

1. 在 `server/mcp/` 或 `server/agent/tools/` 下编写工具实现
2. 在 `smartAgentApp.ts` 的 `initialize()` 中调用注册函数
3. 在对应 Agent Card 的 `tools` 数组中声明工具名

### 2.3 Supervisor 图节点

图节点链路：`classify → plan → execute → replan → respond → memoryExtract → reflection`。第一批迭代已确立 **不改节点内部** 的架构决策。新增领域只需：

- 在 `classifyNode.ts` 的 Prompt 中新增领域描述（动态 Prompt 自动处理）
- 在 `planNode.ts` 的 Prompt 中新增 Agent 能力描述（动态 Prompt 自动处理）
- `executeNode.ts` 通过 `agentRegistry[targetAgent]` 动态分发，无需改动

### 2.4 前端 Cockpit 页面

`Cockpit.tsx` 是车机中控主界面，已集成：ASR 输入、tRPC mutation 发送消息、SSE 流式事件订阅、ThinkingBubble 渲染、AIRI 虚拟人半身展示。新增前端功能的扩展点：

- 顶部区域可增加 Toggle 开关（Omni 模式）
- 右侧 `AssistantPanel` 可新增消息类型渲染（如行程时间轴卡片）
- 底部卡片区可扩展新功能入口

---

## 三、测试资产基线

| 指标 | 当前值 |
|------|--------|
| 测试文件总数 | 66 |
| 测试目录数 | 18 |
| v0.5 第一批新增测试文件 | 9 |
| v0.5 第一批新增用例数 | 34 |
| 全量通过用例 | 756 |
| 基线失败用例 | 3（chat.test.ts，依赖 PostgreSQL） |
| 前端 build | 通过 |

现有测试框架：Vitest 2.1 + @testing-library/react（jsdom 环境）。

---

## 四、第二批迭代用户故事

按 **Schema/共享类型 → 后端工具/Agent → 后端路由集成 → 前端 UI** 的技术依赖顺序排列。

### US-B1：新闻工具与可成长助理

**描述**：新增 `newsTools.ts`，提供 `get_latest_news` 内置工具。GeneralAgent 复用现有记忆工具 + 新闻工具，支持用户通过自然语言定义"早安播报"等自定义技能，Agent 将规则存入长期记忆并在触发时自动执行。

**验收标准**：
- AC-1：`get_latest_news` 工具注册到 ToolRegistry，接受 `category`（可选）和 `count`（默认 5）参数，返回结构化新闻列表（Mock 数据）
- AC-2：GeneralAgent 的 Agent Card 新增 `get_latest_news` 工具声明
- AC-3：单元测试覆盖 `get_latest_news` 的参数校验与 Mock 返回
- AC-4：静态分析（`pnpm build`）通过
- AC-5：自动化测试通过

**关联用户测试用例**：
- UTC-B1-1：调用 `get_latest_news` 返回包含 title/url/source/publishedAt 的新闻数组
- UTC-B1-2：调用 `get_latest_news({ category: "ai" })` 返回 AI 领域新闻
- UTC-B1-3：调用 `get_latest_news({ count: 3 })` 返回恰好 3 条新闻
- UTC-B1-4：调用 `get_latest_news({ category: "invalid_xxx" })` 返回空数组（无匹配分类）
- UTC-B1-5：GeneralAgent 工具列表包含 `get_latest_news`
- UTC-B1-6：newsTools 注册函数被调用后，ToolRegistry 中存在 `get_latest_news` 工具
- UTC-B1-7：「早安播报」场景——GeneralAgent 可依次调用 `memory_search` 和 `get_latest_news`（集成层验证工具共存）

---

### US-B2：OfficeAgent 与飞书 MCP 接入

**描述**：新增 `OfficeAgent`（继承 BaseAgent），专门处理办公协同任务。在 `mcp-config.json` 中声明飞书 MCP 服务配置（`@larksuiteoapi/lark-mcp`）。新增 Agent Card 定义 `office` 领域。

**验收标准**：
- AC-1：`server/agent/domains/officeAgent.ts` 存在，继承 BaseAgent，配置 System Prompt 包含飞书操作指引
- AC-2：`server/agent/agent-cards/officeAgent.json` 存在，domain 为 `office`，tools 包含飞书 MCP 工具名
- AC-3：`mcp-config.json` 新增飞书 MCP 服务配置项（enabled 默认 false，需用户配置 App ID/Secret）
- AC-4：`server/agent/domains/index.ts` 导出 OfficeAgent
- AC-5：`AGENT_MODULE_LOADERS` 中注册 OfficeAgent 动态加载器
- AC-6：单元测试覆盖 OfficeAgent 实例化与 System Prompt 生成
- AC-7：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B2-1：OfficeAgent 实例化成功，name 为 `officeAgent`
- UTC-B2-2：OfficeAgent 的 System Prompt 包含"飞书"关键词
- UTC-B2-3：OfficeAgent 的 System Prompt 包含"拉群"、"发消息"操作指引
- UTC-B2-4：Agent Card Registry 加载后包含 officeAgent，domain 为 `office`
- UTC-B2-5：classifyNode 动态 Prompt 包含 office 领域描述
- UTC-B2-6：OfficeAgent 的 Agent Card tools 列表包含飞书 MCP 工具名（如 `lark_im_create_chat`、`lark_im_send_message`）
- UTC-B2-7：mcp-config.json 包含飞书 MCP 服务配置项，enabled 默认为 false
- UTC-B2-8：OfficeAgent 的 System Prompt 包含防御性指示——"当上下文存在前置导航行程时，必须把行程摘要作为消息正文"
- UTC-B2-9：OfficeAgent 的 availableTools 数组长度 > 0

---

### US-B3：ServiceAgent 与订餐 Mock 工具

**描述**：新增 `ServiceAgent`（继承 BaseAgent）处理生活服务任务。新增 `serviceTools.ts` 提供 `search_restaurants`、`place_order` 两个 Mock 工具。Agent 在推荐前先调用 `memory_search` 获取用户口味偏好。

**验收标准**：
- AC-1：`server/agent/tools/serviceTools.ts` 存在，注册 `search_restaurants` 和 `place_order` 两个内置工具
- AC-2：`search_restaurants` 接受 `cuisine`（可选）、`location`（可选）参数，返回 Mock 餐厅列表
- AC-3：`place_order` 接受 `restaurantId`、`items` 参数，返回 Mock 订单确认
- AC-4：`server/agent/domains/serviceAgent.ts` 存在，继承 BaseAgent，tools 包含 `search_restaurants`、`place_order`、`memory_search`
- AC-5：`server/agent/agent-cards/serviceAgent.json` 存在，domain 为 `service`
- AC-6：单元测试覆盖两个 Mock 工具的参数校验与返回结构
- AC-7：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B3-1：`search_restaurants` 无参数调用返回默认餐厅列表（至少 3 家）
- UTC-B3-2：`search_restaurants({ cuisine: "川菜" })` 返回过滤后的结果，每项 cuisine 字段包含"川菜"
- UTC-B3-3：`search_restaurants({ location: "陆家嘴" })` 返回结果中 location 字段包含"陆家嘴"
- UTC-B3-4：`place_order` 返回包含 orderId、estimatedTime、status 的确认对象
- UTC-B3-5：`place_order` 缺少 restaurantId 参数时抛出校验错误
- UTC-B3-6：`place_order` 缺少 items 参数时抛出校验错误
- UTC-B3-7：ServiceAgent 工具列表包含 `memory_search`、`search_restaurants`、`place_order`
- UTC-B3-8：ServiceAgent 实例化成功，name 为 `serviceAgent`
- UTC-B3-9：ServiceAgent 的 System Prompt 包含"口味偏好"和"记忆"关键词

---

### US-B4：行程规划工具增强 NavigationAgent

**描述**：新增 `generate_itinerary` 内置工具，结合高德地图、天气工具，为用户生成包含时间节点、路线、耗时预估的完整行程单。NavigationAgent 的 Agent Card 新增该工具。

**验收标准**：
- AC-1：`server/agent/tools/itineraryTools.ts` 存在，注册 `generate_itinerary` 内置工具
- AC-2：`generate_itinerary` 接受 `destination`、`date`（可选）、`preferences`（可选）参数，返回结构化行程对象（含 stops 数组，每个 stop 包含 time/location/activity/duration）
- AC-3：NavigationAgent 的 Agent Card 新增 `generate_itinerary` 工具声明
- AC-4：单元测试覆盖行程生成的参数校验与 Mock 返回结构
- AC-5：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B4-1：`generate_itinerary({ destination: "上海" })` 返回包含至少 3 个 stops 的行程
- UTC-B4-2：每个 stop 包含 time、location、activity、duration 字段
- UTC-B4-3：`generate_itinerary({ destination: "上海", date: "2026-04-26" })` 返回行程中 stops 的 time 均在指定日期
- UTC-B4-4：`generate_itinerary({ destination: "上海", preferences: "美食" })` 返回行程中至少一个 stop 的 activity 包含餐饮相关内容
- UTC-B4-5：`generate_itinerary` 缺少 destination 参数时抛出校验错误
- UTC-B4-6：NavigationAgent 工具列表包含 `generate_itinerary`
- UTC-B4-7：返回的行程对象包含顶层 destination 和 date 字段

---

### US-B5：classifyNode 新增 office 和 service 领域路由

**描述**：更新 `classifyNode.ts` 的静态降级 Prompt，新增 `office`（办公协同）和 `service`（生活服务）两个领域描述。动态 Prompt 已通过 Agent Card Registry 自动感知，但静态降级 Prompt 也需同步更新以保持一致。

**验收标准**：
- AC-1：`CLASSIFY_SYSTEM_PROMPT` 包含 `office` 领域描述（飞书、拉群、发消息）
- AC-2：`CLASSIFY_SYSTEM_PROMPT` 包含 `service` 领域描述（订餐、外卖、餐厅推荐）
- AC-3：`PLAN_SYSTEM_PROMPT` 包含 officeAgent 和 serviceAgent 的能力描述
- AC-4：单元测试验证 Prompt 包含新领域关键词
- AC-5：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B5-1：classifyNode 静态 Prompt 包含 "office" 领域描述
- UTC-B5-2：classifyNode 静态 Prompt 包含 "service" 领域描述
- UTC-B5-3：planNode 静态 Prompt 包含 "officeAgent" 能力描述
- UTC-B5-4：planNode 静态 Prompt 包含 "serviceAgent" 能力描述
- UTC-B5-5：classifyNode 静态 Prompt 中 office 描述包含"飞书"、"拉群"、"发消息"关键词
- UTC-B5-6：classifyNode 静态 Prompt 中 service 描述包含"订餐"、"外卖"、"餐厅"关键词

---

### US-B6：Omni 端到端语音模式（后端 Token 接口）

**描述**：新增后端接口 `GET /api/omni/token`，用于获取 DashScope Qwen-Omni-Realtime 的临时 Token，避免前端暴露 API Key。

**验收标准**：
- AC-1：`server/omni/omniTokenRouter.ts` 存在，提供 `GET /api/omni/token` Express 路由
- AC-2：路由从环境变量 `DASHSCOPE_API_KEY` 读取 Key，调用 DashScope Token API 获取临时 Token
- AC-3：返回 `{ token, expireTime, wsUrl }` 结构
- AC-4：API Key 未配置时返回 503 和友好错误信息
- AC-5：路由在 `server/_core/index.ts` 中挂载
- AC-6：单元测试覆盖正常返回和缺少 Key 的错误场景
- AC-7：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B6-1：配置 API Key 后，`GET /api/omni/token` 返回 200 和 `{ token, expireTime, wsUrl }` 结构
- UTC-B6-2：返回的 token 为非空字符串
- UTC-B6-3：返回的 wsUrl 以 `wss://` 开头
- UTC-B6-4：返回的 expireTime 为有效的 ISO 时间戳且在未来
- UTC-B6-5：未配置 `DASHSCOPE_API_KEY` 环境变量时返回 503 和 `{ error }` 结构
- UTC-B6-6：路由已挂载到 Express app 的 `/api/omni/token` 路径

---

### US-B7：Omni 端到端语音模式（前端 WebSocket 客户端）

**描述**：新增 `client/src/lib/omniRealtimeClient.ts`，封装与 DashScope Qwen-Omni-Realtime 的 WebSocket 通信。在 `Cockpit.tsx` 中新增 Omni 模式 Toggle 开关，开启后绕过 ASR→LLM→TTS 链路，直接使用端到端语音。

**依赖**：US-B6（Token 接口）

**验收标准**：
- AC-1：`client/src/lib/omniRealtimeClient.ts` 存在，封装 WebSocket 连接、音频流发送、事件接收
- AC-2：支持 `connect(token, wsUrl)`、`sendAudio(pcmData)`、`disconnect()` 方法
- AC-3：支持 `onAudioDelta`、`onTextDelta`、`onToolCall`、`onError` 事件回调
- AC-4：`Cockpit.tsx` 新增 Omni 模式 Toggle 开关 UI
- AC-5：Toggle 开启时隐藏文本输入框，显示 Omni 语音状态指示器
- AC-6：单元测试覆盖 OmniRealtimeClient 的连接状态管理和事件分发
- AC-7：静态分析通过（`pnpm build`），自动化测试通过

**关联用户测试用例**：
- UTC-B7-1：OmniRealtimeClient 实例化后状态为 `idle`
- UTC-B7-2：调用 `connect()` 后状态变为 `connecting`
- UTC-B7-3：调用 `disconnect()` 后状态回到 `idle`
- UTC-B7-4：注册 `onTextDelta` 回调后，收到文本事件时回调被触发
- UTC-B7-5：注册 `onAudioDelta` 回调后，收到音频事件时回调被触发
- UTC-B7-6：注册 `onError` 回调后，WebSocket 错误时回调被触发
- UTC-B7-7：Cockpit 页面渲染包含 Omni Toggle 开关（data-testid="omni-toggle"）
- UTC-B7-8：Toggle 开启后文本输入区域隐藏
- UTC-B7-9：Toggle 开启后显示 Omni 语音状态指示器
- UTC-B7-10：Toggle 关闭后恢复文本输入区域

---

### US-B8：行程时间轴前端组件

**描述**：在前端新增 `ItineraryTimeline` 组件，用于渲染 `generate_itinerary` 返回的行程数据为精美的时间轴 UI。在 `AssistantPanel` 中识别包含行程数据的 assistant 消息并渲染该组件。

**依赖**：US-B4（行程工具）

**验收标准**：
- AC-1：`client/src/components/cockpit/ItineraryTimeline.tsx` 存在
- AC-2：组件接受 `stops: ItineraryStop[]` props，每个 stop 渲染时间、地点、活动、耗时
- AC-3：时间轴使用竖向布局，每个节点有连接线
- AC-4：`AssistantPanel.tsx` 能识别包含 `[itinerary:...]` 标记的消息并渲染 ItineraryTimeline
- AC-5：单元测试覆盖组件渲染和空数据处理
- AC-6：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B8-1：传入 3 个 stops 的数据，渲染 3 个时间轴节点
- UTC-B8-2：空 stops 数组时显示"暂无行程"占位
- UTC-B8-3：每个节点显示 time 和 location 文本
- UTC-B8-4：每个节点显示 activity 和 duration 文本
- UTC-B8-5：时间轴节点之间有连接线元素
- UTC-B8-6：传入 1 个 stop 时渲染 1 个节点（无连接线）
- UTC-B8-7：AssistantPanel 识别包含 `[itinerary:...]` 标记的消息并渲染 ItineraryTimeline 组件

---

### US-B9：跨域协同增强（行程 + 飞书拉群）

**描述**：增强 `classifyNode` 对 `cross_domain` 的识别能力，使其能正确拆解"规划行程并飞书拉群"类复合任务。在 `OfficeAgent` 的 System Prompt 中增加防御性指示：当上下文存在前置导航行程时，必须把行程摘要作为消息正文。

**依赖**：US-B2（OfficeAgent）、US-B4（行程工具）、US-B5（领域路由）

**验收标准**：
- AC-1：classifyNode 能将"帮我规划明天去上海的行程，顺便在飞书上拉个群通知张三李四"分类为 `cross_domain`
- AC-2：planNode 能为该任务生成包含 navigationAgent 和 officeAgent 的多步计划
- AC-3：OfficeAgent System Prompt 包含"当上下文存在前置导航行程时，必须把行程摘要作为消息正文"
- AC-4：单元测试验证跨域分类和计划生成
- AC-5：静态分析通过，自动化测试通过

**关联用户测试用例**：
- UTC-B9-1："帮我规划明天去上海的行程，顺便在飞书上拉个群通知张三李四"分类结果 domain 为 `cross_domain`
- UTC-B9-2：生成的计划包含至少 2 个步骤，分别指向 navigationAgent 和 officeAgent
- UTC-B9-3：计划中 officeAgent 步骤的 dependsOn 包含 navigationAgent 步骤的 id
- UTC-B9-4：OfficeAgent Prompt 包含行程摘要防御性指示
- UTC-B9-5："帮我查下明天上海天气"不应分类为 cross_domain（单域任务排除验证）
- UTC-B9-6："帮我在飞书上给张三发消息"不应分类为 cross_domain（单域 office 任务排除验证）

---

## 五、用户故事依赖关系与执行顺序

```
US-B1 (新闻工具)           ─── 无依赖，可独立开发
US-B2 (OfficeAgent)        ─── 无依赖，可独立开发
US-B3 (ServiceAgent)       ─── 无依赖，可独立开发
US-B4 (行程工具)           ─── 无依赖，可独立开发
US-B5 (领域路由)           ─── 依赖 US-B2, US-B3（需要新 Agent Card 已存在）
US-B6 (Omni Token 接口)    ─── 无依赖，可独立开发
US-B7 (Omni 前端客户端)    ─── 依赖 US-B6
US-B8 (行程时间轴 UI)      ─── 依赖 US-B4
US-B9 (跨域协同)           ─── 依赖 US-B2, US-B4, US-B5
```

**建议执行批次**：

| 批次 | 用户故事 | 说明 |
|------|----------|------|
| 第一批（并行） | US-B1, US-B2, US-B3, US-B4, US-B6 | 无依赖，可并行开发 |
| 第二批（串行） | US-B5 | 依赖第一批的 Agent Card |
| 第三批（并行） | US-B7, US-B8 | 分别依赖 US-B6 和 US-B4 |
| 第四批（串行） | US-B9 | 跨域集成，依赖多个前置故事 |

---

## 六、状态跟踪

详见 `PROJECT_STATUS_V0.5_BATCH2.md`。
