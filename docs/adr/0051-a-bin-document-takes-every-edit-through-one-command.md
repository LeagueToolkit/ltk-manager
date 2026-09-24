# ADR-0051: A bin document takes every edit through one command

- **Status:** Accepted (2026-09-24)
- **Date:** 2026-09-24
- **Crates:** `src-tauri`, `ltk-manager-core`
- **Related:** [ADR-0029](0029-the-generated-bindings-describe-the-wire-format-they-do-not-change-it.md),
  which moves the bin editor's commands onto `tauri-specta`.
  [ADR-0026](0026-a-saved-bin-is-written-from-the-tree-the-backend-holds.md) and
  [ADR-0027](0027-a-node-is-addressed-by-the-games-property-path.md) fix the store and
  the address an edit carries.

## Context and problem statement

A command per edit of an open document is a command per store method: a leaf, a property, an
item, a key, a pointer, an object, a dependency, a declared reference and a module action. That
is twenty-two commands beside the reads, and a wrapper for each in `src/lib/tauri.ts`. Each one
calls one store method, and every store method runs behind the same gate, `BinDocuments::edit`.
The add lines' three reads of what a holder can take have the same shape.

## Decision

**`bin_edit(document, edit)` applies every edit of an open document.** `BinEdit` is one variant
per store method, tagged on `kind`, with the object and dependency edits as nested enums of their
own. `BinDocuments::apply` in core routes a variant to its store method, so the gate and the
errors are the store's. The answer is `EditOutcome`, whose variant is fixed by the edit: the value
a patched leaf held, a created object's hash, an item's path, a dependency's index, the declared
state after a module action, or nothing.

**`bin_choices(document, query)` answers what an add line offers.** `ChoiceQuery` names the
addable fields, the object classes or the item classes, and `Choices` carries fields or classes.

The document's lifetime, its reads, undo, redo and the declaring switches keep a command each.

## Consequences

- **Positive:** a new edit is a variant and a match arm, and the command table does not grow.
- **Positive:** one test in core holds every variant behind the gate.
- **Negative:** a call site narrows the outcome to the variant its edit answers, which the type
  system does not tie to the edit. `expectKind` in the frontend throws on a mismatch.
- **Neutral:** the store methods stay as they are, so core tests keep calling them directly.
