# 需求反思报告 — v0.5 第二批迭代

**日期**：2026-04-25
**分支**：`demo_0423`

---

## 一、对比结果总结

### 1.1 方案文档 vs 实现

| 方案功能点 | 实现状态 | 说明 |
|---|---|---|
| 端到端语音大模型（Omni 模式） | ✅ 已实现 | 后端 Token 路由 + 前端 WebSocket 客户端 + useOmniMode Hook |
| 飞书办公协同 | ✅ 已实现 | OfficeAgent + feishuTools（Mock 3 个工具） |
| 全天候行程规划 | ✅ 已实现 | itineraryTools + ItineraryTimeline UI 组件 |
| 新闻与生活服务 | ✅ 已实现 | newsTools + serviceTools + ServiceAgent |
| 跨域协同高潮场景 | ✅ 已实现 | classifyNode/planNode 扩展 + inputMapping 跨步骤数据传递 |

### 1.2 架构文档 vs 实现

| 架构决策 | 遵循情况 |
|---|---|
| ADR-B1: Omni 模式前端隔离 | ✅ OmniRealtimeClient 完全独立于 Supervisor 链路 |
| ADR-B2: 新闻/订餐 Mock 工具 | ✅ 全部为内置 Mock，无外部依赖 |
| ADR-B3: 跨域 inputMapping | ✅ 复用现有 resolveInputMapping 机制 |
| ADR-B4: Agent Card 注册 | ✅ 新增 officeAgent.json 和 serviceAgent.json |

### 1.3 接口设计文档 vs 实现

| 接口契约 | 实现一致性 |
|---|---|
| GET /api/omni/token 响应结构 | ✅ 返回 `{ success, token, expireAt }` |
| newsTools Zod Schema | ✅ 支持 category 过滤和 limit 参数 |
| itineraryTools 返回结构 | ✅ 包含 destination/date/stops/totalDuration |
| serviceTools 返回结构 | ✅ search_restaurants 和 place_order 两个工具 |
| feishuTools 返回结构 | ✅ 3 个工具均返回 JSON 结构 |
| OfficeAgent System Prompt | ✅ 包含跨域协同防御性指示 |
| ItineraryTimeline Props | ✅ 支持 itinerary/currentStopIndex/onStopClick |

---

## 二、发现的问题列表

### 问题 1：GeneralAgent 工具列表缺少 get_latest_news

- **严重程度**：中
- **描述**：方案文档要求 GeneralAgent 在"早安播报"场景中能调用 `get_latest_news`，但 `generalAgent.json` 的 tools 数组中未包含该工具。
- **纠正措施**：在 `generalAgent.json` 的 tools 数组中添加 `get_latest_news`。
- **状态**：✅ 已修复

### 问题 2：agentCardRegistry 测试断言数量过时

- **严重程度**：低
- **描述**：新增 2 个 Agent Card 后，`agentCardRegistry.test.ts` 中 `expect(registry.size()).toBe(4)` 断言失败。
- **纠正措施**：更新断言为 `toBe(6)` 并添加新 Agent 的 `has()` 检查。
- **状态**：✅ 已修复

### 问题 3：16 个 UTC 用例缺少测试覆盖

- **严重程度**：中
- **描述**：初始实现中有 16 个 UTC 用例（UTC-B1-5/7, B2-8/9, B4-6, B5-5/6, B6-5/6, B7-7~10, B8-7, B9-5/6）未在测试文件中显式覆盖。
- **纠正措施**：创建 `batch2_coverage_supplement.test.ts` 和 `OmniToggle.test.tsx` 补充全部缺失用例。
- **状态**：✅ 已修复

---

## 三、用户测试用例覆盖检查

| 用户故事 | UTC 总数 | 已覆盖 | 覆盖率 |
|---|---|---|---|
| US-B1 新闻工具 | 7 | 7 | 100% |
| US-B2 飞书 OfficeAgent | 9 | 9 | 100% |
| US-B3 生活服务 ServiceAgent | 9 | 9 | 100% |
| US-B4 行程规划工具 | 7 | 7 | 100% |
| US-B5 领域路由扩展 | 6 | 6 | 100% |
| US-B6 Omni Token | 6 | 6 | 100% |
| US-B7 Omni 前端 | 10 | 10 | 100% |
| US-B8 行程时间轴 UI | 7 | 7 | 100% |
| US-B9 跨域协同 | 6 | 6 | 100% |
| **合计** | **67** | **67** | **100%** |

---

## 四、最终验证结果

```
全量测试：885 通过 / 3 失败（已知 MySQL 依赖问题，与新代码无关）
新增测试：129 个，全部通过
UTC 用例覆盖率：67/67 = 100%
```

**结论**：第二批迭代的所有 9 个用户故事均已实现，67 个用户测试用例全部覆盖，架构和接口设计一致性良好。3 个失败测试均为已知的 MySQL 连接问题（`server/chat.test.ts`），与本次迭代无关。
