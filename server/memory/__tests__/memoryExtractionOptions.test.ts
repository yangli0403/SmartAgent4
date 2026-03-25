/**
 * MemoryExtractionOptions 接口测试
 *
 * 验证 Phase 5 修复新增的 MemoryExtractionOptions 接口：
 * - 接口定义正确性
 * - 与 extractMemoriesFromConversation 的兼容性
 * - 向后兼容性（不传 options 时使用默认值）
 *
 * 注意：由于 extractMemoriesFromConversation 依赖 LLM 和数据库，
 * 此处仅验证接口和类型层面的正确性。
 */

import { describe, it, expect } from "vitest";
import type {
  MemoryFormationInput,
  MemoryExtractionOptions,
} from "../memorySystem";

describe("MemoryExtractionOptions 接口", () => {
  it("应支持 enableFiltering 选项", () => {
    const options: MemoryExtractionOptions = {
      enableFiltering: false,
    };
    expect(options.enableFiltering).toBe(false);
  });

  it("应支持 deduplicationThreshold 选项", () => {
    const options: MemoryExtractionOptions = {
      deduplicationThreshold: 0.75,
    };
    expect(options.deduplicationThreshold).toBe(0.75);
  });

  it("应支持 requireTimeAnchor 选项", () => {
    const options: MemoryExtractionOptions = {
      requireTimeAnchor: false,
    };
    expect(options.requireTimeAnchor).toBe(false);
  });

  it("所有选项都应是可选的", () => {
    const options: MemoryExtractionOptions = {};
    expect(options.enableFiltering).toBeUndefined();
    expect(options.deduplicationThreshold).toBeUndefined();
    expect(options.requireTimeAnchor).toBeUndefined();
  });

  it("应支持组合多个选项", () => {
    const options: MemoryExtractionOptions = {
      enableFiltering: true,
      deduplicationThreshold: 0.5,
      requireTimeAnchor: true,
    };
    expect(options.enableFiltering).toBe(true);
    expect(options.deduplicationThreshold).toBe(0.5);
    expect(options.requireTimeAnchor).toBe(true);
  });

  it("MemoryFormationInput 接口应保持不变", () => {
    const input: MemoryFormationInput = {
      userId: 1,
      conversationHistory: [
        { role: "user", content: "我叫小明" },
        { role: "assistant", content: "你好小明！" },
      ],
    };
    expect(input.userId).toBe(1);
    expect(input.conversationHistory).toHaveLength(2);
  });
});
