# Half the installed mods carry no readme on disk, and the Library has no current mod

An installed modpkg's readme lands at `mods/<slug>/README.md` and an installed fantome's stays
inside the zip. No mod's license text reaches disk at all. The Library holds a selection set rather
than one current mod, and nothing anywhere records which mod was enabled last.

This note carries the facts a design for issue #542 has to live with, a source per point, and the
decisions taken elsewhere that already bind it. Nothing here is a design. The questions it cannot
settle are in the last section.

## Sources

- Issues #542, #536 and #543 on `LeagueToolkit/ltk-manager`
- `crates/ltk-manager-core/src/mods/`, the install, index and library surfaces
- `crates/ltk-manager-core/src/mods/archive/metadata.rs`, the import's extraction
- `src/modules/library/`, the Library's components and state
- `src/modules/workshop/text-files/MarkdownView.tsx`, the renderer
- `src/modules/editor/`, the tab strip, the seam and the side panel
- `react-markdown` 10.1.0 and `react-resizable-panels` 4.12.3, their own readmes and sources
- `docs/ux/LIBRARY.md`, `docs/ux/MOD_HEALTH.md`, `docs/ux/PROJECT_EDITOR.md`, `docs/ux/WORKSHOP.md`
- `docs/adr/0002`, `0007`, `0031`, `0034`, `0036`
- `.claude/skills/design-system/SKILL.md`, which `.gitignore:43` keeps out of the repo

## 1. What the tracker already settles

### 1.1 #542 asks for the readme and names the host as open

The issue's "What to build" is "The Library shows an installed mod's readme where the mod's own
details are shown, rendered rather than as raw text", with the project editor's renderer and its
rules, and "A mod with no readme shows nothing at all rather than an empty panel". Its first open
question is "Where it goes: the mod's detail panel, a tab beside it, or a disclosure on the card".
It carries `area: frontend` and `triage`.

A resizable sidebar with a tab strip is an answer to that open question rather than a new
requirement. What the proposal adds beyond #542 is three things: the panel being resizable, the
strip holding more than one thing, and a license gallery. None of the three appears anywhere in
#542.

### 1.2 The epic settles the renderer, not the host

#536's decision table has seventeen rows. Four of them reach this work: Preview scope
("Project-relative images resolve, remote images do not, links open confirmed"), Flavour ("GitHub
Flavoured Markdown. Raw HTML disabled"), Scope ("`README.md` only, with the document kind named so
a second file is a row") and Command ("A readme-specific pair, returning path, text, readable and
revision"). Every one of them is written about a file in a project directory the user owns. The
epic's closing paragraph names #542 and #543 as the two gaps it leaves.

### 1.3 The license has its own design pass, on a different surface

#543 is the project's license, and its only comment says the backend already answers for it:
`ProjectTextFile::License` resolves the file the way the packer does, and `get_project_text` and
`save_project_text` serve it. What #543 leaves open is "whether a creator picks from known licenses
or writes free text" and "whether it belongs in Details or in a document of its own".

That is a creator writing a license into a project. A gallery of installed mods' licenses is a
reader reading other people's, which #543 does not cover and which nothing on the installed side
reads today - section 3.

## 2. Where an installed mod's readme is

### 2.1 The mod directory and the archive are siblings

```
<storage>
|-- library.json
|-- mods
|   |-- <slug>
|   |   |-- mod.config.json
|   |   |-- thumbnail.webp
|   |   |-- README.md
|   |-- <slug>.modpkg
```

`storage_dir` is `crates/ltk-manager-core/src/mods/index/document.rs:29`, the directory is
`:321`, the archive beside it is `:385`, and `library.json` is `:395`. The module doc states it at
`crates/ltk-manager-core/src/mods/mod.rs:22` - "Every installed mod is a directory under
`<storage>/mods/`, named by its slug."

There is no metadata directory separate from the mod directory. The parameter is named
`metadata_dir` (`crates/ltk-manager-core/src/mods/archive/metadata.rs:129` and `:159`) and receives
the staging directory that `install.rs:338` renames into `mods/<slug>/`. ADR-0002 removed the old
sidecar: "There is no `identity.json` and no `.ltk/` inside an installed mod".

### 2.2 Both formats stay packed

ADR-0007 reverses ADR-0001's fantome unpack:
`docs/adr/0007-an-install-keeps-the-mod-in-its-archive.md:26` - "An install lands as `archive`
storage, for every format. Staging copies the archive ... and extracts its metadata -
`mod.config.json` and the thumbnail - into the mod directory, and nothing else." The mapping is
`crates/ltk-manager-core/src/mods/index/document.rs:229`, where modpkg and fantome both become
`ModStorage::Archive`.

The one path that unpacks is the opt-in per-mod storage switch,
`crates/ltk-manager-core/src/mods/archive/storage.rs:54` and `:339`, and it refuses a modpkg:
"A .modpkg is read straight out of its archive and has no unpacked form"
(`storage.rs:285`).

### 2.3 A modpkg's readme is on disk and a fantome's is not

This is the load-bearing fact. `crates/ltk-manager-core/src/mods/archive/metadata.rs:168`:

```rust
    if let Ok(readme_bytes) = modpkg.load_readme() {
        let _ = fs::write(metadata_dir.join("README.md"), readme_bytes);
    }
```

`extract_fantome_metadata` is `metadata.rs:129` to `:148` in full. It writes `mod.config.json` and
calls `extract_fantome_thumbnail`, and it never reads a readme. `metadata.rs:169` is the only
readme write in the crate outside `workshop/`.

So an installed fantome's readme is inside `mods/<slug>.fantome` as the `META/README.md` entry and
nowhere else. The research note behind the project editor states at its "The installed side already
has the file" section that "Importing a mod writes the archive's readme into the installed mod's
metadata directory" (`docs/research/readme-in-project-editor.md:53`). That holds for a modpkg
alone.

The write is best-effort. `let _ =` discards the error, so a mod directory with no `README.md` is
either a mod that shipped none or a write that failed, and nothing on disk tells the two apart.

### 2.4 A fantome's readme is one reader call away

`ltk_fantome::FantomeReader::read_readme` is `reader.rs:533` in `ltk_fantome` 0.11.0, and it tries
`META/README.md` then a root `README.md`. The manager already opens that reader for the info block
and the thumbnail (`crates/ltk-manager-core/src/mods/archive/metadata.rs:95` and `:191`) and never
calls `read_readme`. The modpkg side is `Modpkg::load_readme`, `ltk_modpkg` 0.9.2 `readme.rs:10`,
over the chunk `_meta_/readme.md` (`readme.rs:6`).

### 2.5 The thumbnail is the shape a readme read would take

`crates/ltk-manager-core/src/mods/library.rs:361` checks `mod_dir/thumbnail.webp` and
`thumbnail.png`, and on a miss mounts the archive beside the mod and extracts per format. The
command pair is `get_mod_thumbnail` and `get_mod_thumbnails`
(`src-tauri/src/commands/mods.rs:232` and `:246`), and the batch reads the index once for the whole
list (`library.rs:331`). A readme command is that function with a different filename and a
different reader.

### 2.6 The frontend already knows where the mod lives

`InstalledMod` carries `modDir`, "Directory where the mod is installed"
(`src/lib/bindings/InstalledMod.ts:14`), along with `format`, `storage`, `hasArchive` and
`description`. It carries no readme and no license. `ModDetailsDialog` already spends `modDir` on
Open Location (`src/modules/library/components/ModDetailsDialog.tsx:34`).

### 2.7 No command reads an installed mod's text

The legacy list is `src-tauri/src/main.rs:73` to `:200` and the specta list is
`src-tauri/src/ipc.rs:30` to `:65`. `get_project_text` and `save_project_text` are there
(`ipc.rs:60`) and take a `project_path` through `WorkshopState`
(`src-tauri/src/commands/workshop.rs:114`). There is no installed-mod equivalent.

## 3. The license is not on disk for any installed mod

### 3.1 Neither format writes it at import

`metadata.rs:168` is the only write in the modpkg path beyond `mod.config.json` and
`thumbnail.webp`, and the fantome path writes neither. No call to `load_license_text` exists in
`crates/ltk-manager-core`.

The capability is there and unused: `ltk_modpkg::Modpkg::load_license_text` (`license.rs:58`, chunk
`_meta_/license`) and `ltk_fantome::FantomeReader::read_license` (`reader.rs:551`), which matches
`META/LICENSE`, `.md` and `.txt` without regard to case (`reader.rs:703`).
`ltk_mod_project`'s `LICENSE_FILE_NAMES` (`license_file.rs:10`) is used by the workshop alone,
through `crates/ltk-manager-core/src/workshop/text_files.rs:104`.

The text does reach disk on the opt-in fantome unpack, through upstream `fantome/import.rs:248`,
covered by `crates/ltk-manager-core/src/mods/long_paths/tests.rs:69`.

### 3.2 The license name is already read and then dropped

`ModProject.license: Option<ModProjectLicense>` lives in `mod.config.json`
(`ltk_mod_project` 0.9.2 `lib.rs:292`), populated from a fantome's info block
(`fantome/convert.rs:73`) and from modpkg metadata (`modpkg/convert.rs:75`). Every installed mod
has that file and the manager reads it per mod. `read_installed_mod` copies fields at
`crates/ltk-manager-core/src/mods/archive/metadata.rs:56` and the license is not among them.

### 3.3 What a gallery costs, by which half it shows

`LibraryModEntry` is `crates/ltk-manager-core/src/mods/index/document.rs:285` and carries six
fields: `id`, `installed_at`, `format`, `storage`, `slug`, `harvest`. Nothing textual. ADR-0002
states the same list. Every textual field on a card comes from a per-mod `mod.config.json` read
(`metadata.rs:24`).

- The license **name** costs nothing new. It rides in a file the mod listing already opens, so
  surfacing it is one field on `InstalledMod` and zero extra reads.
- The license **text** costs one archive mount per mod, because no format writes it out. `N` mods
  is `N` mounts, on the pattern `get_mod_thumbnail_paths` uses for a batch.

### 3.4 A license gallery already exists, for crates

`src/modules/settings/components/LicensesDialog.tsx` is a searchable list of collapsible entries,
each with its SPDX ids on the right and the license text in a `<pre>` below
(`LicensesDialog.tsx:95` to `:139`). The texts are deduplicated into a shared array and referenced
by index (`LicensesDialog.tsx:41`). The manifest is built at build time by `cargo-about` rather
than read at runtime, which is the one thing a mod gallery cannot copy.

## 4. What the Library is today

### 4.1 One column, no sidebar

`src/pages/Library.tsx:64` is a flex column: a drop overlay, an optional unsupported notice,
`LibraryToolbar`, and one bordered box at `:82` holding `LibraryContent`, the selection bar and the
health sweep. Nothing is beside anything.

`docs/ux/LIBRARY.md` is a selection spec rather than a layout spec. It describes the screen once,
at `LIBRARY.md:12` - "It holds a grid of cards, the folders and profiles that organise them, and
the Play button" - and the toolbar only through the feature table at `:43`. It reserves no space
and forbids none, and it never mentions a details surface.

### 4.2 A selection is a set, and a press is not a selection

`useLibrarySelectionStore` holds `selectedIds: Set<string>`, `orderedIds` for shift ranges and
`anchorId`, "the last mod picked without shift"
(`src/modules/library/state/librarySelection.ts:3` to `:17`). There is no current mod and no
notion of one pick being the readable one.

`LIBRARY.md:17` is why: "a card is a switch, and a modifier is what picks it instead. A user comes
to the library to turn mods on and off, so a bare press is that and nothing else." A bare press
enables or disables (`LIBRARY.md:59`), ctrl-click adds and removes (`:64`), shift-click ranges from
the anchor (`:68`). So a reader who presses a card has changed what the game loads and has selected
nothing.

The selection is session state. `src/pages/Library.tsx:54` clears it on unmount, and `LIBRARY.md:156`
states the rule - "The selection is session state and is never written to disk."

### 4.3 The details surface is a modal dialog held in local state

`detailsMod` is `useState` inside `useLibraryContent`
(`src/modules/library/api/useLibraryContent.ts:49`), set from a card's View details
(`src/modules/library/components/LibraryContent.tsx:81`), and drawn by `ModDetailsDialog`
(`:132`). It shows the thumbnail, version, authors, install date, layers and an Open Location
button. It never shows `description`.

### 4.4 There is no last-enabled mod

`enabled` is not a field on a mod. It is membership of the active profile's `enabled_mods`
(`crates/ltk-manager-core/src/mods/library.rs:33`). Enabling appends to that vector
(`library.rs:135`) and then promotes the mod to the front of its folder (`library.rs:138`, and
`crates/ltk-manager-core/src/mods/organize/folders.rs:117`).

The append order does not survive. `sync_profile_orders` rewrites `enabled_mods` into the folders'
flat visual order every time it runs (`folders.rs:136` to `:157`), and
`promote_mod_to_folder_front` calls it on every enable (`folders.rs:127`). A drag-reorder rewrites
it the same way. Nothing anywhere stores a timestamp per enable - a repo-wide search for
`lastEnabled`, `enabledAt` and their Rust spellings returns nothing.

What is observable is weaker than a recency list: the last-enabled mod leads its own folder, until
the next enable or the next drag.

### 4.5 The Library already has a resizable right-hand surface

`ModHealthSweepDrawer` is a `Dialog.Sheet` on the right with a hand-rolled pointer drag on its
inner edge (`src/modules/library/components/ModHealthSweepDrawer.tsx:63` to `:100`), a 280px floor
and a 320px floor on what it leaves of the grid (`:17` and `:19`). Its width persists in
`useModHealthDrawerStore` under `"mod-health-drawer"`, defaulting to 380
(`src/stores/modHealthDrawer.ts:7` and `:117`).

It is modal. It has a backdrop, it takes focus, and `MOD_HEALTH.md:475` states what that buys -
"**It still reflows nothing.** A panel that pushed the cards aside would move the one somebody was
reaching for." The drawer is the second placing of a surface that already tried being a panel over
the grid and was moved off it (`MOD_HEALTH.md:459`).

## 5. What the app has for a resizable panel with a strip

### 5.1 The seam is generic and already borrowed

`react-resizable-panels` 4.12.3 (`package.json:89`) gives `Group`, `Panel` and `Separator`. `Seam`
wraps `Separator` at `src/modules/editor/layout/SplitLayout.tsx:98` and takes only an orientation
and a variant. Four surfaces use the library: `SplitLayout.tsx`, `ObjectDocument.tsx:210`,
`ContentBrowser.tsx:215` and `ProjectTextDocument.tsx:164`.

ADR-0034 declares the machinery generic: "That tree is generic over ids: `LayoutNode`,
`resolveDrop`, `SplitLayout` and `LeafDropZones` name a leaf, a tab and an edge, and none of them
knows what a document is"
(`docs/adr/0034-the-shells-panes-are-the-editors-split-tree.md:26`). It is already reused twice
outside the editor grid, by the VFX and skin shells (ADR-0036:26). No ADR scopes the seam or the
strip to the editor.

The editor-specific half is the opposite policy, in `PROJECT_EDITOR.md:3298` - "The side panels
never enter the split tree. A side panel is not an editor surface: it holds one view rather than
documents, the shell names it, it hides rather than closes, and it takes no tab drop."

### 5.2 Panel sizes persist by hand, and the library's own saver is unused

Every persisted split in the app reads `defaultLayout` from a zustand store and writes back from
`onLayoutChanged` guarded on `meta.isUserInteraction`. `ContentBrowser.tsx:218` is the clearest
case, storing into `useWorkshopLayoutStore.browserSplit`
(`src/stores/workshopLayout.ts:92` and `:225`), persisted under `"ltk-workshop-layout"` (`:236`).
`PROJECT_EDITOR.md:3353` states the rule - "The editor stores a layout on a user change alone, so a
first mount and a window resize write nothing."

`react-resizable-panels` ships `useDefaultLayout`, which saves and restores a group's layout to a
pluggable storage (`node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts:446`).
Nothing in `src/` calls it.

The Library's own persisted store is `useLibraryViewStore` under `"ltk-library-view"`, and it holds
`expandedFolders` and nothing else (`src/modules/library/state/libraryView.ts:6` and `:36`).

### 5.3 The app has two resize idioms, not one

The seam is the `react-resizable-panels` one. The other is a hand-rolled `role="separator"` with
pointer capture and arrow keys, in `ModHealthSweepDrawer.tsx:85` and in the editor's
`SidePanel` `ResizeHandle` (`src/modules/editor/components/SidePanel.tsx:346`). `Seam`'s own doc
says the two are meant to read alike - "Both variants are the 6px band with a centred 2px rail that
SidePanel's ResizeHandle draws, so every seam reads as one control" (`SplitLayout.tsx:91`).

### 5.4 `EditorTabs` is welded to the editor's drag, not to its state

`EditorTabsProps` takes `leafId`, `tabs`, `activeId`, `onActivate` and `onClose` as required, and
eleven optional handlers for close-others, close-to-right, close-all, split, promote, pin, lock and
maximize (`src/modules/editor/components/EditorTabs.tsx:54` to `:82`). A tab is
`{ id, title, context?, path?, icon?, dirty?, preview?, pinned?, menu? }` (`:36`). None of that
names a document.

What it is welded to is the drag. It calls `useSortable` (`:307`) and `useForeignCaretIndex`, which
calls `useDndContext` (`src/modules/editor/layout/useForeignCaretIndex.ts:13`). `@dnd-kit/core`
gives `useDndContext` a default value outside a provider
(`node_modules/@dnd-kit/core/dist/core.cjs.development.js:2542`), so the strip renders in the
Library and its reorder does nothing. The Library's own `DndContext` wraps the grid alone
(`src/modules/library/components/UnifiedDndGrid.tsx:197` and `SortableModList.tsx:87`), and
`LIBRARY.md:82` already spends the grid's press on reordering - "There is no marquee. A drag over
the grid is already how a mod is reordered, and one press cannot mean both."

For two fixed tabs the strip is also most of a close, a pin, a lock and a context menu that has
nothing to enumerate.

### 5.5 `EditorSurface` requires the editor's document model

`EditorSurfaceProps` requires a `registry: EditorRegistry<D>` keyed by document kind, plus
`dirtyIds`, `pinnedIds` and an `onClose`, and it mounts every document at once and hides the
inactive ones (`src/modules/editor/components/EditorSurface.tsx:10` to `:43`, and `:209`). It is
generic over `D extends EditorDocumentBase`, so the Library could satisfy it only by minting
documents for a readme and a gallery.

### 5.6 The plain strip is a component, and `SidePanel` is the wrong axis

`@/components` exports `Tabs` over Base UI, with `default`, `pills` and `plain` variants
(`src/components/Tabs.tsx:7` and `:132`). That is what a two-tab strip is without the editor.

`SidePanel` in the editor module is a vertical accordion of collapsible sections with a boundary
between each (`src/modules/editor/components/SidePanel.tsx:62`). It takes `sections`, `openIds`,
`onToggle`, `heights` and `onResize` and holds no editor state at all
(`SidePanel.tsx:31` to `:40`). It sizes rows inside a panel. It is not the panel.

### 5.7 The renderer is not reachable from the Library today

`MarkdownView` is exported from `src/modules/workshop/text-files/index.ts:1`, and
`src/modules/workshop/index.ts` does not re-export `./text-files`. The barrel rule forbids one
module reaching into another's insides - `eslint.config.js:64` restricts `@/modules/*/**` with
"Import another module through its barrel, `@/modules/<name>`", at `warn`. So the Library reaching
`MarkdownView` is a lint warning until the workshop barrel exports `text-files` or the renderer
moves somewhere both modules may reach.

## 6. The renderer, and what changes when a stranger wrote the file

### 6.1 What it is

`MarkdownView` is `react-markdown` 10.1.0 with `remark-gfm` 4.0.1 and a `components` map, and no
rehype plugin (`src/modules/workshop/text-files/MarkdownView.tsx:30`). The map styles headings,
paragraphs, lists, blockquote, rule, table, code, pre, and overrides `img` and `a`
(`:37` to `:92`). `ChangelogContent` is a second renderer on the same two packages that overrides
neither `img` nor `a` (`src/modules/updater/components/ChangelogContent.tsx:9`).

### 6.2 Raw HTML

Not rendered. `react-markdown`'s own readme lists "safe by default (no `dangerouslySetInnerHTML` or
XSS attacks)" at `node_modules/react-markdown/readme.md:18`, and its "Appendix A: HTML in markdown"
section says the library "typically escapes HTML ... because it is dangerous and defeats the
purpose of this library" and that rendering it takes `rehype-raw` (`readme.md:650`). No rehype
plugin is passed. Its "Security" section adds that "the `remarkPlugins`, `rehypePlugins`, and
`components` you use may be insecure" (`readme.md:787`).

Inline script is refused twice over. The CSP has no `script-src`, so it falls back to
`default-src 'self' ipc: http://ipc.localhost` (`src-tauri/tauri.conf.json:27`).

### 6.3 Links, which the code and the spec disagree about

`react-markdown` passes every URL through `defaultUrlTransform` unless one is supplied
(`node_modules/react-markdown/lib/index.js:320`), and none is. That function returns the URL
unchanged when it is relative or when its protocol matches
`/^(https?|ircs?|mailto|xmpp)$/i`, and the empty string otherwise
(`lib/index.js:124` and `:421`). So `javascript:`, `data:`, `file:` and the app's own `ltk:`
deep-link scheme (`src-tauri/tauri.conf.json:65`) are all dropped before the component map sees
them.

What survives reaches `MarkdownView.tsx:87`, which returns a bare `<span>` for a missing href or a
`#` fragment and hands everything else to `ExternalLink`. `ExternalLink` is a plain anchor with
`target="_blank" rel="noopener noreferrer"` (`src/components/ExternalLink.tsx:17`). It does not
call `@tauri-apps/plugin-shell`, and `src-tauri/src/` registers no navigation or new-window
handler.

Two written statements do not match that. #536's decision table says "links open confirmed", and
`PROJECT_EDITOR.md:1479` says "an external link opens in the system browser". Nothing in the code
confirms anything or routes through the shell plugin. `shell:allow-open` is granted
(`src-tauri/capabilities/default.json:14`) and six other surfaces use it
(`src/modules/home/components/NewsTile.tsx:9` among them), so the plumbing exists and the renderer
is not on it.

A relative href also survives the transform unchanged, so `[x](../../secrets)` in a stranger's
readme reaches `ExternalLink` as a relative navigation against the app's own origin.

### 6.4 Images, which are refused twice

`projectImage` refuses any `src` carrying a scheme, refuses when `root` is null, refuses any
segment equal to `..`, and otherwise returns `convertFileSrc(root + "/" + path)`
(`MarkdownView.tsx:101` to `:108`). Its doc states the reason - "A remote URL would tell its host
that the project was opened, which is a request the creator never made".

The CSP refuses the same thing independently. `img-src 'self' asset: data:
http://asset.localhost ltk-asset: http://ltk-asset.localhost` has no `https:`
(`src-tauri/tauri.conf.json:27`), so a remote image does not load even from a renderer that allowed
it. `data:` is allowed, so an inline data-URI image would load if `projectImage` let it through,
which it does not.

The traversal guard is the only limit on what the asset protocol may read:
`assetProtocol.scope` is `["**"]` (`tauri.conf.json:31`), and `fs:allow-read-file` is granted for
`{ "path": "**" }` (`capabilities/default.json:22`).

### 6.5 What actually changes when the author is a stranger

Three things, and none of them is the HTML question.

- **The root.** `ProjectTextDocument` passes the readme file's own directory as `root`
  (`ProjectTextDocument.tsx:195` and `:236`), which for a project is a tree the author filled. For
  an installed modpkg that directory is `mods/<slug>/`, which holds `mod.config.json`, a thumbnail
  and `README.md` and nothing else. A readme's `![](images/x.png)` resolves to a file the import
  never extracted, and `MarkdownView.tsx:84` draws the alt text instead. For a fantome there is no
  readme on disk and so no directory to resolve against at all.
- **The link.** Section 6.3 - a stranger's `https://` link opens on a press with nothing in
  between, which is the one gap between what #536 wrote down and what ships.
- **Who the guard protects.** For a project the guards stop the app phoning home about a file the
  creator opened. For an installed mod they stop a downloaded file reaching the reader's disk and
  the network, which is a different threat with the same mechanism.

## 7. What the specs already bind

### 7.1 A text document sits on the ground, and a sidebar does not

`PROJECT_EDITOR.md:1492`, in full:

> Every document whose body is text a creator edits - the readme, its rendered half, the ignore
> rules and its syntax rail - draws on `surface-950` with no padding around it and no inset frame
> of its own. The tab is the frame, and what divides two halves is a hairline.
>
> A bordered, rounded box inset in a padded document is a frame drawn inside a frame, which costs
> a text surface the width it exists to give, and which reads as a card in a place where nothing
> is being lifted off the page.

DS-GROUND puts a sidebar on the rung above: `surface-800` is "Chrome, and anything floating over a
card: sidebars, tab rails, dialogs, popovers, menus, tooltips"
(`.claude/skills/design-system/SKILL.md:123`), and `surface-950` is "The page ground and nothing
sits below it" (`SKILL.md:114`).

A readme rendered inside a Library sidebar is therefore on the ground inside chrome, which the two
rules cannot both have. The escape hatch DS-GROUND already names is the inset - "An inset inside a
card ... is the one place a lower rung is right: `bg-surface-950/40` inside a `bg-surface-900` card
reads as recessed because the card, not the page, is what it sits on" (`SKILL.md:129`) - and the
text-document rule refuses exactly that framing.

### 7.2 A grid route is the ground itself

`WORKSHOP.md:161`, the fold:

> Under a project it is a frame the editor and its side panels share, and it rounds against the
> ground: `rounded-t-xl`, a hairline border and `surface-900`, DS-GROUND. Over the grid there is no
> frame to share - the cards are the content and carry their own edges - so the fold is the ground
> itself and the row above it is the same surface rather than a lighter panel over one.

A sidebar beside the Library grid moves the Library from the second case to the first.

### 7.3 A panel beside the Library grid has been argued against once

`MOD_HEALTH.md:475` - "**It still reflows nothing.** A panel that pushed the cards aside would move
the one somebody was reaching for." The surrounding paragraphs are the record of a panel over the
grid being abandoned - "a panel drawn in the same surfaces as the grid, at the same brightness, in
the corner where a toast also lands" (`:459`).

A resizable sidebar reflows by definition, so the design either overturns that sentence or does not
sit beside the grid.

### 7.4 What a resizable edge already owes

`MOD_HEALTH.md:709` - "**The sheet's inner edge is its handle.** That form's own border resizes it,
the gesture the editor's side panels already answer to. It stops before it has eaten the whole
window, and the width it is left at outlives the close." And `:713` - "Neither form opens focused on
its own chrome. The sheet's first tab stop is that handle ... Focus starts on the panel itself."

### 7.5 Escape and Ctrl+A are already spoken for

`LIBRARY.md:110` - "Escape clears the selection, unless a dialog or a menu is drawn over the
library, in which case Escape belongs to what is on top." `MOD_HEALTH.md:482` - "Escape and Ctrl+A
belong to the panel while it is showing, so leaving it does not also drop the selection
underneath." A non-modal sidebar is neither of those cases.

### 7.6 A narrow host is a documented reason to refuse a surface

`PROJECT_PROBLEMS.md:965` - "**Problems opens as a tab, and not as a side panel.** It began as a
section of the content sidebar and a sidebar cannot hold it: a finding needs two lines, a header
level of its own sits..." `PROJECT_EDITOR.md:1261` - "the tree now lives in a side panel, and a
side panel is narrow. A table needs width." The width figure the editor names for a side panel is
280px (`PROJECT_EDITOR.md:1678`), and the readme's own fold to a single half is 560px
(`PROJECT_EDITOR.md:1468`, implemented as `NARROW_TOOLBAR` in
`src/modules/editor/useNarrowToolbar.ts:5`).

A readme sidebar therefore opens below the width at which the project editor stops showing a readme
beside anything.

### 7.7 The rules a new strip and panel pick up for free

- DS-SCROLLBAR: `scrollbar-md` is for "Dense panes - trees, virtual lists, side panels" and
  `scrollbar-sm` for "A strip one row tall, mostly gutter", the rule naming the tab strip case -
  "`scrollbar-sm` is the one that ignores the setting outright, because a tab strip has no height
  to lend a wide one" (`SKILL.md:389` to `:412`).
- DS-VEIL: a tab, a close and a resize handle own no surface, so their fill and edge come from
  `surface-veil` rather than a rung (`SKILL.md:87`).
- DS-MENU-SCOPE: a reading surface may carry a link and nothing else - "A **link** is the one thing
  a card may carry. It goes somewhere rather than changing something ... Anything that writes,
  copies, opens a document or changes state is an action and belongs on the menu" (`SKILL.md:491`).
  The Library's own statement of the same rule is `LIBRARY.md:119` to `:135`.
- DS-RADIUS: `rounded-lg` for a panel, `rounded-xl` for a dialog (`SKILL.md:206`).

### 7.8 No ADR governs the Library's layout

A search across all thirty-nine ADRs turns up nothing about the Library's screen. The nearest is
`docs/adr/0033-a-dialog-shares-a-frame-not-a-manager.md:83`, about where `LibraryDialogs` mounts.
`LIBRARY.md` reserves no space. This design is greenfield rather than a reversal.

## 8. Decisions already taken, and what they were taken over

### 8.1 Raw HTML is not rendered, over adding `rehype-raw`

`docs/research/readme-in-project-editor.md:113` - a readme arrives from a git import or a packaged
mod as readily as from the author, and the webview runs with app privileges. The alternative was
the 60kb plugin `react-markdown`'s own readme offers for "a trusted environment"
(`node_modules/react-markdown/readme.md:653`). #542 restates it, and an installed mod is the case
the decision was written for.

### 8.2 An install keeps the mod in its archive, over unpacking it

ADR-0007, over ADR-0001's fantome unpack. This is what makes a fantome's readme unreachable without
a read into the zip, and the storage switch is the opt-out a user takes per mod.

### 8.3 `library.json` is the only record, over a per-mod sidecar

ADR-0002. This is why no index holds a mod's prose and why every textual field is a per-mod file
read. A gallery cannot be answered from the index.

### 8.4 The health findings are a centred dialog, over a panel beside the grid

`MOD_HEALTH.md:459`. The alternative shipped first and was moved. The reasons given are contrast
against the grid, competing with toasts, and reflow.

### 8.5 Problems is a tab, over a side panel section

`PROJECT_PROBLEMS.md:965`, with the feature table restating it at `:62` - "A document of the editor
surface, and not a side panel". The reason given is the width a finding needs.

## 9. The open questions

Every fork below is settled in section 10, which names what each decision was taken over.

### 9.1 What a fantome's readme costs, and whether it is paid at import or on demand

A modpkg's readme is a file read. A fantome's is a zip mount. Three forks:

- **Extract at import**, matching the modpkg path, so both formats have `mods/<slug>/README.md`.
  Every mod already installed needs a backfill, which is the reconcile pass
  (`crates/ltk-manager-core/src/mods/index/reconcile.rs:363` already re-extracts modpkg metadata).
- **Extract on demand and cache**, matching `thumbnail_path` exactly - check the file, mount the
  archive on a miss, write it beside the mod.
- **Read without caching**, one mount per view.

The default is the second. It is the shape the thumbnail already has, it needs no migration, and it
is the only one that costs nothing for a mod nobody opens the panel on.

### 9.2 Whether the panel follows the selection, the enabled set, or an explicit open

There is no last-enabled mod (section 4.4) and no current mod (section 4.2). So the proposal's "the
selected or last enabled mod" has to be resolved into something that exists:

- **The selection**, which is a set. A one-mod selection reads, a many-mod selection shows what -
  the anchor, a count, or nothing? And a reader who never ctrl-clicks never fills the panel, because
  a bare press is the switch.
- **An explicit open**, the way `detailsMod` works today - the card's View details fills the panel
  instead of raising a dialog. This has an obvious empty state and needs no new state at all.
- **A new last-enabled stamp**, which means a field on the profile and a decision about whether a
  drag-reorder clears it.

The default is the second. It is the smallest change, it reuses an entry point readers already
have, and it makes the panel answer a question the reader asked rather than guess one.

### 9.3 Whether the panel reflows the grid or covers it

`MOD_HEALTH.md:475` argues against reflow on this exact screen. A resizable sidebar reflows.

- **Reflow**, and overturn that sentence with a reason it did not consider - a readme is read
  alongside the grid, where a findings list is read instead of it.
- **Cover**, which makes it the health drawer's shape again and gives up the "expandable" half of
  the proposal.
- **Reflow, but non-modal and closed by default**, so the grid is unchanged until a reader opens it.

The default is the third, because it is the only one that does not contradict a written rule.

### 9.4 Which rung the rendered readme draws on

Section 7.1 - DS-GROUND puts a sidebar at `surface-800` and "A text document sits on the ground"
puts a readme's rendered half on `surface-950` with no frame. Either the text-document rule is
scoped to a document filling a tab and the sidebar gets its own rung, or the sidebar is an
exception to DS-GROUND. Whichever wins, the losing rule needs a sentence added saying so.

### 9.5 Whether the strip is the editor's or a plain `Tabs`

Section 5.4. `EditorTabs` brings close, pin, lock, split, drag and a context menu that two fixed
tabs have nothing to put in, and its drag is inert outside a `DndContext` the Library does not
have there. `@/components`' `Tabs` is the strip without any of it.

The default is `Tabs`, with `EditorTabs` reconsidered only if the tabs become closeable or
reorderable - at which point the honest question is whether the Library wants the editor shell
rather than a strip.

### 9.6 What the license tab shows, and for how many mods at once

Section 3 - no installed mod's license text is on disk, and the name is free.

- **One mod's license**, beside its readme, which is a tab of the same panel and one more read.
- **Every mod's license**, which is the "gallery" word, and which is N archive mounts on open.
- **Every mod's license name**, from `mod.config.json` the listing already reads, with the text
  fetched per row on expand - the shape `LicensesDialog` already draws.

The default is the third. It is free to open, it reuses an existing layout, and it degrades to the
first when a row is expanded.

Separately: whether a license belongs in this panel at all, or beside #543's project license
surface, is a question about where a reader looks rather than about cost.

### 9.7 What an image in a stranger's readme resolves against

#542 asks this in its own words. Section 6.5 gives the facts: a modpkg's mod directory holds three
files and no image tree, and a fantome has no directory at all.

- **Nothing resolves**, and every relative image draws its alt text.
- **The mod directory resolves**, which means the import extracts the readme's images too, and
  something has to decide which entries of an archive are images a readme may reach.
- **The archive resolves**, through a protocol handler like `ltk-asset`, which already serves
  bytes out of the game's archives (`src-tauri/src/protocol.rs:26`).

The default is the first, for a first cut. It ships a correct panel with a known gap, and the third
is the one to reach for if the gap turns out to matter, because the protocol exists.

### 9.8 Whether the link gap is closed here or separately

Section 6.3 - the renderer opens an external link with no confirmation, against what #536 and
`PROJECT_EDITOR.md:1479` both say. That is a bug in the project editor's readme today, not
something this work introduces. It gets worse here, because the author is a stranger.

The fork is whether #542 closes it (and the project editor gets the fix for free) or a separate
issue does. The default is a separate issue, so this design is not gated on a confirmation dialog's
own design pass.

### 9.9 Where the renderer lives once two modules draw it

Section 5.7 - `MarkdownView` is inside the workshop's insides and the barrel rule stands between it
and the Library. Either `src/modules/workshop/index.ts` exports `./text-files`, or the renderer
moves to `@/components` beside the other shared views. The second is the honest read of a component
two modules draw, and it is a rename rather than a design question - it goes in the plan rather
than the grilling.

## 10. Decisions taken in the grilling round

Every fork in section 9 is settled, along with the ones those answers opened. Each decision names
what it was taken over, and what it costs.

The settled shape:

```
+--------------------------------+--------------------+
| [card]  [card]  [card]         | Readme   Licenses  |
|                                |====================|
| [card]  [card]  [card]         | My Mod          x  |
|                                |--------------------|
| [card]  [card]  [card]         | # My Mod           |
|                                | swaps a skin       |
+--------------------------------+--------------------+
        surface-950 page          surface-950 panel
                                  ^ seam, drag
```

### 10.1 The panel reflows the grid, over covering it

A right-edge sidebar on a `Seam`, closed by default, narrowing the grid when open.
`MOD_HEALTH.md:475` argues against a panel that pushes the cards aside, and that argument is about
a sweep's findings arriving unbidden. A panel the reader opens is a different object, so the rule
gains a sentence rather than being overturned.

Taken over a drawer covering the grid, which is `ModHealthSweepDrawer` again and is modal, so a
reader cannot read install steps and browse mods at once. Taken over a disclosure on the card,
which answers #542 and leaves no home for a second tab.

### 10.2 An explicit open, over a selection or an enabled stamp

A card menu item aims the panel at one mod, and the panel holds it until told otherwise.

Taken over following `selectedIds`, because `LIBRARY.md:17` makes a bare card press toggle the
switch rather than select, so a reader browsing mods selects nothing. Taken over the last-enabled
mod, which needs a timestamp that does not exist - `sync_profile_orders` (`folders.rs:136`)
rewrites `enabled_mods` into the folders' visual order on every enable and every drag, so its order
carries no history - and which changes the panel as a side effect of flipping a switch.

### 10.3 A fantome's readme is extracted on demand and cached, over at import

The first read opens the archive and writes `README.md` into the mod's metadata directory, and
every later read is a file read. This is the shape `thumbnail_path` (`library.rs:361`) already has.

Taken over extracting at import beside the thumbnail, which is cleaner going forward but leaves
every already-installed mod without a readme until a backfill runs. Taken over supporting modpkg
alone, which is silent for the older and larger half of the ecosystem.

Both formats converge on `README.md` in the metadata directory, the path the modpkg import already
writes at `metadata.rs:168`, so the read side never branches on format.

### 10.4 The action is always offered, over indexing which mods have a readme

Opening a mod with no readme shows the panel's own empty state. On-demand extraction means a
fantome's readme is unknown until the archive opens, so knowing in advance costs either a
persisted flag with a backfill or an archive open per card.

This scopes #542's "a mod with no readme shows nothing at all" to the panel body rather than to
the affordance, which is one sentence on that issue.

### 10.5 The panel is itself ground, over a well inside a rail

The whole sidebar draws on `surface-950` and separates with a hairline, which is what DS-GROUND
already permits for the toolbar and the session bar. Neither rule is amended: "A text document sits
on the ground" (`PROJECT_EDITOR.md:1492`) is satisfied literally.

Taken over a `surface-800` rail with a `surface-950` well in its tab body, which keeps DS-GROUND's
rung table untouched but redefines "the ground" as relative to a host. Taken over drawing the
readme on `surface-800` throughout, which renders the same document on two rungs depending on which
screen shows it.

The cost is that the tab strip reads as chrome without a rung to do it with, so it leans on the
hairline and on type.

### 10.6 Nothing resolves for an image, over extraction and over a protocol

An image in an installed mod's readme renders as its alt text. Remote images are already refused,
and a mod directory is not a project, so a relative path has nothing to point at.

Taken over extracting an archive's images beside the readme, which puts untrusted markdown in
charge of which archive entries land on disk. Taken over serving the archive through a protocol
handler, which is the most capable option and also puts filesystem reach behind a URL a stranger
composes. The protocol exists (`src-tauri/src/protocol.rs:26`), so this is the option to reach for
if the gap proves to matter.

### 10.7 `ExternalLink` is fixed here, and the confirmation is filed separately

Section 6.3 - an external link reaches no system browser today, against what #536's decision table
and `PROJECT_EDITOR.md:1479` both describe. The fix lands in `ExternalLink` itself, so every caller
gets it, and it ships with this work because a stranger's readme is what makes it urgent.

The confirmation dialog is its own issue with its own design pass, and `PROJECT_EDITOR.md` loses
the sentence it cannot currently back until that lands.

Taken over filing the whole gap separately, which ships an untrusted surface on an unverified link
path. Taken over building the dialog here, which puts a modal's design on a Library feature's
critical path.

### 10.8 A card menu item and a toolbar toggle, over one entry point

The toggle opens and closes the panel as a Library-wide control. The menu item aims it at one mod.
Two affordances at the two scopes DS-MENU-SCOPE names.

Taken over the menu item alone, which hides the whole feature inside a kebab. Taken over a glyph in
the card's hover actions, which adds a permanent target to every card in a dense grid. Taken over a
double-press, because a bare press already toggles the mod's switch, so the gesture would flip
`enabled` twice on the way to opening a readme.

### 10.9 A plain `Tabs`, over `EditorTabs`

The set is fixed at two and neither tab closes, pins, locks, reorders or splits. `EditorTabs`
carries all of that plus a drag that is inert outside a `DndContext` (section 5.4), which is a
latent bug for whoever wires one nearby later.

Taken over a bespoke strip sized for a narrow panel, which is a third tab style in an app that has
two.

### 10.10 The width persists and nothing else does

The seam drag is a preference and survives a restart, matching `ModHealthSweepDrawer`. Which mod
was open, and whether the panel was open at all, do not - the Library opens closed and full width.

Taken over persisting all three, which needs a fallback for a mod uninstalled between sessions and
charges the grid's width to a reader who forgot the panel was open. Taken over persisting the open
state alone, which boots into a narrower grid showing nothing.

### 10.11 The license tab is library-wide, over per-mod

The tab lists every installed mod with its license, independent of whichever mod the readme tab
holds. That is what makes it a gallery rather than a line.

Taken over following the opened mod, which makes the panel coherently one mod's documents and
answers "what is this licensed under" but never "which of mine are all-rights-reserved". Taken over
listing enabled mods only, which hides a license until the mod is enabled, backwards for someone
deciding whether to enable it.

### 10.12 The landing tab follows the entry point

The toolbar toggle lands on Licenses, which needs no mod and is already full. A card menu item
lands on Readme, holding that mod. The tab a panel opens on follows the intent of the thing that
opened it, the way a deep link differs from a generic open.

Taken over always landing on Readme, where the toolbar toggle's reward is a narrower grid showing a
sentence. Taken over remembering the last tab, which still needs a first-open default and stops the
panel being explainable in one sentence.

### 10.13 A bare readme renders as it is

A readme holding one heading renders as one heading. No threshold, because any threshold is wrong
for somebody and an author who wrote only a title still chose to write a file. This answers #542's
own question about a heading-only readme.

Taken over treating a body-less readme as absent, which needs a definition of "body" that survives
GFM. Taken over rendering it with a note that the file is bare, which is one more string for an
edge case.

### 10.14 A failed read and an absent readme are two states

"This mod has no readme" and "this mod's archive could not be read" are different facts, and the
second means the mod may not work at all. #542's "shows nothing at all" is written about absence,
and reporting a damaged archive as a documentation-free one is a silent lie about an installed mod.

Taken over one state with the failure in the log, which tells a reader with a broken mod nothing.
Taken over retrying on every open, which reopens the zip forever for a fantome that genuinely
carries no readme.

### 10.15 Below the threshold the panel overlays, over closing

Under a set window width the panel floats over the grid rather than pushing it, so the feature is
reachable at any size and the cards never squeeze. The precedent for deciding a fold in JavaScript
is the readme's own 560px split.

Taken over closing and disabling the toggle, which switches a feature off by window width. Taken
over taking the whole Library area, which hides the cards the reader was comparing.

### 10.16 A license row's text is read transiently

Expanding a row mounts that mod's archive and the text is held for the session. A license is never
the panel's default content, so nobody pays for it unless they ask.

Taken over caching to disk on first expand, which is a second lazy extraction path to keep in step
with the readme's. Taken over extracting at import, which brings back the backfill 10.3 avoided,
now for two files.

A fantome does carry its license: `META/LICENSE` is what the workshop's own project import already
extracts (`workshop/projects/tests.rs:63` writes it, `:115` asserts it lands). The library's import
is the half that never reads it.

### 10.17 The panel names the mod in its own header

A header row carries the mod's name and the control that closes the panel, so a reader who opened a
readme, toggled six switches and came back still knows what they are reading.

Taken over the tab label carrying the name, which makes the strip shift under the pointer as tab
widths change and leaves a long name nowhere to go. Taken over naming it nowhere, which stops being
true the moment the panel is left open.

### 10.18 Three license states, told apart

A name with a file expands to the text. A name with no file shows the name and nothing to expand.
Neither reads as not declared. The middle case is the common one - an author who typed a license
name and shipped no file - and telling it from silence is the whole point of the audit.

Taken over folding the middle case into "not declared". Taken over listing only mods that have a
license, which hides exactly what the tab is consulted to find.

### 10.19 The gallery searches and groups by license name

Grouping turns a list into an audit: every all-rights-reserved mod in one block, every undeclared
one in another. `LicensesDialog` is already a searchable collapsible gallery, so the shape is one
the app has.

Taken over a flat searchable list sorted by mod name, which answers the per-mod question and leaves
the library-wide one to scanning. Taken over a plain list, which is fine at ten mods and useless at
two hundred.

### 10.20 A removed mod clears the panel, over closing it

The panel stays open at its width and says the mod is gone, so there is no stale content and no
layout jump. Opening another mod is the likely next act.

Taken over closing itself, which is a layout change nobody asked for on top of an uninstall they
may not have started here. Taken over holding the content marked as removed, which is a panel
confidently showing a mod that does not exist.

### 10.21 Taken as obvious, not asked

- The license text renders preformatted rather than as Markdown, which `textFileKind` already
  declares with `markdown: false` on the license kind.
- The panel holds a mod id rather than a name, so a rename does not orphan it.
- A license name renders as a `Code` chip, per DS-CODE-CHIP.
- The extracted fantome readme is written to `README.md` in the metadata directory, the same path
  the modpkg import writes, so nothing downstream branches on format.

### 10.22 What these decisions owe the written rules

- `MOD_HEALTH.md:475` gains a sentence distinguishing a panel that arrives unbidden from one the
  reader opens.
- DS-GROUND's rung table gains the Library panel beside the toolbar and the session bar as a
  surface sharing the ground rather than rising off it.
- `PROJECT_EDITOR.md:1479` loses its claim about a confirmation until the dialog issue lands.
- #542 gains a note scoping "shows nothing at all" to the panel body.
