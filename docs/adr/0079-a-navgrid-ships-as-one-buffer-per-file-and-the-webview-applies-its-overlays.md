# ADR-0079: A navgrid ships as one buffer per file, and the webview applies its overlays

- **Status:** Proposed (2026-11-04)
- **Date:** 2026-11-04
- **Crates:** `ltk-manager-assets`, in `preview/navgrid`, and `ltk-manager-game`, in `map/navgrid`
- **Related:** [ADR-0044](0044-a-map-backdrop-ships-in-one-buffer.md), whose `ltk-asset` buffer
  forms this one joins. [ADR-0068](0068-a-read-resolves-a-linked-object-in-the-backend.md), which
  resolves the `NavGridConfig` and overlay links. `docs/plans/navgrid-guides.md`, the design.

## Context and problem statement

The map editor draws the server's navigation grid as a guide (docs/ux/MAP_EDITOR.md, "Guides").
A map names one grid and a list of overlays. An overlay is a pair of files: rectangles of cell
flags and rectangles of region tags. The grid of a map state is the base grid with the overlays of
that state written over it, each value replacing the whole word of its cell.

On Summoner's Rift the grid file is 9,361,843 bytes. 3,243,600 bytes of it are a hint grid and
3,842,080 bytes are the pathfinding fields of the 48-byte cell record. The client skips both. The 8 overlays hold
18,302 values together. The map state changes while the shell is open, from the Visibility pane
and from the Guides menu.

`ltk_navgrid` 0.1.0 reads all three formats and applies an overlay to a grid.

## Decision

**Each navgrid file is one buffer on the `ltk-asset` scheme, under the `navgrid` form.** A
`.aimesh_ngrid` returns `LTKN`, the cell flags, region tags, cell heights and height samples,
without the pathfinding record or the hint grid. A `.ngrid_overlay` or `.rg_overlay` returns
`LTKO`, its rectangles. The layouts are in `docs/plans/navgrid-guides.md` section 4.

**The webview composes the grid of the shown map state.** It keeps the base grid's arrays, copies
the flag and region tag arrays, and writes the overlays that are on into the copy, in the order of
the overlay list. For each overlay the flag file applies first and the region file second. A value
outside the grid is skipped. This is the rule of `NavGrid::apply_overlay` and
`NavGrid::apply_region_overlay` in `ltk_navgrid` 0.1.0.

**The backend composes the grid for a check.** `map_conformance` applies the same overlays with
`ltk_navgrid` and reads the composed grid.

### Considered options

1. **One buffer per file, the webview applies the overlays.** Chosen.
2. **One buffer per map state, the backend applies the overlays.** A request names the grid and
   the overlays that are on, and the backend returns the composed `LTKN`.
3. **Both the grid and the overlays in the map model, as JSON.** The `read_map` command returns
   the cells with the rest of `MapModel`.

Option 2 keeps one implementation of the overlay rule. It refetches 2.3 MB for every state
change, and its request carries several assets, while an `ltk-asset` URL carries one `AssetRef`.
Option 3 sends 87,320 cells and 350,463 height samples as JSON numbers on every map read,
including reads that draw no guide.

## Consequences

**The overlay rule has two implementations.** `applyOverlays` in
`src/modules/viewport/assets/parsing/navGridBuffer.ts` and `ltk_navgrid` follow the same rule. The
TypeScript tests use the cases of the crate's tests: a rectangle partly outside the grid, an
incomplete row, and two overlapping rectangles.

**A state change costs no fetch.** It copies two arrays of 87,320 values, writes at most 18,302
values, and writes the cell texture of the guide.

**The wire cost is a quarter of the file.** 2,275,656 bytes for a Summoner's Rift grid, once per
grid. The largest overlay file of Map11 is 47,498 bytes.

**The buffer leaves out what the client skips.** A tool that needs the pathfinding record or the
hint grid reads the file with `ltk_navgrid`, not the buffer.

**Adding data later is a version bump.** `LTKN` has no flags word. A new block, such as a second
grid of a map, is `LTKN` v2.
