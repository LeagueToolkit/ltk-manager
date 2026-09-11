# ADR-0037: The run is the shell's, and the timeline is a pane of it

- **Status:** Accepted (2026-09-11)
- **Date:** 2026-09-11
- **Crates:** none. The run is frontend, and Rust holds no clock
- **Related:** Amends [ADR-0036](0036-a-shells-panes-are-its-layouts-own.md), whose `vfx` pane set
  gains `timeline` and whose default `vfx` tree changes, and
  [ADR-0031](0031-a-layout-declares-the-frame-it-draws-in.md), whose shell drew the emitter strip
  as its first pane. [ADR-0034](0034-the-shells-panes-are-the-editors-split-tree.md), whose tree
  takes the pane as one id. Decisions 2.5, 2.6 and 2.46 of `docs/plans/vfx-particle-renderer.md`
  hold the simulation the run drives. The rule is stated in "The timeline" in
  `docs/ux/BIN_EDITOR.md`.

## Context and problem statement

The transport is a row under the viewport, inside the preview pane. `VfxViewport` holds the
driver, the seed, the rig, the speed, the solo switch and the playhead as component state. A tab
switch unmounts the viewport, and the run starts again at seed 1337. A closed preview pane takes
the transport with it.

The transport is one slider over the run's span, and it names no emitter. An emitter's emission
window, its particles' life and the linger past a stop are fields in the inspector, one emitter at
a time. A layered effect is judged by how its emitters line up in time, and no surface draws that.

The emitter strip spends a 160 px card with a 100 px square on each emitter. Three cards fit across
the emitters column, and a system of thirty emitters is ten rows of them.

The open question was whether the timing view grows inside the preview pane, or stands as a pane of
its own with the run lifted out of the viewport.

## Decision

**The timeline is a fifth pane of the particle shell.** `timeline` joins `emitters`, `curve`,
`inspector` and `preview` in the `vfx` pane set. It holds the transport row and one lane per
emitter under one playhead.

**The run is the shell's.** One run per object tab sits above the panes: the driver, the playhead,
playing, the speed, the seed, the rig, mute and solo, and the loop range. The preview and the
timeline both read it. A frame loop the shell owns advances the clock, and the canvas draws the
step the run has reached. A closed preview stops no clock.

**A run outlives its tab for the session.** The seed, the rig, the speed, mute and solo, the loop
range and the playhead are kept in memory per system, keyed on the document and the entry. A tab
that opens a kept system seeks to its playhead. A restart drops them. The display preferences -
Ground, Midlane, Gizmo, Stats, the camera preset and the inspector's Defaults switch - persist
app-wide, beside `previewCheckered`.

**The lanes are the emitter list of the default arrangement.** The default `vfx` tree is the
preview and the inspector over the timeline and the curve. The Emitters pane leaves it and stays in
the Panes menu, its Cards and Table unchanged.

**The preview carries a mini transport while no timeline shows.** Play, a scrub and the time draw
under the viewport with the timeline pane closed or the preview maximized, and at no other time.

## Consequences

- **Positive:** a layered effect's timing reads at a glance, one emitter a row, against one
  playhead.
- **Positive:** a tab switch keeps the run. The seed, the rig and the playhead come back with the
  tab.
- **Positive:** the preview and the timeline arrange apart, as every other pane does.
- **Negative:** the clock leaves `useFrame`. The canvas draws a run it does not advance, and a frame
  can draw one step behind the shell's loop.
- **Negative:** a saved `vfx` tree holds no `timeline` leaf. A project that saved one opens without
  the pane, and the Panes menu or Reset layout adds it. An older build drops the leaf it does not
  know.
- **Negative:** two surfaces address an emitter, its lane and its card, and one selection drives
  both.
- **Neutral:** the skin shell keeps its clock and its transport under the viewport. It takes the
  keys, the camera menu and the speed detents, and no timeline.
