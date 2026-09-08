# Frontend architecture audit

Research note. The evidence is the tree at `018fe6e`, read on 2026-09-07, and the production
bundle in `dist/` built from it.

The scope is `src/`: module boundaries, the state layer, the IPC and query layer, rendering cost,
duplication, and where each thing lives against the conventions in `src/CLAUDE.md`. Each finding
cites a file and line. Each proposal names what moves and what it costs.

## Sources

- `src/CLAUDE.md`, `CLAUDE.md`, `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`
- `docs/adr/0022`, `docs/adr/0029` - the dialog queue and the bindings decision
- `src/lib/tauri.ts`, `src/lib/bindings.gen.ts`, `src/lib/query.ts`, `src/utils/query.ts`
- `src/stores/*.ts` - all 33 files
- `src/modules/*/index.ts` and the 48 sub-barrels under `src/modules/`
- `dist/assets/` - chunk sizes and the static import graph between chunks
- Five read-only sweeps over `src/`, one each for stores, IPC, duplication, rendering, and
  organization

## 1. The shape

1,158 TypeScript files, 49,324 lines including tests, 34,950 without.

| Area                  | Files | Lines  |
| --------------------- | ----- | ------ |
| `modules/workshop`    | 253   | 30,070 |
| `modules/library`     | 131   | 11,338 |
| `modules/settings`    | 65    | 4,969  |
| `modules/diagnostics` | 29    | 2,101  |
| `modules/editor`      | 13    | 1,961  |
| `modules/launcher`    | 15    | 1,328  |
| `modules/home`        | 21    | 1,236  |
| `modules/patcher`     | 22    | 1,192  |
| `modules/shell`       | 10    | 752    |
| `modules/updater`     | 14    | 643    |
| `modules/migration`   | 9     | 460    |
| `modules/deep-link`   | 7     | 346    |
| `components`          | 88    | 6,818  |
| `lib`                 | 244   | 6,655  |
| `stores`              | 33    | 2,831  |
| `hooks`               | 19    | 1,128  |
| `routes`              | 9     | 501    |
| `pages`               | 4     | 470    |
| `i18n`                | 5     | 435    |
| `utils`               | 9     | 263    |

Inside `modules/workshop`: `bin` 48 files and 9,593 lines, `components` 53 and 7,078, `palette`
30 and 4,426, `gameBrowser` 27 and 3,390, `problems` 14 and 2,894, `objectsBrowser` 13 and 2,275,
`preview` 12 and 1,370, `api` 37 and 1,356, `state` 7 and 1,276, `documents` 8 and 1,267,
`utils` 14 and 1,232, `references` 12 and 1,127, `string-overrides` 12 and 1,084, `hooks` 6 and
558, `layers` 12 and 555.

The stack is React 19.2, TanStack Query 5, TanStack Router 1.168 with file routes, zustand 5,
`@tanstack/react-virtual` 3.13, Tailwind 4, Paraglide, Vite 8.

## 2. The eight findings that matter most

1. **Boot loads the whole app.** Route splitting is on, and every module lands in one 2 MB chunk
   that the entry imports statically. Section 3.
2. **Module cycles with no guard.** Three module-level cycles and six files importing their own
   module's root barrel. ESLint checks none of it. Section 4.
3. **The library grid is unvirtualized.** Every mod card mounts, each running thirteen hooks and
   one IPC call for its thumbnail. Section 7.
4. **The patcher status poll runs every second for the app's lifetime.** Section 7.
5. **The IPC layer speaks three ways.** 152 hand-written functions, 16 generated ones, and two
   raw `invoke` calls for a command the table already has. Section 6.
6. **About forty mutations fail silently.** No `onError`, no toast, nothing in the log. Section 6.
7. **Seventeen stores have one consumer and live in the global directory.** Twelve hold backend
   payloads, one performs I/O. Section 5.
8. **`src/CLAUDE.md` teaches the pattern the lib hook exists to replace.** The event section cites
   one of the three files still hand-rolling `listen`. Section 6.

## 3. Boot and bundle

`vite.config.ts` sets `tanstackRouter({ autoCodeSplitting: true })`, and the plugin does split:
`dist/assets/` holds 11 JavaScript chunks and the entry issues `import()` for nine of them. The
route chunks hold nothing, because the module code is reachable from the root route
synchronously.

| Chunk                                           | Size           | Loaded                                           |
| ----------------------------------------------- | -------------- | ------------------------------------------------ |
| `settings-B7xADB79.js` - every module, misnamed | 2,015 KB       | at boot, static import from the entry, preloaded |
| `index-D0B6CMBa.js` - the entry                 | 499 KB         | at boot                                          |
| `settings-CFG0Mxya.js`                          | 6.6 KB         | lazy                                             |
| `diagnostics-C9iedxgz.js`                       | 5.4 KB         | lazy                                             |
| seven other route stubs                         | 74 B to 1.3 KB | lazy                                             |
| `index-GpdlX-ez.css`                            | 165 KB         | at boot                                          |
| 52 `.woff2` files, 10 font families             | 1,049 KB       | at boot, `src/styles/tailwind.css:3-12`          |

Two causes, both structural:

- `src/routes/__root.tsx:16-41` imports eight module barrels: `deep-link`, `diagnostics`,
  `library`, `patcher`, `launcher`, `settings`, `shell`, `updater`, `workshop`. Everything those
  barrels re-export is on the boot path.
- Nine of twelve module barrels are `export *`, and modules import each other through them, with
  three cycles (section 4). Rollup cannot place a strongly connected graph in more than one chunk,
  so it emits one shared chunk and names it after the first route that asked for it.

The fonts are the other half. The ten `@fontsource-variable` families are user-selectable in
settings, so nine of them are dead weight on every launch. `displayStore` already knows the chosen
family.

Also in the bundle for nothing: `src/components/DataTable.tsx` (165 lines, zero importers outside
`src/components/index.ts:11`) and with it `@tanstack/react-table`. `framer-motion` serves two drag
overlays (`DragDropOverlay.tsx:1`, `LayerFileDropOverlay.tsx:1`).
`@tanstack/react-query-devtools` is a production dependency while its one use is commented out at
`src/main.tsx:47`.

## 4. Module boundaries and cycles

### The dependency graph

Twenty-eight edges between modules. The heaviest: `workshop -> editor` 20, `workshop -> library`
7, `library -> settings` 7, `library -> patcher` 7, `workshop -> patcher` 6, `home -> settings` 6.
`library` is the hub, with five modules importing it and five it imports.

Three cycles:

| Cycle                     | One direction                                                                                                                                       | The other                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library <-> patcher`     | `patcher/api/useGuardedStartPatcher.ts:6`, `useOverlayProgress.ts:7`, `useWadScanOffenders.ts:4`, `patcher/components/LinkedBinWarningDialog.tsx:7` | `library/api/useFolderToggle.ts:3`, `useLibraryContent.ts:5`, `useLibraryHotkeys.ts:4`, `useSelectionActions.ts:4`, `library/components/FolderContextMenu.tsx:6`, `ModCard/useModCardController.ts:15`, `PlayButton.tsx:18` |
| `library <-> diagnostics` | `diagnostics/components/IncidentDetail.tsx:18`                                                                                                      | `library/components/ModCard/ModCardGrid.tsx:6`, `ModCardList.tsx:6`                                                                                                                                                         |
| `library <-> launcher`    | `launcher/components/SessionBar.tsx:21`                                                                                                             | `library/components/PlayButton.tsx:16`                                                                                                                                                                                      |

`modules/editor` is the one clean seam: it imports only `@/hooks` and `@/components`, and
`workshop` depends on it one way through 22 imports.

### Self-barrel imports

Six non-test files import their own module's root barrel, which re-exports the importing file.
Each is `file -> module/index.ts -> components/index.ts -> file`.

- `src/modules/library/components/CreateFolderDialog.tsx:5`
- `src/modules/library/components/FolderContextMenu.tsx:5`
- `src/modules/library/components/MissingDepsBadge.tsx:4`
- `src/modules/library/components/ModHealthBadge.tsx:18`
- `src/modules/workshop/components/overview/ProjectInfoSection.tsx:8`
- `src/modules/workshop/components/overview/ThumbnailSection.tsx:11`

### What ESLint checks

`eslint.config.js` carries `react`, `react-hooks`, `simple-import-sort`, `i18next` and the
TypeScript recommended set. It has no `import/no-cycle`, no `no-restricted-imports`, no
`boundaries`, no `max-lines`. Every structural rule in `src/CLAUDE.md` is prose, and each of the
violations below got in past a green lint.

### Inside workshop

Fifteen sub-areas. Internal edges, counted as relative imports: `components -> api` 29,
`bin -> preview` 16, `documents -> components` 11, `components -> utils` 11,
`palette -> components` 10, `bin -> state` 10, `bin -> palette` 10, `bin -> documents` 9,
`objectsBrowser -> gameBrowser` 8, `objectsBrowser -> palette` 6, `references -> gameBrowser` 5,
`references -> bin` 3.

`string-overrides` and `layers` are separable today. `problems` is close. `bin`, `palette`,
`objectsBrowser`, `gameBrowser` and `references` form a clique and stay together.

`references/`, `hooks/` and `utils/` have barrels that `src/modules/workshop/index.ts` does not
re-export, unlike the other twelve slices.

`documents/registry.tsx` is the document-type registry. A new document kind touches
`documents/contentDocument.ts:77` (the union, plus a constructor and id), the registry, the new
`*Document.tsx`, `state/editorFile.ts:145` (the zod sanitizer for persistence), and the barrels.
Twenty-six files switch on `ContentDocument`.

## 5. State layer

Thirty-three files in `src/stores/`, all flat, all `export *` through `src/stores/index.ts`. No
store uses `subscribeWithSelector`, `immer` or `devtools`. No store imports another.

### Single-consumer stores

Seventeen of thirty-one stores are read by one module:

- workshop: `workshopEditor`, `workshopFilter`, `workshopView`, `gameBrowser`, `objectsBrowser`,
  `references`, `extractDialog`, `extractRun`, `workshopSelection`, `workshopDialogs`
- library: `libraryFilter`, `libraryView`, `librarySelection`, `libraryDialogs`
- one each: `deepLink` (deep-link), `home` (home), `devConsole` (shell)

`workshopLayout` is one settings import away from the list.

### Backend state in stores

`src/CLAUDE.md` reserves zustand for client state. Twelve stores import from `@/lib/tauri` and
hold backend payloads: `deepLink.ts:3`, `extractDialog.ts:4`, `extractRun.ts:3`, `incidents.ts:3`,
`libraryDialogs.ts:3`, `patcherFailure.ts:3`, `playSession.ts:3`, `references.ts:3`,
`updater.ts:5`, `workshopDialogs.ts:4`, plus `devConsole` (a log ring buffer streamed from
`modules/shell/hooks/useDevLogStream.ts:12`) and `installMismatch`.

Most are a dialog payload frozen at open time, and `libraryDialogs.ts:14-18` says so. Two are not:

- `stores/updater.ts:42-118` performs I/O. It calls `check()`, `update.download()`,
  `api.prepareForUpdate()` and `relaunch()` from inside the store.
- `stores/extractRun.ts` is a job queue, which is a mutation.

### `workshopEditor.ts`

765 lines, five responsibilities: open documents per project (`:75`), the split layout tree
(`:77-79`, delegating to `modules/editor/layout/tree.ts`), selection (`:88`, `:97`), dirty tracking
(`:95`), and shell-wide navigation history (`:107-113`). The history is root-level state wedged
into a per-project store, and the `EditorMove`, `foldStack` and `updateProject` indirection at
`:195-310` exists only because per-project actions cannot write root state (the comment at
`:186-190` says as much).

`modules/workshop/state/useProjectEditor.ts` (445 lines) is the good layer over it: forty narrow
selectors and curried actions, and the only place `useShallow` is used.

The six `workshop*` stores are split by persistence lifetime, not by feature. `workshopView` and
`workshopFilter` are the same list page in two files, and `workshopLayout` and `workshopEditor` both
describe editor layout.

### Selector hygiene

No selector returns a fresh object or array. Seventeen call sites read a store with no selector
and re-render on every write to it, thirteen of them from the two filter stores:

- `useLibraryFilterStore()` at `library/components/FilterPopover.tsx:62`, `FilterBar.tsx:46`,
  `ActiveFilterChips.tsx:15`, `SortOptions.tsx:64` and `:91`, `library/api/useFilteredMods.ts:10`,
  `useLibraryContent.ts:50`
- `useWorkshopFilterStore()` at `workshop/components/WorkshopFilterPopover.tsx:66`,
  `WorkshopFilterBar.tsx:42`, `WorkshopActiveFilterChips.tsx:15`, `WorkshopSortOptions.tsx:41` and
  `:68`, `workshop/api/useFilteredProjects.ts:10`
- `settings/components/SettingScope.tsx:212-213` reads `useDisplayStore()` and
  `useWorkshopLayoutStore()` whole, then blind-writes both with `setState` at `:135-136`
- `shell/components/DevConsole.tsx:42`, `shell/components/NotificationCenter.tsx:52`

Eight stores export per-field hooks in the `displayStore.ts:187-205` style. The other
twenty-three export only the raw hook, which is where the offenders come from.

### Dialog stores

Five shapes for one idea:

- `dialogQueue.ts:37` coordinates the self-raising dialogs (ADR-0022). Well designed.
- `libraryDialogs.ts:19` encodes open as a non-empty payload array.
- `workshopDialogs.ts:36-68` holds eight dialogs in three encodings (`T | null`, `boolean`, `T[]`)
  with seventeen hand-written open and close actions, plus `lastAuthorName`, which is a preference.
- `extractDialog.ts:36` holds the payload and six remembered form fields, partialized apart at
  `:60`.
- `modHealthDrawer.ts:87` is a drawer with a width, an announce-once latch and a repair handoff.

### Conventions across stores

- Thirteen stores use `create<T>(...)`, twenty use the curried `create<T>()(...)`. Four use the
  curry with no middleware.
- Nine stores persist. Only `displayStore.ts:104` declares `version` and `migrate`. A shape change
  to `workshopLayout` or `modHealthDrawer` hydrates a stale key silently.
- `displayStore.ts` is the one file with a `Store` suffix. `incidents.ts` exports
  `useIncidentLineStore`. `notifications.ts` exports `useNotificationStore`. `dialogQueue.ts`
  exports `useDialogQueue`.
- `gameBrowser.ts:91-95` exports module-level functions that read and write through
  `getState()`, a store used as a mutable singleton.
- `workshopEditor.ts:6-22` imports `@/modules/editor/layout`, a store depending on a module, with a
  comment at `:3-5` on the barrel cycle it dodges.

## 6. Data and IPC layer

### Three ways to call the backend

| Layer                      | Count | Where                                                                                                                                                                    |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.*`, hand-written      | 152   | `src/lib/tauri.ts`, typed against 232 `ts-rs` files in `src/lib/bindings/`                                                                                               |
| `commands.*`, tauri-specta | 16    | `src/lib/bindings.gen.ts`, all sixteen wrapped inside `tauri.ts:359-419`                                                                                                 |
| raw `invoke`               | 2     | `library/components/ModDetailsDialog.tsx:45`, `workshop/components/PackDialog.tsx:166`, both `reveal_in_explorer`, while `api.revealInExplorer` exists at `tauri.ts:390` |

The other seven files named as raw-invoke users import `convertFileSrc`, not `invoke`, and are the
correct asset-protocol path. ADR-0029 sets the migration to specta per module. Sixteen commands
have moved.

`tauri.ts:139` declares `IpcResponse<T>` structurally identical to `Result<T>` in
`src/utils/result.ts:7`, so `toResult` at `:144` is an identity. Four hundred and nine files import
from `@/lib/tauri`, ten from `@/lib/bindings` (seven of them tests), one from `@/lib/bindings.gen`.
The funnel is clean.

`src/lib/query.ts` is the `QueryClient` singleton, eleven lines, imported once by relative path
from `src/main.tsx:9`. `src/utils/query.ts` is the `Result`-to-throw adapter with 117 importers.
Same name, two directories, no overlap.

### Query keys

Eight factories, one per module with data. `library` is the well-formed hierarchy.
`launcher/api/keys.ts:2-3` and `patcher/api/keys.ts:2` have no `all` root, so nothing invalidates
either module whole. Four inline keys sit outside every factory: `hooks/usePlatformSupport.ts:8`,
`workshop/api/useStringKeySearch.ts:18`, `workshop/api/useGameStringValues.ts:19`,
`workshop/gameBrowser/useGameExtract.ts:25`. `workshop/layers/api/useLayerInfo.ts:10` appends a
raw array segment, which makes the key order-sensitive. `workshopKeys.thumbnail` distinguishes
`undefined` from `null`.

### Invalidation

Seventy-six `invalidateQueries` calls in 53 files. Two event-driven hubs:
`library/api/useLibraryWatcher.ts:33-34` and `patcher/api/useOverlayProgress.ts:26-46`. The rest
sit on individual mutations. Fifty-three `setQueryData` calls, all in mutation `onSuccess`, none
from an event. Two `removeQueries`, one deliberate `refetch()`.

### Options

Global `staleTime` is 60 seconds (`lib/query.ts:6`), with no `gcTime` or `refetchOnWindowFocus`
override. `useInstalledMods` (`library/api/queries.ts:59-64`), profiles and folders inherit it.
Fifty `staleTime` overrides, 50 `enabled:` and 24 `skipToken` (both idioms coexist), seven
`select:`, seven `placeholderData: keepPreviousData`, no `structuralSharing` override.

`select:` is used to pick one mod out of a whole-library map at `useModWadReport.ts:37`,
`useModHealthVerdicts.ts:35`, `useLinkedBinOffenders.ts:37`, `useModChecksumMismatches.ts:24`.

No `Channel<T>` anywhere. Every stream is a Tauri event plus a separate invoke. Pagination exists
only on `binChildren` (`tauri.ts:361-366`) and `listReleases`. Search commands are capped with a
`total` and a `superseded` flag. Uncapped and worth watching: `getProjectContentTree`
(`useProjectContentTree.ts:12`, every file, refetched on focus) and `readGameWad` (`tauri.ts:322`,
every chunk of a WAD).

### Mutations

Sixty-eight files call `useMutation`. Twenty-eight have an `onError`. Seventeen reach
`describeError` or `errorSummary`. The remaining forty fail into the query devtools and nowhere
else. One hook does its own `try` (`library/api/useAnalyzeUncategorizedMods.ts`).

Fifteen `await api.*` calls run inside component event handlers with no mutation hook:
`diagnostics/components/CheckRow.tsx:38`, `home/components/LibraryTile.tsx:56-57`,
`settings/components/HotkeySection.tsx:31,42,78,84,126`, `shell/components/AppMenu.tsx:36,38`,
`workshop/components/BulkDeleteDialog.tsx:54`, `BulkPackDialog.tsx:49`,
`ContentLayerList.tsx:475-476`, `workshop/documents/FilesDocument.tsx:39`. The two bulk dialogs
loop sequentially over every project inside the component with their own progress state and their
own invalidation.

### Events

`src/lib/useTauriEvent.ts` (25 lines) is the standard, with 29 uses in 19 files.
`src/lib/useTauriProgress.ts` has five. Three files still hand-roll `listen` in a `useEffect`:
`library/api/useLibraryWatcher.ts:21-31`, `patcher/api/useOverlayProgress.ts:25-52` (three copies
of one effect), `workshop/gameBrowser/useGameExtract.ts:77`.

The "Tauri Event Listening" section of `src/CLAUDE.md` describes the raw pattern and cites
`useOverlayProgress.ts` as the example. `useTauriEvent` is documented nowhere.

## 7. Rendering and data handling

### Unvirtualized lists

| Site                                                               | Data                      | Size              | Severity |
| ------------------------------------------------------------------ | ------------------------- | ----------------- | -------- |
| `library/components/UnifiedDndGrid.tsx:110` and `:208`             | every root mod            | hundreds          | high     |
| `library/components/SortableModList.tsx:69` and `:94`              | every mod in view         | hundreds          | high     |
| `library/components/FolderRow.tsx:81` and `:94`                    | every mod in every folder | hundreds          | high     |
| `workshop/components/ProjectGrid.tsx:43`                           | projects                  | tens to hundreds  | medium   |
| `workshop/string-overrides/components/StringOverridesTable.tsx:59` | override entries          | tens to thousands | medium   |
| `settings/components/WadBlocklistEditor.tsx:161`                   | blocklist rows            | tens to hundreds  | medium   |

The `WadBlocklistEditor` virtualizer at `:302` covers the suggestions popover only. Nine files use
`useVirtualizer`. `components/CommandPalette.tsx` and the seven workshop trees and lists are the
virtualized ones.

### The mod card

Every `ModCard` runs `useModCardController`: thirteen hooks, six store subscriptions, three
queries, and `useModThumbnail(mod.id)` at `:101`, which is one `api.getModThumbnail` invoke per
card (`library/api/useModThumbnail.ts:17`). Three hundred mods is three hundred IPC round-trips at
mount, cached forever after (`staleTime: Infinity`). `ModCardParts.tsx:94` renders a bare `<img>`
with no `loading="lazy"` and no `decoding="async"`. `loading="lazy"` appears nowhere in `src/`.

The workshop side has a scheduler the library does not use: `preview/imageQueue.ts` with six
slots and a scroll-settle delay, driven by `useImageSlot` and `stirImages`. All image bytes cross
as asset-protocol URLs through `convertFileSrc`, never as base64, which is correct.

### The patcher poll

`patcher/api/usePatcherStatus.ts:12` sets `refetchInterval: 1000` unconditionally. Twenty-one
subscribers, `SessionBar` among them and always mounted, so the app issues one IPC per second for
its lifetime, idle included. TanStack deduplicates the fetch and structural sharing keeps the
`data` reference stable while `{ running, phase, session }` is unchanged, so idle cards do not
re-render on it. The cost is the IPC, and during a session the card re-renders. Every other poll
in the app is conditional on work in progress.

### Derived data

- `workshop/problems/ProblemsDocument.tsx:18` passes the raw query, undebounced, into
  `filterProblems`, which joins about ten fields per problem into one lowercased string, over up
  to about 7,000 problems (`runCatalogue.ts:14`). It runs twice per keystroke, once at `:26` for
  the count and once at `ProblemsList.tsx:53` for the rows. `useShownProblems`
  (`runCatalogue.ts:52`) is a per-caller memo with four callers. `ProblemsActions.tsx:19` adds an
  unmemoized filter in render.
- `workshop/bin/useLinkTargets.ts:302` keys its final memo on the arrays `useQueries` returns,
  which are fresh each render without `combine`, so `layerDeclarations` (`:186`) walks every layer,
  entry and object of the content tree per render, and the `LinkTargetsContext` it feeds
  invalidates every row. `:262` and `:275` rebuild the query descriptor arrays unmemoized.
- `workshop/palette/WorkshopBar.tsx:47` is undebounced, and `rank.ts:33` scans every project
  object candidate (a few thousand rows, per `useProjectCandidates.tsx:144`) per keystroke on the
  main thread. The backend-ranked sources are debounced separately.
- `library/api/useFilteredMods.ts:19` filters with `toLowerCase().includes` per keystroke,
  undebounced, and the new array cascades into a full grid re-render.
- `ObjectsTree.tsx:54`, `SourceTree.tsx:59`, `ReferencesTree.tsx:49` memo their flatten on an
  `isExpanded` function prop. An inline closure at any caller re-flattens per render.
- `workshop/string-overrides/useStringOverridesEditor.ts:51` serializes the draft in the render
  body.

Where filtering happens: client side for mods, projects, WADs, blocklist, string overrides,
problems and local palette sources. Backend for game and object index search, string keys and
find, each debounced 200 ms through `hooks/useDebouncedValue.ts`.

### Memoization and concurrency

Seven `React.memo` in the app: `EditorTabs.tsx:208`, `ModCard/index.tsx:11`,
`SortableModCard.tsx:23`, `ContentTreeRow.tsx:108`, `SourceTreeRow.tsx:41`,
`ObjectsTreeRow.tsx:69`, `ReferencesTreeRow.tsx:42`. Not memoized: `bin/BinRow.tsx:61`
`BinRowLine` and its fourteen sub-components, `ClassView.tsx` sections, `VfxSections.tsx` cards,
`ProblemRows.tsx`, `ProjectCard.tsx`.

Nine contexts, none with an inline object value. `BinTree.tsx:123-126` nests four providers with
memoized values.

One `useDeferredValue` (`settings/hooks/useRegexPreview.ts:28`). No `useTransition`,
`startTransition`, `requestIdleCallback`, or Web Worker. React 19 without the compiler.

No per-row `listen`, one `ResizeObserver` per tree, every `addEventListener` has its cleanup, no
raw `setInterval`.

### Five trees, one core missing

| Tree                             | Flatten                       | Expansion state               |
| -------------------------------- | ----------------------------- | ----------------------------- |
| `bin/BinTree.tsx`                | `binRows.ts:196`, async paged | local `Set` and a pages `Map` |
| `components/ContentTree.tsx`     | `utils/contentTree.ts:150`    | zustand `useCollapsedDirs`    |
| `gameBrowser/SourceTree.tsx`     | `sourceIndex.ts:239`          | caller predicate              |
| `objectsBrowser/ObjectsTree.tsx` | `objectTree.ts:351`           | caller predicate plus store   |
| `references/ReferencesTree.tsx`  | `referenceTree.ts:83`         | caller predicate, inverted    |

Shared already: `hooks/useStickyTreeRows.ts`, `useReadOnlyTreeNav.ts`, `components/TreeStickyBand.tsx`.
Duplicated per file: the `useVirtualizer` block, the
`useEffect(() => virtualizer.measure(), [virtualizer, zoomed])` zoom workaround (eight copies,
including `ProblemsList.tsx:107`, `GameWadsDocument.tsx:151`, `CommandPalette.tsx:173`), the
sticky wiring, the context-menu lookup by `data-treeitem-index`, the `translateY` row wrapper, and
the `keepScrollTop` pair. Roughly 300 to 400 lines. `BinTree` is the outlier and stays separate.

## 8. Duplication

### Helpers

| Helper           | Canonical                        | Copies                                                                                                                                                                                          |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| byte format      | `utils/formatBytes.ts:5`         | `deep-link/components/ProtocolInstallDialog.tsx:230-234`                                                                                                                                        |
| `basename`       | `utils/path.ts:3`                | `diagnostics/utils/incident.ts:43` and `:163`, `patcher/api/useWadScanOffenders.ts:24`, `workshop/api/useSessionProjectNames.ts:31`                                                             |
| `slashed`        | `utils/path.ts:15`               | `library/components/ModCard/ModWadFootprintDialog.tsx:27`                                                                                                                                       |
| clipboard toast  | `hooks/useCopyToClipboard.ts:37` | `diagnostics/components/CheckRow.tsx:24-28`, `pages/Diagnostics.tsx:93-97`, `patcher/components/WadScanFailedDialog.tsx:98-101`, raw at `IncidentDetail.tsx:225`, `useModCardController.ts:163` |
| `0x` hex         | `workshop/bin/binHash.ts:18`     | `diagnostics/utils/incident.ts:145`. Byte hex twice: `bin/BinContextMenu.tsx:277`, `bin/valueRows.ts:221`                                                                                       |
| relative time    | none                             | `formatDistanceToNow(..., { addSuffix: true })` at `LastGameTile.tsx:31`, `ModWadFootprintDialog.tsx:145`, `ModHealthBadge.tsx:188`, `NotificationCenter.tsx:35`                                |
| absolute date    | none                             | `toLocaleString` at `CacheSection.tsx:46`, `pages/Diagnostics.tsx:15`, `TokenDecoder.tsx:124`. `toLocaleDateString` at five more                                                                |
| name comparator  | `library/utils/sorting.ts`       | `workshop/api/useFilteredProjects.ts:40`. Twenty-one `localeCompare` sites, none `{ numeric: true }`                                                                                            |
| Enter and Escape | none                             | 32 hand-rolled handlers in 13 files                                                                                                                                                             |

`utils/path.ts` is missing from `utils/index.ts`, which forces the two deep imports at
`diagnostics/api/useIncidentListeners.ts:11` and `launcher/components/InstallMismatchDialog.tsx:14`.

### UI

- Confirm dialog, five clones of Root, Portal, Backdrop, Overlay, Header, Footer, Cancel and a
  danger button: `workshop/components/DeleteConfirmDialog.tsx:60`,
  `workshop/layers/components/DeleteLayerDialog.tsx:52`,
  `library/components/ProfileSelector/ProfileDeleteDialog.tsx:63`,
  `library/components/BulkUninstallDialog.tsx:124`, `workshop/components/BulkDeleteDialog.tsx:177`.
- Search input with a clear button, fifteen files, five the same shape: `TreeSearchBox.tsx`,
  `ProblemsToolbar.tsx`, `StringOverridesToolbar.tsx`, `WorkshopBar.tsx`, `LibraryToolbar.tsx`.
- Empty states: `components/EmptyState.tsx` has 25 users, and four module bundles wrap it again
  (`library/components/LibraryStates.tsx`, `workshop/components/EmptyStates.tsx`,
  `gameBrowser/GameBrowserStates.tsx`, `objectsBrowser/ObjectIndexStates.tsx`).
- Skeleton: `components/Skeleton.tsx` has one user and three hand-rolled `animate-pulse` blocks
  beside it (`HotkeySection.tsx:152`, `bin/LinkChip.tsx:208`, `ImportGitRepoDialog.tsx:116`).
- Row with hover actions, four private clones: `ContentLayerList.tsx:310`,
  `WadBlocklistEditor.tsx:429`, `ModHealthSweepPanel.tsx:465`, `library/components/FolderRow.tsx`.
- Copy menu item, nine copies.

### Dialogs, three mechanisms

`useQueuedDialog` at seven sites, store-driven at seven stores, local `useState` at 26 sites.
`workshop` is store-driven, `settings`, `diagnostics` and `home` are local, `library` uses all
three. `Dialog.Overlay` takes `size` at about 22 sites and `LicensesDialog.tsx:19` overrides the
scale with a class.

### Tests

Twenty-six test files hand-roll a `QueryClientProvider` wrapper. `src/test/utils.tsx`
`renderWithProviders` has nine users. Two files re-mock `@tauri-apps/api/event` over the global
mock (`ProtocolInstallDialog.test.tsx:15`, `InstallMismatchDialog.test.tsx:34`). A shared fixture,
`createMockIncident`, lives under one component's test directory and is imported across the module
from `diagnostics/api/__tests__/useIncidentListeners.test.tsx:12`.

Three placement styles: 124 colocated `__tests__`, 24 under `src/__tests__/`, six loose beside
their source (`hooks/useReorderTransition.test.tsx`, `hooks/useZoomHotkeys.test.ts`,
`i18n/errors.test.ts`, `i18n/index.test.ts`, `lib/useTauriEvent.test.ts`,
`lib/useTauriProgress.test.ts`). `hooks/` and `lib/` each use all three.

## 9. Conventions against `src/CLAUDE.md`

| Rule                         | State                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| no ternary in JSX            | 57 in 38 files. `PackDialog.tsx` 6, `ProjectCard.tsx` 4, `ThumbnailSection.tsx` 4, `components/MultiSelect.tsx` 4                            |
| no new `lucide-react`        | 62 files. library 20, workshop 16, components 11, settings 4, patcher 4, shell 3, migration 2, diagnostics 2                                 |
| base-ui via wrappers only    | one bypass, `editor/components/SidePanel.tsx:1`, for per-section resize the `Accordion` wrapper does not expose                              |
| colors are tokens            | clean, zero raw palette classes and zero hex in a class                                                                                      |
| no bare `rounded`            | 21 files, from `components/MultiSelect.tsx:95` to `workshop/components/overview/ProjectInfoSection.tsx:81`                                   |
| native controls via wrappers | `<button>` 53 in modules, 37 of them in workshop. `<input>` 7. `<select>` 1                                                                  |
| strings through Paraglide    | `SessionBar.tsx`, `ModCardParts.tsx`, `WadBlocklistEditor.tsx` have zero `m.` calls. Every settings `SectionCard title` is a literal         |
| barrel imports only          | intra-module deep imports at ten sites into `library/utils/labels`, `skinhackCheck`, `categories`. One cross-module, `routes/settings.tsx:3` |
| `data-ui`, `select-none`     | 88 and 73 files. Fine                                                                                                                        |

### Size outliers

| File                                          | Lines | Holds                                                                                        |
| --------------------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `launcher/components/SessionBar.tsx`          | 664   | one export, fourteen private components, four label maps, five string builders at `:575-617` |
| `library/components/ModHealthSweepPanel.tsx`  | 657   | one export, thirteen private components                                                      |
| `library/components/ModCard/ModCardParts.tsx` | 578   | six unrelated exports                                                                        |
| `settings/components/WadBlocklistEditor.tsx`  | 515   | one export, six private components, eight `useState`                                         |
| `workshop/preview/ImagePreview.tsx`           | 491   | one export, three private components, an exported `CHECKERBOARD` constant                    |
| `workshop/components/ContentLayerList.tsx`    | 477   | one export, four private components                                                          |
| `components/Combobox.tsx`                     | 476   | eighteen thin wrappers, inherent to the compound API                                         |
| `editor/components/EditorTabs.tsx`            | 419   | two exports, two private hooks at `:153` and `:170`                                          |

## 10. Placement

### `pages/` against `routes/`

Four of eight routes are shims of 7 to 31 lines whose only job is `component: <Page>`. The two
workshop routes render module components directly, which is the newer pattern.
`pages/Diagnostics.tsx:11` imports from `../routes/diagnostics` and binds itself with
`getRouteApi("/diagnostics")` at `:9`, so the shim buys nothing. `pages/Diagnostics.tsx:22-44`
`reportToText` is diagnostics logic. `pages/Library.tsx:44-58` owns selection sync and teardown.

### `lib`, `utils`, `hooks`

The de-facto split is `lib` for the vendor boundary, `utils` for pure functions, `hooks` for shared
React hooks. Where it breaks:

- `lib/useTauriEvent.ts`, `lib/useTauriProgress.ts` are hooks in `lib`
- `lib/form/` has six consumers, all workshop dialogs. `lib/color.ts` has one, `settings/api/useTheme.ts:4`
- `utils/overlay.ts` is a DOM query with two library consumers. `utils/dnd.ts` is a library DnD modifier
- `hooks/useAutoStartPatcher.ts` and `hooks/useSurfaceLinkedBinWarning.ts` are patcher.
  `hooks/useReorderTransition.ts` is library. `hooks/useDebouncedValue.ts` has six users, all
  workshop. `hooks/useZoomHotkeys.ts` and `hooks/useListNav.ts` have one user each.
  `hooks/usePrevious.ts` has none.

### `src/components` with one consumer

About 1,600 lines, a quarter of the directory, reachable from one module: `CommandPalette.tsx`
(434), `Combobox.tsx` (476), `Spotlight.tsx`, `Readout.tsx`, `HoverCard.tsx` from workshop.
`NumberField.tsx`, `HintIcon.tsx`, `ListEditor.tsx` (283) from settings. `FieldAffix.tsx`,
`AutoPill.tsx` from library. `DataTable.tsx` from nothing.

### Docs

Seven of thirty ADRs touch the frontend. None covers the module layout, the barrel policy, the
document registry and split layout in `modules/editor`, the store placement, the virtualization
approach, or `pages/` against `routes/`. `docs/ERROR_HANDLING.md` describes the `Result` boundary
outside the ADR series.

## 11. Proposals, organization

### Enforce before moving

Add to `eslint.config.js`:

- `import/no-cycle` from `eslint-plugin-import`, or `eslint-plugin-boundaries` with one element
  type per module. Either one turns the three cycles and six self-barrel imports into errors and
  stops new ones.
- `no-restricted-imports` with patterns for `@/modules/*/**` (barrel rule), `@/components/*`,
  `@base-ui/react/*` outside `src/components/`, and `lucide-react`.
- `max-lines` at 400 as a warning.

Cheapest change in this note, and the one that keeps every other change from regressing.

### Break the clique

Extract the session state into a leaf the four cycling modules depend down on and never
across: `usePatcherStatus`, `patcherSession`, `pendingRebuild`, `patcherFailure`, `playSession`.
`modules/session` or `src/lib/session` both work. `library`, `patcher`, `launcher` and
`diagnostics` then import it and not each other. `PlayButton` and `SessionBar` move to whichever
side owns the play action.

Convert every `export *` barrel to named exports. `diagnostics`, `launcher` and `patcher` already
are.

### Slim the root route

`__root.tsx` keeps its listeners and lifecycle hooks. The dialog components those listeners raise
(`ProtocolInstallDialog`, `UpdateNotification`, `DevConsole`) go behind `React.lazy`. The root
does not import `@/modules/workshop` for one lifecycle hook. Once the graph is a DAG, the plugin's
splitting places the bin editor and the workshop in their own chunks without further work, and
`manualChunks` is a fallback rather than a requirement.

### Stores go to their module

`src/stores/` keeps what crosses modules: `dialogQueue`, `displayStore`, `notifications`,
`appMark`, `storage`, and `updater` once its I/O moves to `modules/updater/api`. The seventeen
single-consumer stores move to `modules/<module>/state/`, the directory workshop already has.
`history` and `historyIndex` leave `workshopEditor` for a `shellHistory` store, which deletes
`EditorMove`, `foldStack`, `asMove` and about 120 lines. `workshopView` folds into
`workshopFilter`.

One `createDialogStore<T>()` returning `{ payload, open(p), close() }` replaces `libraryDialogs`
and the eight pairs in `workshopDialogs`. `lastAuthorName` goes to settings.

Per-field hooks for `libraryFilter` and `workshopFilter` in the `displayStore` style fix thirteen
of the seventeen whole-store subscriptions. Every persisted store declares `version`.

### Delete `pages/`

Each shim becomes its route's component. `reportToText` goes to `modules/diagnostics/utils`. The
selection sync in `pages/Library.tsx` goes into the library module.

### Fix the `lib`, `utils`, `hooks` split

`lib` holds the vendor boundary and nothing else: `bindings/`, `bindings.gen.ts`, `tauri.ts`,
`query.ts`, `fonts/`. `useTauriEvent` and `useTauriProgress` move to `hooks/`. `lib/form` goes to
workshop, `lib/color` to settings. `utils/overlay.ts`, `utils/dnd.ts`, `hooks/useReorderTransition`
go to library. `useAutoStartPatcher`, `useSurfaceLinkedBinWarning` go to patcher.
`useDebouncedValue` goes to workshop, `useZoomHotkeys` to shell, `useListNav` beside
`CommandPalette`. `usePrevious` is deleted. `utils/query.ts` becomes `utils/ipcResult.ts`, or
its four functions join `lib/query.ts`. `utils/path.ts` joins `utils/index.ts`.

The single-consumer components move with the same rule. `DataTable.tsx` and
`@tanstack/react-table` are removed.

### One place for data-layer defaults

```ts
new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  mutationCache: new MutationCache({
    onError: (error) => toast.error(errorSummary(error)),
  }),
});
```

A mutation that handles its own error keeps its `onError` and opts out through `meta`. This fixes
the forty silent mutations without touching them.

The fifteen handler-side `await api.*` calls become mutation hooks. The two bulk dialogs become one
mutation each over the list, with progress reported through the mutation's state.

`launcher/api/keys.ts` and `patcher/api/keys.ts` gain an `all` root. The four inline keys join
their module's factory. `useLayerInfo` serializes its array segment.

The two raw `invoke("reveal_in_explorer")` calls become `api.revealInExplorer`. The specta
migration continues per module as ADR-0029 sets out, with `library` next, since its 30-odd
commands are the largest hand-written block.

`src/CLAUDE.md`'s event section names `useTauriEvent` and `useTauriProgress` and cites
`launcher/api/useLeagueSession.ts`. The three hand-rolled listeners convert.

### Lift the duplicates

- `components/ConfirmDialog` with `title`, `description`, `confirmLabel`, `onConfirm`, `pending`.
  Five dialogs become props.
- `components/SearchInput` with a clear button and the Escape-clears behavior. Five toolbars use it.
- `useFlatTree({ nodes, isExpanded, rowHeight, scrollKey })` returning `rows`, `virtualizer`,
  sticky state, focus, `handleKeyDown` and `handleContextMenu`, with a `<VirtualTree renderRow>`
  over it. Four read-only trees adopt it, and the eight zoom-measure effects become one.
- `useKeyCommit({ onCommit, onCancel })` for the 32 Enter and Escape handlers.
- `formatRelative`, `formatDate` in `utils/`, on `date-fns`, with the eight inline calls replaced.
- `compareNames` with `{ numeric: true, sensitivity: "base" }` in `utils/`, and the 21
  `localeCompare` sites use it.
- The four `basename` copies, the five clipboard copies, and the hex copies use the canonical one.

### Split the outliers

`ModCardParts.tsx` becomes six files. `SessionBar.tsx` moves its label maps and string builders
to `sessionCopy.ts` and its strings into the catalog. `EditorTabs.tsx` moves its two hooks to
`editor/hooks/`. `ImagePreview.tsx` moves `CHECKERBOARD` to `preview/checkerboard.ts`.

### Tests

Colocated `__tests__` everywhere. The 24 files under `src/__tests__/` move beside their source, as
do the six loose ones. `renderWithProviders` replaces the 26 hand-rolled wrappers. The global
Tauri mock gains `@tauri-apps/api/window`. `createMockIncident` moves to
`modules/diagnostics/__tests__/fixtures.ts`.

### Write the ADRs the code already implements

One each for the module layout and barrel policy, the store placement rule, the document registry
and split layout, and the virtualized tree. Each is a page, and each is the citation a future
comment points at instead of restating.

## 12. Proposals, optimization

### Boot

- Fonts on demand. `Geist` and `Geist Mono` stay eager as the defaults. The other eight load
  through `import("@fontsource-variable/<name>")` when `displayStore` selects them, and the
  selection effect awaits the import before applying the family. About 950 KB off every launch.
- The chunk graph follows from section 11. With the cycles gone and the root slimmed, the bin
  editor (9,593 lines), the palette, the game browser and the problems pass each leave the boot
  path.
- `framer-motion` goes once the two overlays use CSS transitions. `@tanstack/react-query-devtools`
  moves to `devDependencies` or returns behind `import.meta.env.DEV`.

### The library grid

- Virtualize `UnifiedDndGrid`, `SortableModList` and `FolderRow` with `useVirtualizer` over rows
  of cards. `dnd-kit` works over a virtual list when the sortable context holds every id and only
  the visible rows mount.
- One command for thumbnails. Either `get_mod_thumbnails(ids)` answering a map, or the thumbnail
  path on `InstalledMod` so the list query carries it. The per-card query and its IPC go away.
- `loading="lazy"` and `decoding="async"` on the card image, or the workshop's `imageQueue`
  shared across both.
- `useModCardController` reads `running` and `phase` through a selecting hook rather than the whole
  status.

### The patcher poll

The backend emits `patcher-status-changed` from the same place it changes state, and
`usePatcherStatus` invalidates on it through `useTauriEvent`. The interval goes. If a poll stays
as a safety net, it is conditional on `running`.

### The bin editor

- `useCheckLinkTargets` passes `combine` to `useQueries` so the results are stable, and the memo
  at `useLinkTargets.ts:302` recomputes only when a declaration changes. `layerDeclarations`
  moves into its own memo on the content tree alone.
- `BinRowLine` and its sub-components wrap in `memo`. Row props are already stable from the
  virtualizer.
- `useLayerCopy` builds one lowercased index of the content tree once per tree rather than a
  `find` per chip.

### Search and filter typing

- The problems query goes through `useDeferredValue`, `filterProblems` runs once per change in one
  shared memo that the four consumers read, and the grouping keys on that result.
- `WorkshopBar` defers its query before the local ranking. `useFilteredMods` and the WAD filter do
  the same.
- Where a local search is over a few thousand rows, a precomputed lowercase search string per row
  at load time replaces the per-keystroke join.

### React Compiler

React 19.2 with seven `memo` calls is the case the compiler is built for. Adding
`babel-plugin-react-compiler` to the Vite React plugin covers `BinRow`, `ClassView`,
`VfxSections`, `ProjectCard` and the tree rows without hand memoization. It needs a pass with
`eslint-plugin-react-compiler` first, since a component that mutates a prop or reads a ref during
render opts itself out silently.

### IPC shape

No change is urgent. The capped search results and the paged `binChildren` are the right shape.
Two candidates for `Channel<T>` when they next change: the extract progress in `useGameExtract`
and the health sweep, both of which stream today as an event plus a status poll.

## 13. Suggested order

1. ESLint guards. One PR, no behavior change, stops regressions.
2. Fonts on demand and `DataTable` removal. Boot cost, no structural risk.
3. `MutationCache.onError` and the CLAUDE.md event section. Two small edits with wide effect.
4. The patcher event. One backend emit, one frontend hook change.
5. The library grid: thumbnails command, lazy images, virtualization.
6. The session leaf and named barrels. The chunk graph fixes itself after this.
7. Stores to modules, `pages/` deleted, `lib`/`utils`/`hooks` sorted. Mechanical moves once the
   guards hold.
8. The specta migration per module, `library` first.
9. The lifted components and the tree core, each on the next change that touches them.
