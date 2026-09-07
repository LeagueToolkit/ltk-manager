import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import i18next from "eslint-plugin-i18next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "simple-import-sort": simpleImportSort,
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
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.{ts,tsx}",
      "src/test/**",
      "src/lib/bindings/**",
      "src/lib/bindings.gen.ts",
      "src/routeTree.gen.ts",
    ],
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
