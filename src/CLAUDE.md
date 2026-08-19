# Frontend (React + TypeScript) - `src/`

Conventions for everything under `src/`. Repo-wide guidance lives in the root `CLAUDE.md`.

## JSX Conditional Rendering

**Avoid ternary operators in JSX.** Use early returns or `{condition && <Component />}` instead.

```tsx
// Good - early return
if (isLoading) return <LoadingState />;
if (error) return <ErrorState error={error} />;
return <Content />;

// Good - single-line conditional
{
  hasItems && <ItemList items={items} />;
}

// Bad - ternary in JSX
{
  isLoading ? <LoadingState /> : error ? <ErrorState /> : <Content />;
}
```

## Import Conventions

**Always import from barrel exports, never from subdirectories.** This keeps import paths stable and encapsulates internal structure.

- **Global components:** import from `@/components`, not `@/components/Button`, `@/components/Toast`, etc.
- **Modules:** import from `@/modules/{module}`, not `@/modules/{module}/components` or `@/modules/{module}/api`.

```ts
// Good
import { Button, IconButton, useToast } from "@/components";
import { ModCard, useInstalledMods } from "@/modules/library";

// Bad - reaches into internals
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { ModCard } from "@/modules/library/components";
```

## State Consumption - Hooks Over Prop Drilling

**Consume global state (hooks, queries, stores) directly in the component that needs it.** Do not drill Zustand state, TanStack Query data, or mutation callbacks through intermediate components as props.

- Patcher status → call `usePatcherStatus()` in the component that checks it
- Mod toggle/uninstall → call `useToggleMod()` / `useUninstallMod()` in `ModCard`, not passed from a parent
- Folder toggle → call `useFolderToggle()` in `FolderRow`/`FolderCard`, not received as a prop

TanStack Query deduplicates identical queries, so multiple components calling the same hook is efficient and correct.

**Exception:** Props are appropriate for coordinating parent-owned UI state (e.g., `onViewDetails` that opens a sibling dialog, `onReorder` where reorder target varies by context).

## Tauri Event Listening

For backend-to-frontend events (e.g., overlay progress), use `listen<T>()` from `@tauri-apps/api/event` in a `useEffect` with cleanup via `unlisten()`. See `modules/patcher/api/useOverlayProgress.ts` for the pattern.

## Routing

TanStack Router with file-based routing in `src/routes/`. Route tree is auto-generated in `routeTree.gen.ts`. The root route (`__root.tsx`) checks setup status and redirects to `/settings` on first run.

## Component Library (`src/components/`)

**ALWAYS use reusable components from `@/components` instead of native HTML or raw base-ui imports.** Module code should never import from `@base-ui-components/react` directly - all base-ui primitives must be wrapped in `src/components/` first. See `src/components/index.ts` for what is already wrapped.

When adding a new base-ui component:

1. Create wrapper in `src/components/NewComponent.tsx`
2. Export from `src/components/index.ts`
3. Import in modules via `@/components`, never from `@base-ui-components/react` directly

## Form System (`src/lib/form/`)

Uses `@tanstack/react-form` with Zod validation via `useAppForm()`. Field components are pre-registered on `form.AppField` / `form.AppForm` and integrate with the wrapped `@/components` primitives.

## Dependency Constraints

- `zustand` - client-side state only. Never use it for server state - that is TanStack Query's job.
- `framer-motion` - Layout animations for DnD (`AnimatePresence` on `DragDropOverlay` only). Tree-shake to ≤30KB gzipped.

## Icons

All icons come from `@phosphor-icons/react`, imported by PascalCase name **with the `Icon` suffix** -
`GearIcon`, `TrashIcon`, `XIcon`. The bare `Gear` spelling still exports, but it is a deprecated
alias and TypeScript flags it. Standard spinner is `<SpinnerGapIcon className="animate-spin" />`.

`lucide-react` is still installed because most of the app still imports it, and it stays until those
call sites are converted. **Write no new lucide imports** - a file being touched for something else
is a fine moment to convert the icons in it.

Phosphor names things by shape rather than by role, so the lucide name is rarely the phosphor name:
`ChevronDown` is `CaretDown`, `Search` is `MagnifyingGlass`, `Settings` is `Gear`, `Trash2` is
`Trash`, `Loader2` is `SpinnerGap`, `CircleCheck` is `CheckCircle`, `CircleAlert` is
`WarningCircle`. There is no `Radar`. Look the name up rather than guessing.

Phosphor's `regular` weight is lighter than lucide's 2px stroke, so a converted icon reads thinner
beside one that has not been converted yet. Pass `weight="bold"` where an icon carries an action -
buttons, toolbar controls - and leave `regular` for decorative and section-header icons.

Icons inside a control are sized against the control, not the body text. A 16px glyph disappears
in a 32px field, where 20px is right.

Riot's own marks are the exception, since neither icon set carries them. They live in
`src/components/icons/`, lifted from the League and Riot Client asset sets: `LeagueIcon`,
`RiotIcon`, `TftIcon`, and the cosmetics family `MaskIcon` / `ThreeMasksIcon` / `EvolutionIcon` /
`BattleBoostIcon` / `MaskCheckIcon` / `ChampionCheckIcon`. That folder has its own barrel,
re-exported by `src/components/index.ts` - call sites still import from `@/components`.

Each mark is a pair. The artwork is an `.svg` under `src/assets/icons/`, so any viewer can preview
it, and `src/components/icons/Name.tsx` imports that through `vite-plugin-svgr` and is where the doc
comment explaining the mark lives.

Where the `.svg` sits says who drew it. Anything lifted from Riot goes in `assets/icons/game/`, and
the root is for marks that are ours - the patcher crystal, the poro empty states. A new mark
traced off a client asset belongs in `game/` even when the feature using it is ours.

```tsx
import Mark from "@/assets/icons/game/MaskIcon.svg?react";

export function MaskIcon({ className }: MaskIconProps) {
  return <Mark className={className} />;
}
```

Keep the path data untouched, and change only what stops it behaving like an icon: swap the client's
hardcoded fill (League gold `#C89B3C`, parchment `#F0E6D2`) for `currentColor` and drop any wrapping
`opacity`. The wrapper takes `className` so the call site sets the size.

Check the artwork's bounds against its `viewBox` too. The client pads these for its own layout, so a
mark can sit at half the height of its box and read a size smaller than the icons beside it - crop
the `viewBox` to the artwork rather than compensating with a bigger `className` at each call site
(`MaskIcon` is the example).
Redrawing the paths to match the icon set's stroke weight is not worth it - at 16px the fill reads
fine next to a stroked icon, and a hand-traced mark is just a worse copy.

Some of these marks ship only as small bitmaps. Trace nothing: build them by placing the paths the
folder already holds and drawing whatever the bitmap adds on top, the way `MaskCheckIcon` reuses
`MaskIcon`'s silhouette twice under a fresh check. The bitmaps separate overlapping shapes with a
dark outline, which a single-color mark on an unknown background cannot borrow - knock the channel
out instead, with an `<svg>` `<mask>`.

A mask needs an id, and an id in a static file repeats once the same icon is on screen twice. That
is safe only because every copy defines the same mask under that name, so whichever one a reference
resolves to draws the same thing. Name the id for its own file (`maskCheckChannel`, not `channel`)
so two different marks never share one, and if a mask ever has to vary per instance, it stops being
a static file and goes back to a component with `useId`.

## Debug IDs

Key structural elements carry `data-ui`, so an element picked in devtools names the
code that drew it. The value is `Component` for a component's own root and
`Component:part` for a landmark inside it - `ContentSidebar`,
`ContentSidebar:project-row`, `EditorTabs:tab`. The half before the colon is a real
exported symbol, so it resolves with a symbol search.

This is for the regions someone inspects while working on a screen, not for every
node. A list gets one on its container rather than on each item, unless the item is
the thing being debugged - the content tree rows carry one, because they are.

Interpolate when one component draws a family of them:
``data-ui={`SidePanel:${section.id}`}``. Never read `data-ui` from code. It is a
label for a human, and a selector built on it turns a debugging aid into a contract.

## Styling

Tailwind CSS v4 via `@tailwindcss/vite`. Tokens live in `src/styles/`.

**Colors are always a token, never a literal.** No raw Tailwind palette color, no hex, no
`rgb()` in a class or a stylesheet rule - `text-red-400`, `bg-emerald-500/15` and `#22c55e`
are all wrong. There are no exceptions left in `src/`, so a raw palette color in a diff is a
regression, not a style preference. The same goes for bare `rounded`, which is Tailwind's own
hardcoded 4px and bypasses the radius scale.

**Load the `design-system` skill before any styling or visual work** - which token to reach
for, how the surface rungs stack, what the `-text` status variants are for, and how a choice
behaves in light mode. Editing the stylesheets themselves is `src/styles/CLAUDE.md`.

**Do not explain a style in a comment.** Borders, overlap, stacking and hover fills are
primitive CSS that any reader follows from the classes. Where a rule from the design system
drove the choice, cite its `DS-*` code and stop. The rare comment that earns its place names
an outside constraint the classes cannot show, such as a layout gap the value must fit
inside.

## UI Copy

**A description says what the thing is for, not what it is.** A reader arrives at a
settings card, a field or a dialog to change something, so name the options rather than
define the subject. Definitions belong in a hint, if anywhere.

```
Bad   The layered filesystem the patcher builds from your enabled mods.
Good  Options for the layered filesystem that the patcher uses
```

**Do not list what is inside.** The rows under a description enumerate themselves, so
summarising them writes the section twice. Name the subject and stop.

```
Bad   Options for where installed mods live and how they are catalogued
Good  Options for your mod library
```

**Lead with what changes, not with the app doing it.** The row already implies "this
setting", so the subject is the thing the reader owns rather than the verb the app runs.

```
Bad   Verifies modded archives as the game loads them.
Good  Archives get verified on demand when mounting.
```

**Never define by contrast.** A switch already carries its other state, so naming the
alternative doubles the length and adds nothing.

```
Bad   Archives get verified on demand when mounting, not all of them up front.
Good  Archives get verified on demand when mounting.
```

**Use the domain's word.** These readers mod League, so `mount`, `locale`, `overlay` and
`WAD` land better than a plain-English paraphrase of them.

```
Bad   as the game loads them
Good  when mounting
```

A description written this way is often a fragment, and a fragment takes no full stop.
Copy that is a complete sentence, such as a field's helper text or an error, ends with
one as usual.

## Text Selection

This is a desktop app, not a web page - selectable-by-default is the browser's assumption, not ours.
Chrome gets `select-none`. Selection is reserved for text a user would want to take
somewhere else.

The test is **whose text it is**. Text the app wrote about itself is chrome. Text that came from the
user, their disk, or the backend is data.

**Non-selectable** - put `select-none` on the container, not on each label:

- Framing chrome: title bar, session/status bar, toolbars, tab strips, sidebars, headers.
- Anything clicked rather than read: buttons, menu items, list/tree rows, cards, toggles. A
  drag across these leaves a stray highlight and fights click-drag interactions.
- Static prose the app authored: labels, hints, empty states, section descriptions, progress lines.

**Selectable** - leave the default alone:

- Names, paths, IDs and versions that came from the user, the filesystem or the backend.
- Error text and log lines someone will paste into a bug report.
- Long-form content meant to be read or edited: inputs, description bodies, changelogs, dialog
  detail panes.

`select-none` inherits, so data nested inside a `select-none` container needs `select-text` back.

Where copying is routine, give an explicit **Copy** action rather than leaning on selection - the
established pattern here (`CheckRow` for the fix command, `useModCardController` for the mod ID,
`WadScanFailedDialog` for its details, `Diagnostics` for the whole report).

## Reduce Motion

Three-option system applied via `[data-reduce-motion]` on `<html>`: System Default (follows OS `prefers-reduced-motion`), On, Off. Use `useReducedMotion()` from `@/hooks` for component-level checks.

## Scrolling

Two-option system applied via `[data-scroll-mode]` on `<html>`: Smooth and Spring. Both ease a
scroll the app asks for - `scrollIntoView`, an anchor, a log pane pinning itself to the bottom -
and Spring adds the rubber-band overscroll from `useOverscrollSpring()`, a wheel handler of our
own because Chromium has no bounce to turn on. Reduce motion outranks the setting and returns
every scroll to instant.

CSS `scroll-behavior: auto` is deliberately not offered as a third option. The property never
reaches the wheel, which the browser animates either way, so it would read to a user as a
setting that does nothing.
