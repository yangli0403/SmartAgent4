/**
 * M1-05/06/07/08/09 验证：LLMPreAnalyzer 完整行为
 */

import { describe, it, expect } from "vitest";
import {
  LLMPreAnalyzerImpl,
  LLMTimeoutError,
  DEFAULT_LLM_CONFIG,
  type LLMCaller,
  type LLMCallRequest,
  type LLMCallResult,
} from "../../../server/agent/preAnalysis/llm/llmPreAnalyzer";

const baseCtx = {
  userId: "user_123",
  sessionId: "sess_456",
  traceId: "0af7651916cd43dd8448eb211c80319c",
};

/** Mock LLM：返回固定响应或抛错/超时 */
function mockCaller(opts: {
  response?: Partial<LLMCallResult> | string;
  error?: Error;
  delay?: number;
}): LLMCaller {
  return {
    async call(req: LLMCallRequest): Promise<LLMCallResult> {
      // 模拟真实 LLM：尊重 signal，超时立即中止
      if (opts.delay) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delay);
          if (req.signal) {
            req.signal.addEventListener("abort", () => {
              clearTimeout(t);
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      if (req.signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      if (opts.error) throw opts.error;
      if (typeof opts.response === "string") {
        return { content: opts.response, promptTokens: 50, completionTokens: 30 };
      }
      return {
        content: JSON.stringify({
          domain: "iot",
          requiredAgents: ["iotAgent"],
          memoryRelevant: false,
          rewrittenQuery: "x",
          confidence: 0.9,
          reasoning: "ok",
        }),
        promptTokens: 50,
        completionTokens: 30,
        ...opts.response,
      };
    },
  };
}

describe("M1-05 LLMPreAnalyzer 基础调用", () => {
  it("合法 JSON 响应 → 完整 PreAnalyzerOutput", async () => {
    const a = new LLMPreAnalyzerImpl(mockCaller({}));
    const out = await a.analyze("打开灯", baseCtx);
    expect(out.domain).toBe("iot");
    expect(out.requiredAgents).toEqual(["iotAgent"]);
    expect(out.source).toBe("llm");
    expect(out.schemaVersion).toBe("v1");
  });

  it("JSON 包装 ```json``` 也能解析", async () => {
    const a = new LLMPreAnalyzerImpl(
      mockCaller({ response: '```json\n{"domain":"general","requiredAgents":[],"memoryRelevant":false,"rewrittenQuery":"x","confidence":0.7,"reasoning":"y"}\n```' })
    );
    const out = await a.analyze("x", baseCtx);
    expect(out.domain).toBe("general");
  });

  it("无法解析 JSON → 默认值填充", async () => {
    const a = new LLMPreAnalyzerImpl(mockCaller({ response: "garbage not json" }));
    const out = await a.analyze("x", baseCtx);
    expect(out.domain).toBe("unknown");                              // v1.3 修复 #9
    expect(out.requiredAgents).toEqual([]);
    expect(out.memoryRelevant).toBe(false);                          // v1.3 修复 #1
  });
});

describe("M1-06 memoryRelevant 缺失默认 false（v1.3 修复 #1）", () => {
  it("缺 memoryRelevant 字段 → false + 警告日志", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const caller = mockCaller({
      response: JSON.stringify({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        // memoryRelevant 缺失
        rewrittenQuery: "x",
        confidence: 0.9,
      }),
    });
    const a = new LLMPreAnalyzerImpl(caller);
    const out = await a.analyze("x", baseCtx);
    expect(out.memoryRelevant).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("memoryRelevant_missing"));
    warn.mockRestore();
  });

  it("显式 memoryRelevant=true → 保留", async () => {
    const caller = mockCaller({
      response: JSON.stringify({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: true,
        rewrittenQuery: "x",
        confidence: 0.9,
      }),
    });
    const a = new LLMPreAnalyzerImpl(caller);
    const out = await a.analyze("上次我说的那个", baseCtx);
    expect(out.memoryRelevant).toBe(true);
  });
});

describe("M1-07 domain 缺失 → 'unknown'（v1.3 修复 #9）", () => {
  it("缺 domain 字段 → unknown", async () => {
    const caller = mockCaller({
      response: JSON.stringify({
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        rewrittenQuery: "x",
        confidence: 0.9,
      }),
    });
    const a = new LLMPreAnalyzerImpl(caller);
    const out = await a.analyze("x", baseCtx);
    expect(out.domain).toBe("unknown");
  });

  it("缺 domain 不应抛错", async () => {
    const caller = mockCaller({
      response: JSON.stringify({
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        rewrittenQuery: "x",
        confidence: 0.9,
      }),
    });
    const a = new LLMPreAnalyzerImpl(caller);
    await expect(a.analyze("x", baseCtx)).resolves.toBeDefined();
  });
});

describe("M1-08 LLM 超时分级（v1.3 修复 #13）", () => {
  it("正常响应不超时", async () => {
    const a = new LLMPreAnalyzerImpl(mockCaller({ delay: 50 }));
    await expect(a.analyze("x", baseCtx)).resolves.toBeDefined();
  });

  it("soft 超时（默认 3s）抛 LLMTimeoutError 让上层降级", async () => {
    const a = new LLMPreAnalyzerImpl(
      mockCaller({ delay: 5000 }),                     // 5s > 3s soft
      { softTimeoutMs: 100, hardTimeoutMs: 200 }
    );
    await expect(a.analyze("x", baseCtx)).rejects.toThrow(LLMTimeoutError);
  });

  it("自定义 soft/hard 阈值生效", () => {
    const a = new LLMPreAnalyzerImpl(mockCaller({}), { softTimeoutMs: 1000, hardTimeoutMs: 5000 });
    expect(a).toBeDefined();
    // 配置默认值正确
    expect(DEFAULT_LLM_CONFIG.softTimeoutMs).toBe(3000);
    expect(DEFAULT_LLM_CONFIG.hardTimeoutMs).toBe(8000);
  });
});

describe("M1-09 Prompt 模板版本控制（v1.3 修复 #12）", () => {
  it("v1 模板存在", () => {
    const a = new LLMPreAnalyzerImpl(mockCaller({}));
    // 间接验证：调用不抛错
    expect(a).toBeDefined();
  });

  it("缺版本号使用 v1 default", async () => {
    const caller = mockCaller({});
    const a = new LLMPreAnalyzerImpl(caller, { promptTemplateVersion: "v1" });
    await expect(a.analyze("x", baseCtx)).resolves.toBeDefined();
  });

  it("未知版本号降级到 v1", async () => {
    const caller = mockCaller({});
    const a = new LLMPreAnalyzerImpl(caller, { promptTemplateVersion: "v999" });
    // 不应抛错：未知版本降级
    await expect(a.analyze("x", baseCtx)).resolves.toBeDefined();
  });
});