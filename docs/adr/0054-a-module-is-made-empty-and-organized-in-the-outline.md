# ADR-0054: A module is made empty and organized in the outline

- **Status:** Accepted
- **Date:** 2026-09-25
- **Crates:** `ltk-declarations`, `ltk-manager-core`, frontend
- **Related:** Supersedes the "A new module is made by the edit that fills it" paragraph of
  [ADR-0048](0048-a-declared-edit-joins-the-module-the-reader-chose.md), and its negative
  consequence that a named module whose last key goes goes with its name. League-mod ADR-0034
  (an empty `entries` module loads).

## Context and problem statement

ADR-0048 gave modules names and actions, but a module could only be made by the declared edit
that filled it, because an `entries` module with no entry did not load. The outline of a layer's
`game_data.yaml` had no way to add a module, and a move that took a module's last entry removed
the module with its name. A mod author organizing declarations makes the groups first and fills
them after.

League-mod ADR-0034 lets an empty `entries` module load and apply nothing.

## Considered options

1. **Write an empty module when it is named**, and keep a named module a move or a drop empties.
2. **Hold a named module in editor state** until an edit or a move fills it.
3. **Make a module only by moving keys into it.**

## Decision

**New module writes `entries: {}` at the end of `modules`, unnamed, and the outline types its
name in place.** `ModuleAction::Create` is the action and `Manifest::create_module` the text
edit. A layer with no manifest gains one holding that module.

**A named `entries` module a drop or a move empties stays, holding `entries: {}`.** An unnamed
one still goes, so a declared edit that removes the last key of a module the edits made leaves
nothing behind. A `target` module an edit empties goes as before, since an empty `edits` does
not load.

**The outline organizes modules in place.** A module drags to a new place in the apply order,
and an entry or a key of an `entries` module drags into another one. Move to module ends with
New module, which makes a module and moves the keys into it. The module rows carry Move up and
Move down beside their kebab, and a New module line ends each layer.

## Consequences

- **Positive:** an author makes, names and orders modules before filling them, and a module
  keeps its name through every move.
- **Positive:** the manifest on disk is what the outline shows at every step.
- **Negative:** a manifest holding an empty module does not load in a build of LTK Manager or
  league-mod older than league-mod ADR-0034.
- **Negative:** an action that makes a module and moves keys into it is two writes, each its own
  step.
- **Neutral:** whether an emptied module stays depends on its name, which a reader of the
  manifest sees and a reader of the outline sees as the module's title.
