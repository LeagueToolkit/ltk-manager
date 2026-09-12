# The readme already ships, and nothing in the workshop writes it

A mod project holds a `README.md`, both pack formats carry it into the package, and both
imports restore it. Between the moment a project is created and the moment it is packed, no
surface in the manager reads that file or writes it.

This note carries the facts behind the readme document, a source per point, and the decisions
that were taken over the alternatives they were taken over. The design itself is the "The
readme" section of `docs/ux/PROJECT_EDITOR.md`.

## Sources

- `crates/ltk-manager-core/src/workshop/projects.rs`, project creation
- `ltk_mod_project` 0.9.2: `pack/plan.rs`, `modpkg/format.rs`, `fantome/pack.rs`,
  `modpkg/import.rs`, `fantome/import.rs`, `license_file.rs`
- `crates/ltk-manager-core/src/mods/archive/metadata.rs`, archive import

## 1. What the file already is

### 1.1 A project is created with one

`create_project` wrote `# {displayName}` with the project's description under it, once, at
creation. Nothing updated either half afterwards. A creator who edited the description in the
details document left the two texts disagreeing, with nothing on screen saying so.

### 1.2 Both formats pack it

A pack plan resolves the project's root `README.md` and hands it to whichever format is
packing. Modpkg stores it through `with_readme`, fantome writes it as a `META/README.md`
entry. Neither judges the content.

### 1.3 Both imports restore it

A modpkg or fantome import writes the archive's readme back to the project root, beside
`mod.config.json` rather than under `content/`. A test upstream covers it landing at the root
and not inside the content tree.

### 1.4 The bytes are preserved, not decoded

`pack_preserves_non_utf8_readme` is an upstream test. The packer moves the file's bytes
without reading them as text, so a readme written in another encoding survives a pack.

An editor cannot do that: to show text it must decode, and to save it must re-encode. That is
the whole reason a file which does not decode opens read-only rather than lossily.

### 1.5 A project root carries more than the readme

`license_file.rs` resolves `LICENSE`, `LICENSE.md` and `LICENSE.txt`, matched without case, in
that precedence order. The same plan carries it, and the same imports restore it. The manager
has no surface for it either, which is issue #543 rather than part of this work.

### 1.6 The installed side already has the file

Importing a mod writes the archive's readme into the installed mod's metadata directory. The
Library shows the short `description` on a card and nothing else, so a creator's readme
reaches a player's disk and no further. That is issue #542.

## 2. The decisions

### 2.1 The readme is the long description, and `description` is the blurb

Two prose fields about one mod, so one of them has to be derivable or they have to be
independent. They are independent: `description` is the line a card carries, the readme is
what a player reads. Deriving either from the other makes a creator's edit to one silently
rewrite the other, and the scaffold's one-time copy is what produced the drift this closes.

The scaffold now writes the heading alone.

### 2.2 A section skeleton is an action, not a default

The alternative was the `.modignore` precedent, where a new project is written a full
commented default. A readme is prose rather than configuration, and a skeleton of empty
headings written at creation ships verbatim to every player of a mod whose author never
opened the document. Insert template appends the sections a file lacks, on a click.

### 2.3 The split, over a toggle

A readme is written raw and read rendered, so the document carries both. The alternative was
a toolbar toggle at every width, which is cheaper and never shows the creator what they are
writing. The toggle is what the split folds to below 560px, which is the width the ignore
rules document already folds its syntax rail at.

The halves scroll independently. Syncing them needs a map from a source line to the node it
drew, which the renderer does not give up cheaply.

### 2.4 A conflict is refused, not resolved

A creator writes prose in a real editor as readily as in this one, and a debounced autosave
that wins every race silently deletes the other editor's paragraph. A save carries the
modification time and size the buffer was read at, and a file that no longer matches refuses
the write. The creator answers with Reload or Keep mine.

Modification time and size rather than a hash: one `stat` answers it, and prose a person
typed does not return to the same length within the same millisecond.

### 2.5 Pack warns, the problems pass does not

A package with no readme carries nothing to read, which is the missing-thumbnail warning's
shape exactly, so it is a pre-flight warning and Pack stays enabled. A readme that exists is
not judged: nothing here can tell a deliberate one-line readme from an abandoned one.

The problems pass is about a project that will misbehave in the game. A missing readme cannot
break anything, so it gets no rule.

### 2.6 Two files, named rather than addressed

The command takes a `ProjectTextFile`, which is `readme` or `license`, rather than a
project-relative path. A path over IPC needs an allowed list, and an allowed list is a
security surface that has to be right the first time. Naming the files leaves nothing to
validate, and the license variant is what a license surface starts from.

### 2.7 Raw HTML is not rendered

A readme arrives from a git import or a packaged mod as readily as from the project's own
author, and the webview runs with the app's privileges. `react-markdown` renders no raw HTML
unless a plugin is added, so the decision is to add none.

A relative image resolves against the project root through the asset protocol. A remote image
does not load, because fetching one tells a third-party host that the project was opened.
