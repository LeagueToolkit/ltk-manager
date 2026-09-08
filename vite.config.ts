import path from "node:path";
import { fileURLToPath } from "node:url";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import { releaseNotes } from "./scripts/vite-release-notes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    paraglideVitePlugin({ project: "./project.inlang" }),
    /* The React Compiler, through oxc rather than Babel. It memoizes what the
       app never hand-memoized: the bin rows, the class views and the cards. */
    react({ compiler: true }),
    tailwindcss(),
    svgr(),
    releaseNotes(__dirname),
  ],

  // Prevent vite from obscuring rust errors
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Ignore `src-tauri` and the Cargo build output.
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Env variables starting with TAURI_ are exposed to the frontend
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "es2020",
    // Produce source maps for debugging
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,

    // Fallback to original minifier until @tailwindcss/vite supports Vite 8
    cssMinify: "esbuild",
  },
});
