import js from "@eslint/js";
import path from "node:path";

import eslintConfigPrettier from "eslint-config-prettier/flat";
import i18next from "eslint-plugin-i18next";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Output no rule can ask an author to change. */
const GENERATED = ["src/lib/bindings/**", "src/lib/bindings.gen.ts", "src/routeTree.gen.ts"];

const SRC = path.resolve(import.meta.dirname, "src");
const nodeResolver = createNodeResolver({
  extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
});

/**
 * The one `paths` entry in `tsconfig.json`, so `import-x` follows `@/` the way
 * Vite does. `eslint-import-resolver-typescript` reads no alias out of this
 * tsconfig, and one alias does not need a resolver that reads a project graph.
 */
const aliasResolver = {
  interfaceVersion: 3,
  name: "ltk-alias",
  resolve(source, file) {
    const specifier = source.startsWith("@/") ? path.join(SRC, source.slice("@/".length)) : source;
    return nodeResolver.resolve(specifier, file);
  },
};

export default tseslint.config(
  {
    settings: {
      ...importX.flatConfigs.typescript.settings,
      "import-x/resolver-next": [aliasResolver],
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "simple-import-sort": simpleImportSort,
      "import-x": importX,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "react/prop-types": "off",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    /* Warnings while the three module cycles in
       docs/research/frontend-architecture-audit.md stand. Each becomes an error
       as its section lands. */
    files: ["src/**/*.{ts,tsx}"],
    ignores: GENERATED,
    rules: {
      "import-x/no-cycle": ["warn", { ignoreExternal: true }],
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**", ...GENERATED],
    plugins: { i18next },
    languageOptions: {
      parserOptions: {
        // Type information lets the rule skip a literal whose type is a string union.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "i18next/no-literal-string": [
        "warn",
        {
          mode: "all",
          "jsx-attributes": {
            exclude: [
              "className",
              "data-ui",
              "to",
              "href",
              "id",
              "name",
              "type",
              "role",
              "variant",
              "size",
              "weight",
              "for",
              "key",
              "src",
              "rel",
              "target",
              // A key combination the Kbd splits on "+", not a sentence.
              "shortcut",
              // A resizable panel's share of its group, written as a percentage.
              "maxSize",
            ],
          },
          callees: {
            exclude: [
              "invoke",
              "listen",
              "emit",
              "useHotkeys",
              "navigate",
              "console\\..*",
              "setProperty",
              "removeProperty",
              "querySelector",
              "getElementById",
            ],
          },
          "object-properties": {
            // "transform" is a CSS value in a keyframe, never copy.
            exclude: ["to", "search", "key", "id", "className", "data-ui", "transform"],
          },
          words: {
            exclude: [
              // Ids, paths and class tokens: copy has a capital or a space.
              "^[a-z0-9_./:-]+$",
              // Punctuation bracketing a value the code interpolates, never a sentence.
              "^[\\s(){}\\[\\]<>,.:;/|·–—-]+$",
            ],
          },
        },
      ],
    },
  },
  {
    /* The structural rules src/CLAUDE.md states as prose. Warnings, because the
       moves in docs/research/frontend-architecture-audit.md have not landed. */
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**", ...GENERATED],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@/modules/*/*"],
              message: "Import a module through its barrel, `@/modules/<name>`.",
            },
            {
              group: ["@/components/*"],
              message: "Import a component through the barrel, `@/components`.",
            },
            {
              group: ["@base-ui/react/*"],
              message: "Reach Base UI through its wrapper in `src/components`.",
            },
            {
              group: ["lucide-react"],
              message: "Icons are Phosphor duotone: DS-ICON-WEIGHT.",
            },
          ],
        },
      ],
    },
  },
  {
    /* The wrappers are what the rule points every other file at. */
    files: ["src/components/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/target/",
      "**/.claude/",
      "src-tauri/",
      "gen/",
      "prettier.config.js",
      "src/paraglide/",
    ],
  },
  eslintConfigPrettier,
);
