/**
 * US-1：ChatUiMessage 联合类型扩展测试
 * 关联用户测试用例：U-CT-1 / U-CT-2 / U-CT-3
 */
import { describe, it, expect } from "vitest";
import type {
  ChatUiMessage,
  ChatUiThinkingMessage,
  ChatThinkingDetail,
  ChatThinkingPhase,
} from "../chatTts";

describe("US-1 ChatUiMessage 联合类型", () => {
  it("U-CT-1：role === 'thinking' 时可访问 details / status / requestId", () => {
    const detail: ChatThinkingDetail = {
      phase: "plan_ready" satisfies ChatThinkingPhase,
      summary: "已生成 3 步执行计划",
      ts: Date.now(),
    };
    const msg: ChatUiMessage = {
      role: "thinking",
      requestId: "req-123",
      status: "running",
      headline: "Metris Agent 思考中...",
      details: [detail],
      startedAt: Date.now() - 100,
    } satisfies ChatUiThinkingMessage;

    if (msg.role !== "thinking") {
      throw new Error("expect thinking role");
    }
    expect(msg.requestId).toBe("req-123");
    expect(msg.status).toBe("running");
    expect(msg.headline.startsWith("Metris Agent")).toBe(true);
    expect(msg.details).toHaveLength(1);
    expect(msg.details[0].phase).toBe("plan_ready");
  });

  it("U-CT-2：role === 'assistant' 时不应能访问 details（narrowing 校验）", () => {
    const msg: ChatUiMessage = {
      role: "assistant",
      content: "已为您规划好行程",
    };
    if (msg.role === "assistant") {
      // 编译期：msg.details 不应存在；运行期我们仅验证 content 存在
      // @ts-expect-error details 不存在于 assistant 分支
      const _shouldNotCompile = msg.details;
      expect(msg.content).toBe("已为您规划好行程");
    }
  });

  it("U-CT-3：thinking 消息 JSON 序列化往返一致", () => {
    const original: ChatUiThinkingMessage = {
      role: "thinking",
      requestId: "req-xyz",
      status: "completed",
      headline: "Metris Agent 已完成思考",
      details: [
        { phase: "classified", summary: "分类完成", ts: 1 },
        { phase: "completed", summary: "已生成最终回复", ts: 2 },
      ],
      startedAt: 0,
      endedAt: 100,
    };
    const round = JSON.parse(JSON.stringify(original)) as ChatUiThinkingMessage;
    expect(round).toEqual(original);
    expect(round.role).toBe("thinking");
    expect(round.details[1].summary).toBe("已生成最终回复");
  });
});
