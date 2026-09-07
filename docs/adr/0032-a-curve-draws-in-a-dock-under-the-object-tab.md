# ADR-0032: A curve draws in a dock under the object tab

- **Status:** Accepted (2026-09-08)
- **Date:** 2026-09-08
- **Crates:** none. A curve is four fields the projected read already answers, and Rust knows
  no value family
- **Related:** [ADR-0028](0028-an-object-is-a-document-of-its-own.md), whose object tab holds the
  dock. [ADR-0030](0030-a-class-view-is-a-layout-over-the-rows.md), whose layouts draw the marks
  that target it. [ADR-0031](0031-a-layout-declares-the-frame-it-draws-in.md), whose shell gives
  the same surface a second host. The rule is stated in "The curve panel" in
  `docs/ux/BIN_EDITOR.md`. The evidence is `docs/research/bin-editor-curve-panel.md`.

## Context and problem statement

`ValueColor`, `ValueFloat`, `ValueVector2` and `ValueVector3` are one shape: a `constantValue`,
and a `dynamics` pointer that is null on a value which does not animate. A row draws the constant,
and a mark where the dynamics points at a curve. What that curve holds is on no surface. A reader
who wants to know how an emitter's `rate` moves over a particle's life opens Properties and reads
two lists of floats beside each other, pairing them by index in their head.

The four `VfxAnimated*` classes behind the pointer share three field hashes, and their `values`
list is the family's width: one float for a scalar, four for a colour. One widget over
`(times, values[channel])` therefore reads every family, and a colour's gradient strip is that
widget already, rendered as a band rather than as lines.

The open questions were where such a widget draws, what targets it, and what it costs to read.

## Decision

**A curve draws in a dock under the object tab.** The dock is collapsed until a mark targets it
and open from then on for the life of the tab. Both of Riot's editors dock rather than pop over,
and a popover closes on the first click into another cell, which is the click a reader tuning a
value makes most.

**The dock holds its target until another mark replaces it,** so a reader walks the emitter strip
comparing every emitter's numbers against one open curve.

**It carries three tabs: Graph, Probability and Table.** Graph plots the keys. Table is the keys
as rows, which is the form an edit will take. Probability is `probabilityTables` for the channel
the graph's chips chose, with `singleValue` drawn in place of a plot where a table holds no keys.

**Its caption is the label chain, with the wire path on a line under it.** The chain is what the
reader clicked. The path is what a bug report needs.

**The time axis fits the curve's own first and last key,** because a file holds key times outside
the 0 to 1 both of Riot's editors plot.

**A vector draws a line per channel, X red, Y green and Z blue as Riot draws them,** with chips
that mute one. A colour draws its gradient band over the same axis with each stop marked, and the
channel lines behind it only when a chip asks.

**The emitter panel's own rows draw a sparkline, and every other surface keeps the mark.** Two
more read levels for the eight rows a group shows is bounded. The same rule over the emitter
table's four value columns is 240 curves on one screen.

**A value with no dynamics draws no mark, and its row menu offers no curve.** Adding one is a
write that sets a null pointer to a class, which nothing in the editor does yet.

**There is one dock in the app.** A mark on a bin file tab's row opens the object tab with the
dock already targeted, the way Show in properties switches the mode.

## Consequences

- **Positive:** one widget serves four families, because the four `VfxAnimated*` classes share
  their field hashes and differ only in how wide a key is.
- **Positive:** the colour strip a row already draws becomes a reading of the same keys rather
  than a second read of its own.
- **Positive:** the dock's target outliving the click is what makes a strip walkable, which is
  the tuning loop the class view exists for.
- **Negative:** the surface has two hosts. In a stack and in Properties it is the dock, absent
  until targeted. In the shell of ADR-0031 it is a pane that holds its place, because a pane
  appearing on a click moves every pane around it.
- **Negative:** the sparkline's two extra read levels have to be asked for per surface rather
  than per family, so a surface that draws many rows at once must say it wants only the mark.
- **Neutral:** Probability is undocumented. The tab draws the lists it finds and claims nothing
  about what the game samples from them.
- **Neutral:** no plotting library. The axis ticks are fixed and the value axis fits its own
  keys, which is arithmetic rather than a dependency.
