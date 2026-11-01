# ADR-0056: An editor reads and writes through a sandbox

- **Status:** Accepted (2026-09-28)
- **Date:** 2026-09-28
- **Crates:** `src-tauri`, `ltk-manager-core`
- **Related:** [ADR-0026](0026-a-saved-bin-is-written-from-the-tree-the-backend-holds.md), which
  keeps open documents in the backend. [ADR-0028](0028-an-object-is-a-document-of-its-own.md),
  [ADR-0042](0042-a-game-bin-edit-inside-a-project-declares-into-a-layer.md) and
  [ADR-0048](0048-a-declared-edit-joins-the-module-the-reader-chose.md), whose rules still apply.
  Plan: `docs/plans/sandbox.md`.

## Context and problem statement

A workshop editor shows data from one of two sources: the installed game alone, or a mod project's
layers stacked over the game. No type in the code represents that source. Each read and write
passes part of it separately, and each editor repeats the same checks:

- `AssetRef::GameChunk.project` is what makes a game bin a declared document. `useBinDocument` sets
  it from `ProjectContext`, and no other bin open receives a project.
- `DocumentAssets` resolves a link to a layer copy, or else to a game chunk with `project: None`. A
  link followed out of a declared document therefore opens undeclared.
- `assetKey` has no project part. A chunk opened with and without a project gets one document id
  and one query key.
- The editor sorts layers in two ways. `LayerChunks::cmp_for_stacking` sorts by priority first and
  decides which file a path resolves to. `ModProjectLayer::apply_order` puts `base` first and orders
  declarations. The overlay uses `apply_order` for both files and declarations, so for a layer of
  negative priority the editor opens a different file than the build uses. The frontend's
  `lookupOrder` copies `cmp_for_stacking`.
- A game bin that a layer also ships opens as a declared document over the game's copy. The build
  applies declarations over the layer's copy (`ltk_overlay` `apply_game_data`), so the document
  shows content the build never produces.
- The frontend repeats resolution the backend already does, in `useLayerCopy` and
  `joinDeclarations` in `useLinkTargets.ts`.
- `ReadOnly` combines three unrelated reasons: the source (`install`), the file type (`loose`,
  `patch`) and a setting (`declarationsOff`). Ten bin editor files call `useOptionalProjectContext`
  to decide what they allow.

Riot's own editor calls this source a sandbox and shows it above the document as
`Sandbox (featuredmodes) >` (`docs/research/bin-editor-higher-order-views.md`, section 2).

## Decision

**A sandbox is the data source an editor reads from and writes to.**

| Sandbox | Reads                                  | Writes                |
| ------- | -------------------------------------- | --------------------- |
| Game    | The installed game                     | Nothing               |
| Project | Every layer of a project over the game | Into the target layer |

A third kind, a layer subset, reads the chosen layers of a project over the game. A game chunk no
chosen layer ships opens read-only, because the chosen target layer may be outside the subset. A
layer file keeps its one tree and one save, and each id over it records the subset it reads in.

**A project sandbox shows the project's own build output.** It stacks the project's layers over
the game in `ModProjectLayer::apply_order`, the order the overlay uses. Other enabled mods and the
built-in mods are not included. The workshop never writes a negative priority, so one only comes
from an imported or hand-edited config, and the sandbox orders it as the overlay does.

**A path resolves to the copy the build uses.** A game bin that a layer ships opens as that
layer's file, and edits write the file, per ADR-0040. A row of that file that a declaration
overrides shows a mark with the declaring layer and the value it sets. A declared document, per
ADR-0042, exists only for a chunk that no layer ships, so it always starts from the game's copy.

**The backend owns the sandbox,** as ADR-0026 already has it own the open documents. A `SandboxRef`
identifies one on the wire: `{ kind: "game" } | { kind: "project", project } | { kind: "layers",
project, layers }`. Core's `SandboxState` keeps one `Sandbox` snapshot per `SandboxRef`. A snapshot
holds the layer stack and provides the interfaces the editor already reads through: an
`AssetLookup` over the stack and the game index, the project's names, and the objects its layer
bins declare. `GameCopy` stays the install's, because every sandbox reads the same install. A
layer watch event or a config write clears the project's snapshots, and the next read builds a
fresh one.

**`AssetRef` only says where a file is stored.** It loses `GameChunk.project`. A document opens in
a sandbox, `bin_open(sandbox, asset, entry)`. A declared game chunk is keyed by the sandbox and the
asset. A layer file is keyed by the file alone, so every sandbox that reads it shares one tree and
one save.

**A sandbox identifies a layer by its name.** Renaming a layer updates the open sandboxes, the open
documents and the tabs saved in `.ltk/editor.json`.

**The reader's selected layer is the target.** The frontend sends it with `bin_declare_into`
whenever the selection changes, every declared edit lands in it, and the backend refuses a layer
the project does not hold. The module is chosen per ADR-0048. A layer file's edits save to that
file.

**The reader sees the sandbox.** The header of a bin tab starts with `Sandbox (<name>) >`, which
opens the Sandbox options: a choice between the project and the game, and for a declared
document the declarations switch, the target layer and the module. These replace the layer and
module chips. Picking the game opens the same path read-only in the game sandbox, in the same
tab. The option is disabled when the game has no copy of the path. The game browser opens
documents in the project's sandbox, as it does today.

## Consequences

**The editor shows what the build produces.** A negative-priority layer resolves as the overlay
resolves it, and a game bin that a layer ships opens as the file the build starts from. Both change
what an existing project shows, so the release notes must mention them.

**A link keeps its sandbox.** A document opened from a link opens in the same sandbox as the
document the link is in, so a link out of a declared document opens declared.

**`ReadOnly` loses `install`.** A document in the game sandbox is read-only because of the sandbox:
an edit fails as `GameSandbox`, and the frontend draws the gate as `gameSandbox`. `loose`, `patch`
and `declarationsOff` stay, because they describe a file or a setting.

**Saved tabs keep their ids.** A tab in the route's sandbox keeps the id it had, and only a tab
switched to another sandbox adds that sandbox to its id. The tabs saved in `.ltk/editor.json`
therefore need no migration.

**Editing a game file that is not a bin is out of scope.** No editor does it yet. When one does,
the sandbox should copy the file into the target layer on the first edit.

**"Sandbox" is a new word for readers.** A hover card on the header explains it. It is unrelated to
`ChangeBaseline`, which still names what a change list compares against.
