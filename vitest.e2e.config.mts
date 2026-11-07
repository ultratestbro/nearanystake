import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Read-only checks against NEAR mainnet and the public 1Click API (view calls and dry quotes only).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
