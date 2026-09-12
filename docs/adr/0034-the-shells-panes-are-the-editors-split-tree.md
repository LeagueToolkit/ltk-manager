# ADR-0034: The shell's panes are the editor's split tree

- **Status:** Accepted (2026-09-08)
- **Date:** 2026-09-08
- **Crates:** none. A pane is frontend, and Rust knows no frame
- **Related:** Amended by [ADR-0036](0036-a-shells-panes-are-its-layouts-own.md), which gives
  each shelled layout a pane set and a tree of its own. Amends
  [ADR-0031](0031-a-layout-declares-the-frame-it-draws-in.md), whose shell
  fixed the four panes in two columns and whose pane sizes were to be remembered on the class
  hash. [ADR-0032](0032-a-curve-draws-in-a-dock-under-the-object-tab.md), whose curve surface is
  one of the panes. The panel layout the editor grid already runs on is
  `docs/plans/editor-split-tree.md`. The rule is stated in "The shell" in `docs/ux/BIN_EDITOR.md`.

## Context and problem statement

ADR-0031 puts four panes on screen at once: the emitter strip, the curve, the inspector and the
preview. Their places are written into the frame - a two-column grid, the strip over the curve on
the left, the inspector over the preview on the right - and the only thing a reader was to be
given was the sizes.

A tuning loop does not have one shape. A modder judging colour wants the curve wide and the
inspector narrow. One reading sixty emitters wants the strip to take the window and the curve out
of the way. One waiting on the renderer wants no preview at all. Every one of those is a different
arrangement of the same four panes, and a fixed grid answers none of them.

The editor grid solved this once already. A document tab drags onto the edge of a panel and splits
it, onto another panel and moves there, and a seam between two panels resizes them. That tree is
generic over ids: `LayoutNode`, `resolveDrop`, `SplitLayout` and `LeafDropZones` name a leaf, a
tab and an edge, and none of them knows what a document is.

The open question was whether the shell grows an arrangement model of its own, or borrows that
one.

## Decision

**A shell pane is a tab of the editor's own split tree.** `emitters`, `curve`, `inspector` and
`preview` are four ids, a leaf's `tabs` holds them, and every tree operation the editor grid uses
applies unchanged. Two panes dropped on one another share a strip, a pane dropped on an edge
splits the panel, and a seam resizes.

**The tree is the project's, not the class's or the tab's.** One arrangement per project, so a
modder arranges the panes once and every particle system they open opens arranged that way. This
replaces ADR-0031's per-class pane sizes, which never shipped.

**It persists in `.ltk/editor.json`, beside the document tree.** Two additive fields on the file
the editor already writes, which is why the file's version does not move.

**A pane closes from its own tab and comes back from the Panes menu**, which the breadcrumb row
carries along with Reset layout. A pane the tree does not hold is not mounted, so a closed preview
costs nothing.

**The stack frame is untouched.** Below the width the shell needs, the same layout still draws as
one scrolling column with the curve in its dock, and no tree is consulted.

## Consequences

- **Positive:** one panel model in the app. A fix to the drag, the drop preview or the seam
  reaches both the editor grid and the shell.
- **Positive:** the arrangements a fixed grid could not offer - a full-width strip, no preview, the
  curve beside the inspector - are all reachable without another frame.
- **Positive:** a fifth pane is one id and one entry in the registry. The renderer lands as a pane
  rather than as a change to the frame.
- **Negative:** a second `DndContext` mounts inside the editor grid's, one per open object tab.
  Panes register only with the inner one, but the nesting is real and a drag bug can now come from
  either.
- **Negative:** an arrangement a reader saved can hide a pane they later look for, so the Panes
  menu is the only way back and has to stay reachable.
- **Neutral:** the pane titles are the strip's, so a surface that named itself under ADR-0031 -
  the curve - stops doing so in a pane and keeps doing so in the dock.
