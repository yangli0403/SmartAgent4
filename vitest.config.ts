import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "server/**/__tests__/**/*.test.ts"],
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
        "server/airi-bridge/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
