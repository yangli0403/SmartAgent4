/**
 * Vitest 前端测试环境初始化
 */
import "@testing-library/jest-dom";

// 模拟 import.meta.env
if (typeof import.meta.env === "undefined") {
  // @ts-ignore
  import.meta.env = { DEV: true, MODE: "test" };
}
