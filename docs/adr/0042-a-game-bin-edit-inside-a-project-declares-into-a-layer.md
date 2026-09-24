# ADR-0042: A game bin edit inside a project declares into a layer

- **Status:** Accepted. Adding and removing an object is superseded by
  [ADR-0049](0049-a-declared-document-creates-and-removes-objects-through-a-target-module.md)
- **Date:** 2026-09-19
- **Crates:** `ltk-manager-core`, `src-tauri`, frontend
- **Related:** [ADR-0012](0012-the-overlay-merges-a-mod-over-the-games-copy.md), whose merge this
  moves from a whole chunk to one key. [ADR-0040](0040-a-bin-save-writes-the-edited-objects-over-the-bytes-it-opened.md),
  whose rule that a `GameChunk` document takes no patch stands. [ADR-0027](0027-a-node-is-addressed-by-the-games-property-path.md)
  for the path. League-mod ADR-0020 (value rendering), ADR-0021 (game-copy references) and
  `docs/design/game-data.md` sections 3 to 6.

## Context and problem statement

A layer's `game_data.yaml` holds declarations: property edits on named entries, applied over the
game's copy of a chunk while the overlay is built. A mod that declares its edits ships no copy of
the chunk, and Riot's later changes to every key it does not name survive.

A declaration written by hand needs four things: the entry's name, the property path, the value's
spelling, and its type. The bin editor draws all four for a game bin. The document is read-only
(`ReadOnly::Install`), and the manager reads and writes no `game_data.*` file. The only text
editor is `TextBuffer`, a textarea.

The overlay applies declarations with `ltk_game_data::apply` and `PatchSchema`. `apply` is pure
over bytes and returns the diagnostics a build would report.

Authors write `game_data.yaml` by hand as well, with comments, block and dotted forms, and tags.

## Considered options

1. **Declare in place.** A game bin inside a project takes the bin editor's edits, and each edit
   lands as a declaration.
2. **Copy from the row menu.** A read-only game bin offers "Copy as declaration" and "Add to
   declarations". No preview of the result.
3. **A declarations text editor.** `game_data.yaml` as a document with completion for entries,
   paths and types, and apply diagnostics inline. Needs a code editor the frontend lacks.
4. **Convert whole bins.** Diff a layer's full bins against the game's copies into declarations.
   Converts existing mods and authors nothing new.

## Decision

**A game bin opened from a project's game tree is editable, and every edit is a property edit in
one layer's declarations.** A chip in the toolbar names the layer, the last one used or `base`.
The same chunk opened outside a project stays read-only.

**The document draws the game's copy with the project's declarations applied.** Every layer's
declarations apply in build order through `ltk_game_data::apply`, `PatchSchema` and the overlay's
reference reading. A row an edit of the chosen layer touches carries a declared mark, and each
apply diagnostic draws on the row it names.

**An edit lands under an `entries` module.** The entry is spelled by its name from the hashtables,
else its hex hash.

**The manager edits `game_data.yaml` in place, through a lossless syntax tree.** An edit to a
path some `entries` module already sets, in dotted or block form, replaces that value where it
stands. A new key joins the last `entries` module naming the entry, else a new trailing module.
[ADR-0048](0048-a-declared-edit-joins-the-module-the-reader-chose.md) supersedes where a new key
goes, and keeps this rule as its Automatic choice. A hand-written `target` module is edited only where the key already exists. Comments, order and
the spelling of every other key are kept. An undo restores the text before the edit. A write
compares the file on disk with the text the document read and refuses on a difference.

**An edit no key-level declaration expresses sets the whole value, and the row says so.** A move
and a mid-list insert write the whole list. Removing a property, adding or removing an object, and
any edit on a path through a nameless field are disabled, with the reason on the row.

**Values render through `ltk_game_data`, and references follow league-mod ADR-0021.** The row menu
copies a declaration and a reference from any bin, and a declared document pastes a reference as a
set or merges it as an addition.

## Consequences

- **Positive:** an edit reads as the line an author would write, and the mod ships no copy of the
  chunk. ADR-0012's merge happens per key instead of per chunk.
- **Positive:** the document shows what the build makes, from the same function and the same
  schema.
- **Negative:** the manager becomes a second writer of a file authors edit by hand, on a new YAML
  dependency. A construct the syntax tree cannot edit refuses the edit.
- **Negative:** a positional edit, `list[i].field` or `-list: [i]`, lands on a different element
  once Riot inserts ahead of `i`, and nothing reports the shift.
- **Negative:** a whole-list fallback freezes that list at the value of the day it was written.
- **Negative:** no declaration removes a property or an object.
- **Negative:** every edit re-applies the project's declarations to the chunk. The cost per edit
  is unmeasured.
- **Neutral:** ADR-0040 holds. The game's tree takes no patch, and the declarations are what the
  document edits.
