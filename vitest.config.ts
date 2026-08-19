import path from "node:path";
import { fileURLToPath } from "node:url";

import svgr from "vite-plugin-svgr";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svgr()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      exclude: ["src/routeTree.gen.ts", "src/lib/bindings/**", "src/test/**", "**/*.config.*"],
    },
  },
});
