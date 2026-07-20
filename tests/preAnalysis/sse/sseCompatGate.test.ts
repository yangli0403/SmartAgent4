/**
 * M3-02 验证：SSE 兼容性自测 + CI gate
 *
 * 检查项：
 * 1. 所有 SSE 事件工厂方法都注入 sseSchemaVersion
 * 2. SSE 事件 schema 强制包含 sseSchemaVersion（Zod 校验）
 * 3. v1.3 classify 事件不包含 complexity 字段
 * 4. （可选）扫描现有 supervisor SSE 流代码，检查是否需要更新
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  createPreAnalysisSSEEvent,
  createClassifySSEEvent,
  createErrorSSEEvent,
  createDoneSSEEvent,
  PreAnalysisSSEEventSchema,
  ClassifySSEEventSchema,
  CURRENT_SSE_SCHEMA_VERSION,
  isSSEVersionAtLeast,
  resetSSEEventCounter,
} from "../../../server/agent/preAnalysis/sse/sseEventSchema";

describe("M3-02 SSE 兼容性自测", () => {
  beforeEach(() => resetSSEEventCounter());

  it("所有 SSE 事件工厂方法注入 sseSchemaVersion", () => {
    const events = [
      createPreAnalysisSSEEvent({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        memoryRelevant: false,
        source: "rule",
        confidence: 0.9,
        durationMs: 50,
      }),
      createClassifySSEEvent({
        domain: "iot",
        requiredAgents: ["iotAgent"],
        executionMode: "single",
      }),
      createErrorSSEEvent("err"),
      createDoneSSEEvent(),
    ];
    for (const evt of events) {
      expect(evt.sseSchemaVersion).toBe(CURRENT_SSE_SCHEMA_VERSION);
    }
  });

  it("PreAnalysisSSEEventSchema 强制 sseSchemaVersion='v1.3'", () => {
    const valid = createPreAnalysisSSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      memoryRelevant: false,
      source: "rule",
      confidence: 0.9,
      durationMs: 50,
    });
    expect(PreAnalysisSSEEventSchema.parse(valid).sseSchemaVersion).toBe("v1.3");

    // 缺 sseSchemaVersion → fail
    const invalid = { ...valid } as any;
    delete invalid.sseSchemaVersion;
    expect(PreAnalysisSSEEventSchema.safeParse(invalid).success).toBe(false);
  });

  it("ClassifySSEEventSchema 强制 sseSchemaVersion='v1.3'", () => {
    const valid = createClassifySSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      executionMode: "single",
    });
    expect(ClassifySSEEventSchema.parse(valid).sseSchemaVersion).toBe("v1.3");

    const invalid = { ...valid } as any;
    delete invalid.sseSchemaVersion;
    expect(ClassifySSEEventSchema.safeParse(invalid).success).toBe(false);
  });

  it("classify payload 不含 complexity 字段（v1.3 移除）", () => {
    const evt = createClassifySSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      executionMode: "single",
    });
    expect((evt.payload as any).complexity).toBeUndefined();
  });

  it("前端可用 isSSEVersionAtLeast 判断是否读 complexity", () => {
    // 前端逻辑：sseSchemaVersion >= v1.3 → 不读 complexity
    const evt = createClassifySSEEvent({
      domain: "iot",
      requiredAgents: ["iotAgent"],
      executionMode: "single",
    });
    expect(isSSEVersionAtLeast(evt.sseSchemaVersion, "v1.3")).toBe(true);
  });
});

/**
 * M3-02 静态扫描：检查现有 SSE 源文件是否含 sseSchemaVersion
 *
 * v1.3 → M4-12 升级：从警告级（warn）转为强约束（hard fail）
 *
 * 扫描目标：
 * - server/agent/supervisor/runSupervisorStreaming.ts
 * - server/routers/chatRouterEnhanced.ts
 * - server/agent/supervisor/supervisorStreaming.ts（v1.3 新增事件源）
 *
 * 强约束：未使用 sseSchemaVersion → CI gate fail
 */
describe("M3-02 SSE 源文件静态扫描（v1.3 起为强约束）", () => {
  it("runSupervisorStreaming.ts 必须使用 sseSchemaVersion（v1.3 强约束）", () => {
    const file = path.join(
      process.cwd(),
      "server/agent/supervisor/runSupervisorStreaming.ts"
    );
    expect(fs.existsSync(file), `[M4-12 CI gate] ${file} 不存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(
      content.includes("sseSchemaVersion"),
      `[M4-12 CI gate] ❌ ${path.basename(file)} 未注入 sseSchemaVersion 字段（v1.3 修复 #11 强约束）`
    ).toBe(true);
  });

  it("chatRouterEnhanced.ts 必须使用 sseSchemaVersion（v1.3 强约束）", () => {
    const file = path.join(process.cwd(), "server/routers/chatRouterEnhanced.ts");
    expect(fs.existsSync(file), `[M4-12 CI gate] ${file} 不存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(
      content.includes("sseSchemaVersion"),
      `[M4-12 CI gate] ❌ ${path.basename(file)} 未注入 sseSchemaVersion 字段（v1.3 修复 #11 强约束）`
    ).toBe(true);
  });

  it("supervisorStreaming.ts 必须使用 sseSchemaVersion（v1.3 强约束）", () => {
    const file = path.join(
      process.cwd(),
      "server/agent/supervisor/supervisorStreaming.ts"
    );
    expect(fs.existsSync(file), `[M4-12 CI gate] ${file} 不存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(
      content.includes("sseSchemaVersion"),
      `[M4-12 CI gate] ❌ ${path.basename(file)} 未注入 sseSchemaVersion 字段（v1.3 修复 #11 强约束）`
    ).toBe(true);
  });

  it("classified 事件 payload 包含 executionMode（v1.3 替换 complexity）", () => {
    const file = path.join(
      process.cwd(),
      "server/agent/supervisor/supervisorStreaming.ts"
    );
    const content = fs.readFileSync(file, "utf-8");
    // 验证 classified 事件 payload 含 executionMode（与 complexity 双写）
    expect(
      /type:\s*["']classified["'][\s\S]{0,400}executionMode/.test(content),
      `[M4-12 CI gate] ❌ classified 事件 payload 未注入 executionMode（v1.3 修复 #3/#5 要求）`
    ).toBe(true);
  });
});