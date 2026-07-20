/**
 * tests/eval/eval_classify.ts
 *
 * 评测入口（可独立运行）：
 *   DISABLE_SHORTCUTS=true EVAL_MOCK_LLM=true npx tsx tests/eval/eval_classify.ts
 *
 * 行为：
 * - 默认 mock LLM 跑通（不需要外部 API）
 * - 输出 tests/eval/reports/baseline.json + .md
 *
 * 切换真实 LLM：
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=... npx tsx tests/eval/eval_classify.ts
 *   或：
 *   ARK_API_KEY=... npx tsx tests/eval/eval_classify.ts
 *
 * 注意：env vars 必须在所有 import 之前设置（因为 langchainAdapter
 * 顶层 import 会检查 API key）。本文件把所有依赖模块的 import
 * 移到 main() 内通过 await import() 完成。
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ===================================================================
// 第一阶段：只读 env / 路径工具
// ===================================================================

function setupEnv(): void {
  if (
    process.env.EVAL_MOCK_LLM === "true" ||
    process.env.LLM_MODE === "mock" ||
    process.env.LLM_MODE === "scripted"
  ) {
    if (!process.env.ARK_API_KEY && !process.env.OPENAI_API_KEY) {
      process.env.ARK_API_KEY = "eval-mock-fake-key";
    }
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = "https://mock.example.com/v1";
    }
    console.log("[eval_classify] Mock LLM mode enabled");
  } else {
    console.log("[eval_classify] Real LLM mode (require API key)");
  }
  // DISABLE_SHORTCUTS 默认 true（除非显式 false）
  if (process.env.DISABLE_SHORTCUTS === undefined) {
    process.env.DISABLE_SHORTCUTS = "true";
    console.log("[eval_classify] DISABLE_SHORTCUTS defaulting to true (pure test mode)");
  } else {
    console.log(`[eval_classify] DISABLE_SHORTCUTS=${process.env.DISABLE_SHORTCUTS}`);
  }
}

setupEnv();

// ===================================================================
// 主流程（所有依赖用 dynamic import）
// ===================================================================

async function main(): Promise<void> {
  // Dynamic imports —— 必须在 setupEnv() 之后
  const classifyMod = await import("./harness/runSmartAgentClassify");
  const metricsMod = await import("./harness/metrics");
  const registryMod = await import(
    "../../server/agent/discovery/agentCardRegistry"
  );
  const runClassifyForTestCase = classifyMod.runClassifyForTestCase;
  const computeMetrics = metricsMod.computeMetrics;
  const renderMarkdown = metricsMod.renderMarkdown;
  const getAgentCardRegistry = registryMod.getAgentCardRegistry;
  type ClassifyResult = classifyMod.ClassifyResult;
  type EvalReport = metricsMod.EvalReport;

  // 1. 加载 testset
  const testsetPath = path.resolve(process.cwd(), "tests/eval/testset.jsonl");
  if (!existsSync(testsetPath)) {
    console.error(`[eval_classify] testset.jsonl not found at ${testsetPath}`);
    console.error(`[eval_classify] Run: npx tsx tests/eval/generate_testset.ts > tests/eval/testset.jsonl`);
    process.exit(1);
  }

  const testCases = await loadTestset(testsetPath);
  console.log(`[eval_classify] Loaded ${testCases.length} test cases`);

  // 2. 注册 agent card（让 classifyNode 不报 "Registry empty"）
  const registry = getAgentCardRegistry();
  if (registry.size() === 0) {
    const cardsDir = path.resolve(process.cwd(), "server", "agent", "agent-cards");
    if (existsSync(cardsDir)) {
      await registry.loadFromDirectory(cardsDir);
      console.log(`[eval_classify] Loaded ${registry.size()} agent cards`);
    } else {
      console.warn(`[eval_classify] Agent cards dir not found: ${cardsDir}`);
    }
  }

  // 3. 跑每条用例
  const results: ClassifyResult[] = [];
  const startTime = Date.now();
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const result = await runClassifyForTestCase(tc);
    results.push(result);
    if ((i + 1) % 100 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = ((i + 1) / (elapsed / 1000)).toFixed(1);
      console.log(`[eval_classify] Progress: ${i + 1}/${testCases.length} (${elapsed}ms, ${rate} cases/s)`);
    }
  }
  const totalDuration = Date.now() - startTime;
  console.log(`[eval_classify] Done in ${totalDuration}ms`);

  // 4. 计算指标
  const llmMode = (process.env.LLM_MODE ??
    (process.env.EVAL_MOCK_LLM === "true" ? "mock" : "real")) as "mock" | "real" | "scripted";
  const mockSubMode = llmMode === "mock" ? "groundTruth" : undefined;
  const report: EvalReport = computeMetrics(results, testCases, {
    disableShortcuts: process.env.DISABLE_SHORTCUTS === "true",
    llmMode,
    seed: 42,
    totalCases: testCases.length,
    mockSubMode,
  });

  // 5. 输出报告
  const reportsDir = path.resolve(process.cwd(), "tests/eval/reports");
  if (!existsSync(reportsDir)) {
    await mkdir(reportsDir, { recursive: true });
  }
  const jsonPath = path.join(reportsDir, "baseline.json");
  const mdPath = path.join(reportsDir, "baseline.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  await writeFile(mdPath, renderMarkdown(report), "utf-8");
  console.log(`[eval_classify] Wrote ${jsonPath}`);
  console.log(`[eval_classify] Wrote ${mdPath}`);

  // 6. 控制台摘要
  console.log("\n=== Summary ===");
  console.log(`domainAcc:     ${(report.summary.domainAcc * 100).toFixed(2)}%`);
  console.log(`complexityAcc: ${(report.summary.complexityAcc * 100).toFixed(2)}%`);
  console.log(`agentsExactAcc: ${(report.summary.agentsExactAcc * 100).toFixed(2)}%`);
  console.log(
    `fullAcc:       ${(report.summary.fullAcc * 100).toFixed(2)}% (${report.summary.correctCount}/${report.config.totalCases})`
  );
  console.log(
    `\n[Note] This is a mock-LLM baseline (LLM=groundTruth). For real-LLM baseline, set LLM_MODE=real and provide API key.`
  );
}

// ===================================================================
// 辅助
// ===================================================================

async function loadTestset(testsetPath: string): Promise<any[]> {
  const content = await readFile(testsetPath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const out: any[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      console.warn(`[eval_classify] Skipping malformed line: ${line.slice(0, 80)}...`);
    }
  }
  return out;
}

// 顶层 await
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
