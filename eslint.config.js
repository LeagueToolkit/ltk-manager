import js from "@eslint/js";
import pluginQuery from "@tanstack/eslint-plugin-query";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import i18next from "eslint-plugin-i18next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Output no rule can ask an author to change. */
const GENERATED = ["src/lib/bindings/**", "src/lib/bindings.gen.ts", "src/routeTree.gen.ts"];

/** Every directory under `src/modules`, so each can be told apart from the rest. */
const MODULES = [
  "deep-link",
  "diagnostics",
  "editor",
  "home",
  "launcher",
  "library",
  "migration",
  "patcher",
  "settings",
  "shell",
  "updater",
  "workshop",
];

const NOT_MODULE_SOURCE = ["src/**/*.test.{ts,tsx}", "src/test/**", ...GENERATED];

/* The stock merger reads `text-*` against Tailwind's own sizes alone, so it
   files a tier of ours under text colour and drops it when a colour stands
   beside it. `@/utils` exports the one that knows them. */
const TAILWIND_MERGE = {
  group: ["tailwind-merge"],
  message: "Merge classes with `twMerge` from `@/utils`.",
};

/* What every file under `src` is kept away from, whichever module it is in. */
const RESTRICTED = [
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
  TAILWIND_MERGE,
];

/**
 * The barrel rule, as seen from inside `owner`.
 *
 * Only another module's insides are out of bounds. A module reaching past its
 * own barrel is how a file avoids the import cycle the barrel would close, so
 * the rule would otherwise argue against the fix for it.
 */
function barrelRule(owner) {
  const group = ["@/modules/*/**"];
  if (owner) group.push(`!@/modules/${owner}/**`);
  return { group, message: "Import another module through its barrel, `@/modules/<name>`." };
}

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
      /* Import order is oxfmt's `sortImports`, so `pnpm format` fixes it and
         `format:check` gates it. Two owners would fight over the same lines. */
      "simple-import-sort/exports": "error",
    },
  },
  ...pluginQuery.configs["flat/recommended-strict"],
  {
    /* Cycles are oxlint's job, in `.oxlintrc.json`: the graph walk costs
       ESLint more than every other rule here put together. */
    files: ["src/**/*.{ts,tsx}"],
    ignores: GENERATED,
    rules: {
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
      "no-restricted-imports": ["warn", { patterns: [barrelRule(null), ...RESTRICTED] }],
    },
  },
  /* One block per module, each blind to its own insides. Last match wins in a
     flat config, so these replace the rule the block above sets. */
  ...MODULES.map((owner) => ({
    files: [`src/modules/${owner}/**/*.{ts,tsx}`],
    ignores: NOT_MODULE_SOURCE,
    rules: {
      "no-restricted-imports": ["warn", { patterns: [barrelRule(owner), ...RESTRICTED] }],
    },
  })),
  {
    /* The wrappers are what the rule points every other file at, so they reach
       Base UI and each other freely. The merger is not one of those, and a
       wrapper reaching the stock one loses the type tier like anything else. */
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["warn", { patterns: [TAILWIND_MERGE] }],
    },
  },
  {
    /* Where the configured merger is built. */
    files: ["src/utils/twMerge.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    /* React Three Fiber's reconciler draws ThreeJS objects rather than DOM nodes, so
       every element and prop in this directory is one the DOM rule has never heard of. */
    files: ["src/modules/viewport/**/*.tsx", "src/modules/workshop/bin/vfx/**/*.tsx"],
    rules: { "react/no-unknown-property": "off" },
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
