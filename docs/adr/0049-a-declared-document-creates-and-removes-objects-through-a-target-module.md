# ADR-0049: A declared document creates and removes objects through a target module

- **Status:** Accepted (2026-09-24)
- **Date:** 2026-09-24
- **Crates:** `ltk-declarations`, `ltk-manager-core`
- **Related:** Supersedes the object half of [ADR-0042](0042-a-game-bin-edit-inside-a-project-declares-into-a-layer.md),
  which disabled adding and removing an object. League-mod ADR-0029 (object bindings), ADR-0030
  (own-path rewrite) and `docs/design/game-data.md` sections 4 and 6.

## Context and problem statement

ADR-0042 disabled adding and removing an object in a declared document, because no declaration
expressed either. League-mod ADR-0029 adds an `objects` binding to a `target` body: an entry is
`clone` of an entry of the chunk or `class`, each beside an optional `set` entry body, or
`remove: true`. A batch creates its objects after its override files and removes them after its
entry edits. A clone reads its source as the batch starts.

An `entries` module reaches an entry through the object index, which lists the game's objects
only. A key under `entries` for an object a mod creates resolves to nothing.

## Decision

**An object edit writes an `objects` entry of a `target` module of the document's chunk.** The
writer replaces the body of the last `objects` entry naming the object. A new entry joins the
last `target` module of the chunk, else a new trailing module. A clone joins only the trailing
module, and only where that module declares nothing for its source, so the clone reads the
source as the document shows it. The chunk is spelled by its path from the tables, else by its
hash.

**A new object is a clone or a construction, named by the author.** A copy of an object the
document holds is `clone`, and a new object of a class is `class` with no `set`. A name the
chunk or the game's copy holds is refused. The game-data reference suggests `Mods/<mod id>/` as
a prefix, and nothing enforces it.

**A key of an object the layer creates joins the `set` of its creation**, and every other key
stays under `entries` as ADR-0042 decided.

**An object row offers Duplicate as new object and Remove object, and the toolbar `+ Object`.**
A new object is named on a line after the file's objects, never in a dialog, and its name
starts as `Mods/<mod>/<source or class>`. A removed object keeps its row, struck through, and
its menu offers Restore object, which drops the `remove: true`. "Declaring from a game bin" in
`docs/ux/BIN_EDITOR.md` states the rows and the keys.

**A removal drops the layer's own creation, else writes `remove: true`.** Each plan is checked
as a property edit's is: the declarations apply again, and the object has to be present as the
edit made it, or absent. A plan that does not is taken back, and undo restores the manifest text
as for every declared edit.

## Consequences

- **Positive:** a mod adds a particle, a resolver or a skin variant with no override file and no
  copy of the chunk.
- **Positive:** removing an object the layer created leaves no trace in the manifest.
- **Negative:** a clone written beside a later edit of its source copies the source as that
  module finds it. A later edit of the source under an earlier module reaches the clone too.
- **Negative:** a key of an object a lower layer creates is written under `entries`, which does
  not reach it, and the check refuses the edit.
- **Neutral:** removing a property is still disabled. ADR-0042 holds for it.
