# ADR-0030: A class view is a layout over the rows

- **Status:** Accepted (2026-09-07)
- **Date:** 2026-09-07
- **Crates:** `ltk-manager-core`, `src-tauri`
- **Related:** [ADR-0026](0026-a-saved-bin-is-written-from-the-tree-the-backend-holds.md),
  whose rows a view draws and whose tree never crosses. [ADR-0027](0027-a-node-is-addressed-by-the-games-property-path.md),
  whose address every cell of a view carries. [ADR-0028](0028-an-object-is-a-document-of-its-own.md),
  whose object tab a view is a mode of. The rule is stated in "Class views" in
  `docs/ux/BIN_EDITOR.md`. The evidence is `docs/research/bin-editor-higher-order-views.md`.

## Context and problem statement

The generic tree draws every class the same way: a row per property, a kind after the name, a
value in its widget. A material is fourteen properties, and the four a texture modder opens it
for are two lists and a map, three levels down. A skin is a hub of links and paths. A particle
system is a list of emitters of 139 fields each, and the colour a VFX modder reads is three nodes
under a struct row that shows a class name and a count.

Riot's editor sits on a data server that "abstracts away all of the file and data management for
other tools, so those tools can focus on delivering the desired viewing and editing experience".
Its animation editor is a table and a set of tabs over one object, with the generic object tree
as a sibling tab. The bin editor holds the tree in the backend, addresses every node by path and
opens an object as a document. What it lacks is a second way to draw the same rows.

Where the knowledge of what a `StaticMaterialDef` is should live, and whether a bespoke view
hides, reorders or replaces the tree, were the open questions.

## Decision

**A class view is a declarative layout over the rows the backend already sends, drawn as a mode
of the object tab beside the generic tree.** The tree stays underneath, as the Properties mode.
Rust knows no class.

A layout is registered on the class hash, with each subclass listed by hand because the schema
carries no inheritance. It names its fields by name, hashed at load with the game's FNV-1a. It
places every depth-zero field of the object in a section, with a purpose-built widget where one
exists and the row's own widget elsewhere. A field the layout does not name falls into an Other
section drawn by the tree rooted at it. An empty section keeps its header. The view is complete,
and Properties is the same data in tree form.

Every cell is a path and a value, the pair a row carries, so an edit through a view is the patch
a row would send. A cell's menu is the row's menu, plus Show in properties, which switches the
mode and reveals the row.

**One new command answers several nodes in one call.** `bin_read(document, entry, paths)`
returns the children of each path, a page per path and four pages per call, and errors past
that. It stays inside ADR-0026: rows cross, the tree does not. A layout batches its paths under
the cap.

**A string that names a thing is a link.** A string with an `ASSETS/` or `DATA/` prefix and an
extension resolves through the WAD path resolver and draws the chip a `file` draws. Any string is
hashed into the row group's object check and draws the object chip on a hit. A miss draws text.

**A value family draws its constant on its own row.** A `ValueColor` row draws its class, a
swatch and a gradient strip, read per visible page through `bin_read` on scroll settle.
`ValueFloat`, `ValueVector2` and `ValueVector3` draw the constant. This is a rule on the class
and the field, in the generic tree, and not a class view.

## Consequences

- **Positive:** a layout is data. Adding a class, moving a field between sections or renaming a
  section is an edit to one file, with no Rust change and no bindings regeneration.
- **Positive:** the material and skin layouts read the rows the open already answered, and a
  layout over thirty emitters costs two calls rather than three hundred.
- **Positive:** a string path resolves in every bin at once, in the tree and in every view.
- **Negative:** a layout is a whitelist of placements over a schema that changes per patch. The
  Other section is what keeps a new field visible, and a field the layout names and the object
  lacks draws nothing.
- **Negative:** the frontend carries an FNV-1a that has to agree with the backend's. A test over
  known pairs is the guard.
- **Negative:** a per-page `bin_read` costs a call per level on a bin holding colour rows, three
  of them for a `ValueColor`, on each scroll settle.
- **Neutral:** the renderer, and the mesh preview a skin view would carry, are not decided here.
  The skin layout leaves a slot, and the renderer is its own ADR.
- **Neutral:** issue 55's lints are Problems rules, and reverse references wait on the walk.
  Neither is a view's concern.
