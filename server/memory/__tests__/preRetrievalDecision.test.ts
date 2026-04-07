/**
 * preRetrievalDecision 单元测试
 *
 * 验证检索前决策的核心逻辑：
 * - 规则层闲聊模式识别
 * - 规则层记忆相关模式识别
 * - LLM 层决策（mock）
 * - 完整决策流程
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock langchainAdapter
vi.mock("../../llm/langchainAdapter", () => ({
  callLLMText: vi.fn().mockResolvedValue(
    '{"decision": "RETRIEVE", "query": "用户的工作地点", "reason": "涉及个人信息"}'
  ),
}));

import {
  ruleBasedDecision,
  llmBasedDecision,
  rewriteQuery,
  makePreRetrievalDecision,
} from "../preRetrievalDecision";
import { callLLMText } from "../../llm/langchainAdapter";

const mockCallLLMText = callLLMText as ReturnType<typeof vi.fn>;

describe("preRetrievalDecision", () => {
  beforeEach(() => {
    mockCallLLMText.mockReset();
  });

  // ==================== 规则层 ====================

  describe("ruleBasedDecision", () => {
    describe("闲聊模式 → NO_RETRIEVE", () => {
      const chitchatInputs = [
        "你好",
        "你好！",
        "Hi",
        "hello",
        "早上好",
        "晚安",
        "谢谢",
        "感谢",
        "thanks",
        "好的",
        "嗯",
        "ok",
        "行",
        "再见",
        "拜拜",
        "哈哈",
        "呵呵",
        "嘿嘿",
      ];

      for (const input of chitchatInputs) {
        it(`"${input}" 应判定为 NO_RETRIEVE`, () => {
          const result = ruleBasedDecision(input);
          expect(result).not.toBeNull();
          expect(result!.decision).toBe("NO_RETRIEVE");
        });
      }
    });

    describe("记忆相关模式 → RETRIEVE", () => {
      const memoryInputs = [
        "我之前说过我住在上海",
        "你还记得我叫什么吗",
        "我跟你说过我喜欢吃川菜",
        "我住在哪里",
        "我叫什么名字",
        "我喜欢什么颜色",
        "上次那家餐厅叫什么",
        "之前推荐的那本书",
        "根据我的喜好推荐",
        "你了解我吗",
        "适合我的运动",
      ];

      for (const input of memoryInputs) {
        it(`"${input}" 应判定为 RETRIEVE`, () => {
          const result = ruleBasedDecision(input);
          expect(result).not.toBeNull();
          expect(result!.decision).toBe("RETRIEVE");
        });
      }
    });

    describe("不确定的查询 → null", () => {
      const uncertainInputs = [
        "帮我写一段代码",
        "今天天气怎么样",
        "什么是量子计算",
        "帮我翻译一下这段话",
        "推荐一部好看的电影",
      ];

      for (const input of uncertainInputs) {
        it(`"${input}" 应返回 null（不确定）`, () => {
          const result = ruleBasedDecision(input);
          expect(result).toBeNull();
        });
      }
    });

    it("空输入应返回 NO_RETRIEVE", () => {
      const result = ruleBasedDecision("");
      expect(result).not.toBeNull();
      expect(result!.decision).toBe("NO_RETRIEVE");
    });
  });

  // ==================== LLM 层 ====================

  describe("llmBasedDecision", () => {
    it("应正确解析 LLM 的 RETRIEVE 响应", async () => {
      mockCallLLMText.mockResolvedValueOnce(
        '{"decision": "RETRIEVE", "query": "用户的工作地点", "reason": "涉及个人信息"}'
      );

      const result = await llmBasedDecision("我在哪上班来着", [], {
        enableLLM: true,
      });

      expect(result.decision).toBe("RETRIEVE");
      expect(result.rewrittenQuery).toBe("用户的工作地点");
      expect(result.reason).toContain("个人信息");
    });

    it("应正确解析 LLM 的 NO_RETRIEVE 响应", async () => {
      mockCallLLMText.mockResolvedValueOnce(
        '{"decision": "NO_RETRIEVE", "query": null, "reason": "通用知识问答"}'
      );

      const result = await llmBasedDecision("什么是量子计算", [], {
        enableLLM: true,
      });

      expect(result.decision).toBe("NO_RETRIEVE");
      expect(result.rewrittenQuery).toBeNull();
    });

    it("LLM 调用失败时应保守选择 RETRIEVE", async () => {
      mockCallLLMText.mockRejectedValueOnce(new Error("API 错误"));

      const result = await llmBasedDecision("某个查询", [], {
        enableLLM: true,
      });

      expect(result.decision).toBe("RETRIEVE");
      expect(result.reason).toContain("失败");
    });

    it("LLM 响应格式异常时应保守选择 RETRIEVE", async () => {
      mockCallLLMText.mockResolvedValueOnce("这不是一个有效的 JSON");

      const result = await llmBasedDecision("某个查询", [], {
        enableLLM: true,
      });

      expect(result.decision).toBe("RETRIEVE");
    });
  });

  // ==================== 查询重写 ====================

  describe("rewriteQuery", () => {
    it("无对话历史时应返回原始查询", async () => {
      const result = await rewriteQuery("我喜欢什么", []);
      expect(result).toBe("我喜欢什么");
      expect(mockCallLLMText).not.toHaveBeenCalled();
    });

    it("有对话历史时应调用 LLM 重写", async () => {
      mockCallLLMText.mockResolvedValueOnce("用户喜欢的食物类型");

      const result = await rewriteQuery(
        "那我喜欢什么",
        [
          { role: "user", content: "帮我推荐个餐厅" },
          { role: "assistant", content: "你喜欢什么类型的菜？" },
        ]
      );

      expect(result).toBe("用户喜欢的食物类型");
      expect(mockCallLLMText).toHaveBeenCalledTimes(1);
    });

    it("LLM 重写失败时应返回原始查询", async () => {
      mockCallLLMText.mockRejectedValueOnce(new Error("超时"));

      const result = await rewriteQuery(
        "那个东西",
        [{ role: "user", content: "之前聊的" }]
      );

      expect(result).toBe("那个东西");
    });
  });

  // ==================== 完整决策流程 ====================

  describe("makePreRetrievalDecision", () => {
    it("闲聊输入应快速返回 NO_RETRIEVE（UTC-006）", async () => {
      const result = await makePreRetrievalDecision("你好", []);

      expect(result.decision).toBe("NO_RETRIEVE");
      expect(result.source).toBe("rule");
      expect(result.rewrittenQuery).toBeNull();
      expect(result.durationMs).toBeDefined();
      expect(mockCallLLMText).not.toHaveBeenCalled();
    });

    it("记忆相关输入应返回 RETRIEVE（UTC-007）", async () => {
      mockCallLLMText.mockResolvedValueOnce("用户的居住地点");

      const result = await makePreRetrievalDecision(
        "我住在哪里",
        [{ role: "assistant", content: "你好，有什么可以帮你的？" }]
      );

      expect(result.decision).toBe("RETRIEVE");
      expect(result.source).toBe("rule");
      expect(result.rewrittenQuery).toBeDefined();
    });

    it("不确定的查询应走 LLM 层（UTC-008）", async () => {
      mockCallLLMText.mockResolvedValueOnce(
        '{"decision": "RETRIEVE", "query": "推荐适合用户的电影", "reason": "可能需要了解用户偏好"}'
      );

      const result = await makePreRetrievalDecision(
        "推荐一部好看的电影",
        [],
        { enableLLM: true }
      );

      expect(result.decision).toBe("RETRIEVE");
      expect(result.source).toBe("llm");
    });

    it("LLM 禁用时不确定的查询应保守选择 RETRIEVE", async () => {
      const result = await makePreRetrievalDecision(
        "推荐一部好看的电影",
        [],
        { enableLLM: false }
      );

      expect(result.decision).toBe("RETRIEVE");
      expect(result.source).toBe("rule");
      expect(mockCallLLMText).not.toHaveBeenCalled();
    });
  });
});
