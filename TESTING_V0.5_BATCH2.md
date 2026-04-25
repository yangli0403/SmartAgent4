# SmartAgent v0.5 第二批迭代测试报告

> system-dev 第 6 阶段交付物
> 版本：v0.5 第二批迭代（Omni 端到端语音 + 新闻助理 + 飞书 OfficeAgent + 行程规划 + 订餐 ServiceAgent + 跨域协同）
> 分支：`demo_0423`
> 日期：2026-04-25

---

## 1. 测试策略概览

本项目采用三层测试策略：

| 测试层级 | 目标 | 工具 | 运行环境 |
|---|---|---|---|
| 单元测试 | 验证单个函数/类的输入输出正确性 | Vitest + @testing-library/react | node / jsdom |
| 集成测试 | 验证模块间交互（Agent Card 注册、工具注册、路由挂载） | Vitest + supertest | node |
| 静态分析测试 | 验证 Prompt 关键词、配置文件结构、类型定义 | Vitest + fs | node |

**端到端测试说明**：由于 SmartAgent4 启动依赖 MySQL + GitHub OAuth 配置，沙箱中无法直接运行端到端测试。所有用户故事通过单元测试 + 集成测试 + 静态分析测试三层覆盖，确保代码质量。

---

## 2. 测试基线对照

| 指标 | v0.5 Batch1 基线 | v0.5 Batch2 当前 | 变化 |
|---|---|---|---|
| Test Files（通过） | 63 | **74** | **+11** |
| Test Files（失败） | 1 | 1 | 不变 |
| Tests（通过用例） | 756 | **885** | **+129** |
| Tests（失败） | 3 | 3 | 不变 |
| UTC 用例覆盖率 | — | **67/67** | **100%** |

**说明**：唯一持续失败的 `server/chat.test.ts`（3 个用例）是基线已存在的 MySQL 依赖问题，与第二批迭代改动**完全无关**。所有新增测试 100% 通过。

---

## 3. 测试环境与配置

### 3.1 运行测试命令

```bash
# 运行全量测试
pnpm test
# 或
npx vitest run

# 仅运行第二批迭代新增测试
npx vitest run server/agent/tools/__tests__/newsTools.test.ts \
  server/agent/tools/__tests__/itineraryTools.test.ts \
  server/agent/tools/__tests__/serviceTools.test.ts \
  server/agent/tools/__tests__/feishuTools.test.ts \
  server/agent/domains/__tests__/newAgents.test.ts \
  server/routers/__tests__/omniTokenRouter.test.ts \
  server/agent/__tests__/batch2_coverage_supplement.test.ts \
  server/agent/supervisor/__tests__/crossDomain.test.ts \
  client/src/lib/__tests__/omniRealtimeClient.test.ts \
  client/src/components/cockpit/__tests__/ItineraryTimeline.test.tsx \
  client/src/components/cockpit/__tests__/OmniToggle.test.tsx
```

### 3.2 依赖的外部服务

| 服务 | 测试中的处理方式 |
|---|---|
| MySQL | 不依赖，所有新增工具为内置 Mock |
| DashScope API | Omni Token 路由测试通过环境变量 Mock |
| 飞书 API | feishuTools 为完全 Mock 实现 |
| LLM (OpenAI) | Agent 测试通过 vi.mock 桩化 |

### 3.3 vitest.config.ts 变更

在 `coverage.include` 中新增 11 个第二批迭代文件作为覆盖统计目标：

```typescript
// v0.5 Batch2 新增覆盖目标
"server/agent/tools/newsTools.ts",
"server/agent/tools/itineraryTools.ts",
"server/agent/tools/serviceTools.ts",
"server/agent/tools/feishuTools.ts",
"server/agent/domains/officeAgent.ts",
"server/agent/domains/serviceAgent.ts",
"server/routers/omniTokenRouter.ts",
"server/agent/supervisor/executeNode.ts",
"server/agent/supervisor/classifyNode.ts",
"client/src/lib/omniRealtimeClient.ts",
"client/src/components/cockpit/ItineraryTimeline.tsx",
```

---

## 4. 全量测试用例清单（第二批迭代新增）

### 4.1 后端工具测试

| 测试文件 | 用户故事 | 用例数 | 测试类型 | 状态 |
|---|---|---|---|---|
| `server/agent/tools/__tests__/newsTools.test.ts` | US-B1 新闻工具 | 15 | 单元 | ✅ |
| `server/agent/tools/__tests__/itineraryTools.test.ts` | US-B4 行程规划 | 15 | 单元 | ✅ |
| `server/agent/tools/__tests__/serviceTools.test.ts` | US-B3 生活服务 | 16 | 单元 | ✅ |
| `server/agent/tools/__tests__/feishuTools.test.ts` | US-B2 飞书工具 | 14 | 单元 | ✅ |

### 4.2 后端 Agent 与路由测试

| 测试文件 | 用户故事 | 用例数 | 测试类型 | 状态 |
|---|---|---|---|---|
| `server/agent/domains/__tests__/newAgents.test.ts` | US-B2/B3 Agent | 12 | 单元 | ✅ |
| `server/routers/__tests__/omniTokenRouter.test.ts` | US-B6 Omni Token | 4 | 集成 | ✅ |
| `server/agent/__tests__/batch2_coverage_supplement.test.ts` | 多个 US | 11 | 集成/静态 | ✅ |
| `server/agent/supervisor/__tests__/crossDomain.test.ts` | US-B9 跨域协同 | 12 | 集成 | ✅ |

### 4.3 前端组件与 Hook 测试

| 测试文件 | 用户故事 | 用例数 | 测试类型 | 状态 |
|---|---|---|---|---|
| `client/src/lib/__tests__/omniRealtimeClient.test.ts` | US-B7 Omni 前端 | 12 | 单元 | ✅ |
| `client/src/components/cockpit/__tests__/ItineraryTimeline.test.tsx` | US-B8 行程 UI | 12 | 组件 | ✅ |
| `client/src/components/cockpit/__tests__/OmniToggle.test.tsx` | US-B7/B8 | 6 | 组件 | ✅ |

### 4.4 汇总

| 类别 | 测试文件数 | 测试用例数 | 通过 |
|---|---|---|---|
| 后端工具 | 4 | 60 | ✅ |
| 后端 Agent/路由 | 4 | 39 | ✅ |
| 前端组件/Hook | 3 | 30 | ✅ |
| **合计** | **11** | **129** | **✅** |

---

## 5. 用户验收测试（UTC）覆盖清单

### US-B1：新闻工具（newsTools）

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B1-1 | get_latest_news 返回数组 | newsTools.test.ts | ✅ |
| UTC-B1-2 | 每条新闻包含 title/summary/source/publishedAt | newsTools.test.ts | ✅ |
| UTC-B1-3 | category 过滤生效 | newsTools.test.ts | ✅ |
| UTC-B1-4 | limit 参数限制返回条数 | newsTools.test.ts | ✅ |
| UTC-B1-5 | GeneralAgent 工具列表包含 get_latest_news | batch2_coverage_supplement.test.ts | ✅ |
| UTC-B1-6 | ToolRegistry 注册成功 | newsTools.test.ts | ✅ |
| UTC-B1-7 | 早安播报场景工具共存 | batch2_coverage_supplement.test.ts | ✅ |

### US-B2：飞书 OfficeAgent

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B2-1 | feishu_send_message 返回 messageId | feishuTools.test.ts | ✅ |
| UTC-B2-2 | feishu_create_event 返回 eventId | feishuTools.test.ts | ✅ |
| UTC-B2-3 | feishu_create_group 返回 chatId | feishuTools.test.ts | ✅ |
| UTC-B2-4 | 发送消息必须包含 receiverId 和 content | feishuTools.test.ts | ✅ |
| UTC-B2-5 | 创建日程必须包含 title 和 startTime | feishuTools.test.ts | ✅ |
| UTC-B2-6 | 创建群组必须包含 name 和 memberIds | feishuTools.test.ts | ✅ |
| UTC-B2-7 | OfficeAgent 实例化成功 | newAgents.test.ts | ✅ |
| UTC-B2-8 | System Prompt 包含防御性指示 | batch2_coverage_supplement.test.ts | ✅ |
| UTC-B2-9 | availableTools 数组长度 > 0 | batch2_coverage_supplement.test.ts | ✅ |

### US-B3：生活服务 ServiceAgent

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B3-1 | search_restaurants 返回数组 | serviceTools.test.ts | ✅ |
| UTC-B3-2 | 每个餐厅包含 name/cuisine/rating/distance | serviceTools.test.ts | ✅ |
| UTC-B3-3 | cuisine 过滤生效 | serviceTools.test.ts | ✅ |
| UTC-B3-4 | place_order 返回 orderId | serviceTools.test.ts | ✅ |
| UTC-B3-5 | 下单必须包含 restaurantId 和 items | serviceTools.test.ts | ✅ |
| UTC-B3-6 | ToolRegistry 注册成功 | serviceTools.test.ts | ✅ |
| UTC-B3-7 | ServiceAgent 实例化成功 | newAgents.test.ts | ✅ |
| UTC-B3-8 | availableTools 包含 search_restaurants 和 place_order | newAgents.test.ts | ✅ |
| UTC-B3-9 | System Prompt 支持位置上下文注入 | newAgents.test.ts | ✅ |

### US-B4：行程规划工具（itineraryTools）

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B4-1 | generate_itinerary 返回行程对象 | itineraryTools.test.ts | ✅ |
| UTC-B4-2 | 行程包含 stops 数组 | itineraryTools.test.ts | ✅ |
| UTC-B4-3 | 每个 stop 包含 name/time/duration/type | itineraryTools.test.ts | ✅ |
| UTC-B4-4 | destination 参数必填 | itineraryTools.test.ts | ✅ |
| UTC-B4-5 | ToolRegistry 注册成功 | itineraryTools.test.ts | ✅ |
| UTC-B4-6 | NavigationAgent 工具列表包含 generate_itinerary | batch2_coverage_supplement.test.ts | ✅ |
| UTC-B4-7 | 返回包含顶层 destination 和 date | itineraryTools.test.ts | ✅ |

### US-B5：领域路由扩展

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B5-1 | classifyNode 支持 office 领域 | crossDomain.test.ts | ✅ |
| UTC-B5-2 | classifyNode 支持 service 领域 | crossDomain.test.ts | ✅ |
| UTC-B5-3 | resolveAgentsForDomain("office") 返回 officeAgent | crossDomain.test.ts | ✅ |
| UTC-B5-4 | resolveAgentsForDomain("service") 返回 serviceAgent | crossDomain.test.ts | ✅ |
| UTC-B5-5 | Prompt 中 office 描述包含飞书关键词 | batch2_coverage_supplement.test.ts | ✅ |
| UTC-B5-6 | Prompt 中 service 描述包含餐厅关键词 | batch2_coverage_supplement.test.ts | ✅ |

### US-B6：Omni Token 路由

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B6-1 | GET /api/omni/token 返回 200 | omniTokenRouter.test.ts | ✅ |
| UTC-B6-2 | 响应包含 token 和 expireAt | omniTokenRouter.test.ts | ✅ |
| UTC-B6-3 | token 格式为非空字符串 | omniTokenRouter.test.ts | ✅ |
| UTC-B6-4 | expireAt 为有效时间戳 | omniTokenRouter.test.ts | ✅ |
| UTC-B6-5 | 未配置 API Key 时返回错误 | batch2_coverage_supplement.test.ts | ✅ |
| UTC-B6-6 | 路由挂载到 /api/omni/token | batch2_coverage_supplement.test.ts | ✅ |

### US-B7：Omni 前端 WebSocket 客户端

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B7-1 | OmniRealtimeClient 实例化成功 | omniRealtimeClient.test.ts | ✅ |
| UTC-B7-2 | connect() 建立 WebSocket 连接 | omniRealtimeClient.test.ts | ✅ |
| UTC-B7-3 | disconnect() 关闭连接 | omniRealtimeClient.test.ts | ✅ |
| UTC-B7-4 | 接收文本消息触发 onMessage 回调 | omniRealtimeClient.test.ts | ✅ |
| UTC-B7-5 | 接收音频数据触发 onAudio 回调 | omniRealtimeClient.test.ts | ✅ |
| UTC-B7-6 | 连接错误触发 onError 回调 | omniRealtimeClient.test.ts | ✅ |
| UTC-B7-7 | Cockpit 渲染 Omni Toggle 开关 | OmniToggle.test.tsx | ✅ |
| UTC-B7-8 | Toggle 开启后文本输入隐藏 | OmniToggle.test.tsx | ✅ |
| UTC-B7-9 | Toggle 开启后显示语音指示器 | OmniToggle.test.tsx | ✅ |
| UTC-B7-10 | Toggle 关闭后恢复文本输入 | OmniToggle.test.tsx | ✅ |

### US-B8：行程时间轴 UI

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B8-1 | ItineraryTimeline 渲染行程标题 | ItineraryTimeline.test.tsx | ✅ |
| UTC-B8-2 | 渲染所有 stops | ItineraryTimeline.test.tsx | ✅ |
| UTC-B8-3 | 每个 stop 显示时间和名称 | ItineraryTimeline.test.tsx | ✅ |
| UTC-B8-4 | 当前 stop 高亮显示 | ItineraryTimeline.test.tsx | ✅ |
| UTC-B8-5 | 点击 stop 触发 onStopClick | ItineraryTimeline.test.tsx | ✅ |
| UTC-B8-6 | 空 stops 数组显示提示 | ItineraryTimeline.test.tsx | ✅ |
| UTC-B8-7 | AssistantPanel 识别 [itinerary:...] 标记 | OmniToggle.test.tsx | ✅ |

### US-B9：跨域协同

| UTC ID | 验证目标 | 测试文件 | 状态 |
|---|---|---|---|
| UTC-B9-1 | cross_domain 返回多个 Agent | crossDomain.test.ts | ✅ |
| UTC-B9-2 | planNode 生成多步骤计划 | crossDomain.test.ts | ✅ |
| UTC-B9-3 | inputMapping 跨步骤数据传递 | crossDomain.test.ts | ✅ |
| UTC-B9-4 | 步骤执行顺序正确 | crossDomain.test.ts | ✅ |
| UTC-B9-5 | 单域任务不误分类为 cross_domain | batch2_coverage_supplement.test.ts | ✅ |
| UTC-B9-6 | office 和 service 作为独立领域 | batch2_coverage_supplement.test.ts | ✅ |

---

## 6. 覆盖率报告摘要

### 6.1 新增代码统计

| 文件 | 行数 | 导出/函数数 | 对应测试文件 |
|---|---|---|---|
| `server/agent/tools/newsTools.ts` | 223 | 8 | newsTools.test.ts (15) |
| `server/agent/tools/itineraryTools.ts` | 226 | 11 | itineraryTools.test.ts (15) |
| `server/agent/tools/serviceTools.ts` | 279 | 8 | serviceTools.test.ts (16) |
| `server/agent/tools/feishuTools.ts` | 243 | 7 | feishuTools.test.ts (14) |
| `server/agent/domains/officeAgent.ts` | 89 | 2 | newAgents.test.ts (6) |
| `server/agent/domains/serviceAgent.ts` | 89 | 2 | newAgents.test.ts (6) |
| `server/routers/omniTokenRouter.ts` | 43 | 3 | omniTokenRouter.test.ts (4) |
| `client/src/lib/omniRealtimeClient.ts` | 308 | 14 | omniRealtimeClient.test.ts (12) |
| `client/src/components/cockpit/ItineraryTimeline.tsx` | 221 | 11 | ItineraryTimeline.test.tsx (12) |
| `client/src/hooks/useOmniMode.ts` | 153 | 15 | OmniToggle.test.tsx (6) |

### 6.2 测试代码比率

| 指标 | 数值 |
|---|---|
| 新增源代码行数 | 1,874 |
| 新增测试代码行数 | 2,071 |
| 测试/源代码比率 | **1.11:1** |

### 6.3 未覆盖区域说明

由于 vitest 覆盖率报告在当前沙箱环境中未生成文本输出（v8 provider 兼容性问题），覆盖率通过以下方式间接验证：

1. **UTC 用例全覆盖**：67/67 用户测试用例在测试文件中均有对应断言
2. **测试/源代码比率 > 1:1**：测试代码行数超过源代码行数
3. **导出函数全覆盖**：每个新增源文件的所有导出函数/类均有对应测试
4. **边界情况覆盖**：包含参数校验、空值处理、错误状态等边界测试

---

## 7. 关键改动的测试覆盖说明

### 7.1 新闻工具（US-B1）

`newsTools.ts` 实现为内置 Mock 工具，返回预定义的新闻数据。测试覆盖：
- 默认返回 5 条新闻，支持 `limit` 参数调整
- `category` 过滤（科技、财经、体育、娱乐、汽车）
- 每条新闻结构完整性（title/summary/source/publishedAt/url）
- ToolRegistry 注册和 Zod Schema 校验

### 7.2 飞书工具与 OfficeAgent（US-B2）

`feishuTools.ts` 实现 3 个 Mock 工具（发消息、创建日程、创建群组）。测试覆盖：
- 每个工具的必填参数校验（缺少参数返回错误）
- 返回结构正确性（messageId/eventId/chatId）
- OfficeAgent 的 System Prompt 包含跨域协同防御性指示
- Agent Card 工具列表完整性

### 7.3 生活服务工具与 ServiceAgent（US-B3）

`serviceTools.ts` 实现 `search_restaurants` 和 `place_order` 两个 Mock 工具。测试覆盖：
- 餐厅搜索支持 `cuisine` 过滤和 `maxDistance` 限制
- 下单返回 orderId 和预计送达时间
- ServiceAgent 的位置上下文注入

### 7.4 行程规划工具（US-B4）

`itineraryTools.ts` 实现 `generate_itinerary` Mock 工具。测试覆盖：
- 返回包含 destination/date/stops/totalDuration 的完整行程
- stops 数组中每个站点包含 name/time/duration/type
- NavigationAgent 工具列表已包含 generate_itinerary

### 7.5 Omni 端到端语音（US-B6/B7）

后端 Token 路由 + 前端 WebSocket 客户端。测试覆盖：
- Token 路由在有/无 API Key 时的不同响应
- OmniRealtimeClient 的连接/断开/消息/音频/错误回调
- Cockpit 页面的 Omni Toggle 开关状态切换

### 7.6 跨域协同（US-B5/B9）

classifyNode 和 planNode 扩展。测试覆盖：
- resolveAgentsForDomain 对 office/service 的正确路由
- cross_domain 返回多个 Agent
- Prompt 中新领域的关键词验证
- 单域任务不误分类为 cross_domain

---

## 8. 已知限制与遗留问题

### 8.1 沙箱端到端验证限制

与第一批迭代相同，SmartAgent4 启动需要 MySQL + GitHub OAuth 配置，沙箱中无法直接运行端到端测试。所有功能通过单元测试 + 集成测试 + 静态分析测试三层覆盖。

### 8.2 基线遗留测试失败

`server/chat.test.ts` 中 3 个用例因 MySQL 未配置而失败，与第二批迭代改动**完全无关**。

### 8.3 后续验证建议

1. 在本地环境配置 MySQL + .env 后运行完整端到端联调
2. 配合飞书开放平台自建应用测试 OfficeAgent 真实链路
3. 配置 DashScope API Key 测试 Omni 模式真实语音交互
4. 跨域协同场景的完整 thinking 气泡事件序列验证

---

## 9. 变更记录

| 日期 | 版本 | 变更内容 |
|---|---|---|
| 2026-04-24 | v0.5 Batch1 | 新增 34 个测试用例（方言 ASR + AIRI 半身 + 可视化思考 + Supervisor 流式） |
| 2026-04-25 | v0.5 Batch2 | 新增 129 个测试用例（Omni + 新闻 + 飞书 + 行程 + 订餐 + 跨域协同） |

---

## 10. 验收 checklist

| 检查项 | 状态 |
|---|---|
| 第 4 阶段所有 9 个用户故事都有靶向测试 | ✅ |
| 67 个 UTC 用例 100% 覆盖 | ✅ |
| 新增 129 个测试 100% 通过 | ✅ |
| 全量回归测试只剩基线遗留失败（3 个 MySQL 依赖） | ✅ |
| 测试/源代码比率 > 1:1 | ✅ |
| vitest.config.ts 覆盖目标已更新 | ✅ |
| 基线遗留问题已识别且不阻塞 | ✅ |
