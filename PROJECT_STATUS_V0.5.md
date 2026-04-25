# SmartAgent4 v0.5 第一批迭代 — 项目状态跟踪

**当前阶段**：第 2 阶段（架构与设计）— 等待用户检查点 2 确认
**目标分支**：`demo_0423`
**对应方案文档**：`docx/优化计划/SmartAgent4_Demo_v0.5_0424.md`

## 阶段总览
- [x] 第 1 阶段：仓库分析与用户故事拆解（已 commit & push）
- [x] 第 2 阶段：架构与设计（已生成 ARCHITECTURE_V0.5.md，待检查点 2）
- [ ] 第 3 阶段：接口与数据结构定义
- [ ] 第 4 阶段：TDD 实现（4 个用户故事）
- [ ] 第 5 阶段：需求反思
- [ ] 第 6 阶段：质量与覆盖率审查 + TESTING.md
- [ ] 第 6b 阶段：CLAUDE.md 更新
- [ ] 第 7 阶段：交付

## 用户故事完成度
| 编号 | 故事 | 状态 | 子代理 |
|---|---|---|---|
| US-1 | ChatUiMessage 扩展 thinking 类型 | 待开始 | A |
| US-2 | 方言 ASR 模型升级 | 待开始 | B |
| US-3 | AIRI 半身 viewMode | 待开始 | A |
| US-4 | Supervisor 流式事件总线 | 待开始 | C |
| US-5 | tRPC streamMessage subscription | 待开始 | C |
| US-6 | 前端 ThinkingBubble 组件 | 待开始 | D |
| US-7 | Cockpit 集成（halfBody + 流式） | 待开始 | D |

## 测试基线
- 命令：`pnpm test`
- 通过：45/46 测试文件，651/654 用例
- 已知失败：`server/chat.test.ts`（3 用例，因沙箱无 MySQL，**与本次迭代无关**）

## 风险登记
- R1：tRPC subscription 改造可能涉及前端 link 配置，必要时退化为独立 SSE 端点
- R2：Live2D 资源在沙箱可能加载失败，halfBody 验证以几何单元测试为主
