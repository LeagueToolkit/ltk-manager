# ADR-0050: A declared document adds and removes dependencies through link lists

- **Status:** Accepted (2026-09-24)
- **Date:** 2026-09-24
- **Crates:** `ltk-declarations`, `ltk-manager-core`
- **Related:** [ADR-0042](0042-a-game-bin-edit-inside-a-project-declares-into-a-layer.md),
  [ADR-0049](0049-a-declared-document-creates-and-removes-objects-through-a-target-module.md),
  [ADR-0040](0040-a-bin-save-writes-the-edited-objects-over-the-bytes-it-opened.md). League-mod
  `docs/design/game-data.md` sections 4 and 6.

## Context and problem statement

A `PROP` bin's header lists the files it depends on, and the bin editor draws that list as rows
pinned over the objects. A layer bin saves a changed list through `BinDelta::set_dependencies`.
A game bin opened inside a project takes its edits as declarations of one layer, and no
declaration of ADR-0042 or ADR-0049 changes the list.

League-mod's binding body takes `links` (alias `+links`) and `-links`. An edit removes its
`-links` paths, without regard to ASCII case, then appends each `links` path the list does not
name. No binding reorders the list or renames an item in place.

## Decision

**A dependency edit writes an item of a `links` or `-links` list of a `target` module of the
document's chunk.** It joins the last `target` module of the chunk, else a new trailing module,
as an object edit does. The chunk is spelled as ADR-0049 spells it.

**An edit takes back the layer's own opposite item before it writes one.** A removal of a path
the layer's `links` names drops that item, and an addition of a path the layer's `-links` names
drops that one. Restore on a removed dependency is that drop.

**Each plan is checked by applying again**, and the list has to hold the path, or lack it. A
second write on top of the first is tried once, for a path the game also holds. A plan that does
not land is taken back, and undo restores the manifest text.

**A declared document adds at the end and removes, and nothing else.** Rename, move and an
insert before the end are refused as undeclarable. A dependency the layer removes keeps its row,
struck through, after the list.

## Consequences

- **Positive:** a mod links its own bin into a game chunk with no copy of the chunk.
- **Positive:** removing a link the layer added leaves no trace in the manifest.
- **Negative:** an `entries` module's `links` reach every declaring chunk, and a removal written
  here runs before a later module adds the path again. The check refuses that edit.
- **Neutral:** a layer bin keeps full control of the list, order and spelling included.
