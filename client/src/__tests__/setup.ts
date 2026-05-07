/**
 * Vitest 前端测试环境初始化
 */
/** 服务端 LLM 模块在 import 时会校验密钥；测试里一般用 mock，此处仅占位避免整包无法加载 */
if (!process.env.OPENAI_API_KEY?.trim() && !process.env.ARK_API_KEY?.trim()) {
  process.env.ARK_API_KEY = "vitest-placeholder-not-for-real-api";
}

import "@testing-library/jest-dom";

// 模拟 import.meta.env
if (typeof import.meta.env === "undefined") {
  // @ts-ignore
  import.meta.env = { DEV: true, MODE: "test" };
}
