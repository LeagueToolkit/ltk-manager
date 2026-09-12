# A mod's details in the sidebar — Implementation Plan

> Status: **proposed**. Depends on the documents sidebar (`feat/library-documents-sidebar`, EPIC #547).
> Design source: [The documents panel](../ux/LIBRARY.md#the-documents-panel), and section 10 of
> `docs/research/library-readme-sidebar.md` for the decisions the panel already carries.

A mod card's menu opens three separate modal dialogs about one mod: **View Details**, **Edit
Metadata** and **WAD Footprint**. Each covers the library, each is dismissed before the next is
opened, and none of them can be read beside the grid. They are three answers to one question - what
is this mod - split across three surfaces because there was nowhere to put them.

The sidebar is now that place. This plan folds all three into a **Details** tab beside Readme and
Licenses, and collapses the three menu items into one.

The win is not only the panel. The three dialogs are wired through `onViewDetails` and
`onEditMetadata` props drilled five levels deep, plus a `setWadFootprintOpen` flag on every card's
controller. The sidebar store is already the seam that a card reaches without a prop, so folding
the surfaces in **deletes that drilling** rather than re-routing it.

## 1. Current state (verified 2026-09-12)

| Piece             | Where                                                                                                          | Shape today                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Details dialog    | `library/components/ModDetailsDialog.tsx`                                                                      | `Dialog.Shell`, 240 lines. Thumbnail, facts, categories, layers       |
| Packaging warning | same file, `ModDetailsPackaging`                                                                               | Checksum-mismatch band. Renders nothing for a well-packed mod         |
| Layer toggles     | same file, `ModDetailsLayers` over `LayerToggleList`                                                           | Only for a mod with more than one layer                               |
| Edit dialog       | `library/components/EditMetadataDialog.tsx`                                                                    | `Dialog.Shell`, 327 lines. A vertical form plus a suggestions band    |
| WAD footprint     | `library/components/ModCard/ModWadFootprintDialog.tsx`                                                         | `Dialog.Root`, analyses on mount, grouped by game directory           |
| The three items   | `library/components/ModCard/ModCardParts.tsx`                                                                  | `View Details`, `Edit Metadata`, `WAD Footprint`                      |
| Details state     | `library/api/useLibraryContent.ts`                                                                             | Two `useState`s, `detailsMod` and `editMod`                           |
| The drilling      | `UnifiedDndGrid`, `SortableModList`, `SortableModCard`, `FolderRow`, `SortableFolderRow`, `DroppableFolderRow` | `onViewDetails` and `onEditMetadata` threaded through all six         |
| Footprint flag    | `ModCard/useModCardController.ts`, `ModCardGrid`, `ModCardList`                                                | `setWadFootprintOpen` on the view, one dialog root per card           |
| The panel         | `library/components/DocumentsSidebar.tsx`                                                                      | Two tabs, a header naming the open mod, a store holding `modId`       |
| The store         | `library/state/librarySidebar.ts`                                                                              | `open`, `tab`, `modId`, `split`. `showReadme(modId)` is the deep link |

Every textual field the three dialogs draw is already on `InstalledMod`, which the panel receives.
Nothing here needs a backend change.

## 2. What the reader gets

One menu item, **Details**, opening the panel on a tab that answers the whole question:

```
+--------------------------------+--------------------+
| [card]  [card]  [card]         | Details Readme Lic |
|                                |====================|
| [card]  [card]  [card]         | My Mod          x  |
|                                |--------------------|
| [card]  [card]  [card]         |####################|
|                                |#### cover art #####|
| [card]  [card]  [card]         |# My Mod      v1.2 #|
|                                |--------------------|
|                                | Edit  Open location|
|                                |--------------------|
|                                | Author - 4 Sep     |
|                                | Swaps Ahri's base  |
|                                | [champion] [tag]   |
|                                | > Layers      2/3  |
|                                | > WAD footprint    |
|                                | mods/ahri-rework   |
+--------------------------------+--------------------+
```

**The cover is the one thing a reader remembers.** The thumbnail runs full-bleed to the panel's
edges at `aspect-video`, with the mod's name and version knocked over a `bg-linear-to-t
from-scrim` wash at its foot. The dialog drew the same image at 140px in a row of facts; the panel
is a column, and a column's top is the one place a dramatic scale jump costs nothing. It is also
what tells a reader at a glance which mod the panel is holding, without reading the header.

Two type tiers under it and no more: `text-row` for what a section is, `text-meta` for everything
that qualifies it. No section draws a surface of its own - bands parted by a hairline, the shape
`DS-SETTING-LEVEL` already names, because a panel of boxes inside a panel is the wall of boxes the
level exists to replace.

## 3. Design notes worth writing down

**The name over the cover takes `text-brand-on`, not a surface rung.** A scrim over cover art is a
fill that stays mid-toned in both themes while every rung flips underneath it, so `text-surface-100`
would render dark-on-dark in light mode. This is DS-INVARIANT's named case, and `scrim` is the token
documented for exactly "a chip over cover art".

**A mod with no thumbnail keeps the cover.** It falls back to the initial-letter plate the details
dialog already draws, at the cover's size. A panel whose first element appears and disappears per
mod reads as broken rather than as adaptive.

**Editing happens in the tab, not over it.** An **Edit** press swaps the read sections for the
form, in place, with a Save and Cancel band pinned to the panel's foot - the confirm band
`DS-REPORT-PANEL` already describes. The cover stays, because the thumbnail picker is part of the
form and the cover is where a thumbnail is.

**WAD footprint is a fold, and it analyses on first expand.** The dialog got "no work until asked"
for free, because `Dialog.Portal` unmounts its children while closed. A section in a scrolling tab
has no such gate, so the fold is the gate: the component that runs the analysis mounts when the
fold opens. This is the shape the licenses tab's own rows already use.

**Three tabs is the ceiling.** Details, Readme and Licenses fit a 360px strip at the tab's own
`px-4 py-2 text-sm`. A fourth would need either truncation or a scroller, so anything else about a
mod becomes a section of Details rather than a tab.

## 4. Phases

### Phase 1 — The tab and the way in

- `DocumentsTab` gains `"details"`, and it becomes the store's landing tab for a card.
- `showDetails(modId)` beside `showReadme(modId)` in `librarySidebar.ts`.
- `ModCardParts` loses `View Details`, `Edit Metadata` and `WAD Footprint`, and gains one
  `Details` item calling `showDetails`. The `Readme` item stays - it is a deep link to a different
  tab, the same way the toolbar's toggle deep-links to Licenses.
- The tab renders its empty state. No content yet.

Checkpoint: the menu item opens the panel on an empty Details tab, and the three dialogs are
unreachable but still compiled.

### Phase 2 — The read sections

New `DetailsTab.tsx`, taking `mod: InstalledMod | null` exactly as `ReadmeTab` does.

- `Cover` - full-bleed `aspect-video`, name and version over a scrim, letter-plate fallback.
- An action row: `Edit` and `Open Location`, ghost buttons on a hairline.
- Facts: authors and install date, one `text-meta` line.
- Description, when the mod carries one.
- Categories: the tag, champion and map pills, moved over unchanged - they already use `cat-*`.
- Layers: `LayerToggleList` behind a fold, for a mod with more than one.
- The packaging advisory, moved over unchanged.
- Location: the mod directory as mono, selectable.

`ModDetailsDialog`'s body is the source for all of it. Move the pieces, do not rewrite them; the
diff should read as a relocation plus the cover.

Checkpoint: Details answers everything the old dialog did.

### Phase 3 — The footprint fold

- `WadFootprintSection` - the dialog's `WadFootprint` body, minus its `Dialog.*` wrappers, mounted
  by the fold rather than by a portal.
- Grouping (`groupWadsByCategory`, `shortWadName`) moves with it, unchanged.
- Re-analyse stays as a button inside the open fold.

Checkpoint: a library nobody expands runs no analysis, which is the property the portal was buying.

### Phase 4 — Edit in place

- `DetailsEditForm.tsx` - `EditMetadataDialog`'s body, with its `Dialog.Shell` replaced by the
  tab's own column and its footer by the pinned band.
- The suggestions block moves unchanged.
- **The dirty guard.** The panel is not modal, so a reader can press another card mid-edit.
  Opening a different mod while the form is dirty raises `useConfirm`; discarding switches, and
  cancelling leaves the panel where it was. Nothing autosaves - a half-typed name is not a name.
- Saving drops back to the read sections and keeps the panel open on that mod.

Checkpoint: every field the dialog edited is editable in the panel, and an abandoned edit cannot
be lost silently.

### Phase 5 — Delete the dialogs and the drilling

This is the phase the plan exists for.

- Delete `ModDetailsDialog.tsx`, `EditMetadataDialog.tsx`, `ModWadFootprintDialog.tsx`.
- Drop `detailsMod` and `editMod` from `useLibraryContent`, and their render in `LibraryContent`.
- Drop `onViewDetails` and `onEditMetadata` from all six components that thread them.
- Drop `setWadFootprintOpen` and `wadFootprintOpen` from `useModCardController`, and the per-card
  dialog roots in `ModCardGrid` and `ModCardList`.

Checkpoint: `pnpm check` clean, and a card's menu reaches the panel through the store alone.

### Phase 6 — Copy and docs

- Every string the moved bodies carry goes into `messages/en/library.json`. The dialogs predate the
  catalog, so this is the migration-on-touch the frontend guide asks for, and it is the last phase
  because the strings stop moving once the components have.
- `LIBRARY.md` - "The documents panel" gains Details as the first tab, and the feature table gains
  its row. The three dialog rows go.
- A `Changes` row on `LIBRARY.md`.

## 5. What this plan does not do

- **The card's hover actions are untouched.** This moves what a menu opens, not what a card offers.
- **No backend change.** Every field is already on `InstalledMod`, and the WAD report already has
  its own command.
- **The layer popover stays.** `LayerPopover` on the card is a different gesture at a different
  scope, and folding it in would leave a multi-layer mod's switches two presses away.
- **Readme stays its own tab and its own menu item.** A readme is long-form text a reader scrolls;
  a section of Details would bury it under the facts.

## 6. Risks

| Risk                                                        | Answer                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| The form is cramped at the panel's 280px floor              | It is already a vertical form. Test at the floor before Phase 4 closes |
| An edit lost to a stray card press                          | The dirty guard in Phase 4, and Save is never implicit                 |
| The cover pushes the facts below the fold on a short window | The cover scrolls with the column rather than pinning                  |
| Three tabs crowd a narrow panel                             | Measured at 360px in Phase 1, before any content is written            |
