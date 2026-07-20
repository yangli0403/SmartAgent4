/**
 * tests/eval/harness/mockLLM.test.ts
 *
 * MockLLM 单元测试（≥ 10 个用例）
 *
 * 不依赖任何外部 API；可在 vitest 框架下独立运行：
 *   npx vitest run tests/eval/harness/mockLLM.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MockLLM,
  installMockLLM,
  uninstallMockLLM,
  injectGroundTruth,
  getMockLLM,
  resetMockLLM,
  type MockLLMOptions,
} from "./mockLLM";
import type { TaskClassification } from "../../../server/agent/supervisor/state";

const GT: TaskClassification = {
  domain: "multimedia",
  complexity: "simple",
  reasoning: "playing music",
  requiredAgents: ["multimediaAgent"],
};

describe("MockLLM", () => {
  beforeEach(() => {
    resetMockLLM();
  });
  afterEach(async () => {
    await uninstallMockLLM();
  });

  // 1) groundTruth 返回 label
  it("1. groundTruth 模式应返回 ground truth label", async () => {
    const m = new MockLLM({ mode: "groundTruth" });
    const out = await m.classify("system", "播放周杰伦的歌", GT);
    expect(out.domain).toBe("multimedia");
    expect(out.complexity).toBe("simple");
    expect(out.requiredAgents).toEqual(["multimediaAgent"]);
    expect(out.reasoning).toContain("[mock]");
  });

  // 2) wrongDomain 让 LLM 错配
  it("2. wrongDomain 模式应故意返回错的 domain（高概率 general）", async () => {
    const m = new MockLLM({ mode: "wrongDomain", seed: 42 });
    let wrongHits = 0;
    for (let i = 0; i < 50; i++) {
      const out = await m.classify("system", `query ${i}`, GT);
      if (out.domain !== "multimedia") wrongHits++;
    }
    // 80% 概率返回 general → 至少 35/50 应是 wrong
    expect(wrongHits).toBeGreaterThanOrEqual(35);
  });

  // 3) throwError 模式抛错
  it("3. throwError 模式应抛错", async () => {
    const m = new MockLLM({ mode: "throwError" });
    await expect(m.classify("system", "test", GT)).rejects.toThrow(
      /throwError/
    );
  });

  // 4) scripted 模式按 query 命中
  it("4. scripted 模式按 query 命中应返回映射的 label", async () => {
    const map = new Map<string, TaskClassification>([
      ["今日新闻", { domain: "general", complexity: "simple", reasoning: "news query", requiredAgents: ["generalAgent"] }],
    ]);
    const m = new MockLLM({ mode: "scripted", scripted: map });
    const out = await m.classify("system", "今日新闻", GT);
    expect(out.domain).toBe("general");
    expect(out.requiredAgents).toEqual(["generalAgent"]);
  });

  // 5) 跨域 scripted 覆盖
  it("5. scripted 模式跨域 case 应返回 cross_domain", async () => {
    const map = new Map<string, TaskClassification>([
      ["找餐厅并发到飞书", { domain: "cross_domain", complexity: "complex", reasoning: "composite", requiredAgents: ["serviceAgent", "officeAgent"] }],
    ]);
    const m = new MockLLM({ mode: "scripted", scripted: map });
    const out = await m.classify("system", "找餐厅并发到飞书", GT);
    expect(out.domain).toBe("cross_domain");
    expect(out.complexity).toBe("complex");
  });

  // 6) 空 query 兜底
  it("6. 空 query 在 groundTruth 模式无 GT 时应返回 fallback", async () => {
    const m = new MockLLM({ mode: "groundTruth" });
    const out = await m.classify("system", "", undefined);
    expect(out.domain).toBe("general");
  });

  // 7) 多轮 dialogue_history 不影响 mock 结果
  it("7. groundTruth 模式不读 dialogue_history", async () => {
    const m = new MockLLM({ mode: "groundTruth" });
    const out = await m.classify(
      "system",
      "zhangsan@example.com",
      { domain: "office", complexity: "simple", reasoning: "follow-up", requiredAgents: ["officeAgent"] }
    );
    expect(out.domain).toBe("office");
  });

  // 8) 必需字段缺失抛错 (return fallback)
  it("8. wrongDomain 模式在无 groundTruth 时应返回 fallback", async () => {
    const m = new MockLLM({ mode: "wrongDomain" });
    const out = await m.classify("system", "test", undefined);
    expect(out.domain).toBe("general");
  });

  // 9) seed 固定的 wrongDomain 可复现
  it("9. seed 固定的 wrongDomain 应可复现", async () => {
    const m1 = new MockLLM({ mode: "wrongDomain", seed: 12345 });
    const m2 = new MockLLM({ mode: "wrongDomain", seed: 12345 });
    const out1 = await m1.classify("system", "x", GT);
    const out2 = await m2.classify("system", "x", GT);
    expect(out1.domain).toBe(out2.domain);
    expect(out1.reasoning).toBe(out2.reasoning);
  });

  // 10) 切换 mode 不影响外部状态
  it("10. setMode 切换后行为应立即生效", async () => {
    const m = new MockLLM({ mode: "groundTruth" });
    let out = await m.classify("system", "x", GT);
    expect(out.domain).toBe("multimedia");
    m.setMode("throwError");
    await expect(m.classify("system", "x", GT)).rejects.toThrow();
    m.setMode("groundTruth");
    out = await m.classify("system", "x", GT);
    expect(out.domain).toBe("multimedia");
  });

  // 11) installMockLLM / uninstallMockLLM 应能切换真实/模拟
  it("11. installMockLLM 应注入到 langchainAdapter", async () => {
    await installMockLLM({ mode: "groundTruth" });
    const mod = await import("../../../server/llm/langchainAdapter");
    expect((mod as any).__mockLLMInstalled).toBe(true);
    // 尝试调用 mock
    const out = await mod.callLightLLMStructured<TaskClassification>(
      "system",
      injectGroundTruth("播放周杰伦的歌", GT)
    );
    expect(out.domain).toBe("multimedia");
    await uninstallMockLLM();
    expect((mod as any).__mockLLMInstalled).toBe(false);
  });

  // 12) 解析 [GT_JSON] 块
  it("12. injectGroundTruth + 解析应正确传递 ground truth", async () => {
    await installMockLLM({ mode: "groundTruth" });
    const mod = await import("../../../server/llm/langchainAdapter");
    const msg = injectGroundTruth("分析 C 盘", {
      domain: "file_system",
      complexity: "simple",
      reasoning: "disk",
      requiredAgents: ["fileAgent"],
    });
    const out = await mod.callLightLLMStructured<TaskClassification>("system", msg);
    expect(out.domain).toBe("file_system");
    expect(out.requiredAgents).toEqual(["fileAgent"]);
  });

  // 13) getMockLLM 单例
  it("13. getMockLLM 应返回同一单例", () => {
    const a = getMockLLM();
    const b = getMockLLM();
    expect(a).toBe(b);
  });

  // 14) scripted miss → fallback
  it("14. scripted miss 应返回 fallback", async () => {
    const map = new Map<string, TaskClassification>([
      ["hit", { domain: "navigation", complexity: "simple", reasoning: "r", requiredAgents: ["navigationAgent"] }],
    ]);
    const m = new MockLLM({ mode: "scripted", scripted: map });
    const out = await m.classify("system", "miss", GT);
    expect(out.domain).toBe("general");
  });

  // 15) wrongDomain 应保持 complexity 和原 agents
  it("15. wrongDomain 模式应保持 complexity 不变", async () => {
    const m = new MockLLM({ mode: "wrongDomain", seed: 42 });
    const out = await m.classify("system", "x", {
      domain: "office",
      complexity: "complex",
      reasoning: "complex office",
      requiredAgents: ["officeAgent", "navigationAgent"],
    });
    expect(out.complexity).toBe("complex");
  });
});
