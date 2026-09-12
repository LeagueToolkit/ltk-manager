# The frontend owns every user-facing string, and Paraglide compiles them

Research note, and the record of what was decided from it. Sections 1 to 11 are evidence gathered
on 2026-09-02, against the repository and against each tool's own registry entry, documentation and
source. Section 12 is the decision and sections 13 to 17 what follows from it.

The question came from two priorities the team set in this order: move user-facing strings out of
components and out of the Rust backend into the frontend, behind one i18n layer, in English only,
and do it on a migrate-on-touch policy that a reviewer can apply and a CI job can enforce. No
candidate was named going in. Six were evaluated on their own registry entries, documentation and
source.

Three findings decide the rest:

- **The backend already has the shape the frontend needs, in three places.** `LauncherError`,
  `PatcherError` and `WorkshopError` cross IPC as `#[serde(tag = "kind")]` enums that ts-rs turns
  into discriminated unions, and `useLaunchErrorToast` already matches on `kind` and writes its
  own English. The rest of `AppError` collapses to a code plus a sentence. The work is making the
  three the rule.
- **Paraglide is the one candidate whose message keys and parameter names are compile-time
  facts.** A `tsc` probe against its generated output fails on an unknown message, a missing
  input, a misspelled input and a missing plural `count`. i18next types keys, and its parameter
  typing holds only when an options object is passed and only from a literal-typed catalog.
  react-intl and Lingui type neither.
- **`@vitejs/plugin-react` 6 removed Babel.** Lingui's macros and FormatJS's Babel plugin now
  need `@rolldown/plugin-babel` or a switch to the SWC plugin. Paraglide and i18next need neither,
  because both are plain function calls.

## Sources

Repository, read on 2026-09-02:

- `src-tauri/src/error.rs`, `crates/ltk-manager-core/src/error.rs` - the IPC error shape
- `crates/ltk-manager-core/src/launcher/types.rs`, `patcher/error.rs`, `workshop/mod.rs` - the
  tagged enums that already cross IPC
- `crates/ltk-manager-core/src/problems/mod.rs` and `problems/rules/*/mod.rs` - the `Rule` trait
  and the five rules' copy
- `crates/ltk-manager-core/src/mods/health.rs`, `docs/ux/MOD_HEALTH.md` - what a stored verdict
  keeps
- `crates/ltk-manager-core/src/diagnostics/mod.rs`, `diagnostics/incident.rs` - checks and verdicts
- `src-tauri/src/patcher/thread.rs`, `hotkeys.rs`, `deep_link/download.rs` - events carrying prose
- `src/lib/tauri.ts`, `src/utils/errors.ts`, `src/modules/launcher/api/useLaunchErrorToast.ts`,
  `src/modules/patcher/api/usePatcherError.ts` - how the frontend renders an error
- `src/main.tsx`, `src/routes/__root.tsx`, `vite.config.ts`, `vitest.config.ts`,
  `eslint.config.js`, `tsconfig.json`, `package.json`, `.cargo/config.toml`,
  `src-tauri/tauri.conf.json`, `.github/workflows/ci.yml`, `README.md`
- Counts in section 2, from `grep` over `src/` with the patterns described there

Probes run in the session scratchpad, on the versions named:

- `i18next@26.4.1` with `typescript@5.9.3`: key and parameter typing from a `.json` import and from
  an `as const` catalog
- `i18next-resources-for-ts@2.x` `interface` and `toc` output on the same catalog
- `@inlang/paraglide-js@2.25.0`: `compile` over nested, dotted and slashed keys, a plural with an
  exact-number case, a second locale missing messages, an array `pathPattern`, and `tsc` over
  the generated modules

Primary sources, fetched on 2026-09-02:

- npm registry documents for every package named, at `https://registry.npmjs.org/<pkg>`
- GitHub REST API for every repository named, for `open_issues_count`, `pushed_at` and
  `contributors`
- [i18next TypeScript](https://www.i18next.com/overview/typescript),
  [plurals](https://www.i18next.com/translation-function/plurals),
  [configuration options](https://www.i18next.com/overview/configuration-options),
  [plugins and utils](https://www.i18next.com/overview/plugins-and-utils),
  [add or load translations](https://www.i18next.com/how-to/add-or-load-translations),
  [i18next `t.d.ts`](https://raw.githubusercontent.com/i18next/i18next/master/typescript/t.d.ts),
  [i18next `Translator.js`](https://raw.githubusercontent.com/i18next/i18next/master/src/Translator.js)
- [react-i18next Trans](https://react.i18next.com/latest/trans-component),
  [useTranslation](https://react.i18next.com/latest/usetranslation-hook),
  [react-i18next CHANGELOG](https://raw.githubusercontent.com/i18next/react-i18next/master/CHANGELOG.md)
- [i18next-cli README](https://raw.githubusercontent.com/i18next/i18next-cli/main/README.md),
  [i18next-parser README](https://raw.githubusercontent.com/i18next/i18next-parser/master/README.md)
- [eslint-plugin-i18next README](https://raw.githubusercontent.com/edvardchen/eslint-plugin-i18next/main/README.md)
  and [`no-literal-string`](https://raw.githubusercontent.com/edvardchen/eslint-plugin-i18next/main/docs/rules/no-literal-string.md)
- [FormatJS message extraction](https://formatjs.github.io/docs/getting-started/message-extraction),
  [CLI](https://formatjs.github.io/docs/tooling/cli),
  [bundler plugins](https://formatjs.github.io/docs/guides/bundler-plugins),
  [react-intl API](https://formatjs.github.io/docs/react-intl/api),
  [linter](https://formatjs.github.io/docs/tooling/linter),
  [ICU syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax),
  [runtime requirements](https://formatjs.github.io/docs/guides/runtime-requirements),
  [`packages/intl/types.ts`](https://github.com/formatjs/formatjs/blob/main/packages/intl/types.ts)
- [Lingui installation](https://lingui.dev/installation), [Vite plugin](https://lingui.dev/ref/vite-plugin),
  [configuration](https://lingui.dev/ref/conf), [CLI](https://lingui.dev/ref/cli),
  [macro](https://lingui.dev/ref/macro), [core](https://lingui.dev/ref/core),
  [explicit vs generated ids](https://lingui.dev/guides/explicit-vs-generated-ids),
  [typed message ids](https://lingui.dev/guides/typed-message-ids),
  [testing](https://lingui.dev/guides/testing), [migration to 6](https://lingui.dev/releases/migration-6),
  [eslint-plugin-lingui](https://github.com/lingui/eslint-plugin)
- [Paraglide JS](https://paraglidejs.com/), [basics](https://paraglidejs.com/basics),
  [compiling messages](https://paraglidejs.com/compiling-messages),
  [compiler options](https://paraglidejs.com/compiler-options), [strategy](https://paraglidejs.com/strategy),
  [variants](https://paraglidejs.com/variants), [markup](https://paraglidejs.com/markup),
  [changelog](https://paraglidejs.com/changelog),
  [inlang message format plugin](https://inlang.com/m/reootnfj/plugin-inlang-messageFormat),
  [`compiler-options.ts`](https://raw.githubusercontent.com/opral/paraglide-js/main/src/compiler/compiler-options.ts),
  [`@inlang/cli` lint command](https://raw.githubusercontent.com/opral/inlang/main/packages/cli/src/commands/lint/index.ts)
- [typesafe-i18n README](https://raw.githubusercontent.com/codingcommons/typesafe-i18n/main/README.md)
- [TC39 Intl.MessageFormat proposal](https://github.com/tc39/proposal-intl-messageformat),
  [ECMA-402 proposals](https://raw.githubusercontent.com/tc39/proposals/main/ecma402/README.md),
  [LDML Part 9 MessageFormat](https://www.unicode.org/reports/tr35/tr35-messageFormat.html),
  [message-format-wg README](https://raw.githubusercontent.com/unicode-org/message-format-wg/main/README.md),
  [CLDR 47](https://cldr.unicode.org/downloads/cldr-47), [CLDR 48](https://cldr.unicode.org/downloads/cldr-48),
  [MDN Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl),
  [browser-compat-data `Intl/*.json`](https://github.com/mdn/browser-compat-data/tree/main/javascript/builtins/Intl)
- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/),
  [Tauri CSP](https://v2.tauri.app/security/csp/),
  [Tauri config schema](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-schema-generator/schemas/config.schema.json),
  [MDN `default-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/default-src)
- [WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution),
  [Evergreen vs fixed](https://learn.microsoft.com/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)
- [`@vitejs/plugin-react` CHANGELOG](https://raw.githubusercontent.com/vitejs/vite-plugin-react/main/packages/plugin-react/CHANGELOG.md)
  and [README](https://raw.githubusercontent.com/vitejs/vite-plugin-react/main/packages/plugin-react/README.md),
  [`@vitejs/plugin-react-swc` README](https://raw.githubusercontent.com/vitejs/vite-plugin-react/main/packages/plugin-react-swc/README.md),
  [Vite features](https://vite.dev/guide/features)
- [TanStack Router code splitting](https://tanstack.com/router/latest/docs/framework/react/guide/code-splitting),
  [data loading](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading),
  [router context](https://tanstack.com/router/latest/docs/framework/react/guide/router-context),
  [RouterOptionsType](https://tanstack.com/router/latest/docs/framework/react/api/router/RouterOptionsType)
- [TypeScript `resolveJsonModule`](https://www.typescriptlang.org/tsconfig/resolveJsonModule.html)
- [ts-rs README](https://raw.githubusercontent.com/Aleph-Alpha/ts-rs/main/README.md) and
  [`union_with_internal_tag.rs`](https://raw.githubusercontent.com/Aleph-Alpha/ts-rs/main/ts-rs/tests/integration/union_with_internal_tag.rs)
- [Clippy lint configuration](https://doc.rust-lang.org/clippy/lint_configuration.html),
  [Clippy configuration](https://doc.rust-lang.org/clippy/configuration.html),
  [`disallowed_methods.rs`](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/disallowed_methods.rs),
  [`disallowed_macros.rs`](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/disallowed_macros.rs),
  [Reference: the `expect` attribute](https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-expect-attribute),
  [dylint README](https://raw.githubusercontent.com/trailofbits/dylint/master/README.md)
- crates.io API for `rust-i18n`, `fluent-bundle`, `fluent-templates`, `intl-pluralrules`,
  `gettext-rs`, `tr`, `icu`, `icu_experimental`, `ts-rs`, `specta`, `tauri-specta`,
  `cargo-dylint`, `cargo-marker`, [icu4x #3028](https://github.com/unicode-org/icu4x/issues/3028),
  [Fluent guide](https://projectfluent.org/fluent/guide/selectors.html),
  [gettext-sys README](https://raw.githubusercontent.com/gettext-rs/gettext-rs/master/gettext-sys/README.md)
- [ESLint CLI](https://eslint.org/docs/latest/use/command-line-interface),
  [ESLint configuration files](https://eslint.org/docs/latest/use/configure/configuration-files),
  [lint-staged README](https://raw.githubusercontent.com/lint-staged/lint-staged/main/README.md),
  [actions/checkout](https://github.com/actions/checkout),
  [GHSA-mrrh-fwg8-r2c3](https://github.com/advisories/GHSA-mrrh-fwg8-r2c3)
- [Vitest environment](https://vitest.dev/config/environment), [Vitest guide](https://vitest.dev/guide/environment)

## 1. How a backend string reaches the UI today

**One envelope, two shapes inside it.** Every command returns `IpcResult<T>`, whose error arm is
`AppErrorResponse { code: ErrorCode, message: String, context: Option<serde_json::Value> }`
(`src-tauri/src/error.rs`). The `From<AppError>` impl there is the only place that decides what
the frontend gets, and it writes English: `"League installation not found"`,
`format!("Mod not found: {}", id)`, and the two-sentence `SchemaVersionTooNew` message. Some
variants also put structured data in `context` (`path`, `modId`, `projectName`, `fileVersion` and
`maxSupported`, the overlay `category`). The frontend's `AppError` binding types `context` as
`unknown`, and `src/utils/errors.ts` re-validates it with zod per code.

**Three sub-errors already cross as typed unions.** `LauncherError` is declared
`#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", rename_all_fields = "camelCase")]`
and ts-rs exports it as
`{ "kind": "RIOT_CLIENT_NOT_FOUND", installsPath: string } | { "kind": "REFUSED", riotErrorCode: string, message: string } | ...`.
`PatcherError` and `WorkshopError` are the same shape. `useLaunchErrorToast` matches on `kind`
with `ts-pattern` and writes its own title and description per variant, falling back to
`error.message` only for a refusal where "Riot's own prose is better than anything generic".
`usePatcherError` keys titles by `PatcherFailureStage` and by `OverlayErrorCategory`. These two
files are the pattern the rest of the migration copies.

**The free-text variants are the backlog.** `AppError::ValidationFailed(String)` has 83 call
sites, `Other(String)` 81, `InvalidPath(String)` 26, `Fantome(String)` 16 and `PackFailed(String)`
4, each composing an English sentence at the call site. Core carries 77 `#[error("...")]`
attributes across 14 files, and no `anyhow` context strings reach a user (`anyhow` is a
dependency of the shell only, used in `error.rs` and its tests).

**External crates contribute prose that cannot be keyed.** `std::io::Error`, `serde_json`,
`ltk_modpkg`, `ltk_wad`, `zip`, `ltk_overlay::Error` (`#[non_exhaustive]`, mapped to
`OverlayErrorCategory`), `HashtableError` (not `Serialize`, so "the message is where the detail
rides") and `PreviewError` all arrive as `to_string()`. That text is data in the sense of
`src/CLAUDE.md`'s Text Selection rule: it is what a user pastes into a bug report.

**Health rules own their copy.** `Rule::title() -> &'static str`, `description()` and
`unfixable_description()` (`problems/mod.rs`) are English, in five rules: `Meta property type
mismatch`, `Unset soundbank id`, `Unsupported audio bank version`, `Partial resource resolver`,
`Block-unaligned texture size`. `RuleInfo` carries them once per run. A rule also composes
per-problem `message: Option<String>` with `format!` (`bin_property_type/mod.rs` lines 1150 to
1180 build three-sentence explanations around hash values) and a `Dormancy { waiting, reason }`
pair (`"Patch {patch}"`, a sentence about the installed build). `RuleFailure.message` is
`"The check was cancelled"`.

**Stored verdicts already treat titles as the build's.** `docs/ux/MOD_HEALTH.md` "What the store
keeps": "The store keeps what the run observed, and nothing the build owns... Everything the rules
declare about themselves is rebuilt on load from the manager that is running". `RuleBrief.title`
and `.description` in `mods/health.rs` are therefore already a projection, and moving them to the
frontend changes who projects, not what is stored.

**Diagnostics are the same shape.** `Check { id: "windows.long_paths", label, summary, suggestion,
fix_command }` (`diagnostics/mod.rs`), with `id` documented as "Survives label changes", and 18
`check_*` call sites writing `label` and `summary` literals. `Verdict.title` is derived from
`VerdictKind::title()`, sixteen titles from `"DLL Injection Failure"` to
`"Unexplained Game Exit"`, with a `cause` sentence beside it. `VerdictKind` is exported as a
string union.

**Events carry prose in three places.** `patcher-error` carries an `AppErrorResponse`.
`hotkey-error` carries a bare `e.to_string()`. `protocol-install-progress` carries
`{ stage: String, error: Option<String> }` with `stage` untyped. Every other progress payload
(`OverlayProgress`, `HashtableSyncProgress`, `ModStorageProgress`, `HealthSweepProgress`,
`LaunchProgress`) is a stage enum plus numbers and needs nothing.

**Bindings are generated and committed.** ts-rs 12 with `TS_RS_EXPORT_DIR=src/lib/bindings/` in
`.cargo/config.toml`, produced by `pnpm generate:types` (`cargo test --workspace export_bindings`).
183 files, and a hand-maintained `index.ts` of 175 re-exports. Core gates the derive behind a
`ts` feature.

## 2. Where the frontend's own strings live

Heuristic counts over `src/`, excluding tests, `lib/bindings/` and `routeTree.gen.ts`. The
patterns are a multi-word capitalised JSX text node, a copy-bearing string attribute (`title`,
`placeholder`, `aria-label`, `label`, `description`, `hint`, `heading`, `tooltip`), a `toast.*`
call with a literal first argument, and a capitalised three-word literal in a `.ts` file.

| Area                      | Files with copy | Of files |
| ------------------------- | --------------- | -------- |
| `src/modules/workshop`    | 68              | 187      |
| `src/modules/library`     | 54              | 126      |
| `src/modules/settings`    | 20              | 66       |
| `src/modules/diagnostics` | 12              | 28       |
| `src/components`          | 8               | 86       |
| `src/modules/launcher`    | 6               | 13       |
| `src/modules/patcher`     | 5               | 21       |
| `src/modules/shell`       | 4               | 8        |
| `src/modules/migration`   | 3               | 10       |
| `src/pages`               | 3               | 3        |
| `src/modules/updater`     | 2               | 8        |
| `src/hooks`               | 2               | 16       |
| other                     | 3               | 60       |
| **total**                 | **190**         | **648**  |

Four other numbers size the catalog:

- About 750 distinct multi-word literals, which undercounts single words (`Cancel`, `Save`) and
  overcounts log lines. The first English catalog is on the order of a thousand messages.
- 70 `toast.*` calls with a literal title, 86 multi-word JSX text nodes on one line (multi-line
  nodes are missed), 397 copy-bearing attributes (an overcount).
- 66 hand-rolled plural sites, such as
  `count === 1 ? "A mod is missing dependencies" : \`${count} mods are missing dependencies\``and`formatToggleMessage`in`library/utils/folders.ts`.
- Rich text inside a sentence in about 7 places, all a `<Code>`, `<strong>` or `<kbd>` inline, and
  one inline link.

Formatting today is `toLocaleString()` and `toLocaleDateString(undefined, {...})` at about ten
sites, `date-fns` `formatDistanceToNow` in three files, and `src/utils/formatBytes.ts`.
`workshop/utils/naturalOrder.ts` deliberately avoids `Intl.Collator` because it "resolves to the
host locale", which is unaffected by any of this.

Tests: 38 of 103 test files assert on rendered English, such as
`getByText("Couldn't launch League")` in `useLaunchErrorToast.test.tsx`. `src/test/setup.ts`
loads jest-dom and the Tauri mock and nothing else. `vitest.config.ts` sets
`environment: "node"` globally, with `happy-dom` installed for files that opt in.

Nothing i18n-shaped exists yet: no library in `pnpm-lock.yaml`, no prior decision in `docs/adr/`
or `docs/plans/`, and no language setting (the `locale` in `Settings` is the game's).

## 3. What the toolchain already provides

- **Vite 8.0.10 with `@vitejs/plugin-react` 6.0.1.** `@vitejs/plugin-react` 6.0.0 (2026-03-12)
  "Remove Babel Related Features": "babel is no longer a dependency of this plugin and the related
  features are removed. If you are using Babel, you can use `@rolldown/plugin-babel` together with
  this plugin." Its README has no `babel` option. `@vitejs/plugin-react-swc` 4.3.3 supports Vite 8
  and takes SWC plugins as `plugins: [["name", {}]]`. Anything that needs a Babel or SWC
  transform therefore costs a second plugin or a plugin swap.
- **`build.target` is `chrome105` on Windows** and `es2020` elsewhere. `tsconfig.json` targets
  ES2020, `strict`, `resolveJsonModule`, `moduleResolution: bundler`, no `allowJs`.
- **Windows is the only shipped platform.** `README.md`: "Windows 10 or 11 (64-bit). macOS and
  Linux support is planned." `release.yml` runs on `windows-latest` only. On Windows the webview is
  WebView2, whose Evergreen runtime "receives the same Microsoft Edge updates" as the Stable
  channel, is "preinstalled onto all Windows 11 devices" and was installed to eligible Windows 10
  devices.
- **Tauri's CSP allows bundled modules.** `tauri.conf.json` sets
  `default-src 'self' ipc: http://ipc.localhost` and a `connect-src` that starts with `'self'`, so a
  dynamic `import()` of a chunk and a `fetch()` of a bundled file are both same-origin and allowed.
  Tauri's own docs example sets a `connect-src` without `'self'`, under which `fetch()` of a bundled
  JSON would be blocked, so a runtime-loading library depends on `'self'` staying in that
  directive. Route components are already code-split (`autoCodeSplitting: true`), so chunk loading
  under this CSP is proven.
- **ESLint 9.39 flat config** via `tseslint.config`, plugins `react`, `react-hooks`,
  `simple-import-sort`, ignoring `src-tauri/`, `gen/`, `dist/`. `lint-staged` runs `eslint --fix`
  and Prettier on staged `.ts`/`.tsx` and `cargo fmt` on staged `.rs`. CI's `frontend-check` runs
  `pnpm check` (typecheck, lint, format:check, test) and `clippy` runs
  `cargo clippy --all-targets --all-features -- -D warnings`. There is no `clippy.toml`.
- **`ts-pattern` 5.9 is a dependency** and `.exhaustive()` is used in 14 files, so an exhaustive
  match over a ts-rs union is the codebase's own idiom.
- **TanStack Router** `createRouter` accepts `Wrap` ("A component that will be used to wrap the
  entire router. This is useful for providing a context to the entire router") and `InnerWrap`,
  and the documented pattern for providers is to render them above `RouterProvider`, which
  `src/main.tsx` already does for `QueryClientProvider`, `ThemeProvider` and `ToastProvider`. Route
  `loader` and `beforeLoad` are not React: "You can't use hooks in a non-React function, so you
  can't use hooks in your `beforeLoad` or `loader` functions."

## 4. The frontend candidates

Versions, licenses and maintenance signals are as fetched on 2026-09-02.

### 4.1 i18next and react-i18next

- `i18next` 26.4.1 (MIT, published 2026-09-01), 2 open issues, pushed 2026-09-02, 13.7 kB gzipped,
  no runtime dependencies. Commits are 95% two people (jamuhl 1154, adrai 931).
- `react-i18next` 17.0.13 (MIT, 2026-09-01), peers `react >= 16.8.0` and `i18next >= 26.2.0`,
  10.2 kB gzipped, 1 open issue. React 19 is inside the range.
- **Keys are typed** by augmenting `CustomTypeOptions` with `resources: { ns: typeof json }`. The
  probe confirms an unknown key fails. Plural suffixes collapse, so `t("toggled")` is the typed key
  when the catalog has `toggled_one` and `toggled_other`.
- **Parameter typing is conditional.** Since 26.2.0 `parseInterpolation` extracts `{{var}}` from
  the resource string type. The probe shows three limits. A `.json` import widens every value to
  `string`, so no parameter is inferred from it. From an `as const` catalog,
  `t("greet", {})` fails on the missing `name` and `t("greet", { nme })` fails on the wrong name,
  but `t("greet")` with no options object passes. `t("toggled", {})` passes without `count`.
  `i18next-resources-for-ts interface` emits a literal-typed `interface Resources`, which is how
  `i18next-cli types` gets the literal types a JSON catalog cannot give.
- **Missing keys return the key string** at runtime (`Translator.js`, `res = key`), with
  `missingKeyHandler`, `parseMissingKeyHandler` and `saveMissing` hooks. Nothing fails at build
  time.
- **Plurals** use `Intl.PluralRules` with `_one`/`_other` suffixes and `count`. Since 24.0.0 there
  is no non-Intl fallback. ICU syntax is a plugin, `i18next-icu` 2.4.4, wrapping
  `intl-messageformat` (another 9.9 kB gzipped).
- **`<Trans>`** renders React elements inside a message by indexed tags (`<1>{{name}}</1>`) or
  named `components`, and "does ONLY interpolation", so it pairs with `useTranslation`.
- **Extraction.** `i18next-parser` 9.4.0 carries the npm `deprecated` field "Project is
  deprecated, use i18next-cli instead", and its repository is archived (pushed 2025-10-01).
  `i18next-cli` 1.72.4 (MIT, 2026-09-02) is the replacement, first published 2025-09-25, 316
  versions since, Node 22+, TypeScript on an SWC parser, 896 of 919 commits by one person. It
  offers `extract`, `types` (emits the `CustomTypeOptions` augmentation, `--ci` fails when stale),
  `lint` (hardcoded JSX strings, interpolation mismatch, concatenation) and `status`.
- **No official Vite plugin.** Lazy loading is
  `resourcesToBackend((lng, ns) => import(\`./locales/${lng}/${ns}.json\`))`, and namespaces
map onto `src/modules/\*`. Third-party Vite plugins exist but pin `vite 6 - 7`.
- **Enforcement.** `eslint-plugin-i18next` 6.1.5 (ISC on npm, 2026-06-28, single maintainer, no
  ESLint peer range, ESLint 9 in devDeps) has one rule, `no-literal-string`, with `mode`
  `jsx-text-only` (default) | `jsx-only` | `all`, and exclusion lists for `jsx-attributes`,
  `callees`, `object-properties` and `words`. With type information it allows a literal whose
  contextual type is a string-literal union, which is what keeps `variant="ghost"` quiet. It
  works on any codebase because it inspects literals, not i18next calls.

### 4.2 FormatJS react-intl

- `react-intl` 10.1.25 (BSD-3-Clause, 2026-08-30), peer `react >=18.0.0`, 14.7 kB gzipped.
  `@formatjs/cli` 6.16.22, `eslint-plugin-formatjs` 6.6.1 (peer `eslint 9 || 10`),
  `@formatjs/unplugin` 1.2.7 (first release 2026-03-16, Vite via `unplugin` and `oxc-parser`).
  Monorepo has 3 open issues, pushed 2026-09-02, one active maintainer (longlho 3120 commits).
- **The message is the id.** Extraction hashes `defaultMessage` into
  `[sha512:contenthash:base64:6]`, and the docs "recommend against explicit IDs since it can cause
  collision". The English therefore stays in the component as `defaultMessage`, and the catalog
  is derived from code.
- **Typing.** Ids type only through a global `FormatjsIntl.Message { ids }` augmentation.
  `values` is `Record<string, PrimitiveType | FormatXMLElementFn>` and is not checked against the
  message. Placeholder completeness is a lint rule, `enforce-placeholders`, not a type.
- **Rich text** is native to ICU: `<b>chunks</b>` in the message, resolved by
  `values={{ b: (chunks) => <b>{chunks}</b> }}` or `defaultRichTextElements`.
- **Missing ids** call `onError(new MissingTranslationError(...))` and fall through five steps to
  the literal id.
- **Build.** `babel-plugin-formatjs` 13 depends on Babel 8, `@swc/plugin-formatjs` lives in the
  swc-project repo and tracks `swc_core` bumps. `@formatjs/unplugin` needs neither, and 2026 saw
  five closed issues where the CLI's extractor and the unplugin disagreed on generated ids.
- **Enforcement.** `no-literal-string-in-jsx` covers `JSXText` and listed props only. No rule
  covers a literal passed to an arbitrary call such as `toast.error("Saved")`, which is where 70 of
  this repo's strings sit.

### 4.3 Lingui

- `@lingui/core`, `@lingui/react`, `@lingui/cli`, `@lingui/vite-plugin` all 6.6.0 (MIT,
  2026-07-24). Lingui 6 is ESM-only and its `engines` are `node >=22.19.0`, above the 22.17.0 on
  the development machine that ran these probes. `@lingui/react` peers React 16.14 through 19.
  Core is 2.0 kB and react 1.7 kB gzipped. `js-lingui` has 67 open issues, pushed 2026-09-02,
  commits led by tricoder42 (1460) and andrii-bodnar (245).
- **Macros need a transform.** The installation page's "Vite 8+ with Rolldown" variant reads:
  "Rolldown doesn't support native plugins yet, so you still need Babel or SWC to transform Lingui
  macros", and wires `@rolldown/plugin-babel` with `linguiTransformerBabelPreset()`. The SWC
  alternative is `@lingui/swc-plugin` 6.7.0, whose README says "SWC Plugin support is still
  experimental" and pins `swc_core` versions. Issue #2648 (closed 2026-08-22) records an Oxc
  transform as the intended direction, unshipped.
- **The message is the id** by default: `sha256(msg + U+001F + context)` truncated to six
  URL-safe base64 characters, so `t\`Attachment ${name} saved\`` keeps the English in the
component. Explicit ids are possible (`t({ id, message })`).
- **Typing.** Ids via `declare module "@lingui/core" { interface Register { messageIds } }`, off by
  default. `Values = Record<string, unknown>`. Issue #2206 "Strictly typed values alongside
  message with variables" has been open since 2025-03-21.
- **`<Trans>`** wraps JSX with real elements, compiled to `<0>docs</0>` placeholders. Plurals use
  CLDR via `Intl.PluralRules`. A missing translation falls back to the source message, and in
  production a message that was never extracted renders as its hash.
- **Catalogs** are `.po` by default, compiled by the Vite plugin on the fly.
  `lingui compile --strict` fails on missing translations, and `--typescript` emits typed compiled
  catalogs.
- **Enforcement.** `eslint-plugin-lingui` 0.14.0 (MIT, 2026-06-05, README still "beta", 33 stars)
  has `no-unlocalized-strings`, which matches "all JSXText, StringLiterals, and TmplLiterals" and
  then excludes by `ignore`, `ignoreFunctions`, `ignoreNames`, with `useTsTypes` needing typed
  linting. It is the other rule that covers call arguments, and it needs no Lingui in the codebase
  to run.
- **Tests** in the Lingui guide assert on rendered source-language strings, never on ids.

### 4.4 Paraglide JS

- `@inlang/paraglide-js` 2.25.0 (MIT, published 2026-08-27), 161 versions since 2023-10-16, six
  releases in the five weeks before the check. peers `typescript >=5.6` and `vite >=5.0.0`. 1.0.0
  shipped 2024-01-05, 2.0.0 on 2025-03-17. The homepage reads "Stable and production-ready -
  @inlang/paraglide-js is on v2 (MIT-licensed), with framework adapters like
  @inlang/paraglide-js-react at v1."
- **Bus factor is the weakest number in this note.** `opral/paraglide-js` has 28 open issues and
  was pushed 2026-08-27. Contributors: samuelstroschein 1333, LorisSigrist 574, then a long tail
  under 60, and one human npm maintainer. Opral is a company, not a foundation.
- **Compilation model.** `project.inlang/settings.json` names `baseLocale`, `locales`, and the
  `plugin.inlang.messageFormat` plugin (4.4.4) with a `pathPattern`. Messages are JSON with
  `{name}` placeholders and `\{` escapes. `paraglide-js compile` emits one ES module per message
  under `messages/`, a `runtime.js`, a `registry.js` (`Intl.PluralRules`, `Intl.NumberFormat`,
  `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`) and a `server.js`, plus a `.gitignore`, a
  `.prettierignore` and a README, with `/* eslint-disable */` at the top of every file. The
  `paraglideVitePlugin` is exported from the package itself (the separate `@inlang/paraglide-vite`
  is deprecated), compiles at `buildStart` and recompiles on `watchChange` in dev.
- **Every message is a typed function.** Generated JSDoc declares
  `@param {{ name: NonNullable<unknown> }} inputs` and `@param {{ locale?: "en" }} options`, and
  `--emit-ts-declarations` writes the same as `.d.ts`. The probe against the 2.25.0 output, with
  `strict` and `allowJs`, produced exactly the expected diagnostics and no others:

  | Call                                  | Result                       |
  | ------------------------------------- | ---------------------------- |
  | `m.library_empty_title()`             | ok, `string`                 |
  | `m.greet()`                           | error, inputs required       |
  | `m.greet({})`                         | error, `name` missing        |
  | `m.greet({ nme: "x" })`               | error, unknown input         |
  | `m.toggled({})`                       | error, `count` missing       |
  | `m.nope()`                            | error, no such export        |
  | `m.greet({ name }, { locale: "fr" })` | error, locale not configured |

  Values are `NonNullable<unknown>`, so a `count` of the wrong type is not caught. Names and
  presence are.

- **Keys.** The compiler flattens any key to a snake_case identifier and also exports the original
  as an alias. From the probe, `rule.bin/property-type.title` compiles to
  `export const rule_bin_property_type_title` plus
  `export { rule_bin_property_type_title as "rule.bin/property-type.title" }`, so both
  `m.rule_bin_property_type_title()` and `m["rule.bin/property-type.title"]()` type-check. The
  docs recommend flat keys and show the bracket form for nested ones.
- **Plurals and selects** are `match` blocks. The inlang format writes
  `"declarations": ["input count", "local countPlural = count: plural"]`,
  `"selectors": ["count", "countPlural"]` and a `match` keyed `count=0, countPlural=*`,
  `count=*, countPlural=one`, `count=*, countPlural=other`. The probe compiled that to
  `registry.plural("en", i?.count, {})` with an `i?.count === 0` branch ahead of the category
  branches, so exact-number cases sit beside CLDR categories. The vocabulary (declarations,
  selectors, variants) is MessageFormat 2's, which section 4.6 comes back to.
- **Missing messages never fail the build.** With a second locale that lacks a message, the
  compiler emitted `const de_toggled = en_toggled` and put the base locale last in the dispatcher,
  with a final `return "toggled"` (the key) as the last resort. No warning was printed and none is
  in `compile-project.ts`. In an English-only project a missing message is a missing export, which
  is a type error, so the runtime fallback is never reached.
- **Rich text exists, since February 2026.** Messages take `{#code}...{/code}` markup, and
  `@inlang/paraglide-js-react` 1.0.3 (published 2026-08-06, peers `@inlang/paraglide-js >=2.11.0
<3` and `react ^18 || ^19`) renders it as
  `<ParaglideMessage message={m.cta} inputs={{}} markup={{ link: ({ children, options }) => <a href={options.to}>{children}</a> }} />`,
  with tag names type-checked. `m.cta.parts()` exposes the tokens for anything else. The docs
  address react-i18next's `<Trans>` users by name. This is a six-month-old 1.0 package.
- **Locale resolution is a strategy list**, compiled in. The default is
  `["cookie", "globalVariable", "baseLocale"]`. `localStorage`, `preferredLanguage`, `url` and
  `custom-<name>` (via `defineCustomClientStrategy`) exist. `experimentalStaticLocale` compiles the
  locale to a constant and is marked experimental.
- **No lint or extraction tooling of its own.** `@inlang/cli` 3.3.4's `lint` command prints
  "Inlang lint rules have been removed for the CLI v3" and does nothing else. The Sherlock VS Code
  extension (2.4.3, 50,638 installs) extracts a selected string on click and flags a missing
  reference, and needs `@inlang/plugin-m-function-matcher` to recognise `m.x()`. Neither scans a
  codebase for unlocalised strings, and the docs recommend no ESLint rule. Section 10 fills that
  with a third-party rule, which works because a Paraglide call carries no literal.
- **Per-module message files work for reading.** `pathPattern` accepts an array, "Messages from
  all matching files will be merged", and the probe compiled
  `["./messages/{locale}/library.json", "./messages/{locale}/errors.json"]` without touching the
  files. The plugin's caveat: "When exporting, all messages are written to the last path pattern in
  the array", so an inlang tool that writes (Sherlock's extraction) lands its message in the last
  file, and a hand-edited layout depends on nobody letting a tool write.
- **Build fit.** No Babel, no SWC, no runtime library: the output is ordinary ES modules the
  bundler tree-shakes per message. `tsc` needs either `allowJs: true` (the JSDoc path the probe
  used) or `emitTsDeclarations` (docs: "requires TypeScript 5.6 or newer and is slower than
  JSDoc-based types"). TypeScript 5.6 is also what makes `export { x as "a.b" }` legal, and the
  repo is on 5.9.

### 4.5 typesafe-i18n

`typesafe-i18n` 5.27.1 (MIT, published 2026-02-11) after a gap since 5.26.2 on 2023-08-25. The
repository was transferred to `codingcommons/typesafe-i18n` (not archived, pushed 2026-03-22, 23
open issues, 18 open PRs). Its README now reads "Created by Ivan Hofer (1995-2023)", the author of
1231 of its commits. The 2026 commits are release tooling and a provenance fix. It is not a
candidate.

### 4.6 The platform: Intl and MessageFormat 2

- **`Intl.MessageFormat` is Stage 1.** The proposal README says "Stage: 1", the ECMA-402 proposals
  table lists it last presented 2024-06, the repository was pushed 2025-05-12, and MDN's `Intl`
  page lists no `MessageFormat`. No browser ships it.
- **MessageFormat 2 itself is stable.** LDML Part 9, version 48.2 (2026-03-03): "This is a stable
  document and may be used as reference material or cited as a normative reference by other
  specifications." CLDR 47 (2025-03-13) is where it "advanced from Final Candidate to Stable".
  Some functions in the `u:` namespace are still Draft. The `messageformat` npm package 4.0.0
  (2025-11-25, Apache-2.0) is the polyfill, "current as of the LDML 48 (October 2025) version".
- **Intl coverage** from browser-compat-data (Chromium column applies to WebView2): `PluralRules`
  Chrome 63 / Safari 13, `RelativeTimeFormat` 71 / 14, `ListFormat` 72 / 14.1, `DisplayNames`
  81 / 14.1, `Segmenter` 87 / 14.1, `DurationFormat` 129 / 16.4. The Vite target of `chrome105`
  is above all of them but `DurationFormat`. WebKitGTK has no compat row: it links the distro's
  ICU (`OptionsGTK.cmake` requires ICU 70.1), and Tauri's table maps Ubuntu 22.04 to WebKitGTK
  2.36, a Safari 16.0 equivalent, so everything but `DurationFormat` is present there too.
- **Using the platform alone** would mean writing a message formatter or shipping the 4.0.0
  polyfill with hand-written key lookup, and neither types keys or parameters. It is not a
  candidate, and MF2's stability matters only as a sign that Paraglide's message model is aligned
  with where the platform is going rather than with a private format.

### 4.7 Comparison

| Candidate       | Version / license                        | Runtime, gzipped       | Key typing                 | Parameter typing                                               | Where the English lives                | Rich text                           | Extraction and missing-key detection                                        | Vite 8 fit                                             | Maintenance signal                                |
| --------------- | ---------------------------------------- | ---------------------- | -------------------------- | -------------------------------------------------------------- | -------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| i18next + react | 26.4.1 / 17.0.13, MIT                    | 13.7 + 10.2 kB         | yes, `CustomTypeOptions`   | only with an options object, only from literal-typed resources | JSON catalog                           | `<Trans>`                           | `i18next-cli` extract, types, lint. Missing key returns the key at runtime  | plain calls, no plugin                                 | 2 open issues, two maintainers, CLI is one person |
| react-intl      | 10.1.25, BSD-3                           | 14.7 kB                | opt-in global augmentation | none                                                           | in code as `defaultMessage`, hashed id | ICU tags in message                 | `formatjs extract`. Missing id goes to `onError` then falls to the id       | `@formatjs/unplugin`, six months old                   | 3 open issues, one maintainer                     |
| Lingui          | 6.6.0, MIT                               | 2.0 + 1.7 kB           | opt-in `Register`          | none                                                           | in code inside macros, hashed id       | `<Trans>` macro                     | `lingui extract`, `compile --strict`. Unextracted renders as hash           | needs `@rolldown/plugin-babel` or SWC swap, Node 22.19 | 67 open issues, two maintainers                   |
| Paraglide       | 2.25.0, MIT                              | generated modules only | yes, exports               | names and presence, values `unknown`                           | JSON catalog                           | markup + `paraglide-js-react` 1.0.3 | none of its own. Missing message is a type error in an English-only project | bundled `paraglideVitePlugin`, no transform            | 28 open issues, one company, one dominant author  |
| typesafe-i18n   | 5.27.1, MIT                              | -                      | yes                        | yes                                                            | catalog                                | -                                   | -                                                                           | -                                                      | author deceased, maintenance is release tooling   |
| platform        | MF2 stable, `Intl.MessageFormat` Stage 1 | polyfill 4.0.0         | none                       | none                                                           | -                                      | -                                   | -                                                                           | -                                                      | not shippable as an app layer                     |

## 5. Key-based catalog or source string as id

The team's first priority is "migrating where strings are stored". A source-string-as-id design
(react-intl, Lingui by default) leaves the English in the component and derives the catalog from
it, which moves the storage nowhere until a second language exists. A key-based catalog moves it
today. Two repository facts reinforce that:

- **Copy is specified outside code already.** `docs/ux/*.md` quote UI copy in tables (SETTINGS.md,
  MOD_HEALTH.md, PROJECT_EDITOR.md), and `src/CLAUDE.md`'s "UI Copy" rules govern its shape. A
  catalog file per module is the artefact a reviewer diffs against those documents.
- **The domain has stable ids to key on.** `RuleId` ("a stable public name", ADR-0010, "frozen
  forever", ADR-0016), `Check.id` ("Survives label changes"), `VerdictKind` and `ErrorCode` are
  exactly the keys a catalog wants, and Paraglide's alias export means the id can be the key
  verbatim.

The cost of keys is naming them, and the risk is a key that names the sentence rather than the
slot. Paraglide's docs suggest random stable keys (`calm_green_otter`) to avoid renames when copy
changes. This repository names things on its domain vocabulary, so a key names the slot
(`library_empty_title`), which is as stable as a random word and readable in a diff.

## 6. Rich text

Section 2 counted about seven sentences with an inline element. That is small enough to decide
per site. Paraglide's markup plus `@inlang/paraglide-js-react` covers them with typed tag names,
and where a sentence splits cleanly (a label, then a `<Code>`, then nothing) two messages and a
fragment are simpler than markup. What is ruled out is composing a sentence from fragments and
concatenation, which every candidate's docs warn against and which breaks the first non-English
locale.

## 7. Plurals for English only

English needs `one` and `other`, and often an exact `0`. i18next spells that as `key_one`,
`key_other` and `key_zero` suffixes. ICU and Lingui spell it
`{count, plural, =0 {..} one {..} other {..}}`. Paraglide spells it as a `match` with `count=0`
beside `countPlural=one`. All four resolve the category through `Intl.PluralRules`, which WebView2
has had since Chrome 63. The 66 hand-rolled sites become one message each, and the
`mod${n === 1 ? "" : "s"}` idiom disappears with them.

## 8. The backend: crates, and why none

The goal is to move strings out of the backend. A Rust i18n crate keeps them in and translates
there, which is the opposite direction, and each also has its own defects for this use:

- **`rust-i18n` 4.2.1** (MIT, 2026-07-16) embeds YAML at compile time behind `t!`. It has no
  plural support (issue #65, open since 2023-10-27). Its `Backend::messages_for_locale` can dump a
  locale's table, with `%{name}` placeholders, so it could in principle ship strings to the
  frontend, but that is a worse catalog than a JSON file the frontend owns.
- **`fluent-bundle` 0.16.0** (2025-05-22) is the best-designed of them, with CLDR plurals via
  `intl-pluralrules` 7.0.2 (last updated 2022-10-19). `fluent-rs` had four commits in the year to
  2026-09-02. Sharing FTL across Rust and the frontend would need `@fluent/react` 0.15.2, last
  published 2023-08-01.
- **`gettext-rs` 0.8.0** statically links GNU gettext, which is LGPL, and needs autotools and
  MSYS2 to build on Windows. `tr` 0.1.11 defaults to it.
- **icu4x** 2.3.1 has `icu_plurals` and no MessageFormat: issue #3028 "Implement MessageFormat
  2.0" has been open since 2023-01-25 and the one implementation PR (#7884) was closed unmerged in
  2026-05.

The honest answer is that the backend should not own a string a user reads. What it owns is the
fact: which error, which rule, which check, with which values. That is what
`crates/ltk-manager-core/src/error.rs` already says of itself: "`AppError` describes _what went
wrong_, not how to report it. Rendering it for a consumer is the frontend's job." The variants
that carry a `String` sentence are where that principle was not followed through.

The `Display` impls stay. They are for logs, `tracing`, and `cargo test` output, and nothing
about this note removes them. What changes is that `Display` never reaches the IPC boundary as
the headline.

## 9. Enforcement on the Rust side

**Clippy cannot see a literal.** `disallowed_methods`, `disallowed_macros` and `disallowed_types`
are the configurable lints in `clippy.toml`. `disallowed_methods` matches "`ExprKind::Path`
resolving to a def and `ExprKind::MethodCall`", `disallowed_macros` matches by macro `DefId` in a
span's backtrace (so `std::format` and derive macros are matchable), and `disallowed_types` matches
type paths. None of them inspects a string literal, and `#[error("...")]` is a helper attribute the
`thiserror` derive consumes, not a macro with a path to list. The lints that do look at strings
(`literal_string_with_formatting_args`, `useless_format`, `print_literal`) check formatting, not
presence. A `clippy.toml` entry can forbid `format!` in a module, which is far too blunt for code
that formats paths and hashes all day.

**A variant constructor is undocumented ground.** `AppError::ValidationFailed` used as a function is
a path expression resolving to a definition, which is the shape `disallowed_methods` walks, but the
documented reach is functions and methods and this note did not verify a constructor matches.
Section 17 lists it.

**`#[expect]` has nothing to expect.** The attribute (stable since 1.81, with `reason`) fires
`unfulfilled_lint_expectations` when a lint stops firing, which is the right tool for a lint that
exists. It cannot stand in for one that does not.

**dylint can do it, at a price.** `cargo-dylint` 6.0.4 (2026-08-14) runs a custom `LateLintPass`,
which could flag a string literal inside `#[error]` or a `&'static str` returned from a `Rule`
method. The library pins a nightly (`nightly-2026-05-28` in the template, with `rustc-dev` and
`llvm-tools-preview`), needs `dylint-link`, and the README's CI section is about caching driver
and toolchain builds. `cargo-marker`, the alternative, was last published 2023-12-28. For one lint
on two crates, this is a toolchain to maintain, not a rule to write.

**What is enforceable is the wire.** Every type that crosses IPC derives `TS`, and
`pnpm generate:types` regenerates `src/lib/bindings/*.ts` from them. A script that scans those
bindings for a `string`-typed field named `message`, `title`, `description`, `summary`, `label`,
`suggestion`, `reason`, `cause` or `detail` sees every prose field the backend can emit, whatever
Rust file it lives in. Checked against a committed baseline that only shrinks, it is a ratchet a
CI job can run in seconds. Section 13.8 specifies it.

**The other lever is the compiler.** Once `AppErrorResponse` is an enum of typed fields, a new error
with a sentence in it has nowhere to put the sentence. The free-text variants' call sites (section

1. are the remaining backlog, and deleting each variant when its last site is migrated turns the
   policy into a compile error.

**Changed-file detection.** `git diff --name-only $(git merge-base origin/main HEAD)` needs the
history to reach the merge base, so the job that runs it sets `actions/checkout` `fetch-depth: 0`
("0 indicates all history for all branches and tags"). `tj-actions/changed-files` is the usual
shortcut and is what GHSA-mrrh-fwg8-r2c3 (CVE-2025-30066, CVSS 8.6) compromised in March 2025 by
moving its tags to a commit that dumped runner memory into logs across 23,000 repositories. A
hand-written `git diff` has no tag to move.

## 10. Enforcement on the frontend side

**The rule has to see call arguments.** Section 2 puts 70 strings in `toast.*` calls and 37 files'
worth in `.ts` hooks. `eslint-plugin-formatjs`'s `no-literal-string-in-jsx` checks JSX only.
`eslint-plugin-i18next`'s `no-literal-string` in `mode: "all"` and `eslint-plugin-lingui`'s
`no-unlocalized-strings` both check every string and template literal and both exempt a literal
whose contextual type is a string-literal union when type information is available. Neither cares
which library the calls go to, which is what makes them usable with Paraglide, whose own tooling
has no such rule. `eslint-plugin-i18next` is the older and wider-used of the two and has the
`mode` ladder that lets a file be tightened in steps, so it is the one section 13.7 configures,
with the Lingui rule as the drop-in alternative if its `ignoreFunctions` globs prove easier to
tune.

**Scoping to the PR's files is a CLI feature, not a config trick.** ESLint's `--rule` sets a rule
from the command line, `--max-warnings 0` turns warnings into a failing exit, and
`--no-warn-ignored` "suppresses both `File ignored by default` and `File ignored because of a
matching ignore pattern` warnings when an ignored filename is passed explicitly", which is what
happens when a generated file is in the diff. lint-staged appends the staged files to the command
by default and supports a function task that filters them. So the same command runs on staged
files at commit and on `git diff --name-only` in CI, and the config file keeps the rule at
`warn` for everything else.

**An allowlist is the alternative, not a requirement.** Flat config merges objects for the same
file "with later definitions taking precedence", so `{ files: migrated, rules: { ...: "error" } }`
after a global `warn` would ratchet per file. It is not needed when changed-file enforcement
exists, because any regression in a migrated file is by definition in a changed file. It becomes
worth it only if the global `warn` output is too noisy to live with, in which case the global level
drops to `off` and the allowlist carries `error`.

## 11. Tests

Two kinds of test want two kinds of assertion:

- **A component test asserts on rendered English.** That is what 38 files do today, it is what the
  Lingui guide does, and it is the only check that the copy on screen matches `docs/ux/`. With
  Paraglide the message function returns the English at test time, so
  `getByText("Couldn't launch League")` keeps passing with no provider and no setup.
- **A mapping test asserts against the message function.**
  `describeError({ code: "MOD_NOT_FOUND", modId: "x" }).title` is compared to
  `m.error_mod_not_found({ modId: "x" })`, not to a retyped sentence, so a copy edit does not break
  a test about routing.

Assertions on keys are the wrong shape here: a key is an implementation detail with no reader,
and a test that checks it passes when the copy is wrong. i18next's `cimode` language, which returns
keys, is the one thing this note found that argues for key assertions, and it argues only for
i18next.

Vitest's `environment: "node"` stays global, with `// @vitest-environment happy-dom` per file as
now. Paraglide's output has to exist before `vitest` runs, which section 13.9 handles.

## 12. Decision: Paraglide, and the backend sends codes with typed fields

**Paraglide JS 2.25.0 owns every user-facing string of the frontend**, in JSON message files per
module, compiled by `paraglideVitePlugin` into typed functions that components call directly. It
is chosen for the two properties the priorities need most: the English moves into a catalog file
today, and an unknown key or missing parameter is a `tsc` failure rather than a runtime string. It
costs the smallest build change of any candidate (no transform, no runtime library, no provider)
and its message model is the one the platform standardised.

**The backend sends a code and typed fields, never a sentence.** `AppErrorResponse` becomes an
internally tagged enum, tag `code`, exported by ts-rs as a discriminated union, and the frontend
turns it into copy in one exhaustive `describeError`. Rule, check and verdict copy is keyed by the
domain id the backend already sends. External-crate prose travels as a `detail` field and is drawn
as data, never as the headline.

**Migration is on touch, enforced on the PR's changed files** on both sides: `no-literal-string` at
`error` on changed `.ts`/`.tsx`, and a bindings ratchet plus a backlog count on changed `.rs`.

What tipped it against the runner-up (section 14): i18next's parameter typing is conditional in
ways the probe made concrete, its catalog needs a generated `.d.ts` to be typed at all, and its
official extractor is eleven months old and one person's work, which is the same bus-factor
concern Paraglide carries without the type safety in return.

What was accepted: a six-month-old rich-text adapter for about seven sentences, a company-backed
project with one dominant author, and no first-party lint (section 10 shows the third-party rule
is the better tool anyway).

## 13. The sketch

### 13.1 Placement

Paraglide has no provider. A message is a function that reads the locale through the compiled
strategy, and with `strategy: ["baseLocale"]` it reads a constant. So nothing wraps `RouterProvider`
and nothing is added to `__root.tsx`. What exists instead is one module:

```
src/i18n/index.ts        re-exports m, and later registers the locale strategy
src/i18n/errors.ts       describeError, describeLaunchError, describePatcherError
src/i18n/rules.ts        rule copy by RuleId
src/i18n/checks.ts       diagnostics copy by Check.id and VerdictKind
```

`src/main.tsx` imports `@/i18n` before `createRouter`, which matters only once a strategy is
registered (section 15). Route `loader` and `pendingComponent` code calls `m.*` like any other
function, which the hook-based candidates could not offer in a loader.

### 13.2 Catalog layout

```
.
|-- project.inlang
|   |-- settings.json            baseLocale, locales, the message-format plugin, pathPattern
|   |-- paraglide.config.ts      outdir, strategy, shared by the CLI and the Vite plugin
|-- messages
|   |-- en
|       |-- errors.json          one message per AppError code and per sub-error kind
|       |-- rules.json           keyed by RuleId
|       |-- diagnostics.json     keyed by Check.id and VerdictKind
|       |-- library.json
|       |-- workshop.json
|       |-- settings.json
|       |-- launcher.json
|       |-- patcher.json
|       |-- shell.json
|       |-- common.json          Cancel, Save, Close, the words every module shares
|-- src
    |-- paraglide                generated, gitignored, cleaned on every compile
```

`pathPattern` lists the files in that order, `common.json` last, because a writing tool lands its
output in the last pattern and `common.json` is where a stray message is easiest to spot. The
generated folder is not committed: `routeTree.gen.ts` is, but it is one file, and this is one file
per message. `src/paraglide/` goes into the root `.prettierignore` (Prettier reads only the root
one) and into the ESLint `ignores`.

### 13.3 Keys

Two shapes, and the file says which applies:

- **A slot name** for the app's own copy: `<module>_<subject>_<role>` in snake_case, on the domain's
  words. `library_empty_title`, `library_empty_description`, `settings_league_path_hint`,
  `patcher_stop_action`. The role suffixes are a short closed set: `title`, `description`, `hint`,
  `action`, `label`, `placeholder`, `empty`.
- **A domain id** for copy the backend keys: `rule.<RuleId>.title`, `rule.<RuleId>.description`,
  `rule.<RuleId>.unfixable`, `check.<Check.id>.label`, `verdict.<VerdictKind>.title`,
  `error.<CODE>.title`. These are called with the bracket form,
  `m["rule.bin/property-type.title"]()`, so the id in the catalog is the id on the wire.

A key names the slot, never the sentence, so the copy can change without a rename. Keys are sorted
in the file, and a message that is only whitespace or punctuation away from another is a sign the
two should be one message with an input.

### 13.4 A component

```tsx
import { m } from "@/i18n";

export function LibraryEmpty({ onImport }: LibraryEmptyProps) {
  return (
    <EmptyState
      title={m.library_empty_title()}
      description={m.library_empty_description()}
      action={<Button onClick={onImport}>{m.library_import_action()}</Button>}
    />
  );
}
```

A plural and a select, replacing `formatToggleMessage`:

```json
{
  "library_folder_toggled_title": [
    {
      "declarations": ["input count", "input state", "local countPlural = count: plural"],
      "selectors": ["state", "countPlural"],
      "match": {
        "state=enabled, countPlural=one": "Enabled {count} mod",
        "state=enabled, countPlural=other": "Enabled {count} mods",
        "state=disabled, countPlural=one": "Disabled {count} mod",
        "state=disabled, countPlural=other": "Disabled {count} mods"
      }
    }
  ],
  "library_folder_toggled_description": "All mods in \"{folderName}\" have been {state}"
}
```

```ts
toast.success(
  m.library_folder_toggled_title({ count, state: enabled ? "enabled" : "disabled" }),
  m.library_folder_toggled_description({ folderName, state: enabled ? "enabled" : "disabled" }),
);
```

The literal match on `state` is the mechanism the probe showed for `count=0`. A rich sentence uses
markup and the adapter:

```tsx
<ParaglideMessage
  message={m.settings_league_path_hint}
  inputs={{}}
  markup={{ code: ({ children }) => <Code>{children}</Code> }}
/>
```

with `"settings_league_path_hint": "Pick the folder holding {#code}LeagueClient.exe{/code}"`.

### 13.5 A backend error becomes a string

The Rust side, in `src-tauri/src/error.rs`, replacing the `code` / `message` / `context` struct:

```rust
/// What went wrong, as the fields the frontend translates over.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, rename = "AppError")]
#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE", rename_all_fields = "camelCase")]
pub enum AppErrorResponse {
    Io { detail: String },
    Serialization { detail: String },
    LeagueNotFound,
    InvalidPath { path: String },
    ModNotFound { mod_id: String },
    ValidationFailed { detail: String },
    SchemaVersionTooNew { file_version: u32, max_supported: u32 },
    Launcher { error: LauncherError },
    Patcher { error: PatcherError },
    Workshop { error: WorkshopError },
    Overlay { category: OverlayErrorCategory, detail: String },
    Hashtable { detail: String },
    // ...
}
```

The tag is `code` rather than `kind` so every `error.code === "INVALID_PATH"` and `hasErrorCode`
site keeps working, and the sub-errors are struct variants (`Launcher { error }`) rather than
newtype variants, because an internally tagged newtype around an enum that is itself tagged `kind`
would nest two tags. `From<AppError>` stays the single mapping. ts-rs writes:

```ts
export type AppError =
  | { code: "IO"; detail: string }
  | { code: "LEAGUE_NOT_FOUND" }
  | { code: "INVALID_PATH"; path: string }
  | { code: "MOD_NOT_FOUND"; modId: string }
  | { code: "SCHEMA_VERSION_TOO_NEW"; fileVersion: number; maxSupported: number }
  | { code: "LAUNCHER"; error: LauncherError }
  | ...
```

The frontend, in `src/i18n/errors.ts`:

```ts
import { match } from "ts-pattern";
import { m } from "@/i18n";
import type { AppError } from "@/lib/bindings";

export interface ErrorCopy {
  title: string;
  description?: string;
  /** Prose from outside the app, drawn as data with `select-text`. */
  detail?: string;
}

export function describeError(error: AppError): ErrorCopy {
  return match(error)
    .with({ code: "LEAGUE_NOT_FOUND" }, () => ({
      title: m["error.LEAGUE_NOT_FOUND.title"](),
      description: m["error.LEAGUE_NOT_FOUND.description"](),
    }))
    .with({ code: "MOD_NOT_FOUND" }, ({ modId }) => ({
      title: m["error.MOD_NOT_FOUND.title"]({ modId }),
    }))
    .with({ code: "SCHEMA_VERSION_TOO_NEW" }, ({ fileVersion, maxSupported }) => ({
      title: m["error.SCHEMA_VERSION_TOO_NEW.title"](),
      description: m["error.SCHEMA_VERSION_TOO_NEW.description"]({ fileVersion, maxSupported }),
    }))
    .with({ code: "IO" }, ({ detail }) => ({ title: m["error.IO.title"](), detail }))
    .with({ code: "LAUNCHER" }, ({ error }) => describeLaunchError(error))
    .exhaustive();
}
```

`.exhaustive()` makes a new Rust variant a frontend compile error, which is the coupling the
migration wants. `useLaunchErrorToast` becomes `describeLaunchError` with its prose moved into
`launcher.json`, and `usePatcherError`'s two title tables become `describePatcherError`.

Rule copy, in `src/i18n/rules.ts`:

```ts
const ruleCopy = {
  "bin/property-type": {
    title: m["rule.bin/property-type.title"],
    description: m["rule.bin/property-type.description"],
    unfixable: m["rule.bin/property-type.unfixable"],
  },
  // one entry per rule in rules::all()
} satisfies Record<string, RuleCopy>;

export function describeRule(id: RuleId): RuleCopy {
  return ruleCopy[id] ?? { title: () => id, description: () => "" };
}
```

`RuleId` is `string` in the bindings, so exhaustiveness is a test: a fixture lists the ids
`rules::all()` returns and asserts `ruleCopy` has each. On the Rust side `Rule::title`,
`description` and `unfixable_description` leave the trait, `RuleInfo` and `RuleBrief` lose their
`title`, `description` and `unfixable` fields, and `docs/ux/MOD_HEALTH.md`'s "Who answers" table
reads "the running build, from the catalog". A per-problem `message` becomes a tagged `detail`
enum with typed fields per rule, migrated rule by rule. `Check.label`, `summary` and `suggestion`
follow the same path keyed by `Check.id`, with `summary` becoming a tagged outcome, and
`Verdict.title` and `cause` by `VerdictKind`.

Events: `hotkey-error` carries an `AppError`, `protocol-install-progress` carries a `stage` enum
and an `error: Option<AppError>`.

### 13.6 The wire, in one line

```json
{ "ok": false, "error": { "code": "SCHEMA_VERSION_TOO_NEW", "fileVersion": 4, "maxSupported": 3 } }
```

### 13.7 ESLint

```js
import i18next from "eslint-plugin-i18next";

// after the existing ts/tsx object
{
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/lib/bindings/**", "src/paraglide/**", "src/routeTree.gen.ts"],
  plugins: { i18next },
  rules: {
    "i18next/no-literal-string": ["warn", {
      mode: "all",
      "jsx-attributes": { exclude: ["className", "data-ui", "to", "href", "id", "name", "type", "role", "variant", "size", "weight", "for", "key", "src", "rel", "target"] },
      callees: { exclude: ["invoke", "listen", "emit", "useHotkeys", "navigate", "console\\..*", "setProperty", "removeProperty", "querySelector", "getElementById"] },
      "object-properties": { exclude: ["to", "search", "key", "id", "className", "data-ui"] },
      words: { exclude: ["^[a-z0-9_./:-]+$"] },
    }],
  },
},
```

The exclusion lists are a starting point to tune on the first migrated module, and the `words`
pattern exempts identifiers, paths and ids on the heuristic that copy has a capital or a space.
Typed linting (`parserOptions.projectService`) is what lets the rule skip `variant="ghost"`, and
enabling it is part of this change.

The same rule at `error`, on the files that changed:

```jsonc
// package.json, lint-staged
"*.{ts,tsx}": [
  "eslint --fix",
  "eslint --no-warn-ignored --max-warnings 0 --rule 'i18next/no-literal-string: error'",
  "prettier --write"
]
```

```yaml
# ci.yml, in frontend-check, after pnpm install
- uses: actions/checkout@v5
  with: { fetch-depth: 0 }
- name: Touched files carry no literal copy
  run: |
    base=$(git merge-base origin/main HEAD)
    files=$(git diff --name-only --diff-filter=ACMR "$base" -- 'src/**/*.ts' 'src/**/*.tsx')
    [ -z "$files" ] || pnpm exec eslint --no-warn-ignored --max-warnings 0 \
      --rule 'i18next/no-literal-string: error' $files
```

The escape hatch is a file-level
`/* eslint-disable i18next/no-literal-string -- deferred, #<issue> */`, which the diff shows and a
reviewer reads. It is the one comment this policy permits, and it names the issue that owes the
migration.

### 13.8 Rust

Two scripts and one deletion, no lint:

- **`scripts/check-prose-bindings.mjs`** scans `src/lib/bindings/*.ts` for a field typed `string`
  whose name is one of `message`, `title`, `description`, `summary`, `label`, `suggestion`,
  `reason`, `cause`, `detail`, and compares the set of `File.field` pairs with a committed
  `i18n/prose-bindings.json`. A pair not in the file fails. A pair in the file that no longer
  exists is removed by the script with `--update`, and `git diff --exit-code` on the file is the
  check, the way `licenses` already verifies `third-party-licenses.json`. `detail` is in the list
  so that every new `detail` field is a deliberate addition to the baseline, visible in the diff.
- **`scripts/check-i18n-backlog.mjs`** counts, per `.rs` file, `AppError::ValidationFailed(`,
  `AppError::Other(`, `AppError::Fantome(`, `AppError::PackFailed(`, `AppError::InvalidPath(`,
  `fn title(&self) -> &'static str` and `check_ok(` / `check(` calls, against a committed
  `i18n/rust-backlog.json`. A count may only fall. On the CI job's changed-file list, a changed
  file's count must be zero. That is the migrate-on-touch rule for Rust, and its escape hatch is
  the baseline entry staying put, which the diff of `rust-backlog.json` shows.
- **Delete each free-text variant** when its count reaches zero. From then on the compiler is the
  lint.

`pnpm generate:types` has to run before the bindings script sees fresh output. CI runs it and
fails on `git diff --exit-code src/lib/bindings`, which also catches the stale-bindings mistake
this repository has today with no check.

### 13.9 Build, check and test wiring

```jsonc
// package.json
"i18n:compile": "paraglide-js compile --project ./project.inlang --outdir ./src/paraglide",
"check": "pnpm i18n:compile && pnpm run --parallel \"/^(typecheck|lint|format:check)$/\" && pnpm run test",
```

`vite.config.ts` and `vitest.config.ts` both add
`paraglideVitePlugin({ project: "./project.inlang", outdir: "./src/paraglide", strategy: ["baseLocale"] })`,
so `pnpm dev`, `pnpm build` and `vitest` compile for themselves. `tsconfig.json` gains
`allowJs: true` so `tsc` reads the JSDoc types, with `emitTsDeclarations: true` as the fallback if
`allowJs` proves unwanted. `@inlang/paraglide-js` and `@inlang/paraglide-js-react` are
dependencies, `eslint-plugin-i18next` a devDependency, and `pnpm generate:licenses` runs after.

### 13.10 The policy, as a reviewer applies it

> A pull request leaves every file it changes with no user-facing literal. For a `.ts` or `.tsx`
> file that means `no-literal-string` passes at `error`. For a `.rs` file that means its backlog
> count is zero and no new prose field appears in the bindings. A file the pull request cannot
> afford to migrate says so in the file, with the issue that owes it, and the reviewer treats that
> line as the thing under review.

Three consequences a reviewer applies with it:

- A one-line fix in a 400-line unmigrated component is a migration of that component. That is the
  policy working, not a cost to negotiate away. The alternative is a separate migration PR first,
  and the deferral comment is for when neither fits.
- A new message goes into the catalog of the module that owns the screen, not into `common.json`,
  unless two modules already say the same words.
- Copy is reviewed against `docs/ux/` and `src/CLAUDE.md`'s UI Copy rules in the JSON diff, where
  the sentences sit together, rather than in the component diff, where they no longer are.

### 13.11 Order of migration

1. **`src-tauri/src/error.rs` and `src/i18n/errors.ts`, one PR.** The tagged `AppErrorResponse`,
   `describeError`, the sub-error describers folded in from `useLaunchErrorToast` and
   `usePatcherError`, `errors.json` and `launcher.json`. About 45 messages. TypeScript lists every
   `error.message` read (about 50) as an error, and each becomes `describeError(error)`. This goes
   first because every later Rust migration needs the seam to exist.
2. **`src/components/` and `common.json`.** `Toast`, `Dialog`, `CommandPalette`, the empty states:
   the eight files with copy define the shared words every module reuses.
3. **`src/modules/launcher` and `src/modules/patcher`.** Small, already keyed by `kind`, and the
   proof that a backend union and a frontend catalog round-trip.
4. **The bindings ratchet and the backlog script**, landed once the above shows the shape holds.
   From here the policy is enforced.
5. **`src/modules/settings`** (20 files). The copy is specified in `docs/ux/SETTINGS.md`, so the
   catalog can be checked line by line against it.
6. **`src/modules/library`** (54 files) together with `problems/rules/*` and
   `mods/health.rs` on the Rust side: rule copy keyed by `RuleId`, verdict briefs without titles.
7. **`src/modules/diagnostics`** (12 files) with `diagnostics/*.rs`: check copy by `Check.id`,
   verdict copy by `VerdictKind`, the incident cause sentences.
8. **`src/modules/workshop`** (68 files) last and on touch only. It is the largest and the least
   coupled to the backend's prose.

`src/pages/` (three legacy files) migrates when touched or is deleted, whichever comes first.

## 14. Runner-up: i18next, and what would pick it

i18next 26 with react-i18next 17 is the runner-up, on key-based JSON catalogs per module, typed by
`i18next-cli types`, enforced by the same `eslint-plugin-i18next` rule, with `<Trans>` for rich
text and `cimode` for mapping tests. It would be chosen instead if any of these held:

- **Parameter typing is not worth a compile step.** i18next's typing is good enough when every
  call passes an options object and the catalog types come from `i18next-cli types --ci`. A team
  that accepts "the key is typed, the params are a lint" gets a larger ecosystem for it.
- **Runtime catalog loading is wanted.** Namespaces loaded per route through
  `resourcesToBackend` and `import()` are i18next's native shape, and Paraglide compiles everything
  in. For an English-only desktop app the catalog is a few hundred kilobytes of source and the
  difference is nil, but a plugin-style app with third-party string packs would want i18next.
- **Bus factor is weighed above type safety.** i18next has two long-standing maintainers and 8,600
  stars against one dominant author at a company. Its official CLI, though, is one person and
  eleven months old, so the gap is narrower than the star counts suggest.
- **`<Trans>` has to be boring.** react-i18next's `<Trans>` is years old and documented in depth,
  where `@inlang/paraglide-js-react` is a 1.0.3 from August.

Lingui is not the runner-up because its default puts the English back in the component and its
macros need the Babel plugin this build removed. react-intl is not, because ids are hashes of the
English and neither ids nor values are typed without work.

## 15. Deferred, and what would pick each up

- **A second language.** Needs a translator workflow (Sherlock, or Fink, or a hand-edited
  `messages/de/*.json`), `locales: ["en", "de"]`, and a decision on the fallback that section 4.4
  showed compiles silently. It is picked up when someone offers a translation, and the catalog
  layout needs nothing changed for it.
- **Locale switching.** A `Settings.uiLocale` field, a
  `defineCustomClientStrategy("custom-settings", ...)` registered in `src/i18n/index.ts` ahead of
  `baseLocale`, and a re-render on change, which Paraglide does not provide for React: the
  candidate mechanism is a `key={locale}` on the tree under `RouterProvider`, and whether
  `ParaglideMessage` re-renders on its own is unverified. Picked up with the first second language.
- **RTL.** `getTextDirection()` exists in the runtime and reads `Intl.Locale`. Picked up only with
  an RTL locale, and the design system's `select-none` and layout rules would need their own
  review first.
- **Date, number and byte formatting per locale.** `toLocaleString()`, `date-fns` and `formatBytes`
  stay as they are. Paraglide's registry can format inside a message
  (`local size = bytes: number`), and the `undefined` locale in
  `toLocaleDateString(undefined, ...)` becomes `getLocale()` when switching lands. Until then every
  one of these formats in the host locale, which is what they do today.
- **`experimentalStaticLocale`.** Would compile the locale to a constant and drop the strategy
  code from the bundle. Experimental in 2.25.0 and not worth the flag for a few kilobytes.

## 16. Decisions that deserve an ADR

Each is a declarative sentence in the style of `docs/adr/`:

- **The frontend owns every user-facing string.** The backend sends codes, ids and typed fields,
  `Display` is for logs, and a `String` a user reads is a defect in a type that crosses IPC.
- **A domain id is its own message key.** `RuleId`, `Check.id`, `VerdictKind` and `ErrorCode` key
  the catalog verbatim, which binds the copy to ADR-0010 and ADR-0016's promise that those ids are
  frozen.
- **A touched file leaves migrated.** The policy of section 13.10, its two escape hatches, and the
  reason a lint on changed files was chosen over an allowlist.
- **A component test asserts on rendered English.** Because the copy is specified in `docs/ux/`
  and a key is not something a reader sees.
- **Generated message modules are not committed.** `src/paraglide/` is compiled by the Vite plugin
  and by `pnpm check`, against `routeTree.gen.ts`'s precedent of committing generated code.

## 17. Still unconfirmed

- **Whether `disallowed_methods` matches a tuple-variant constructor.** The lint's source walks
  `ExprKind::Path` resolving to a definition, which a constructor is, but the documentation says
  functions and methods. It decides nothing now, since section 13.8 does not rely on it, and it
  would remove one script if it works.
- **Whether `ParaglideMessage` re-renders on a locale change.** Deferred with switching, section 15.
- **Value typing beyond `NonNullable<unknown>`.** Whether a `plural` selector on an input narrows
  it to `number` in the generated JSDoc was not probed. Presence and names are what the probe
  covered.
- **The `words` and `callees` exclusion lists** in section 13.7 are drafted from section 2's
  counts and not yet run against the tree. The first migrated module tunes them.
- **`i18next-resources-for-ts` is what `i18next-cli types` wraps.** The CLI's dependency list
  names it and its `interface` output is literal-typed, but the CLI's own `types` output was not
  run.
- **Whether `eslint-plugin-i18next` needs an ESLint 10 check.** It declares no ESLint peer range.
  The repository is on 9.39 and this note did not run it on 10.
