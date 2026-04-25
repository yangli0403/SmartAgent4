import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    /**
     * v0.5：按文件 glob 切换环境
     * - client/** 与 shared/** 走 jsdom（React / DOM API）
     * - 其它默认 node
     */
    environmentMatchGlobs: [
      ["client/**", "jsdom"],
      ["shared/**", "jsdom"],
    ],
    include: [
      "tests/**/*.test.ts",
      "server/**/__tests__/**/*.test.ts",
      "server/chat.test.ts",
      // v0.5 新增：client / shared / hooks 端测试
      "client/src/**/__tests__/**/*.test.{ts,tsx}",
      "shared/__tests__/**/*.test.ts",
    ],
    setupFiles: ["client/src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "server/personality/**/*.ts",
        "server/emotions/**/*.ts",
        "server/memory/**/*.ts",
        "server/mcp/fileOrganizerTools.ts",
        "server/mcp/fileOrganizerRegistration.ts",
        "server/mcp/toolRegistry.ts",
        "server/agent/supervisor/reflectionNode.ts",
        "server/agent/discovery/**/*.ts",
        "server/airi-bridge/**/*.ts",
        // v0.5 新增覆盖目标
        "shared/chatTts.ts",
        "shared/supervisorEvents.ts",
        "server/agent/supervisor/supervisorEvents.ts",
        "server/asr/asrStreamSocket.ts",
        "client/src/lib/airi-stage/framing.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
