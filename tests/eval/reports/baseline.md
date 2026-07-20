# baseline_2026-06-10T10-15-22-296Z

## 配置
- llmMode: `mock`
- mockSubMode: `groundTruth`
- disableShortcuts: `true`
- seed: `42`
- totalCases: **610**

## 主指标
| 指标 | 值 |
|------|----|
| domain 准确率 | 97.38% |
| complexity 准确率 | 98.52% |
| requiredAgents 精确匹配率 | 97.38% |
| 端到端全对率 | 97.38% |
| 正确条数 | 594 / 610 |

## 每域 P/R/F1
| 域 | precision | recall | f1 | support |
|----|-----------|--------|----|---------|
| navigation | 94.0% | 100.0% | 96.9% | 110 |
| multimedia | 100.0% | 100.0% | 100.0% | 111 |
| file_system | 100.0% | 100.0% | 100.0% | 93 |
| office | 100.0% | 98.7% | 99.4% | 78 |
| service | 100.0% | 100.0% | 100.0% | 60 |
| general | 89.5% | 91.7% | 90.6% | 84 |
| cross_domain | 100.0% | 89.2% | 94.3% | 74 |
| **macro avg** | 97.7% | 97.1% | 97.3% | - |
| **micro avg** | 97.4% | 97.4% | 97.4% | - |

## query 长度分段准确率
| 长度 | domain 准确率 |
|------|--------------|
| short (≤15) | 97.6% |
| medium (16-40) | 97.2% |
| long (41+) | 97.6% |

## edge case 子集准确率
| 子集 | 准确率 | 总数 |
|------|--------|------|
| adv:cross_domain_camo | 87.5% | 8 |
| adv:empty | 100.0% | 2 |
| adv:extreme_long | 100.0% | 1 |
| adv:irony | 100.0% | 3 |
| adv:long_injection | 100.0% | 4 |
| adv:noise_prefix | 100.0% | 6 |
| adv:typo | 100.0% | 6 |
| dir_inventory | 100.0% | 8 |
| disk | 100.0% | 8 |
| follow_up | 100.0% | 12 |
| music | 100.0% | 12 |
| news | 100.0% | 12 |
| similarity | 100.0% | 8 |
| vehicle | 100.0% | 12 |
| weather | 100.0% | 8 |

## refine 函数触发占比
| 规则 | 触发率 |
|------|--------|
| news_intent | 1.5% |
| weather_intent | 1.1% |

## 短路 / 场景激活
- 短路命中: 0 / 610 (0.0%)
- 场景激活: 0 / 610 (0.0%)

## 延迟 (毫秒)
| p50 | p95 | min | max |
|-----|-----|-----|-----|
| 1 | 1 | 0 | 17 |

## 误判矩阵
行 = 真实域, 列 = 预测域

| real \ pred | navigation | multimedia | file_system | office | service | general | cross_domain |
|---------------|---|---|---|---|---|---|---|
| navigation | 110 | 0 | 0 | 0 | 0 | 0 | 0 |
| multimedia | 0 | 111 | 0 | 0 | 0 | 0 | 0 |
| file_system | 0 | 0 | 93 | 0 | 0 | 0 | 0 |
| office | 0 | 0 | 0 | 77 | 0 | 1 | 0 |
| service | 0 | 0 | 0 | 0 | 60 | 0 | 0 |
| general | 7 | 0 | 0 | 0 | 0 | 77 | 0 |
| cross_domain | 0 | 0 | 0 | 0 | 0 | 8 | 66 |

## Top 误判 case
| id | query | expected | got |
|----|-------|----------|-----|
| crs_0039 | 能否帮我在飞书群里同步今天的新闻和明天日程，谢谢 | cross_domain | general |
| crs_0040 | 帮我在飞书群里同步今天的新闻和明天日程 | cross_domain | general |
| crs_0041 | 请帮我在飞书群里同步今天的新闻和明天日程，谢谢 | cross_domain | general |
| crs_0042 | 麻烦你在飞书群里同步今天的新闻和明天日程 | cross_domain | general |
| crs_0043 | 可以帮我在飞书群里同步今天的新闻和明天日程，谢谢 | cross_domain | general |
| crs_0044 | 请帮我在飞书群里同步今天的新闻和明天日程 | cross_domain | general |
| crs_0045 | 我准备在飞书群里同步今天的新闻和明天日程。我现在在上海市区，... | cross_domain | general |
| crs_0046 | 我想在飞书群里同步今天的新闻和明天日程，谢谢 | cross_domain | general |
| gen_0525 | 请帮我今天天气不错 | general | navigation |
| gen_0526 | 麻烦你今天天气不错 | general | navigation |

## 下一步建议
- 查看 edge case 子集准确率，定位**最弱**的 refine 函数
- 查看误判矩阵，找出**最高频**的误判路径（如 office → service）
- 切到 `LLM_MODE=real` 跑真实 baseline，对比 mock 数字
- 优化后跑 `compare_runs.ts` 看 delta
