import { defineConfig } from "vitest/config";
import path from "path";

/**
 * 前端组件/库的 Vitest 配置
 * 使用 jsdom 环境模拟浏览器 API
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: [
      "client/src/**/__tests__/**/*.test.ts",
      "client/src/**/__tests__/**/*.test.tsx",
    ],
    coverage: {
      provider: "v8",
      include: [
        "client/src/lib/airi-stage/**/*.ts",
        "client/src/hooks/useExpressionDriver.ts",
        "client/src/hooks/useMotionDriver.ts",
        "client/src/hooks/useLipsyncDriver.ts",
        "client/src/hooks/useIdleManager.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts"],
    },
    setupFiles: ["./client/src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
