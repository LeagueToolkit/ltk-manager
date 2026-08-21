# Bin editor

## Changes

| Date       | Change                                                            |
| ---------- | ----------------------------------------------------------------- |
| 2026-08-21 | Address a node with the game's own property path                  |
| 2026-08-21 | Propose the block model, and replace the planned Monaco text view |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The bin editor is the LTK Manager viewer and editor for a `.bin` file. The core design idea
is blocks rather than text. A property bin is already a tree of typed values, and the manager
draws that tree directly instead of turning it into ritobin source for a user to read as code.

The name covers one surface in two modes. A `.bin` of the installed game opens read-only, and
a `.bin` of a project layer opens editable. Both draw the same blocks.

## Goals

- A modder reads what a `.bin` declares without installing a second tool
- A value is edited in the widget its type deserves, not in a line of text
- A file that is saved holds everything it held before, including what the viewer could not draw
- A class worth a purpose-built view can have one, without the generic view knowing
- The install is readable and never writable

## Feature status

This table holds every major feature of the bin editor. A status word has one meaning.

- **Available** - the feature is in the application today
- **In progress** - work started, and the feature is not complete
- **Planned** - the team agreed on the feature, and work did not start
- **Proposed** - an idea for review, and not a decision
- **Blocked** - the team agreed on the feature, and a change outside this repository has
  to land first

| Feature              | Status    | Note                                                          |
| -------------------- | --------- | ------------------------------------------------------------- |
| VS Code handoff      | Available | Opens the file as ritobin text in VS Code. `BinPreview.tsx`   |
| Object list          | Proposed  | The objects of one file, collapsed, with their classes        |
| Property rows        | Proposed  | Every leaf kind, drawn read-only                              |
| Container rows       | Proposed  | The eight complex kinds, expandable                           |
| Hash names           | Proposed  | The four mimir bin tables, layered                            |
| Property paths       | Proposed  | The game's path syntax, as the address and as Copy path       |
| Object links         | Proposed  | A link to the object, in this file or a dependency            |
| WAD chunk links      | Proposed  | A link that opens the chunk in a preview tab                  |
| Leaf editing         | Proposed  | The primitive widgets, and the patch that carries an edit     |
| Container editing    | Proposed  | Add, remove, reorder, and a `Map` key                         |
| Autosave             | Proposed  | The strings editor's debounce and save state                  |
| Undo                 | Proposed  | An inverse-patch stack per document                           |
| Class views          | Proposed  | A bespoke block for a class that earns one                    |
| Schema-aware editing | Proposed  | The meta dump, for a field's declared type and its subclasses |
| Copy into a layer    | Proposed  | The route from a read-only game chunk to an editable copy     |
| Ritobin text view    | Proposed  | A read-only text pane, once `ltk_ritobin` publishes           |
| Patch bin records    | Blocked   | `ltk_meta` reads none of them. A `PTCH` opens read-only       |
| Patch authoring      | Proposed  | An edit written as a patch record rather than a rewrite       |

## Scope

In scope is one file at a time. The editor opens a `.bin`, draws its objects, and writes it
back where the source allows a write.

Out of scope:

- Searching across files. The [bin object index](PROJECT_EDITOR.md#the-bin-object-index) is
  where a query over the whole install belongs, and this editor is what it opens
- The packaging step. What a project declares in `mod.config` is the
  [project editor](PROJECT_EDITOR.md), not a bin
- Authoring a bin from nothing. Every bin this editor opens exists already
- Writing into the install. Read [Why the game side is read-only](#why-the-game-side-is-read-only)
- Authoring a patch record. It is named in the feature status, and it waits on a `ltk_meta`
  that can write one
- A second bin parser. The format belongs to `ltk_meta`

## Vocabulary

| Word     | Meaning                                                                    |
| -------- | -------------------------------------------------------------------------- |
| Bin      | One property bin file, of `PROP` or `PTCH` magic                           |
| Object   | One entry of a bin, addressed by a path hash and typed by a class hash     |
| Entry    | The same thing, in the words a patch record uses                           |
| Property | One named value of an object, addressed by a field hash                    |
| Path     | The game's property path, such as `Position.UIRect.Size`                   |
| Kind     | One of the 27 types `ltk_meta` reads, such as `F32`, `Container` or `Map`  |
| Leaf     | A kind that holds a value and no child                                     |
| Node     | Anything the tree addresses: an object, a property, or a container element |
| Block    | The drawn form of a node                                                   |
| Patch    | One edit, as a path and an operation                                       |

## What exists today

| Surface               | Where                           | Says                                          |
| --------------------- | ------------------------------- | --------------------------------------------- |
| `BinPreview`          | The preview document, for a bin | There is no viewer, and offers VS Code        |
| `RitobinVerb`         | `core/src/ritobin.rs`           | Reads the Explorer verb, stages, and spawns   |
| The four mimir tables | The hashtable cache             | Downloaded already, and opened by nothing yet |

The handoff works and stays. What is missing is anything in the application that draws a bin.

## Why blocks and not text

### What this supersedes

The [project editor](PROJECT_EDITOR.md#planned-document-types) plans the bin preview as
**ritobin text in a read-only Monaco editor**, and this document replaces that row. The two
tables that name it change with this spec.

It also revises one line of
[The scan, and the reader it needs](PROJECT_EDITOR.md#the-scan-and-the-reader-it-needs). That
table lists the bin preview as a reader wanting one object at a time. It does not. Read
[The parse is not the problem](#the-parse-is-not-the-problem).

### The three options

| Option                 | Buys                                    | Costs                                                        |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Monaco and the LSP     | Full fidelity, and an editor users know | Megabytes of editor, a Vite worker setup, and an LSP sidecar |
| CodeMirror and the LSP | The same, smaller                       | A Lezer grammar, and the same sidecar                        |
| Blocks                 | Typed widgets, and a view per class     | A widget matrix, and an edit model                           |

Three reasons decide it, in order of weight.

**The text answer already shipped.** The VS Code handoff is the text option without the
integration, and it is better than anything hosted here, because it is the real editor with
the real language server. Rebuilding it inside the manager spends a large budget to reach a
worse copy of a thing a user already has open. The audience that wants to hand-write ritobin
is the audience that already runs VS Code.

**A class-specific view is only possible under blocks.** A `Color` as a swatch, a
`WadChunkLink` that resolves to the texture it points at, an `ObjectLink` that jumps - none
of it has a form in a text buffer. That capability is the whole reason to build a viewer here
rather than open one elsewhere.

**The generic case is small and closed.** `ltk_meta` reads 27 kinds and Riot adds one rarely.
Nineteen are leaves with an obvious widget. Write that matrix once and every bin in the game
draws. A bespoke class view is then an addition on a view that already works, never a
prerequisite for it.

### What the LSP would have given

`ritobin-lsp` is further along than it looks. Its server advertises semantic tokens with delta
and range, completion, document symbols, code lens, hover, formatting, and code actions.
Definition is switched off. That is a real language server and none of it is wasted, because
the handoff hands the file to the editor that already speaks to it.

### The VS Code handoff stays

Nothing in this document removes it. A bin the block editor draws badly, a bin a modder wants
to diff, a bin with a kind that has no widget yet - all of them still open in VS Code from the
same context menu and the same pane. The block editor is what opens by default. The handoff is
the way out.

## The document model

### Rust owns the tree

The backend parses the file once with `ltk_meta::Bin::from_reader` and keeps the `Bin` in
memory for as long as the document is open. The frontend never holds the tree. It holds a
window of rows and asks for more.

**A saved bin is written from the `Bin` the backend parsed, never rebuilt from what the
frontend drew.** This is the single decision the correctness of the feature rests on. A tree
serialized to JSON, edited, and serialized back loses whatever the crossing did not model: a
kind with no widget, a hash no table names, a container order, a duplicate key. Losing any of
it corrupts game data silently, which is the one failure a mod manager cannot ship.

Under this model the frontend cannot lose data, because it never holds any. What it fails to
draw, it fails to draw. The file is unharmed.

### Addressing a node

**The address is the game's own property path.** League carries a typed path language for
pointing at one property inside one object - `Enabled`, `Position.UIRect.Size`, `Elements[3]`,
`AnimationItems[0].AnimationName` - and this editor uses it rather than inventing a second one.
A patch record in a `PTCH` file is built on it, Riot's own tools address objects with it, and a
few bin properties hold one as their value and resolve it while the game runs.

| Token  | Means                                                                  |
| ------ | ---------------------------------------------------------------------- |
| `.`    | A member separator, at bracket depth zero                              |
| `Name` | A property, matched by `FNV1a32(lowercase(name))`                      |
| `[i]`  | One element of a `Container`, an `UnorderedContainer` or an `Optional` |
| `{k}`  | One entry of a `Map`, the subscript read as the map's own key type     |

Bracket depth is counted, so a subscript may hold a separator of its own, and an opening
bracket is what ends a member name. `Elements[3].Position` is therefore `Elements`, `[3]`,
`Position`.

Casing is cosmetic, because a segment is lowercased before it is hashed. The editor writes the
casing the hash tables give it and accepts whatever casing a user types.

**An `Optional` is indexed rather than descended.** It is a container of nothing or one thing,
so the value inside a present `Optional` is `[0]` and an absent one has no child to address.

### Why the game's syntax and not our own

Three things follow from taking the language that already exists.

- A path copied out of this editor is a path a patch record can carry, a path Riot's tools
  understand, and a path another modder can read
- The ritobin text form shares the shape, so a user moving between this editor and
  [VS Code](#the-vs-code-handoff-stays) is reading one notation
- The syntax belongs to the format, so it is not ours to keep current

An address of our own would have to be translated at each of those boundaries, and every
translation is a place for the two to disagree.

### The entry, and the path

A path begins inside an object and never names it, which is why a patch record carries the
entry's name hash beside the path. The editor's address is the same pair.

```rust
/// One node of one bin: which object, and where inside it.
pub struct NodeAddress {
    /// The object's path hash, which the file addresses it by.
    pub entry: BinHash,
    /// The property path, empty for the object itself.
    pub path: String,
}
```

Written for a person the two join on a colon, because an object path separates on `/` and a
property path never holds one.

```
Characters/Aatrox/Skins/Skin0/Resources:skinMeshProperties.material
0x2a1f3c7d:Elements[3].Position.UIRect.Size
```

Every row's context menu copies that string, and an object row copies the entry alone. It is
the one thing in this editor a modder pastes somewhere else, and it is worth more than the
value it points at.

### What a path walks through

Traversal is driven by the property's type tag, and `ltk_meta`'s `Kind` **is** that tag. The
two agree on every number, so the table below reads one enum rather than mapping two.

| `ltk_meta` kind      | Tag    | A path                       |
| -------------------- | ------ | ---------------------------- |
| `Container`          | `0x80` | indexes it with `[i]`        |
| `UnorderedContainer` | `0x81` | indexes it with `[i]`        |
| `Struct`             | `0x82` | dereferences it              |
| `Embedded`           | `0x83` | continues into it inline     |
| `ObjectLink`         | `0x84` | **stops.** It is a leaf here |
| `Optional`           | `0x85` | indexes it with `[0]`        |
| `Map`                | `0x86` | keys it with `{k}`           |
| `BitBool`            | `0x87` | stops. It is a leaf          |

**An `ObjectLink` is where a path ends.** It names another entry rather than holding one, and
nothing follows it on the way down. The editor still offers it as a link, and the address on
the far side starts again at its own entry. A patch record has the same boundary - one
record reaches one entry, and reaching a second one is a second record.

A `Struct` is nullable, written as a class hash of zero, and a path through a null one resolves
to nothing. The row shows `null` and has no children.

### A segment for a hash that no name resolves

The syntax has no form for a property the tables do not name, because the tools it was built
for always have the names. This editor does not, so it adds one segment form.

```
0x9c4e1b02.Position.UIRect
```

A segment of `0x` and eight hex digits addresses the property of that hash, matched literally
rather than hashed.

**A path holding one of these is ours and not the format's, and it must never be written into a
patch record.** Every segment of a real path is hashed as text, so `0x9c4e1b02` would resolve
as `FNV1a32("0x9c4e1b02")` and address nothing at all. Anything that writes a patch record
refuses a path with a hex segment in it, and names the segment it refused.

### An index is a position

An element index shifts when a sibling is removed. The frontend refetches the children of a
container after any patch that changes its length, and never carries an element address across
such an edit.

### The children call

The frontend keeps expansion state. The backend answers one question.

```rust
/// The children of one node, as rows a list can draw.
fn bin_children(document: DocumentId, at: NodeAddress, offset: u32, limit: u32) -> BinRows;
```

A row is small and flat: the address, the label, the kind, a rendered value for a leaf, a
child count for a container, and whether a link resolves. Expanding a node fetches its children,
collapsing drops them, and the visible list is the concatenation the frontend assembles.

The range exists for one case. A container of several thousand elements is one node, and a
single response holding all of them is a payload no viewport reads. Everything else answers
in one call.

### The open document, and its bound

The parsed tree outlives no tab. The frontend opens a document and closes it, and the pair is
explicit over IPC, because a tab closed without a close call leaks a tree.

```rust
fn bin_open(asset: AssetRef, name: Option<String>) -> BinDocumentHandle;
fn bin_close(document: DocumentId);
```

Two guards sit behind that. The store is bounded to eight documents and evicts the least
recently used, and eviction refuses to drop a document with unsaved edits. A frontend that
crashes therefore costs the memory of eight trees and no more, and a bug in the close path
costs nothing a user can see.

## The value kinds

`ltk_meta::property::Kind` is the closed set. Nineteen leaves and eight containers.

| Kind                              | Draws as                                      |
| --------------------------------- | --------------------------------------------- |
| `None`                            | The word, dimmed                              |
| `Bool`, `BitBool`                 | A switch                                      |
| `I8`..`U64`                       | A number field, clamped to the kind's range   |
| `F32`                             | A number field                                |
| `Vector2`, `Vector3`, `Vector4`   | Two to four number fields, labelled           |
| `Matrix44`                        | A four by four grid, collapsed by default     |
| `Color`                           | A swatch, and its four channels               |
| `String`                          | A text field                                  |
| `Hash`                            | The name the tables give, or the hex          |
| `WadChunkLink`                    | The chunk's path, as a link                   |
| `Container`, `UnorderedContainer` | A list, with its length                       |
| `Struct`, `Embedded`              | A nested block, with its class                |
| `ObjectLink`                      | The object's path, as a link                  |
| `Optional`                        | Present or absent, and the value when present |
| `Map`                             | Key and value pairs, with both kinds named    |

`BitBool` is a leaf that the format flags as complex. It draws as a switch and nothing about
it is nested.

**A kind with no widget still has a row.** It shows its name and its kind, says that this
viewer does not draw it, and offers the file in VS Code. It is never hidden, because a row a
user cannot see is a row a user believes is absent.

## Names

### The four tables

A bin stores hashes. Four mimir tables turn them back into names, and all four are in
`Table::ALL` and are downloaded by the sync that already runs.

| Table        | Names            |
| ------------ | ---------------- |
| `binentries` | An object's path |
| `bintypes`   | A class          |
| `binfields`  | A property       |
| `binhashes`  | A `Hash` value   |

Nothing in the manager opens them yet. `hashtables.rs` gains a `bin_tables()` beside
`wad_tables()`, layering the four the same way, and best-effort in the same way - a table
absent from the cache logs at debug and its hashes simply miss.

The [project editor](PROJECT_EDITOR.md#the-two-halves) measures the install at 359,095
distinct objects, of which the tables name 325,357. Nine names in ten resolve. The tenth is a
number.

### What a hash shows when nothing names it

The hex, in `font-mono`, at the width the kind uses: eight digits for a bin hash, sixteen for
a WAD path hash. It is selectable and the row's context menu copies it, because a modder
holding an unnamed hash is a modder about to paste it into another tool.

## The blocks

### The object block

```
│ ▾ ◈ Characters/Aatrox/Skins/Skin0/Resources                     │
│     SkinCharacterDataProperties                            17   │
│     ├ skinClassification            1                           │
│     ├ championSkinName              "Justicar Aatrox"           │
│     ├ ▸ skinMeshProperties          SkinMeshDataProperties      │
│     └ ▸ armorMaterial               8 items                     │
```

| Part      | Reads                                    |
| --------- | ---------------------------------------- |
| The mark  | `◈`, the same mark the object index uses |
| The name  | The object's path, or its hash           |
| The class | The class the object declares            |
| The count | The object's property count              |

The document opens with every object collapsed and its class showing. A bin holding one
object opens it expanded, because a collapsed single row is a document that says nothing.

### The property row

A row is a name, a kind and a value, on one line. The name column is fixed and the value
column takes the rest, so a run of rows reads as a column of values rather than a ragged list.

The kind shows only where the name does not imply it. A `String` reading `"Justicar Aatrox"`
needs no label, and an `Embedded` needs its class.

### Containers and depth

Indentation carries depth, and a guide line runs down each expanded level. Depth is bounded in
practice and not in the format, so the rows virtualize and the indentation stops growing after
eight levels, where the guide lines stack instead.

A container shows its length. An empty container shows `empty` rather than `0 items`, which is
one glance shorter.

### The header

The document's own row in the tab strip carries what the file is, and follows the
[document chrome](PROJECT_EDITOR.md#document-chrome) rule of one row per leaf.

| Shows        | From                                                     |
| ------------ | -------------------------------------------------------- |
| Objects      | The object count                                         |
| Version      | `Bin::version`, and `PTCH` where `is_override` is set    |
| Dependencies | The count, expanding to the list                         |
| Save state   | The strings editor's `SaveStatus`, on an editable source |

A `PTCH` bin patches objects rather than declaring them, and the header says so, because the
same block drawn under different semantics is the kind of thing a user has to be told once.
Read [A patch bin is read-only](#a-patch-bin-is-read-only) for the rest of what it says.

## Links

### An object link

An `ObjectLink` names an object that this file may not hold. Three outcomes, and the row says
which.

- The object is in this file, and the link scrolls to it
- The object is in a file this bin depends on, and the link opens that file
- Nothing the manager knows declares it, and the row shows the hash and does not link

The second outcome is what the [dependency
graph](PROJECT_EDITOR.md#the-dependency-graph) is for. Until it lands the link resolves inside
the open file and no further.

### A WAD chunk link

A `WadChunkLink` holds a path hash into the install's archives. The
[WAD path resolver](PROJECT_EDITOR.md#hash-names) already turns one into a path, and the
[preview document](PROJECT_EDITOR.md#how-a-preview-reaches-the-screen) already opens a chunk
by hash. The link therefore opens a preview tab, and a texture a bin points at is one click
from the bin that points at it.

## Special classes

The generic view draws every class. A class earns a bespoke view when the generic one buries
something a modder is there to change.

A bespoke view is a component keyed by class hash, taking the same node path every generic
block takes, and it composes rather than replaces - a class view that handles four of an
object's seventeen properties leaves the other thirteen to the generic rows below it.

Candidates, none of them decided:

| Class                         | Would show                                  |
| ----------------------------- | ------------------------------------------- |
| `SkinCharacterDataProperties` | The skin's name, its mesh, and its textures |
| A material                    | Its samplers, with the textures drawn       |
| A particle system             | Its colors and its lifetimes                |

This section stays a list until the generic view ships and a real complaint names the first
entry. Building a class view before the generic view is what turns a viewer into a form for
three classes and nothing else.

## Editing

### Where editing is allowed

The rule falls out of `AssetRef` and needs no new state.

| Source      | Mode      | Why                                                 |
| ----------- | --------- | --------------------------------------------------- |
| `Layer`     | Editable  | The project's own file                              |
| `GameChunk` | Read-only | Inside the install, which the manager never writes  |
| `File`      | Read-only | Anywhere on disk, and owned by nobody the app knows |

The source is one of two gates. A `PTCH` file is read-only from either side of that table, for
a reason of its own that the next section gives.

A read-only document draws the same blocks with the widgets disabled, and offers **Copy into
layer**, which writes the chunk into the active project's layer and reopens it editable. That
is the route a modder wants anyway, because a change to a game file is a change that has to
live in a mod.

### A patch bin is read-only

A `PTCH` file is a layer rather than a file of its own. After its object table it carries
property-patch records - an entry hash, a value type, a path and a value each - and the game
applies them to whatever bin the layer is attached to. Riot ships its UI variants that way, as
a few hundred one-property edits rather than a duplicated scene, so a patch bin is mostly
patches and only incidentally objects.

**`ltk_meta` reads none of those records.** `Bin::data_overrides` is a `Vec<()>`. The reader
takes the record count and pushes that many units without consuming a single record byte, and
the writer writes the count back with the loop that would write the records commented out.

That makes a save destructive in the worst way on offer. A `PTCH` written back through
`ltk_meta` declares a count of records it does not contain, which is a file the game reads off
the end of, and nothing about it looks wrong until it is loaded.

One more mismatch sits in the same reader. The outer `PTCH` header's count is followed by that
many `u32` entry hashes, naming entries to drop, where `ltk_meta` reads the count and expects
`PROP` immediately after it. Every shipped file carries a count of zero, so the two readings
agree today and part company the moment one does not.

So a `PTCH` opens read-only whatever its source, and the header says both that the file is a
patch layer and that its records are not drawn. This is one upstream fix, not a shape for the
frontend to be built around.

### What an edit is

A patch, applied to the tree in Rust, answered with the rows that changed.

| Operation       | Carries                        |
| --------------- | ------------------------------ |
| Set value       | A path and a value             |
| Add element     | A path, and an index           |
| Remove element  | A path                         |
| Move element    | A path, and a destination      |
| Add property    | An object path, a hash, a kind |
| Remove property | A path                         |
| Set map key     | A path, and a key              |

A text or number field is controlled locally and commits on blur, on `Enter`, or after the
same debounce the strings editor uses. A patch per keystroke is a round trip per keystroke,
and neither the tree nor the disk wants one.

### Validation

The backend validates every patch against the kind and rejects what does not fit - 300 into a
`U8`, a string into an `F32`, an element into a container of another kind. The frontend
clamps the same ranges so the common case never round-trips, and the backend is what decides,
because a guard that lives only in the frontend is a guard an IPC caller walks past.

A rejected patch leaves the tree untouched and marks the field, and the save state goes to
`blocked` for as long as a field is invalid, exactly as the strings editor does.

### Save

Autosave. There is no save button, the debounce is the strings editor's `SAVE_DELAY_MS`, and
the state union is the one that editor already ships.

```
clean → pending → saving → clean
                        ↘ failed
blocked                              while any field is invalid
```

The write goes through `ltk_meta`'s writer to a temp file and then renames, and the tab's
unsaved dot follows `blocked` and `failed` only, because a document that autosaves is clean
between keystrokes and a dot that blinks on every edit means nothing.

### The version-3 write

`ltk_meta` documents its writer as always writing version 3, whatever version it read. A bin
of version 1 or 2 therefore comes back upgraded, and a save that changes one float also
changes the file's version.

This is a hazard and not a decision. Two ways out, and the upstream one is preferred:

- `ltk_meta` writes the version it read, or takes the version as an argument
- The editor refuses to save a bin below version 3 until it does

Until one of them lands the editor opens such a file read-only and says why.

### Undo

An inverse-patch stack per document, in Rust, bounded. `Ctrl+Z` and `Ctrl+Shift+Z` while the
document is active. The stack is per document rather than global, because the tab strip holds
several and an undo that crosses them undoes work a user is not looking at.

### What an edit cannot do

- Change an object's path hash. It is the object's identity, and every link to it holds it
- Change an object's class. The properties of the old class are not the properties of the new
- Add a property the class does not declare, once the schema lands

Each of these is a legal operation on the format and a destructive one in practice. They stay
out until there is a reason and a confirmation to put in front of them.

## When a file will not read

The [project editor](PROJECT_EDITOR.md#the-build-measured) measures three files of 42,306 that
will not scan. A file that will not parse gets the empty state, the parse error, and the VS
Code action, in the pane that today says there is no viewer.

A parse failure is never a toast and never a dialog. The document opened, the document is what
failed, and the document is where a user is looking.

## Performance

### The parse is not the problem

The [project editor](PROJECT_EDITOR.md#the-scan-and-the-reader-it-needs) measures a full
`ltk_meta` parse at 760ms over 194.8MB of decompressed bins, which is about 250MB a second. A
2MB bin is therefore about 8ms, on one thread, once, when the tab opens.

**The lazy read does not block this feature.** It blocks the object index, which parses 42,306
files in a build and cares about the 242x. One file at a time does not. The editor ships on
`ltk_meta` as published and adopts `Bin::scan` if and when it lands upstream, for the
read-only case, as an optimisation and not a prerequisite.

That is the revision to the reader table in the project editor's blocker section.

### The window

Rows virtualize on `@tanstack/react-virtual`, which the explorers already use. What is
expanded is what is fetched, and a collapsed object costs one row whatever it holds.

### Budgets

Targets, not measurements. Nothing here is measured until there is something to measure.

| Step                            | Target |
| ------------------------------- | ------ |
| Open a bin of a few megabytes   | 100ms  |
| Expand a node                   | 16ms   |
| A committed edit, to save state | 50ms   |
| Eight open documents, in memory | 200MB  |

## What has to land first

Nothing hard-blocks the first stage.

| Item              | Where     | Status                                                 |
| ----------------- | --------- | ------------------------------------------------------ |
| `ltk_meta` 0.6.1  | crates.io | Published. `MIT OR Apache-2.0`, the workspace's        |
| `bin_tables()`    | This repo | A small addition to `hashtables.rs`                    |
| `Bin::scan`       | Upstream  | Wanted by the object index, optional here              |
| The write version | Upstream  | Read [The version-3 write](#the-version-3-write)       |
| Patch records     | Upstream  | A `PTCH` is read-only until `ltk_meta` round-trips one |
| The meta dump     | Upstream  | Stage four only, for schema-aware editing              |
| `ltk_ritobin`     | Upstream  | Git only. Publish before the text view                 |

Adding `ltk_meta` needs a `pnpm generate:licenses` and nothing else.

## The backend

`core/src/bin_document.rs` holds the parsed tree, the patch application, and the row
projection. It knows about `ltk_meta`, `AssetRef` and the hashtable cache, and it knows
nothing about Tauri.

`src-tauri/src/commands/bin.rs` is the seam, and `BinDocuments` is a third managed state
beside `SettingsState` and `PatcherState`.

| Command        | Answers                                       |
| -------------- | --------------------------------------------- |
| `bin_open`     | A handle, the header facts, and the root rows |
| `bin_children` | The rows under one address                    |
| `bin_patch`    | The rows that changed, or a rejection         |
| `bin_undo`     | The same                                      |
| `bin_close`    | Nothing                                       |

Errors carry an `ErrorCode` and their context the way
[error handling](../ERROR_HANDLING.md) describes, with the node address in the context of a
rejected patch.

## The frontend

`src/modules/workshop/bin/` holds the document, the row components, the widget matrix keyed by
kind, and the class views keyed by class hash. It is a sibling of `preview/` rather than a part
of it, because the preview module draws an asset and this one edits a document.

`PreviewDocument` routes a property bin here instead of to `BinPreview`, and `BinPreview` stays
as the fallback for a file that will not parse.

The design system rules the blocks lean on:

- `DS-RADIUS` - a row is dense inline chrome, so `rounded-sm`
- `DS-GAP` - the row list is a `flex` with a `gap`, never `space-y-*`
- `DS-VEIL` - a row's hover is `bg-surface-veil`, because a row owns no surface
- `DS-KIND-HUE` - a kind is not a status. A hue that tells the kinds apart is its own scale
- `DS-TOKEN` - a `Color` swatch draws the bin's value, which is data and not a token

A bin already has a tint. `fileKindIcon.ts` gives `property_bin` the `--ltk-riot-red` mark,
the tab takes it through the existing descriptor, and no `doc-*` token is added.

## What ships in what order

1. **The viewer.** `bin_open`, `bin_children`, the leaf widgets read-only, the container rows,
   the four tables, and the address on every row with a **Copy path** behind it. Replaces the
   empty state with the file. Useful on its own, and it is the game browser's missing half
2. **The links.** Object links inside the file, and WAD chunk links into the preview
3. **Leaf editing.** The primitive widgets, `bin_patch`, validation, autosave, undo. Layer
   sources only
4. **Container editing.** Add, remove, reorder, and a `Map` key. This is where the complexity
   is
5. **Class views.** The first one, chosen by a complaint and not by this document
6. **Schema-aware editing.** The meta dump, a field's declared type, and the subclasses an
   `Embedded` accepts

Ship one and stop. It answers whether the block model reads well before any of the edit
machinery is written, and if the answer is no, nothing built so far is wasted on a viewer that
is still worth having.

## Why not a text view first

A read-only ritobin pane is cheap once `ltk_ritobin` publishes, and it is tempting as a first
stage because it puts something on screen sooner.

It is the wrong first stage. It delivers what the VS Code handoff already delivers, worse, and
it teaches nothing about the block model that stage one has to answer anyway. It stays on the
list as a pane beside the blocks, for the file that draws badly, and it earns its place there
rather than at the front.

## Why the game side is read-only

The manager never writes into the install. That is a rule the whole application already keeps,
and the patcher's overlay exists so that it can. A bin editor that wrote a game chunk in place
would put an unrepairable edit one keystroke away, behind a viewer a user opened to read.

**Copy into layer** is the answer, and it is a better one than editing in place, because the
result is a mod rather than a modified install.

## Open questions

| Question                                                                     |
| ---------------------------------------------------------------------------- |
| Does a search inside one open bin belong here, or in the project bar?        |
| What does a `Matrix44` look like when a user actually has to change one?     |
| Should two layers' copies of one bin be comparable, and is that this doc's?  |
| Is eight open documents the right bound, or should it follow the tab strip?  |
| Does a class view get to hide the properties it handles, or only reorder?    |
| Is a `{k}` map subscript worth emitting before one is confirmed in game?     |
| Should an edit be offerable as a patch record once `ltk_meta` can write one? |
