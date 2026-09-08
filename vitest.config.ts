import path from "node:path";
import { fileURLToPath } from "node:url";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vitest/config";

import { releaseNotes } from "./scripts/vite-release-notes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    paraglideVitePlugin({ project: "./project.inlang" }),
    react({ compiler: true }),
    svgr(),
    releaseNotes(__dirname),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      exclude: ["src/routeTree.gen.ts", "src/lib/bindings/**", "src/test/**", "**/*.config.*"],
    },

    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],

    experimental: { fsModuleCache: !process.env.CI },
  },
});
