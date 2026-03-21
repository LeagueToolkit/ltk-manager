# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is the primary guidance document for the ltk-manager codebase.

## Commands

All commands run from the repo root.

```bash
# Full dev mode (Rust backend + React frontend with hot reload)
pnpm tauri dev

# Frontend only (skip Rust rebuild, faster iteration on UI)
pnpm dev

# Type check / lint / format / all three
pnpm typecheck
pnpm lint
pnpm format
pnpm check          # typecheck + lint + format:check

# Production build
pnpm tauri build

# Rust-only operations (from workspace root)
cargo clippy -p ltk-manager
cargo fmt -p ltk-manager

# Verbose backend logging
RUST_LOG=ltk_manager=trace,tauri=info pnpm tauri dev
```

## Editing Rules

**Always read files before editing them.** Never assume file contents from memory or prior context. When making bulk edits across multiple files, read all target files first, then perform edits.

## Code Style

From `.cursorrules`: avoid trivially descriptive comments. Only comment non-obvious business logic, workarounds, edge cases, or "why" decisions. Document all public Rust APIs with `///` doc comments.

**No redundant comments.** Do not add inline comments that restate what the code already expresses. If the code is descriptive enough (clear variable names, well-known patterns like temp-file-then-rename, obvious API calls), leave it uncommented. This applies to AI-generated code and suggestions too — strip narration comments before committing.

### JSX Conditional Rendering

**Avoid ternary operators in JSX.** Use early returns or `{condition && <Component />}` instead.

```tsx
// Good — early return
if (isLoading) return <LoadingState />;
if (error) return <ErrorState error={error} />;
return <Content />;

// Good — single-line conditional
{
  hasItems && <ItemList items={items} />;
}

// Bad — ternary in JSX
{
  isLoading ? <LoadingState /> : error ? <ErrorState /> : <Content />;
}
```

### Import Conventions

**Always import from barrel exports, never from subdirectories.** This keeps import paths stable and encapsulates internal structure.

- **Global components:** import from `@/components`, not `@/components/Button`, `@/components/Toast`, etc.
- **Modules:** import from `@/modules/{module}`, not `@/modules/{module}/components` or `@/modules/{module}/api`.

```ts
// Good
import { Button, IconButton, useToast } from "@/components";
import { ModCard, useInstalledMods } from "@/modules/library";

// Bad — reaches into internals
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { ModCard } from "@/modules/library/components";
```

## Backend (Rust) — `src-tauri/src/`

### Module Layout

- `main.rs` — Tauri setup, command registration in `generate_handler![]`, logging init
- `error.rs` — `AppError`, `AppErrorResponse`, `IpcResult<T>`, `MutexResultExt`
- `state.rs` — `SettingsState(Mutex<Settings>)`, settings persistence
- `commands/` — `#[tauri::command]` wrappers (one file per domain: `mods.rs`, `profiles.rs`, `patcher.rs`, `settings.rs`, `workshop.rs`, `shell.rs`, `app.rs`)
- `mods/mod.rs` — Business logic for mod install/uninstall/toggle, profile CRUD, library index management
- `overlay/` — Overlay building, content providers (`modpkg_content.rs`, `fantome_content.rs`)
- `patcher/` — Patcher lifecycle (start/stop/status), thread management with `Arc<AtomicBool>` stop flag
- `legacy_patcher/` — FFI integration with `cslol-dll.dll`

### State

Two Tauri-managed states:

- `SettingsState` — App settings (league path, storage path, theme). Access via `State<SettingsState>`, lock with `.0.lock().mutex_err()?.clone()`.
- `PatcherState` — Patcher thread handle and stop flag. Access via `State<PatcherState>`.

### Error Codes

`ErrorCode` enum variants (serialized as `SCREAMING_SNAKE_CASE`): `Io`, `Serialization`, `Modpkg`, `Fantome`, `LeagueNotFound`, `InvalidPath`, `ModNotFound`, `ValidationFailed`, `InternalState`, `MutexLockFailed`, `PatcherRunning`, `Unknown`, `WorkshopNotConfigured`, `ProjectNotFound`, `ProjectAlreadyExists`, `PackFailed`, `Wad`, `Zip`.

Errors can carry JSON context: `AppErrorResponse::new(code, msg).with_context(json!({ "modId": id }))`.

## Frontend (React + TypeScript) — `src/`

### Key Files

- `lib/tauri.ts` — All Tauri command bindings (`api` object), TypeScript types matching Rust structs, `invokeResult<T>()` wrapper
- `utils/result.ts` — `Result<T, E>` discriminated union, `isOk`, `isErr`, `unwrap`, `match`
- `utils/query.ts` — `queryFn()`, `queryFnWithArgs()`, `mutationFn()`, `unwrapForQuery()` bridges between `Result<T>` and TanStack Query
- `utils/errors.ts` — `AppError` interface, `ErrorCode` type, `hasErrorCode()` guard, context extractors with Zod
- `stores/` — Zustand stores for client-only state

### Adding a New Tauri Command (Checklist)

1. Business logic in `src-tauri/src/{module}/` → returns `AppResult<T>`
2. Command wrapper in `src-tauri/src/commands/{module}.rs` → returns `IpcResult<T>` via `.into()`
3. Export in `src-tauri/src/commands/mod.rs`
4. Register in `main.rs` `generate_handler![]`
5. Add TS types + `api.myCommand` in `src/lib/tauri.ts`
6. Create hook in `src/modules/{module}/api/useMyCommand.ts`
7. Export through `src/modules/{module}/api/index.ts` → `src/modules/{module}/index.ts`

### Tauri Event Listening

For backend-to-frontend events (e.g., overlay progress), use `listen<T>()` from `@tauri-apps/api/event` in a `useEffect` with cleanup via `unlisten()`. See `modules/patcher/api/useOverlayProgress.ts` for the pattern.

### Routing

TanStack Router with file-based routing in `src/routes/`. Route tree is auto-generated in `routeTree.gen.ts`. The root route (`__root.tsx`) checks setup status and redirects to `/settings` on first run.

### Component Library (`src/components/`)

**ALWAYS use reusable components from `@/components` instead of native HTML or raw base-ui imports.** Module code should never import from `@base-ui-components/react` directly — all base-ui primitives must be wrapped in `src/components/` first.

**Available components:**
| Component | Usage | Base-UI Primitive |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------- |
| `Button`, `IconButton` | All clickable actions | `Button` |
| `Field`, `FormField`, `TextareaField` | All form inputs (text, textarea) | `Field` |
| `Checkbox`, `CheckboxGroup` | Boolean/multi-select inputs | `Checkbox` |
| `RadioGroup` (compound: `Root`, `Label`, `Options`, `Card`, `Item`) | Mutually exclusive choices | `Radio`, `RadioGroup` |
| `Tabs` (compound: `Root`, `List`, `Tab`, `Panel`, `Indicator`) | Tabbed content | `Tabs` |
| `Tooltip` | Hover information | `Tooltip` |
| `Toast`, `ToastProvider`, `useToast()` | Notifications | `Toast` |
| `Switch` (sizes: `sm`, `md`) | Toggle on/off | `Switch` |
| `Menu` (compound: `Root`, `Trigger`, `Portal`, `Positioner`, `Popup`, `Item`, `Separator`, `Group`, `GroupLabel`) | Dropdown/context menus | `Menu` |
| `Select`, `SelectField` (compound + simplified), TanStack Form: `field.SelectField` | Dropdown select inputs | `Select` |
| `Popover` (compound: `Root`, `Trigger`, `Portal`, `Backdrop`, `Positioner`, `Popup`, `Arrow`, `Title`, `Description`, `Close`) | Positioned popover panels | `Popover` |

**Also wrapped:**
| Component | Usage | Base-UI Primitive |
| ------------ | -------- | --------------------------------- |
| `Progress` (compound: `Root`, `Track`, `Indicator`) | Progress bars | `Progress` |
| `Combobox` (compound: `Root`, `Input`, `Trigger`, `Portal`, `Positioner`, `Popup`, `List`, `Item`, `Empty`, `Clear`, `Chips`, `Chip`, `ChipRemove`) | Autocomplete / combobox | `Combobox` |
| `MultiSelect` | Multi-value combobox | Wraps `Combobox` |
| `Skeleton` (`width`, `height`, `count`, `rounded`, `className`) | Shimmer loading placeholders | None (custom) |
| `Spinner` (`size`: sm/md/lg, `className`) | Loading spinner (wraps Loader2) | None (custom) |

When adding a new base-ui component:

1. Create wrapper in `src/components/NewComponent.tsx`
2. Export from `src/components/index.ts`
3. Import in modules via `@/components`, never from `@base-ui-components/react` directly

### Form System (`src/lib/form/`)

Uses `@tanstack/react-form` with Zod validation. The form system provides:

- `useAppForm()` — Pre-configured form hook with Zod adapter
- Pre-registered field components available via `form.AppField` and `form.AppForm`:
  - `field.TextField`, `field.TextareaField` — Text inputs
  - `field.SelectField` — Dropdown select
  - `field.CheckboxField` — Boolean checkbox
- All field components integrate with the wrapped `@/components` primitives

### Key Dependencies

- `@base-ui/react` — Headless UI primitives (wrapped via `src/components/`)
- `@tanstack/react-form` + `zod` — Form management with validation
- `ts-pattern` — Exhaustive pattern matching
- `zustand` — Client-side state (not for server state — use TanStack Query)
- `lucide-react` — Icon library (`import { IconName } from "lucide-react"`)
- `tailwind-merge` — Merging Tailwind classes in component variants
- `framer-motion` — Layout animations for DnD (`AnimatePresence` on `DragDropOverlay` only). Tree-shake to ≤30KB gzipped.

### Icons

All icons come from `lucide-react`. Import by PascalCase name:

```ts
import { Check, Settings, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react"; // for type annotations
```

- Standard spinner: `<Loader2 className="animate-spin" />`
- Icons accept `className`, `size`, `strokeWidth` props
- Do NOT use `react-icons` — it has been removed from the project

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin. CSS is organized into three files in `src/styles/`:

| File             | Purpose                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global.css`     | Design tokens (all scales), CSS reset, dark/light themes, global utilities, scrollbar, focus ring, drag region, toast viewport, glassmorphism         |
| `animations.css` | All `@keyframes` (fade-in, slide-up, slide-down, toast-slide-in/out, shimmer, dialog-enter/exit, spinner) + `.stagger-enter` system + utility classes |
| `tailwind.css`   | `@import "tailwindcss"` + `@theme {}` mapping tokens to Tailwind utilities. **This is the single CSS entry point** imported in `main.tsx`.            |

**Design tokens** use numbered scales defined as CSS custom properties:

| Category   | Pattern            | Example                          |
| ---------- | ------------------ | -------------------------------- |
| Spacing    | `--space-{NNN}`    | `--space-004` → 24px (NNN × 6px) |
| Radius     | `--radius-{NNN}`   | `--radius-003` → 8px             |
| Icon sizes | `--icon-{NNN}`     | `--icon-003` → 16px              |
| Shadows    | `--shadow-{name}`  | `--shadow-sm`, `--shadow-glass`  |
| Z-index    | `--z-{name}`       | `--z-modal`, `--z-toast`         |
| Duration   | `--duration-{NNN}` | `--duration-004` → 200ms         |
| Easing     | `--ease-{name}`    | `--ease-spring`                  |

**Color tokens:** `surface-{50..950}` for neutrals, `accent-{50..950}` for the dynamic accent color (HSL-based via `--accent-hue`). Dark theme is default; light theme uses `[data-theme="light"]` attribute on `<html>`.

**Important:** `global.css` must NOT use `@apply` with Tailwind utilities — use raw CSS custom property references instead (e.g., `background-color: var(--surface-900)`).

### Density Modes

Three density modes applied via `[data-density]` attribute on `<html>`:

| Mode     | Scale | Description                          |
| -------- | ----- | ------------------------------------ |
| Compact  | 0.6x  | Extra tight spacing and icons        |
| Normal   | 0.75x | Default — tighter than original base |
| Spacious | 1x    | Original base spacing                |

`--density-scale` CSS custom property is set on `:root` for `calc()` usage. Density affects `--space-*` and `--icon-*` tokens. Does NOT affect `--radius-*`, `--shadow-*`, `--z-*`, or colors.

Managed by `useDisplayStore` (Zustand persist, localStorage key `ltk-display-prefs`). Synced to `<html>` via `useEffect` in `__root.tsx`.

### Reduce Motion

Three-option system applied via `[data-reduce-motion]` attribute on `<html>`:

- **System Default** — follows OS `prefers-reduced-motion` media query
- **On** — always suppress animations (durations collapse to 0.01ms)
- **Off** — always animate regardless of OS

Use `useReducedMotion()` hook from `@/hooks` for component-level checks. Returns `boolean`.

### Animation System

**Overlay transitions:** All popups (Dialog, Menu, Select, Popover) use base-ui's `data-[starting-style]`/`data-[ending-style]` with CSS `transition-[opacity,transform]` for enter/exit.

**Stagger system:** Add `stagger-enter` class to a parent container. Children animate in sequence with 60ms delay, capped at 7 items. Uses `slide-up` keyframe.

**Toast animations:** Slide-in via `animate-toast-slide-in`, exit via `data-[ending-style]`. Includes rAF progress bar and hover pause.

**DnD animations:** CSS transitions for sortable reorder (200ms ease-out). framer-motion `AnimatePresence` on `DragDropOverlay` only.

**Utility classes:** `.animate-fade-in`, `.animate-slide-down`, `.scroll-fade` (bottom gradient on scrollable containers).

## Log Files

- **Windows:** `%APPDATA%\dev.leaguetoolkit.manager\logs\ltk-manager.log`
- **Linux/macOS:** `~/.local/share/dev.leaguetoolkit.manager/logs/ltk-manager.log`
