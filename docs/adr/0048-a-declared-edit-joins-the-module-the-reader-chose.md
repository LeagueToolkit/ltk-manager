# ADR-0048: A declared edit joins the module the reader chose

- **Status:** Accepted, the new-module paragraph superseded by
  [ADR-0054](0054-a-module-is-made-empty-and-organized-in-the-outline.md)
- **Date:** 2026-09-24
- **Crates:** `ltk-declarations`, `ltk-manager-core`, `src-tauri`, frontend
- **Related:** Supersedes the placement paragraph of
  [ADR-0042](0042-a-game-bin-edit-inside-a-project-declares-into-a-layer.md), "The manager edits
  `game_data.yaml` in place", as far as where a new key goes. League-mod #276 (module names).

## Context and problem statement

A layer's `game_data.yaml` is a list of modules, applied in order. ADR-0042 placed a new key in
the last `entries` module naming the entry, else in a new trailing module. An author who groups
their declarations, one module for a skin's look and another for its particles, had no say in
where an edit landed and had to move the lines by hand.

`ltk_game_data` now reads an optional `name` on a manifest module item. A name carries no meaning
for loading or applying, need not be unique, and is refused when empty. A module holds at least
one entry, so an empty `entries: {}` does not load.

## Considered options

1. **Keep the placement rule** and leave grouping to a text editor.
2. **A chosen module per project**, beside the chosen layer, with module actions over the
   manifest's text.
3. **A module per edit**, asked for on every edit.

## Decision

**The chosen module is a third part of where an edit lands, after the project and the layer.**
It is stored per project in `.ltk/editor.json` as `selectedModule`, beside `selectedLayer`, and a
toolbar chip next to the layer chip shows and changes it. Automatic keeps ADR-0042's rule.

**A new key joins the chosen module.** It goes in the deepest block of the entry's body there,
else in a new body for the entry. A key some module already declares is still edited where it
stands, and the edit reports the index of the module holding it. A `target` module is never
chosen.

**A new module is made by the edit that fills it.** Choosing New module with a name holds the
name until the next edit, which appends the module with `name` as its first key and the key under
`entries`. From then on the choice is that module's index. No action creates an empty module,
because none loads.

**Module actions are whole-line splices of the manifest's text.** Rename sets, replaces or clears
`name`. Remove takes a module and the comment lines directly above it. Move reorders a module
with those comment lines. Move keys carries every signed key of one property path of one entry,
or the entry's whole body, to another `entries` module, and a module the move empties goes, its
name with it. Each action is refused where its result does not load through
`ltk_game_data::load_declarations`, and a bin document records it as an edit its undo reverts.
The actions take a layer and module indices, so a view of the manifest itself calls the same
commands.

**A declared mark names its module.** The row's tooltip gives the module's name, else its place,
`Module 2`, and the row menu moves the row's keys to another module.

## Consequences

- **Positive:** an edit lands in the group the author keeps it in. A moved entry keeps the
  comments beside its keys.
- **Positive:** undo stays a pair of manifest texts, the same as for every other declared edit.
- **Negative:** a module is named by its index. A hand edit that reorders the modules while a
  choice is held moves the choice to another module, and an index past the end reads as
  Automatic.
- **Negative:** a named module whose last key is dropped goes with its name, because an empty
  module does not load.
- **Negative:** a moved property path drops the comment on its key's line.
- **Neutral:** a key moved out of a block is written dotted in its new module.
