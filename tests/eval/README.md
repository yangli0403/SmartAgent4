# SmartAgent4 领域分类评测框架

> 对应 scratchpad `##3.领域分类评测数据集` 的全部实现。

## 目录结构

```
tests/eval/
├── README.md                        # 本文件
├── generate_testset.ts              # 模板生成器（seed=42, 幂等）
├── testset.jsonl                    # 生成的 610 条 JSONL
├── eval_classify.ts                 # 评测入口（mock LLM 可脱网跑通）
├── deliverable.md                   # 6 件产出 + 跑通数字 + 下一步建议
├── harness/
│   ├── mockLLM.ts                   # 4 模式 mock LLM
│   ├── mockLLM.test.ts              # 15 个单测
│   ├── runSmartAgentClassify.ts     # 启动 classifyNode 的薄封装
│   └── metrics.ts                   # 4 主指标 + 6 辅指标 + Markdown 渲染
└── reports/
    ├── baseline.json                # JSON 报告
    └── baseline.md                  # Markdown 报告
```

## 5 分钟上手

```bash
cd D:\DEMO\SmartAgent4_demo_v1

# 1) 生成数据集（固定 seed，幂等）
npx tsx tests/eval/generate_testset.ts --out tests/eval/testset.jsonl
# 预期：[generate_testset] Wrote 610 cases to tests/eval/testset.jsonl (seed=42)

# 2) 跑 mock baseline（默认 mock + DISABLE_SHORTCUTS=true，纯净模式）
DISABLE_SHORTCUTS=true EVAL_MOCK_LLM=true npx tsx tests/eval/eval_classify.ts
# 预期：
#   tests/eval/reports/baseline.json
#   tests/eval/reports/baseline.md
#   控制台打印 4 个主指标

# 3) 跑 mock LLM 单测
npx vitest run tests/eval/harness/mockLLM.test.ts
# 预期：15 个单测全部通过
```

## 切换真实 LLM

mock baseline 是"框架自测"，证明 refine 函数和 metric 计算正确。**真实 baseline** 是下一步：

```bash
# 配置 .env（任一即可）
# OPENAI_API_KEY=...  +  OPENAI_BASE_URL=...
# ARK_API_KEY=...  +  ARK_API_KEY=...
# DASHSCOPE_API_KEY=...

# 跑真实 baseline（注意耗时：610 条 × 1-3s/条 = 10-30 分钟）
DISABLE_SHORTCUTS=true LLM_MODE=real npx tsx tests/eval/eval_classify.ts
```

## 评测开关

| Env Var | 默认 | 说明 |
|---------|------|------|
| `EVAL_MOCK_LLM` | (未设) | 设为 `true` 进入 mock 模式 |
| `LLM_MODE` | (未设=real) | `mock` / `real` / `scripted` |
| `DISABLE_SHORTCUTS` | (eval 默认 true) | 关闭 scene activation + canShortCircuit |

mock 模式自动注入假 API key，无需真实环境变量。

## 指标说明

### 主指标（4）
- `domainAcc` — 域分类准确率
- `complexityAcc` — 复杂度准确率
- `agentsExactAcc` — requiredAgents 精确匹配率
- `fullAcc` — 三项全对率

### 辅指标（6）
- 每域 P/R/F1（macro / micro）
- 误判矩阵（confusion matrix 7×7）
- query 长度分段准确率（short / medium / long）
- edge case 子集准确率（8 个 refine 函数各一组）
- 延迟 p50/p95
- refine 触发占比

详见 `C:\Users\Administrator\.mavis\agents\coder\workspace\tests-eval-design\metrics-spec.md`。

## 添加新测试用例

### 方式 1：模板（推荐）

修改 `tests/eval/generate_testset.ts` 的对应 `*_TEMPLATES` 数组（`NAVIGATION_TEMPLATES` / `MULTIMEDIA_TEMPLATES` / 等），然后重新跑 `npx tsx tests/eval/generate_testset.ts --out tests/eval/testset.jsonl`。

每个域的模板会自动套上 3 种风格 × 3 种长度扰动。

### 方式 2：边界 case

修改 `buildEdgeCaseSeeds()` 添加新 case。建议每加一个就给它打 `refine:xxx` 标签，便于后续按规则筛选。

### 方式 3：对抗

修改 `buildAdversarialSeeds()`。

### 方式 4：手动 JSONL

直接往 `testset.jsonl` 追加条目，每行一个符合 schema 的 JSON：

```json
{"id":"manual_001","query":"...","dialogue_history":[],"context":{...},"label":{"domain":"navigation","complexity":"simple","requiredAgents":["navigationAgent"]},"tags":["manual"],"source":"real","notes":"..."}
```

## 数据集 Schema

```json
{
  "id": "nav_0001",
  "query": "帮我导航到虹桥机场",
  "dialogue_history": [],
  "context": {
    "userId": "test_user_001",
    "sessionId": "sess_001",
    "location": { "city": "上海" },
    "currentTime": "2026-06-10T12:00:00+08:00",
    "platform": "windows"
  },
  "label": {
    "domain": "navigation",
    "complexity": "simple",
    "requiredAgents": ["navigationAgent"]
  },
  "tags": ["smoke", "style:command", "length:short", "domain:navigation"],
  "source": "template",
  "notes": "纯导航，无歧义"
}
```

详见 `C:\Users\Administrator\.mavis\agents\coder\workspace\tests-eval-design\dataset-design.md`。

## 项目代码改动说明

为支持 `npx tsx` 独立跑通 mock LLM，对 `SmartAgent4` 项目代码做了 2 处最小改动：

### 1. 新增 `server/agent/supervisor/classifyLLMCall.ts`
薄包装，根据 env var 决定调真实 LLM 还是返回 mock label。
- 默认（env var 未设）行为完全等价于原 `callLightLLMStructured`
- `EVAL_MOCK_LLM=true` / `LLM_MODE=mock`：从 userMessage 解析 `[GT_JSON]...[/GT_JSON]` 块返回 mock label
- 自动注入假 API key（mock 模式专用），避免 `langchainAdapter.ts` 顶层 import 抛错

### 2. 修改 `server/agent/supervisor/classifyNode.ts`
- 第 22 行：`import { callLightLLMStructured }` → `import { classifyLLMCall } from "./classifyLLMCall"`
- 第 711 行：`callLightLLMStructured(...)` → `classifyLLMCall(...)`
- 第 632 行附近：增加 `const shortcutsEnabled = process.env.DISABLE_SHORTCUTS !== "true";`
- 包住 scene activation + canShortCircuit 的两个 if 块

**单元测试影响**：
- `classifyNode.test.ts` 全部通过（它只测 routeByComplexity + refine 函数 + resolveAgentsForDomain，不调 classifyNode 本身）
- 其他 unit test 不受影响（默认 env var 未设，wrapper 透传）

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `[LangChainAdapter] ARK_API_KEY is required` | env var 没设，且 mock 模式未启用 | 加 `EVAL_MOCK_LLM=true` 或设 `OPENAI_API_KEY` |
| `Cannot find module ... agentCardRegistry` | 路径深度错 | 用 `process.cwd()` 基准 |
| 跑得很慢 | 真实 LLM 模式 + 网络抖动 | 改 mock 模式验证框架 |
| 全是 general | mock LLM 没装上 | 检查 `EVAL_MOCK_LLM=true` 是否生效（看日志） |
| refine 函数没触发 | DISABLE_SHORTCUTS=true 把整个短路关了 | 改 false 测全链路 |

## 相关文档

- 设计根入口：`C:\Users\Administrator\.mavis\agents\coder\workspace\tests-eval-design\README.md`
- 数据集设计：`...\tests-eval-design\dataset-design.md`
- 指标规范：`...\tests-eval-design\metrics-spec.md`
- mock LLM 设计：`...\tests-eval-design\mock-llm-design.md`
- 跑通流程：`...\tests-eval-design\baseline-flow.md`

## 下一步（下一轮 worker）

1. **真实 LLM baseline**：配 API key + `LLM_MODE=real`，跑真实 baseline（耗时 10-30 分钟）
2. **优化实施**：把 `classifyNode` 的 LLM 调用抽到独立分类模型（scratchpad `##1.方向 B` 方案 2：专用模型蒸馏）
3. **跑 optimized baseline + compare_runs.ts**：对比 baseline ↔ optimized 的 delta
4. **人工核验**：抽 50 条 ground truth 由人复核（参考 scratchpad `##3.10` 约束 6）
