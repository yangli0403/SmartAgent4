/**
 * LangChain Adapter 单元测试
 *
 * 测试 LLM 适配器的工厂函数和配置。
 * 不涉及实际 LLM 调用（需要 API Key）。
 */
import { describe, it, expect, vi } from "vitest";
import { createLLM } from "../langchainAdapter";

describe("LangChain Adapter", () => {
  // ==================== createLLM ====================

  describe("createLLM", () => {
    it("应创建 LLM 实例", () => {
      const llm = createLLM({ temperature: 0.5 });
      expect(llm).toBeDefined();
    });

    it("应接受 temperature 参数", () => {
      const llm = createLLM({ temperature: 0 });
      expect(llm).toBeDefined();
    });

    it("应接受 maxTokens 参数", () => {
      const llm = createLLM({ maxTokens: 2048 });
      expect(llm).toBeDefined();
    });

    it("无参数时应使用默认配置", () => {
      const llm = createLLM();
      expect(llm).toBeDefined();
    });
  });
});
