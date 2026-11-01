# Bin editor

## Changes

| Date       | Change                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| 2026-10-31 | Add a menu bar to every object tab, in place of the kebab and Panes      |
| 2026-10-15 | Draw the sprite sheet in the Texture group, and pick its frames on it    |
| 2026-10-15 | Duplicate an object as a new one from its own tab                        |
| 2026-10-15 | Create, duplicate and remove objects in a bin the project holds          |
| 2026-10-15 | Declare an added or deleted emitter of a game bin without the whole list |
| 2026-10-15 | Scale a system in the Adjust popover, beside the hue turn                |
| 2026-10-15 | Recolor a system by turning the hue of every tint                        |
| 2026-10-12 | Collapse a panel to its strip or to a rail of its panes' icons           |
| 2026-10-09 | Draw a pane's strip as a filled rail, with tabs as tall as the rail      |
| 2026-10-06 | Fit a Continuous run's timeline to the time its last bar ends            |
| 2026-10-06 | Author an emitter's stencil mask in a Stencil group                      |
| 2026-10-05 | Author an emitter's emission mesh and surface in a Source group          |
| 2026-10-04 | Move the skin shell, its preview and its panes to docs/ux/SKIN_EDITOR.md |
| 2026-09-27 | Select an emitter by a click on its particles in the viewer              |
| 2026-09-26 | Walk the rows by key, and keep a refused edit's text                     |
| 2026-09-24 | Pick an emitter's primitive, and sketch what it draws                    |
| 2026-09-24 | Edit a bin's dependencies as rows pinned over its objects                |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The bin editor is the LTK Manager viewer and editor for a `.bin` file. The core design idea
is blocks rather than text. A property bin is already a tree of typed values, and the manager
draws that tree directly instead of turning it into ritobin source for a user to read as code.

The name covers one surface in three modes. A `.bin` of the installed game opens read-only, a
`.bin` of a project layer opens editable, and a `.bin` of the game opened from a project's game
tree opens declared: its edits land in a layer's `game_data.yaml`. All three draw the same
blocks.

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

| Feature               | Status      | Note                                                              |
| --------------------- | ----------- | ----------------------------------------------------------------- |
| VS Code handoff       | Available   | Opens the file as ritobin text in VS Code. `BinPreview.tsx`       |
| Object list           | Available   | The objects of one file, collapsed, with their classes            |
| Property rows         | Available   | Every leaf kind, drawn read-only                                  |
| Container rows        | Available   | The eight complex kinds, expandable                               |
| Hash names            | Available   | The four mimir bin tables, through `bin_tables()`                 |
| Property paths        | Available   | The game's path syntax, as the address and as Copy path           |
| Open at object        | Available   | A `$` hit opens the declaring file scrolled to its object         |
| Type tags             | Available   | Every row's kind after its name, in ritobin's words               |
| Class cards           | Available   | A class or a field on hover, from the meta schema                 |
| Object tab            | Available   | One declaration as a document. ADR-0028                           |
| Object links          | Available   | A chip that opens the object tab, resolved through the index      |
| Hash links            | Available   | A `hash` the index declares, opening the same way                 |
| WAD chunk links       | Available   | A chip that opens the chunk in a preview tab                      |
| Texture swatch        | Available   | A `file` link to a texture, at row height and on a hover card     |
| Find all references   | Available   | A class's objects from the index, the rest from a walk            |
| String links          | Available   | A string naming a chunk or an object, as the chip its kind draws  |
| Value rows            | Available   | Every family's constant, and a mark where a curve carries more    |
| Class views           | Available   | A complete layout beside Properties, keyed on class. ADR-0030     |
| Curve panel           | In progress | The dock, the graph and its channels. The tabs next. ADR-0032     |
| Particle system shell | Available   | Panes under a crumb, arranged by the reader. ADR-0031, ADR-0034   |
| Particle timeline     | Available   | Lanes under one playhead, on checkpoints. ADR-0037                |
| Pane maximize         | Available   | A tab fills its split tree, and Esc restores it                   |
| Floating panes        | Available   | A pane leaves the tree for a frame over the shell, and docks back |
| Inspector rows        | Available   | Every group, named values, units, a curve per animated row        |
| Inspector bands       | Planned     | A rich value on its own band, the roll rail, and no group tabs    |
| Primitive picker      | Available   | The primitive's class, its fields, and a sketch of what it draws  |
| Emission source       | Available   | Emission mesh and surface, typed, checked and drawn as births     |
| In-document search    | Available   | The bar's `@` scope over the open rows                            |
| Leaf editing          | Available   | The primitive widgets, and the patch that carries an edit         |
| Path field            | Available   | Project and game files suggested in a `file` or path string edit  |
| Property editing      | Available   | Add and remove a property inline, at the schema's default         |
| Container editing     | Available   | List items, map entries, options and pointers, inline             |
| Row keys              | Available   | Arrows walk the rows, and `Enter` or `F2` opens a value           |
| Autosave              | Available   | The strings editor's debounce, saved as a delta. ADR-0040         |
| Undo                  | Available   | An inverse-patch stack per open tree, from anywhere in the group  |
| Schema-aware editing  | Proposed    | The meta dump, for a field's declared type and its subclasses     |
| Copy into a layer     | Proposed    | The route from a read-only game chunk to an editable copy         |
| Ritobin text view     | Proposed    | A read-only text pane, once `ltk_ritobin` publishes               |
| Patch bin records     | Available   | Grouped under the objects they target, read-only. ADR-0041        |
| Declared game bin     | In progress | A row edit of a game bin lands as a declaration. ADR-0042         |
| Declaration actions   | In progress | Copy a row as a declaration or a reference, and paste one         |
| Patch authoring       | Proposed    | An edit written as a patch record rather than a rewrite           |

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
- Authoring a patch record. It is named in the feature status
- A second bin parser. The format belongs to `ltk_meta`

## Vocabulary

| Word        | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| Bin         | One property bin file, of `PROP` or `PTCH` magic                           |
| Object      | One entry of a bin, addressed by a path hash and typed by a class hash     |
| Entry       | The same thing, in the words a patch record uses                           |
| Declaration | One object in one file, the pair an object tab is keyed on                 |
| Property    | One named value of an object, addressed by a field hash                    |
| Path        | The game's property path, such as `Position.UIRect.Size`                   |
| Kind        | One of the 27 types `ltk_meta` reads, such as `F32`, `Container` or `Map`  |
| Leaf        | A kind that holds a value and no child                                     |
| Node        | Anything the tree addresses: an object, a property, or a container element |
| Block       | The drawn form of a node                                                   |
| Tag         | A row's kind, written after its name in ritobin's words                    |
| Chip        | A value drawn as a `Code` chip, which opens what it names                  |
| Patch       | One edit, as a path and an operation                                       |
| Record      | One property-patch record of a `PTCH`: an object hash, a path and a value  |
| Target      | The object a record names, which the file tab draws its records under      |

## What exists today

| Surface               | Where                           | Says                                        |
| --------------------- | ------------------------------- | ------------------------------------------- |
| `BinDocument`         | `src/modules/workshop/bin/`     | The blocks, over rows the backend projects  |
| `BinDocuments`        | `core/src/bin_document.rs`      | The held trees, bounded to eight            |
| `BinPreview`          | The preview document, for a bin | The parse error, and offers VS Code         |
| `RitobinVerb`         | `core/src/ritobin.rs`           | Reads the Explorer verb, stages, and spawns |
| The four mimir tables | `bin_tables()`, `hashtables.rs` | Opened as `BinHashTables` for the pass      |

The handoff stays as the fallback for a file that does not parse.

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

The save writes the objects a patch touched, out of that tree, over the bytes the file opened
with. Every other object is copied byte for byte. ADR-0040.

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

### A map that repeats a key

The format lets a map hold one key twice, and a hand-edited bin sometimes does. A key alone
reaches only the first of those entries, so the editor adds a second form of its own.

```
mClipDataMap{"Run"}
mClipDataMap{"Run"}#1
```

The first entry of a key keeps `{k}`, and each later one takes `#n`, the count of earlier
entries holding the same key. A map with no repeat never shows the form, so every address it had
stands. A repeat draws a warning mark beside its key, reads and edits as its own entry, and an
add or a rename onto a key the map holds is refused. Like a hex segment, a path with `#n` is
ours and never goes into a patch record.

### A patch record

A record's value sits in no object of the file, so its rows take an address of their own.
ADR-0041.

```
0x4a47c414:#              the target: every record of the object
0x4a47c414:#12            record 12 of the file
0x4a47c414:#12.9c4e1b02   a field of the value record 12 writes
```

`#n` is the record's position in the file's record list. What follows it is the wire form of
[Addressing a node](#addressing-a-node), each segment with its separator. The readable path starts
with the record's own path, so Copy path on a field under the record writes
`ClientStates/.../MinimapFrame:Position.UIRect.Size`. An object's key holds no path that starts
with `#`, so a record on an object the same patch adds draws apart from that object.

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

### The projected read

A [layout](#class-views) and a [value row](#a-value-family-on-its-row) want several nodes at
once, and one call per node is a round trip per cell.

```rust
/// The children of each of several nodes, in the order asked.
fn bin_read(document: DocumentId, entry: BinHash, paths: Vec<String>) -> Vec<BinRows>;
```

Each path answers the page `bin_children` answers, 500 rows, and a call answers four pages at
most. Past that the call errors and names the cap, and the caller batches. The tree never
crosses, per ADR-0026, and `bin_children` stays as the one-node form.

A path reaching nothing answers an empty page rather than failing the call, because a layout
names fields an object of its class need not hold and a caller that has to know first is back
to a call per node. An entry the file does not declare is still an error.

The cap is counted before a row is built, so a refused call costs a walk. A caller batches on
the row counts it already holds: a node's own row carries how many rows sit under it, so no
level of a read guesses.

### The open document, and its bound

The parsed tree outlives no tab. The frontend opens a document and closes it, and the pair is
explicit over IPC, because a tab closed without a close call leaks a tree.

```rust
fn bin_open(asset: AssetRef, name: Option<String>) -> BinDocumentHandle;
fn bin_close(document: DocumentId);
```

Two guards sit behind that. The store is bounded to thirty-two documents and evicts the least
recently used, and eviction refuses to drop a document with unsaved edits. A frontend that
crashes therefore costs the memory of thirty-two trees and no more, and a bug in the close path
costs nothing a user can see. A call on an evicted document reopens it and is sent again on the
fresh id.

## The value kinds

`ltk_meta::property::Kind` is the closed set. Nineteen leaves and eight containers.

| Kind                              | Draws as                                    |
| --------------------------------- | ------------------------------------------- |
| `None`                            | The word, dimmed                            |
| `Bool`, `BitBool`                 | A checkbox                                  |
| `I8`..`U64`                       | A number field, clamped to the kind's range |
| `F32`                             | A number field                              |
| `Vector2`, `Vector3`, `Vector4`   | Two to four number fields, labelled         |
| `Matrix44`                        | A four by four grid, collapsed by default   |
| `Color`                           | A swatch, and its four channels             |
| `String`                          | A text field                                |
| `Hash`                            | The name the tables give, or the hex        |
| `WadChunkLink`                    | The chunk's path, as a link                 |
| `Container`, `UnorderedContainer` | A list, with its length                     |
| `Struct`, `Embedded`              | A nested block, with its class              |
| `ObjectLink`                      | The object's path, as a link                |
| `Optional`                        | What it holds, or that it holds nothing     |
| `Map`                             | Key and value pairs, with both kinds named  |

`BitBool` is a leaf that the format flags as complex. It draws as a checkbox and nothing about
it is nested.

Every widget here is drawn before it is editable, and the read-only one is the editable one at
rest: a number sits in its field and a bool in its checkbox from the first read, so nothing on
the row moves when editing lands. A string that names nothing is the exception and draws as its
text. A field around a short name reads the way a link chip does, so the box would say a string
opens something, and the field it edits in arrives with editing. A field draws its border at rest rather than
under the pointer, because a value that only becomes a field on hover reads until then as text
laid over the row. What a read-only widget does not take is focus, since a document of them
would otherwise be a tab order thousands of stops long.

**An optional draws what it holds.** It is one value or none, so a leaf inside one takes the
option's own row rather than a `[0]` under it - a row a reader opens to learn nothing the option
row had not already said. An optional holding a struct or a container keeps its `[0]`, because
those rows have to hang off something. The tag stays `option[...]` either way, so the row still
says it is an option.

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

`hashtables.rs` opens them as `bin_tables()` beside `wad_tables()`, best-effort in the same
way - a table absent from the cache logs at debug and its hashes miss. The four are not
layered the way the two WAD tables are, because they hash four unrelated kinds of string into
32 bits, so `BinHashTables` answers one table per lookup.

The [project editor](PROJECT_EDITOR.md#the-two-halves) measures the install at 359,095
distinct objects, of which the tables name 325,357. Nine names in ten resolve. The tenth is a
number.

### What a hash shows when nothing names it

The hex, in `font-mono`, at the width the kind uses: eight digits for a bin hash, sixteen for
a WAD path hash. It is selectable and the row's context menu copies it, because a modder
holding an unnamed hash is a modder about to paste it into another tool.

A field or a class the tables miss takes the name the shipped meta schema holds for it, so a
spawn shape reads `VfxShapePointDoNotUse` rather than `0xee39916f`. The hex is for a hash
neither names.

### What a project names

The tables are a crawl of the retail game, so a name that a mod author invents is in none of them.
A project answers before the tables for objects and `Hash` values, in every read of a document in
that project. It names an object from its `binentries` tables and from the object paths that its
game data declarations write, and a `Hash` value from its `binhashes` tables and from every string
its game data declarations write: a literal, a map key, and a key subscript of a property path. A
joint of a `.skl` in a layer names its `Hash` value too, so `mBoneName` and `ParentJoint` read as
the joint a mod adds. A bin of one layer reads the names that another layer holds.

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

| Part      | Reads                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The mark  | `◈`, the same mark the object index uses. A `Champion` carries the champion mark and a `SkinCharacterDataProperties` the skin mark |
| The name  | The object's path, or its hash                                                                                                     |
| The class | The class the object declares                                                                                                      |
| The count | The object's property count                                                                                                        |

The document opens with every object collapsed and its class showing. A bin holding one
object opens it expanded, because a collapsed single row is a document that says nothing.

### A patch bin's records

A `PTCH` draws the objects it adds as object blocks, then one target row per object its records
patch. A target expands to its records in file order. The targets keep the order of each one's
first record.

```
v .../Minimap/VoiceChatButton/VoiceChatPanel_ButtonClicked   3
    Position.Anchors.Anchor    vec2    0, 1
  > Position.UIRect            embed   UiElementRect
v .../Minimap/MinimapFrame                                  2
    FlipX                      flag    true
> .../Minimap/MinimapIcons                                  4
```

| Part           | Reads                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| A target       | The object's path, or its hash, and its record count                       |
| A record       | The record's path as the file writes it, its kind, and its value           |
| Under a record | What the value holds, as the rows of a property of that kind               |
| Open object    | A target's hover action and menu item, where the index declares the object |

A record row carries no mismatch mark. The class of the object it patches is outside the file.
A field under an embed or a pointer the record writes reads its declared kind through that
value's class. A record's value reads no base: the value the record replaces is one Open object
away.

### The property row

A row is a name, a tag and a value, on one line. The name column is one width for the whole
list and the value column takes the rest. A run of rows reads as a column of values rather than a ragged list, which is
why the indent lives inside the name column rather than beside it - an indent that pushes the
name along would push every value with it, and a deep row's value would start where a shallow
one's ended.

**The name column is measured, not fixed.** Every row is set in one mono face, so the width the
widest name needs is arithmetic over the loaded rows rather than a measurement of the drawn ones:
the indent in characters, the name, the tag and any class it holds. It is taken over the loaded
rows rather than the visible ones, so it does not move while a reader scrolls, and it is bounded
at both ends - a shallow list is not cramped, and one long name cannot push every value off the
pane.

**An element sits outside the column.** Its value follows its index rather than starting where a
property's does, because a list of elements is read down its own values and a column measured for
the names around it strands each one behind a run of nothing. The names in a list are `[0]` and
`[1]`, so there is no column for them to keep.

**An element's index never elides.** A list is read by counting down it, so `[12]` is the one part
of a row that has to survive a narrow pane, and the class beside it is what gives way.

**The pane is the last bound.** The measured width is what the names want, and on a narrow pane
what they want is the whole row, so the column stops at half of it and the names elide from there.
The value is the answer a reader came for, and a column of names beside a column of nothing
answers nothing. Half is the split rather than a fixed number of characters, because the pane
moves under a splitter drag and a name has an ellipsis to fall back on where a value has none.

```
│     ├ championSkinName        string   "Justicar Aatrox"           │
│     ├ ▸ skinMeshProperties    embed    SkinMeshDataProperties      │
│     ├ ▸ armorMaterial         list[embed]   8 items                │
│     ├ ▸ tags                  map[hash,string]   3 entries         │
│     └ [3] SkinMeshDataProperties        17 properties             │
```

**The tag is the row's kind, in ritobin's words.** Every row but the object row carries one.
It sits after the name, the way a type follows a name in code, mono and in the kind hue, and the
values keep one column. An element row carries its item's kind. A container composes its shape the way the meta wiki
writes it: `list[embed]`, `map[hash,string]`, `option[f32]`.

| Kind in `ltk_meta`                | Tag                      |
| --------------------------------- | ------------------------ |
| `None`, `Bool`, `BitBool`         | `none`, `bool`, `flag`   |
| `I8` to `U64`, `F32`              | `i8` to `u64`, `f32`     |
| `Vector2`, `Vector3`, `Vector4`   | `vec2`, `vec3`, `vec4`   |
| `Matrix44`, `Color`               | `mtx44`, `rgba`          |
| `String`, `Hash`, `WadChunkLink`  | `string`, `hash`, `file` |
| `ObjectLink`                      | `link`                   |
| `Container`, `UnorderedContainer` | `list`, `list2`          |
| `Struct`, `Embedded`              | `pointer`, `embed`       |
| `Optional`, `Map`                 | `option`, `map`          |

The words are the ones a ritobin dump and the meta wiki write. The Problems finding for a
property type mismatch writes the same words.

**The tag is the kind in the file.** The meta schema declares a kind for the field at the
install's build, and the two differ where the Problems rule for a property type fires. A row
whose file kind differs from the declared kind carries the warning mark the Problems list uses,
and that mark's tooltip names the declared kind. The tag itself carries no tooltip, because the
schema's line for the field is on [the field card](#the-field-card) and one row does not answer
the same question twice.

A field no table names takes the schema's name where the schema has one. The hex form stays for
a field neither names.

**An element names its class, not its kind.** A row inside a container is its index and, where
it holds a struct, the class it holds - the tag is dropped, because the declaring property
already reads `list[pointer]` and no element of a container is a different kind from its
siblings. The value column stays empty under it, because a count of the rows the caret is about
to open is a fact the tree answers the moment a reader asks for it.

### Containers and depth

Indentation carries depth, and a guide line runs down each expanded level. Depth is bounded in
practice and not in the format, so the rows virtualize and the indentation stops growing after
eight levels, where the guide lines stack instead.

A container shows its length. An empty container shows `empty` rather than `0 items`, which is
one glance shorter.

### A value family on its row

`ValueColor`, `ValueColorRgb`, `ValueFloat`, `ValueVector2` and `ValueVector3` are one shape: a
constant, and a dynamics of times and values that may be null. Each is a struct row, and the
constant a modder reads is one node under it.

`ValueColorRgb` carries three channels where `ValueColor` carries four, and reads as a colour with
a full alpha rather than as a vector, because what it holds is a colour. Its name is a hash crack
rather than an attested string, which is why the schema spells it `Rgb`.

**A collapsed row of the family draws its constant.** A `ValueColor` draws its class, then the
constant as a swatch, then a gradient strip of fixed width over the dynamics' stops, with alpha
over a checkerboard and the stops on a hover card. A colour with no dynamics draws the swatch
alone, and one whose file writes no `constantValue` draws the strip alone: a colour that animates
is its stops, and a row that waited for a constant the file never held drew nothing at all. The
other three draw the constant in the field a scalar or a vector row draws.

**A colour edits as a colour.** An editable colour constant, a float vector of three or four
channels whose field name ends in `Color`, and a byte colour each draw a swatch with its hex and
alpha. A click opens a picker with an alpha slider and each channel as an exact field, which keeps
a channel past 1 or below 0 the picker cannot reach, and Save writes every channel at once. A byte
colour keeps its channel boxes beside the swatch.

```
|  birthColor    embed   ValueColor    [#] [=====gradient=====]   |
|  rate          embed   ValueFloat    [ 1.00 ]                   |
|  velocity      embed   ValueVector3  [X 0.00] [Y 1.50] [Z 0.00] |
```

The rule is keyed on the class and the field, the way ritobin-lsp issue 55 states it, and it
holds in the generic tree and in every layout, except that a layout drops the class this row
draws first, per [a value family in a layout](#a-value-family-in-a-layout). The nodes a row wants are read per visible page
through [the projected read](#the-projected-read), on scroll settle, and the row draws them when
they land. The tree draws the mark and never a sparkline, because it scrolls a thousand rows and
a sparkline is two more read levels each. What the curve holds is
[the curve panel](#the-curve-panel), and the lints the issue names are Problems rules.

Three levels answer a curve: the row's own children, the dynamics one of them points at, and the
dynamics' two lists. Each level's rows carry how long the next is, so a level batches under the
read's cap rather than guessing at it. A surface says which families it wants those levels for. A
colour asks for them wherever it draws, since its band is its keys. Every other family asks only
where a sparkline draws one. A value with no dynamics stops at the first level whatever asked.

The dock and the inspector's sections on screen walk three more for the probability tables - the
table list, each table behind a slot, and each table's own two lists. The dock is aimed at one row
and the inspector reads only what is on screen, where the tree reads a page of rows at a time.

The strip takes the width one vector component takes, so a column mixing colours, floats and
vectors keeps its readouts under each other. A stop sits at its own time in
[the curve's window](#the-window-a-curve-is-drawn-over), and the outermost colours hold flat to
the ends of it, so a ramp keyed over the middle of a particle's life reads as one rather than as
a ramp filling the whole of it. The strip, the emitter card's colour square and the dock's band
are one drawing at three sizes. A row draws nothing where the read has not landed, rather than a
placeholder that would shift the line under it.

Copy value on a row of the family takes the constant: a colour as `#RRGGBBAA`, and a float and a
vector as the row draws them.

### The header

The document's own row in the tab strip carries what the file is, and follows the
[document chrome](PROJECT_EDITOR.md#document-chrome) rule of one row per leaf.

| Shows        | From                                                               |
| ------------ | ------------------------------------------------------------------ |
| Objects      | The object count                                                   |
| Version      | `Bin::version`, and `PTCH` where `is_override` is set              |
| Dependencies | The count, opening the pinned row of [Dependencies](#dependencies) |
| Save state   | The strings editor's `SaveStatus`, on an editable source           |

A `PTCH` bin patches objects rather than declaring them, and the header says so, because the
same block drawn under different semantics is the kind of thing a user has to be told once.
The header counts the records, and the objects the patch deletes where it deletes any. The
deleted count opens a list of the deleted objects, each a link. On a narrow tab the row keeps the
object count, the dependencies and the fact that the file is a patch, and drops the version and
the patch tallies.
Read [A patch bin is read-only](#a-patch-bin-is-read-only) for the rest of what it says.

### The row menu

Every action a row has is on its context menu, and a card holds none - `DS-MENU-SCOPE`. The menu
belongs to the row rather than to the pointer, so it lists everything the row carries and which
pixel was clicked never changes what it offers.

| Item                             | On                                        |
| -------------------------------- | ----------------------------------------- |
| Open link, Open link beside      | A row whose value resolves to a document  |
| Open object, Open object beside  | An object row                             |
| Find all references              | An object row, and a row carrying a class |
| Reveal in Objects                | An object row                             |
| Copy path                        | Every row                                 |
| Copy name                        | A row a table names                       |
| Copy field hash                  | A property row                            |
| Copy class name, Copy class hash | A row whose value carries a class         |
| Copy value                       | A row whose value reads as one string     |
| Copy value hash                  | A row whose value carries a hash          |
| Show in properties               | A cell of a class view                    |
| Reset to default                 | A property row of a class view or a node  |

Copy value takes the value as the row draws it: a string, a number, a `flag` as `true` or `false`,
a colour as `#RRGGBBAA`, a vector or a matrix as its components joined by a comma, and a link as
its path or its name. A container, a map, a struct and an optional read as no single string, so
they carry no Copy value. Copy value hash is the hash behind such a link, whether or not a table
names it.

#### Reset to default

Reset to default puts a property back to its class default. It is one undo step. The Graph pane offers it too, first in the menu of a right click on a field row inside a node.

- a bin that can drop a property removes it, and the class view then draws the field as the
  schema's default, the value the game reads for a field the file leaves out
- on a declared document, a row a declaration of the chosen layer sets drops that declaration,
  every signed key of its path in its module. The row then reads the game's value, or the
  class default where the game has none
- a declared document cannot remove a property from a game bin, so on a row no declaration
  sets it writes the default instead: the latest schema's default, or the kind's own zero where the schema has none. The
  zero is 0, `false`, an empty string, a zero hash, an identity matrix, or opaque white for a
  colour
- a value class (`ValueFloat`, `ValueVector3`, `ValueColor` and the rest) resets its constant
  the same way and drops its curve
- in a declared document, a list, a map, an embed or a pointer has no single default to write,
  so the item is disabled with the reason as its title

#### What changed

Every row and node that differs from a baseline carries a dot, and the row menu offers the
baseline's value back. The inspector's View menu holds the switches: Marks, on by default,
Changed only, and under Baseline the two a change is measured from, Opened for the file as it was
opened and Game for the game's copy. The two names are the row menu's own, Revert to opened and
Revert to game.

```
Changes v                         Rate           [ 12.0 ] *     filled dot: changed
  [x] Mark changes                Birth color    [#ff8800] *    green dot: added
  [ ] Changed only                Shape          ( 3 )  o       ring: a change inside
  (o) Compare with the file as opened
  ( ) Compare with the game's copy
```

- the file as opened is the bytes the document was read from. A save leaves it as it is, since
  every edit saves on its own, so it keeps what this session changed. A reload reads it again
- the game's copy is each object as the first game archive that declares it holds it. An
  object no archive declares is added
- a struct, and a list or a map of structs of one class, is compared field by field, so an edit
  inside an emitter marks that field. Any other value is compared whole
- a dot is amber for a changed value, green for an added one and red for a removed one. A ring
  marks a holder, a node or an emitter with a change inside it, and a node carries its dot on its
  top right corner
- Revert to opened, or Revert to game, writes the baseline's value back as one undo step. A
  property the baseline lacks is removed, and one only the baseline holds is written back
- Changed only lists the changed properties alone in the inspector and fades every node of the
  Graph pane without a change
- a declared document reports no changes here, since its declarations already mark what it
  changes and Reset to default drops them

### Preview lifetime

Open documents and visited pane tabs retain their content while hidden. Switching an object
between its class view and Properties retains the class preview. Returning from an ability
preview restores the skin preview's camera and playback position. Closing a pane or document
releases its content. Which preview a skin's viewport shows is in "The preview" of
docs/ux/SKIN_EDITOR.md.

A hidden viewport stops rendering, and a hidden document pauses its particle simulation.
Showing it resumes from the same time. Hidden zero-size measurements do not change the class
view's layout. A canvas is created only after its viewport first has a visible, usable size.

## The object tab

An object opens as a document of its own. [ADR-0028](../adr/0028-an-object-is-a-document-of-its-own.md)
records the rule, and the [objects browser](PROJECT_EDITOR.md#objects-browser) is the tree that
opens one.

### What it is keyed on

A declaration: the asset and the object hash. Two files declaring one hash are two tabs. The
install's copy and a layer's sit side by side, and the layout is the diff.

| Part      | Reads                                                             |
| --------- | ----------------------------------------------------------------- |
| Title     | The last segment of the object path, `Resources`                  |
| Context   | The declaring file, `Aatrox.wad/…/skin0.bin`, or the layer's path |
| Tooltip   | The whole object path                                             |
| Copy path | The whole object path                                             |

### What it draws

The object's properties, from depth zero. The header is the object, and no row repeats it.

```
│ File Edit View  Aatrox.wad/…/skin0.bin > SkinCharacterDataProperties                         │
│ ├ skinClassification            u32          1                                               │
│ ├ championSkinName              string       "Justicar Aatrox"                               │
│ ├ ▸ skinMeshProperties          embed        SkinMeshDataProperties                          │
│ └ ▸ armorMaterial               list[embed]  8 items                                         │
```

The facts sit at the trailing edge of the tab row, the [document chrome](PROJECT_EDITOR.md#document-chrome)
rule of one row per leaf.

| Fact  | Reads                                                                       |
| ----- | --------------------------------------------------------------------------- |
| Class | The class the declaration carries, as a [card](#the-class-card)             |
| Mode  | The layout or Properties, where the class has a [layout](#class-views)      |
| Menu  | The object's, the class's and the view's actions, per [Menu bar](#menu-bar) |

The other files declaring the object are in the [Sandbox options](#the-sandbox), which lead
the row.

The row carries no property count. The tree under it is the count, one row per property, and a
tally of what is already on screen is a fact the reader reads twice.

**The row holds what the reader looks at, and the menu bar holds what they do.** The class and the
mode stay at every width. A toolbar never wraps or scrolls, because a second row costs the tree a
row of content at the width that has the least of it, and a control that has scrolled out of a row
is a control nobody finds.

### Menu bar

Every object tab leads its row with a menu bar. It is the shared `Menubar` of `src/components`,
drawn from a table of commands by `CommandMenubar` in `src/modules/editor`. A view builds its table
from the state it reads, so an item shows what applies now and a key the handler answers. The bar
mounts inside the scope of the view that it serves and portals into the `menubar` slot of the row.

| Menu | Items that every view has                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File | Save. The view's file actions. Reload after a conflict, Show in file, Duplicate as new object, Declare edits                                                            |
| Edit | Undo, Redo. The view's edits. Find object references, Find class references. The Copy submenu of the path, the declaration, the hash, the class name and the class hash |
| View | The layout and Properties, as a choice. The view's items. The Panes submenu of a shell, Collapse all. Keys and gestures                                                 |

| Class                                                           | Menus                                                     | Described in                              |
| --------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| A class without a layout                                        | File, Edit, View                                          | This section                              |
| `StaticMaterialDef`                                             | File, Edit, View, Preview                                 | [The material shell](#the-material-shell) |
| `CustomShaderDef`                                               | File, Edit, View, Preview, Shader                         | [The material shell](#the-material-shell) |
| `VfxSystemDefinitionData`                                       | File, Edit, Insert, View, Playback, Emitter, Graph, Curve | docs/ux/VFX_GRAPH.md                      |
| `SkinCharacterDataProperties`, `TftSkinCharacterDataProperties` | File, Edit, View, Animation, Skin, Physics, Spells        | docs/ux/SKIN_EDITOR.md                    |
| `AnimationGraphData`                                            | File, Edit, View, Clip                                    | docs/ux/SKIN_EDITOR.md                    |
| `Map`, `MapSkin`, `MapContainer`                                | File, Edit, Insert, Tools, View, Map                      | docs/ux/MAP_EDITOR.md                     |
| `ViewController` subclasses, `UiPropertyLoadable`               | File, Edit, Insert, View, Canvas, Arrange                 | docs/plans/atlas-ui-editor.md             |
| `UiElementIData` subclasses                                     | File, Edit, View, Canvas, Arrange                         | docs/plans/atlas-ui-editor.md             |
| `GameFontDescription`                                           | File, Edit, View, Preview                                 | docs/plans/atlas-ui-editor.md             |
| `ContextualActionData`                                          | The bar of the audio document                             | docs/ux/CONTEXTUAL_VOICE.md               |

The bar follows "Menu bar" in docs/ux/AUDIO.md: the WAI-ARIA pattern, Alt or F10 to reach it, a
chosen item returning focus to where it was, and the titles moving from the end into one overflow
menu in a narrow row. A menu keeps its titles in Properties, in a narrow pane and in a read-only
document. An item that does not apply there is disabled, and it shows the reason under its words
where the reader cannot see it. An item that the class can never have is left out.

The bar lists what the viewport rails, the toolbars and the context menus offer, and those stay
where they are. Keys and gestures opens a sheet of each key that the bar shows, by menu. The
palette lists the bar's commands while the tab is open.

A pane offers the commands that read its own state through `usePaneCommands`. Where two panes offer
one command, such as Delete in the Graph and in the timeline, the item acts on the pane the reader
last focused and its words name the target.

### Duplicate as new object

In a document that takes edits, the File menu carries Duplicate as new object. A dialog asks for the
name, which starts as `Mods/<mod>/<the object's last segment>`. The copy lands in the same file as
one undo step, as the file tab's own Duplicate as new object lands, and opens in its own tab. A name
the file holds is refused under the field, and the dialog stays open. This is how a shipped particle
system becomes a variant of the modder's own while the game's stays as it is.

### How it opens

An object tab is a preview document. A single open replaces the previous preview, a double click
pins, and `Ctrl+Enter` opens beside.

| From                          | Gesture                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| A `$` hit in the project bar  | `Enter`                                                    |
| An object block in a file tab | Open object in the context menu, or the row's hover action |
| An objects browser row        | A click                                                    |
| A link chip                   | A click                                                    |
| A References row              | `Enter`                                                    |

The file tab keeps its inline blocks. A file is a file, and a bin holding three objects reads
better as three blocks than as three rows opening three tabs.

### Reveal in Objects

The tab's menu and an object block's menu carry Reveal in Objects. It opens the objects
browser, expands the object's path and focuses its row.

## Links

A value that names something the manager can open draws as a mono `Code` chip, per
`DS-CODE-CHIP`. A click opens the target, `Ctrl+click` opens it beside, and the context menu
carries the same pair. A value nothing resolves draws as dim hex and is not a chip.

A chip's hover card shows the target's path, its class, its declaring file and its declaration
count.

**A path under the row's object drops that object's path.** A UI scene names its elements under
its own path, so a column of them repeats one long folder and differs only at the end. The chip
draws an ellipsis for the object's path and the rest after it, and the hover card and Copy value
keep the whole path. The object is the one the row sits in, which a scroll or a page landing
never moves.

```
ClientStates/Gameplay/UX/Chat
  BaseLoadable     link  [.../UIBase]                             UiPropertyLoadable
  ChatFrameBounds  hash  [.../UIBase/ChatFrame/ChatFrame_Bounds]  UiElementRegionData
```

**A resolved chip names its target's class after it,** in the class hue with the class card on
hover, the way an `embed` row names the class it holds. The class gives way before the chip on a
narrow pane.

### An object link

An `ObjectLink` names an object that this file may not hold. The index resolves it, per
ADR-0028, and the row says which outcome it has.

| Where the target is                 | The chip                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| In this file                        | Opens the object tab over this asset                                     |
| In a file this bin depends on       | Opens the object tab over that file                                      |
| Elsewhere in the install or a layer | Opens the first declaration in archive order. The rest are in its header |
| Nowhere the index knows             | Dim hex, and no chip                                                     |

Each page of rows checks its targets against the index in one call, the call the palette's
override line uses. While the index is absent, only this file's own objects are checked. A link
outside the file draws as a chip, and its click builds the index.

### A hash

A `Hash` is FNV1a32 of a path. One the index declares an object under is a link to that object,
resolved by the same check and drawn as the same chip. A hash nothing declares is text.

### A WAD chunk link

A `WadChunkLink` holds a path hash into the archives. The
[WAD path resolver](PROJECT_EDITOR.md#hash-names) turns one into a path, and the
[preview document](PROJECT_EDITOR.md#how-a-preview-reaches-the-screen) opens a chunk by hash.
The chip opens the chunk in a preview tab, and a bin chunk in a bin tab.

On the layer side the target is looked for in the layer first and in the install second. The
chip carries the side that answered, in the word the palette's layer rows use.

**A link to a texture carries a swatch.** The swatch sits after the chip at row height, the way
the `Color` swatch does, and a hover card at 256px carries the texture facts. The swatch opens
the preview as the chip does. The pixels arrive over `ltk-asset` with the `?w=` parameter the
[explorer thumbnails](PROJECT_EDITOR.md#thumbnails) are specified on, under the same queue. Any
other kind carries its kind badge.

### A string that names a thing

A `string` is text to the format and a name to the game, which resolves a path held in one by
name while it runs. Two shapes of string resolve here, and a miss on both draws text.

| The string                                 | Resolves through                       | Draws                              |
| ------------------------------------------ | -------------------------------------- | ---------------------------------- |
| A folder and a file name with an extension | The WAD path resolver, the layer first | The chip and swatch a `file` draws |
| Any, hashed as an object path              | The index, in the row group's check    | The chip an `ObjectLink` draws     |

A path counts under any root, because a mod's own chunks sit under roots of its choosing, such as
`mod/83f7e874bb9f/`. Outside `ASSETS/` and `DATA/` a path holds no whitespace, so that prose with a
slash in it stays text. A string that answers on both sides takes the chunk. So an emitter's `texture`, a skin's
`simpleSkin` and `skeleton`, a clip's `mAnimationFilePath` and a system's `particlePath` are
chips in every bin, in the tree and in every layout.

A path is resolved and drawn lowercased, which is the one spelling the resolver, the layer's
copy and the preview all answer under, and an author's own capitals are not it. The hash is
the game's FNV-1a over the lowercased string, which the class views reuse. A string joins the
hashes and the paths its row group already sends, so neither shape costs a call of its own.

### A project names its own chunks

The shared tables are a crawl of the retail game, so a path or an object a mod author invents is
in none of them. A project's own content names those, and a bin opened out of a layer reads
both: every file of every layer at its path inside its archive, and every table the project's
manifest declares, each under its category. A `game` table names chunk paths, a `binentries`
table the objects the project's bins add, and a `binhashes` table the strings behind their
`Hash` values. The project answers first, and only a hash it does not name reaches the shared
tables. Classes and properties stay with the shared tables, and a table of a category the
tooling does not know is skipped.

The scan runs once with the parse and is held with the open document, so a file added while a
document is open is named the next time it opens.

### A chunk nothing holds

A `file` whose path resolved and whose chunk neither a layer nor the install holds draws that
path with a warning mark. The path is what the file asks for, and the mark is that nothing
answers it. A hash no table names keeps its hex and no mark, because an unnamed chunk says
nothing about whether it is there.

A layer's copy is found at the file's path inside its archive, which is the layer entry's own
path without its leading archive directory. The document's own layer answers first. A game bin
opened in a project is in no layer, so the highest-priority layer that has the file is used.
That is the copy the game loads when the mod is enabled.

A miss never builds the object index. A `link` a reader clicks says they want the target, and
a string that happens to hash to nothing says nothing at all, so an absent index leaves every
string as text rather than as a page of chips that would each warm it.

Copy value hash on a resolved string offers the object hash the string was resolved under. A
string that resolved as a chunk carries none, because the hash a chunk answers to is the
resolver's over the path rather than a value the row holds.

### A string-table key

A string that names neither a chunk nor an object may be a key of the game's string table, such
as `hud_Chat_Party`. One shaped like a key - one word holding an underscore - joins its row
group's check, and a key the table holds draws as a chip followed by its in-game line, dim and
quoted.

```
|  PartyChatChannelTra  string  [hud_Chat_Party]  "Party"  |
```

The line is the install locale's, which is the text the [strings](PROJECT_EDITOR.md#strings)
editor shows under an override. The chip's hover card carries the whole line. A click opens the
overrides of the document's own layer, or of the selected layer for a bin of the install, in
the `default` locale, filtered to the key. A key the layer does not override yet starts in the
composer with the in-game line as its text.

The first check of a session builds the string index, so the lines arrive after the rows. A
`file` link does not wait on it.

## Classes

A class name appears on the object block, on the object tab's header, on a `pointer` and an
`embed` row, on a container's element rows, and on an objects browser row. Every one of them is
the same control.

It draws in the class hue rather than a neutral rung, `DS-KIND-HUE`, so a name the meta schema
declares reads apart from the names a modder writes. The kind tag takes the other half of that
pair, so a row's two type words are told apart by hue the way an editor tells a type from a
keyword.

### The class card

The card opens on hover after the tooltip delay and closes when the pointer leaves both the name
and the card. It reads and does nothing else, per `DS-MENU-SCOPE`: it carries no action, and the
name under it takes no click of its own, so a click there expands the row like a click anywhere
else on it. The pointer reaches into the card to scroll the field list and to select a hash.

| Shows     | From                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| Name      | The tables, and the hex where no table names it                                  |
| Bases     | The classes it derives from at the build, nearest first, each opening its card   |
| Counts    | The fields it and its bases declare, and the install's objects of the class      |
| Prose     | The wiki's documentation for the class, per [the wiki's prose](#the-wikis-prose) |
| Patch     | The patch the schema answered at, or that it has no line                         |
| Meta wiki | A link to the class's page, where its fields are written                         |

The object count comes from the object index, and is left out while the index is absent or
building. A card carries no hash: Copy class hash is on [the row menu](#the-row-menu), and a
class no table names shows its hash as its name.

The class name's actions are on [the row menu](#the-row-menu) where a row carries it, and on the
object tab's Edit menu where no row does.

The card sends the fields to the wiki rather than listing them. `meta-wiki.leaguetoolkit.dev`
serves a page per class at its lowercased name, and that page carries every property with its
type, its default and its patch history - more than a card can hold and more than the schema
snapshot knows. A class no table names has no such URL, so it carries no link.

The link is the one thing a card does that is not reading, and `DS-MENU-SCOPE` allows it: a link
goes somewhere rather than changing something, and burying the wiki behind a right-click is
hiding the card's most useful line.

The schema crosses IPC once per class and is held on the frontend for the session. The meta
schema ships in the build as the snapshot `pnpm generate:meta-schema` writes, read through
`core/src/meta_schema.rs` and keyed on the install's game build.

### The field card

A field name is the same control as a class name: a card on hover after the tooltip delay,
closed by leaving it. The name draws under a dotted underline while the pointer is on it, which
marks the card without making the name a second click target inside the row.

| Shows       | From                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| Title       | The label the row shows, where it says other words than the field's name          |
| Signature   | The field's name, then its kind and class after a colon: `rate: embed ValueFloat` |
| Declared on | The base class that declares the field, where the row's class does not            |
| Default     | The schema's constructor default, in the row's own notation                       |
| Mismatch    | A warning naming the file's kind and the schema's, where the two differ           |
| Type change | The type an earlier revision had and the patch it changed at, if it changed       |
| Prose       | The wiki's documentation for the field, per [the wiki's prose](#the-wikis-prose)  |
| Meta wiki   | A link to the field's section on the wiki page that documents it, if any          |

The card's content scrolls under a cap and the footer with the wiki link stays in view, so long
prose never cuts a section in half. The signature is colored as a bin preview colors it: the kind in the kind hue and the class
in the class hue, per `DS-KIND-HUE`. The card's text is a step larger than a hover card's own.
A class on the card opens its own class card on hover. A value family's default is its
constant, the way its row draws it. A struct, a pointer and a container show no default, since
their default is their class's own defaults. A field no table names shows its hash as its name,
and Copy field hash is on the row menu.

Every field name that opens this card - a tree row, a class view row, the VFX inspector's rows,
the emitter table's column headers and the force rows - shows the same documentation.

Copy name and Copy field hash are on [the row menu](#the-row-menu).

The kind shown on the row stays the file's kind, per [The property row](#the-property-row).

### The wiki's prose

The LoL Meta Wiki documents some classes and their properties with a description, notes and
examples, each in markdown. A card shows this text below the schema lines, and long text scrolls
inside the card. A relative link in the text opens on the wiki. A class or field without
documentation shows no documentation section.

A field is documented on the class that declares it, which is often a base of the class the row
is read on - `mMesh` of a `VfxPrimitiveMesh` is documented on `VfxPrimitiveMeshBase`. The card
checks the row's class and then its bases in the schema, uses the first documentation it finds,
and links to that class's page.

The app fetches all documentation in one request to `/v1/docs/all` and caches it in the meta
schema database's directory. The first card opened in a session starts a background refresh. The
refresh sends at most one request every six hours across sessions, with the cached copy's tag, so
the wiki returns `304` with no body when nothing changed. A card reads the cached copy immediately
and reads again when a newer copy is installed. Offline, cards read the cached copy, and a machine
that never reached the wiki shows no documentation.

The documentation is CC BY-SA 4.0 under the wiki's developer tooling exception, which requires
attribution. The About section credits the wiki.

### Find all references

For a top-level class the index answers at once. Every declaration carrying the class hash is a
row, grouped by file. An embedded class and an object's incoming links are answers of the walk,
which the References document describes. Find references sits on every menu an object has, on the
menu of a row whose value carries a class, and in the object tab's Edit menu.

The row a menu opens on decides which question it asks. An object row and the object tab's Edit menu
ask for the objects of the class, and an `embed` or a `pointer` row asks for every value of the
class at any depth.

## Searching an open bin

The project bar's `@` scope over the active bin or object tab lists the rows whose name or value
holds the query, case aside: a string, a number, the name behind a hash or a link and its hex, a
file's path, and the class a struct holds. An object tab searches its object alone. A file tab
over a `PTCH` searches its targets, its records and the rows under them after its objects. Each row reads
by its name over its readable path, with its value at the trailing edge, and the backend answers
the first 200 in tree order.

`Enter` expands every level above the row, asks a level for its next page where the row sits past
a page boundary, focuses the row and scrolls to it. An object tab in its class view switches to
Properties first, the one mode that draws every row.

## Class views

A class view is a layout over the rows, and the tree stays underneath.
[ADR-0030](../adr/0030-a-class-view-is-a-layout-over-the-rows.md) records the rule, and
`docs/research/bin-editor-higher-order-views.md` the evidence it was decided on.

### A mode of the object tab

An object whose class has a layout opens in it. A segmented control in the toolbar, before Show
in file, switches between the layout and Properties, which is the tree the tab draws today. The
choice holds while the tab is open and resets when it closes. A class with no layout draws no
control.

```
+-----------------------------------------------------------------------------------+
| StaticMaterialDef . 9 properties                  [ Material | Properties ]   [:] |
+-----------------------------------------------------------------------------------+
| v IDENTITY                                                                        |
|   name                Ezreal_Base_Mat                                             |
| v SAMPLERS                                                                        |
|   +----+                                                                          |
|   |    |  Diffuse_Texture                                                         |
|   |    |  ASSETS/.../ezreal_base_tx_cm.dds    U 0   V 0   W 0   Mag 1   Min 1     |
|   +----+                                                                          |
| v PARAMS                                                                          |
|   Fresnel_Power       x 4.00   y 0.00   z 0.00   w 0.00                           |
| v SWITCHES                                                                        |
|   [x] USE_EMISSIVE                                                                |
|   [ ] USE_FRESNEL                                                                 |
| v MACROS                                                                          |
|   v shaderMacros      map[string,string]   3                                      |
| v TECHNIQUES                                                                      |
|   v techniques        list[embed]   2                                             |
| v OTHER                                                                           |
|   > childTechniques   list[embed]   1                                             |
+-----------------------------------------------------------------------------------+
```

The file tab keeps its blocks. A layout is the object tab's, per ADR-0028.

### A map's files

A `Map`, a `MapSkin` and a `MapContainer` open in a shell of four panes: the drawn map, an
outliner of its chunks, its visibility, and the object's sections. The outliner lists each
`MapPlaceableContainer` of the map's `.materials.bin` and what it holds. A row sends the camera
to where its placeable stands, and an eye hides a chunk or one placeable from the scene.

The Visibility pane is a tab behind the outliner. It lists the layers of the map and the
visibility controllers that its `.materials.bin` declares. A layer has a checkbox that changes
the active flags of the preview. A controller that depends on no other controller has a checkbox
that sets its state. These controllers are grouped as Terrain, Stage, Mutator and Other. A
terrain is titled by its layer, a stage by its stage and a mutator by its name, each followed by
the controller's name, or its path hash if no hash table has the name.

A controller that depends on other controllers has no checkbox, because its state is computed.
It is listed under each controller it depends on, with a plus if it is shown while that
controller is shown and a minus if it is hidden, and an eye for its current state. A row opens
the controller object in its own tab, and the reset returns the map to its own defaults. The
rules are ADR-0064.

A search box over the outliner keeps the placeables whose name or class holds its text, and every
placeable of a chunk whose own name does. A chip per kind the map holds keeps only that kind.
Under a search each chunk with a match opens by itself and counts what it keeps of what it holds.
A placeable an event shows carries a lightning mark, and the preview plays it only with Event
effects on or while the reader has it selected. The tree is one tab stop: the arrows walk and fold it, Enter flies to the row, and
Ctrl+F returns to the box.

The Placeables switch in the preview marks every placeable the outliner lists with a dot in its
kind's colour, drawn through the map at one size on the screen. The Box select tool takes the
primary button: a drag selects the dots inside its box and a click the one under it, Shift adds
and Ctrl flips, and the other buttons still move the camera. The outliner and the preview hold
one selection. A click on a row selects it alone and flies to it, Shift and Ctrl edit the
selection there too, and Ctrl+A selects every row listed. A bar over the tree counts the
selection and frames, hides, shows or clears it. A pick opens the chunk of the placeable picked
last and scrolls the outliner to it, and the inspector heads its sections with that placeable's
own fields, read in the `.materials.bin`, with a button that opens its chunk's tab at the row.

A `.mapgeo` and a `.materials.bin` open on the same map, because the map is what a reader of
either file came for. The path says which map it is, since both files are the map's entry path
under `data/`. A `.materials.bin` keeps its blocks behind a Map and Objects switch in the
toolbar, and a `.mapgeo` has no objects to switch to. The panel beside the map switches between
the outliner and the visibility. A file no hash table names has no path to
read, so it opens as the blocks it always did.

Everything the scene reads is looked for in the project first and the install second: the
geometry, the materials, their textures and the skins of what the map stands. A file an unpack
named by the hex of its chunk hash answers the path that hashes to it, which is how the game
itself reaches it.

The editing tools of the map shell are specified in docs/ux/MAP_EDITOR.md.

### The order of a file's objects

A file's objects are listed by class and then by name, digits by their value and without regard
to case. A file keeps them in the order its hash table fell out in, which says nothing to a
reader, and sorting by class keeps the hundreds of materials a map declares apart from the one
container that names it. A class or an object no table names sorts after the named ones. A
patch's targets stay after the objects.

### A layout is complete

A layout places every depth-zero field of the object in a section. A field with a purpose-built
widget takes it, and every other field takes the cell its row would draw. A field the layout
does not name falls into a last section, Other, drawn as the field rows of those fields, a struct
among them opening in place. So a field the game adds in a patch is on screen the day the schema
changes, and a layout is a placement rather than a whitelist.

A headless layout draws its sections without headers or folds, for a layout whose one widget is
the whole view, such as Voice lines. Its Other draws as field rows when it holds a field, and
draws nothing when it is empty.

A layout can also list the fields that the object does not author. The particle system's layout
does this, because a system file authors only a few of its fields. Each of those fields draws at
its schema default in the section of field rows that names it, or in Other, and an edit adds it to
the object. A field that a widget's section names is left to the widget. The fields draw only
while the inspector's Defaults switch is on, and Changed only hides them.

**A layout draws one kind of row.** Every section of named fields, every list and Other draw
`FieldRow`, the row [the inspector](#the-inspector) draws, and every one of them shares a name
column measured over the names the layout draws. A nested row indents inside that column, so a
value starts at one x at every depth. A tree with its kind tags beside a field row without them
is two grammars for one reader, and its name column starting at a second x is what made a pane
of both read as ragged.

A section whose list is empty keeps its header and draws a muted None beside its title, so a
reader tells an empty list from a field the class lacks, and every object of one class has one
section order. A list section and Other carry their count there instead. The header sticks to the
top of the column while its rows scroll, and a rule divides it from the section above.

Sections collapse and open by default. A section a reader folds stays folded for every object of
that class, app-wide, because the section a modder never reads is a property of their work
rather than of the file.

A section the tree draws opens the fields the layout named for it, and a reader sees one level
of each without a click. A tree section scrolls at twelve rows, so no one section owns the page.

### The registry

A layout is data, keyed on the class hash, with each subclass listed by hand because the schema
carries no inheritance. It names its fields by name, and a frontend FNV-1a turns each into the
row's hash at module load, checked by a test over known pairs.

A section names one widget or none. `rows` is the elements of the containers the section placed,
each a field row that opens in place, which is what a list takes. `override-rows` is the same over
a list one level down, which is how the skin reaches the mesh's material overrides. It draws them
as a table of submesh and material, the material a chip reading its name, and each row folds open
to the override's other fields, its textures among them. `icons`, `mesh`, `effect-table` and
`condition-rows` are the skin's own, and `emitters` the particle system's, each reading the fields
of one class. `condition-rows` reads down to each condition's drivers, and a condition's row
reads its effects and its submesh lists when the row is unfolded. `fields` draws the sub-fields a section names under the row it
placed, which is what a one-field embed such as `skinAnimationProperties` takes. `tree` is the
tree rooted at the section's own fields, which is what a nested structure takes. A section that
names no widget draws each of its fields in the cell that row would draw.

**A list draws as rows, not as a table of its own columns.** A table asks a reader to learn which
column is which and then holds them to the fields it chose, where the same elements as rows read
the way the rest of the editor reads and open to everything the element carries. The tile and the
columns a table spent its width on are what a row gives up for that.

A widget also declares how far under its own fields it reads, one step per level, and a step
names which of a level's rows carry on down. So the skin's material overrides reach
`skinMeshProperties.materialOverride` and the elements under it without the mesh's other fields
costing a call of their own.

```ts
export const materialLayout: ClassLayout = {
  title: m.workshop_bin_layout_material,
  sections: [
    { title: m.workshop_bin_section_identity, fields: ["name", "type"] },
    {
      title: m.workshop_bin_section_samplers,
      fields: ["samplerValues"],
      as: "rows",
    },
    {
      title: m.workshop_bin_section_params,
      fields: ["paramValues"],
      as: "rows",
    },
    {
      title: m.workshop_bin_section_switches,
      fields: ["switches"],
      as: "rows",
    },
    {
      title: m.workshop_bin_section_macros,
      fields: ["shaderMacros"],
      as: "tree",
    },
    {
      title: m.workshop_bin_section_techniques,
      fields: ["techniques"],
      as: "tree",
    },
  ],
};
```

One renderer draws every layout. Rust knows no class.

### A cell is a row

Every cell is a path and a value, the pair a row carries, drawn in the widget the row would use:
a field, a checkbox, a chip, a swatch. When leaf editing lands, a cell edits through the patch a
row would send, and a layout never holds state of its own.

A cell carries the key of the row it draws rather than of the element it sits in. The menu over
the mesh's `simpleSkin` is that row's, and Show in properties from it reveals
`skinMeshProperties.simpleSkin`. A section drawn as rows carries [the row menu](#the-row-menu)
itself, because its rows are the tree's.

A cell's context menu is [the row menu](#the-row-menu), plus Show in properties, which switches
the mode and reveals the row in the tree, expanding the ancestors of a nested key. A layout has
no keyboard model beyond its fields, and its read-only fields take no focus,
per [The value kinds](#the-value-kinds).

### A value family in a layout

A `ValueFloat`, `ValueVector2`, `ValueVector3` or `ValueColor` row draws its constant alone
wherever a layout draws it, without the class [the tree](#a-value-family-on-its-row) names beside
it. The wrapper is how the game stores an animatable number, and the layout is where a reader
asks what the number is, so a cell that spends its width on `ValueFloat` has answered a question
nobody put. The tree keeps the class, because there the class is what the row is.

Where the row's `dynamics` points at a curve the cell takes a mark, since the constant alone
would read as the whole value. The first level of the value read answers `constantValue` and
`dynamics` together, so the mark costs no call of its own.

A field row draws the shape rather than the mark, in every layout that draws field rows: an
animated row takes its curve on a plate in its value column, per
[the inspector](#the-inspector). A table cell keeps the mark, and so does a field row whose keys
the read has not answered.

### What a layout reads

The depth-zero rows arrive with the open. A nested row arrives through
[the projected read](#the-projected-read), one call per level with the paths of a section
batched under the call's cap. A section of rows costs one level, the elements of the containers
the layout placed, and every section of one layout shares that call. The rows under an element
are the tree's own fetch rather than a level of the read. A widget that draws named cells costs
the level under its elements too, which is as deep as a layout reads. A tree section reads
nothing until a reader expands it.

A widget that joins a second object reads it through the same handle, because a read names the
entry it walks. The inspector reads a child lane's emitter the same way, since the run inlines a
child system only where the open document declares it. Only an object another file declares
costs an open of its own, which is what the skin's VFX table does to reach its resolver.

A texture cell draws by the row's kind. A `file` takes the chip and swatch a row takes, a
`string` that resolves as [a string that names a thing](#a-string-that-names-a-thing) takes the
same, and a path neither side holds draws as text. The skin's icons draw as tiles, because the
pictures are what that section is opened for. The mesh's textures are field rows with the swatch
a `file` takes, the way an override's texture draws, since the preview beside them already draws
what they dress.

A path is cut inside its folder where the column runs out, so the root that names the champion
and the file name both stay. The whole path is on the chip's hover. The side a `file` chip
answered on carries its mark, a layer's glyph or an archive's, and names itself in full on hover.

An idle effect is keyed by `effectKey`, or by the hash of its `effectName` where it carries no
key, and one the resolver answers for neither draws its name. Its row carries the bone it sits
on and, after an arrow, the bone it aims at. The system's chip reads its last segment alone,
the whole path on its card, because every effect of a skin shares the folder its systems sit in
and a column of that folder hides the one word that tells the rows apart. An object link
anywhere else is cut inside its folder, as a `file` path is.

A widget of named cells draws the fields it names and no others, which is what the icons, the
mesh and the VFX join do. Everything else a class carries is reachable through the rows and
through Properties.

### The layouts

| Class                                               | Sections                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `StaticMaterialDef`                                 | Identity, Samplers, Params and Switches as rows, Macros and Techniques as nested trees, Other, beside a preview and its program |
| `SkinCharacterDataProperties`, and its TFT subclass | Identity, Icons, Mesh, Material overrides, Clips, Animation, VFX, Audio, Health bar, Other, beside a preview                    |
| `VfxSystemDefinitionData`                           | Identity, Emitters as a strip of cards or as a table, Audio, Other                                                              |
| `AnimationGraphData`                                | Clips as a table with Tracks, Masks and Sync groups as its tabs, Other                                                          |

The material, the skin, the particle system and the animation graph are the registered
layouts, with the value rows beside them.

A layout draws no Used by. Reverse references are the walk's, and Find class references in the
Edit menu is the affordance until it ships.

### The skin shell

The shell a `SkinCharacterDataProperties` object draws in, its preview, and its Spells, Clips,
Material, Skeleton and Physics panes are in docs/ux/SKIN_EDITOR.md.

### The emitter strip

The strip is the Emitters pane of the particle shell, and a stack's Emitters section. The shell's
default arrangement draws the lanes of [the timeline](#the-timeline) in its place, and the Panes
menu opens it.

Both of Riot's particle editors draw a system as a row of emitter cards, and the Emitters section
draws the same: one card per element of `complexEmitterDefinitionData` and
`simpleEmitterDefinitionData`, in one strip that scrolls sideways, a card off the second list
marked as simple. A card carries the emitter's name, its index in its own list, a square, and one
chip per group of fields it sets. A `disabled` emitter dims and takes a struck eye.

The square is the texture the emitter draws, and where it names none, its `birthColor`: the band
its stops make where it animates, and its constant where it does not. An emitter with neither
takes the tile a missing texture takes.

**A card has three targets and each does the one thing it looks like.** The name row opens the
emitter, the square opens the texture it draws, and a chip opens the emitter at that group. A card
the read has not answered the fields of still opens, on no group, because a card that does nothing
when clicked reads as a card that is broken.

A chip scrolls the panel under the strip to that group, which draws the emitter's other groups
above and below it, each field in the cell its own row draws. The strip opens on the first emitter
at its first group, because the read has answered every field by then and an empty panel says
nothing. Reading an emitter whole is Properties, which is the whole object.

**The card is sized to its name.** A card a reader cannot tell from the next one is worth nothing
however many of them fit, so the width is what a typical emitter name reads in rather than what
the square or the group names need.

**In a pane the cards wrap, in a stack they scroll sideways.** A pane is sized by the reader, so
the count on screen is theirs to set: the cards flow into as many rows as its height allows, and a
system of sixty is a page rather than a sideways walk. The stack draws the same cards in the one
row it has room for, under a column that is already scrolling.

A field over the strip narrows both readings to the emitters whose name holds what was typed,
case-insensitively, and says how many of how many are drawn while it holds anything. It sits
beside the reading control, on the stack's own row and in a pane's strip. The open emitter stays
open while it matches, and the first match opens when it does not. The table narrows on what the
strip left rather than matching the names a second time, so the two cannot drift.

The groups are Birth, Position, Render, Scale and Texture, the components both of Riot's editors
draw, and Emission, Colour, Material and Effects for what the class carries and those five do not
hold. Primitive holds `primitive` alone, out of Render, because the class it names decides what
every other group draws onto, per [the primitive](#the-primitive). Which fields each holds is a table written by hand, so a field the schema adds falls to
Other and is on screen the day it appears rather than landing in a group by accident. Birth is
the value a particle starts with and every other group is what it does over its life, which is
the line that puts `birthScale0` under Birth and `scale0` under Scale. Texture holds the effects
that change how the texture draws, alpha erosion, distortion and reflection, and Effects holds
the rest.

A card and a table are two readings of one list, and a control on the section switches them. The
strip says what one emitter is. The table compares a field down every emitter of the system,
which is what a modder tuning a timing reads. Both move sideways, and both take a plain wheel, so
the emitters past the edge are reachable without holding shift.

The panel scrolls past a dozen rows rather than growing, because a Position or a Render group runs
to thirty fields and no section owns the page.

### The shell

A layout declares the frame it draws in, and the frame is the stack of sections unless it says
otherwise. `VfxSystemDefinitionData` declares a shell, per ADR-0031, because a particle system is
tuned rather than read: a change to one emitter's `rate` is judged against that emitter's curve,
its other fields and the particles themselves. A scrolling column
holds two of those in view at best.

The skin declares a shell too, per ADR-0036, which docs/ux/SKIN_EDITOR.md describes. Each
shell's arrangement is its own, so arranging the skin's panes leaves the particle system's
where they were.

```
+----------------------------------------------------------------------------------+
| VfxSystemDefinitionData  Ahri_Base_Q_mis > Orb [0]   [System|Properties]         |
+------------------------------------------------------+---------------------------+
| PREVIEW  [Ground][Midlane][Gizmo][Stats][Cam v][Fit] | INSPECTOR                 |
|                                      [Ground Auto v] | [Emission][Birth][Scale]  |
|                                                      | v EMISSION                |
|                      (viewport)                      |   rate           1  ___/  |
|                                                      |   lifetime       1 s      |
|                              1,204 particles  2.1 ms | v BIRTH                   |
+------------------------------------------------------+---------------------------+
| TIMELINE  < > >  0.42 / 1.60 s  1x                   | CURVE      [Graph|Table]  |
| [#] Orb           [0]  [####]~~~//               312 |  1.0 +--+                 |
| [/] Sparkles      [1]    [##]~~~~//               48 |  0.0 +---+-------+        |
+------------------------------------------------------+---------------------------+
```

**One row holds the object tab's header and the crumb.** The sandbox, the class, the crumb, the
mode control and Panes share it, and the preview takes the height of the row it
saves. The row starts with `Sandbox (<name>) >`, per [the sandbox](#the-sandbox).

The crumb names system and emitter, and each segment is a target the inspector draws. The system's
segment draws Identity, Audio and Other, which is where a shell keeps the sections a stack lists
down the page. The emitter's segment draws every group it sets, per
[the inspector](#the-inspector). A third segment names the group in view and opens a menu of the
groups, which draws that group alone. Selecting a lane or a card rewrites the crumb. A child lane's
emitter takes a segment of its own between its parent's and the group, and the parent's segment
goes back to the parent.

The Emitters pane's Table takes the shell's whole width and folds the inspector away. Thirteen
columns down sixty emitters answer without one beside them.

The curve pane holds its place until a mark targets it, where the dock in a stack is absent until
then: a pane that appears on a click moves every pane around it. It draws a muted line, and over
it a chip per field of the selected emitter that animates, each aiming the pane. The preview
draws the run per [the viewer](#the-viewer), and the timeline draws its emitters per
[the timeline](#the-timeline).

Below the width the panes need, the same layout draws as the stack, and nothing is out of reach on
a narrow window or with both sidebars open. The stack keeps the preview above the sections and out
of their scroll, the skin's character and the particle system's run alike, so the preview stays in
view while the sections scroll. A particle system's preview carries the mini transport there.

The strip and the lanes mark the squares' colours, and the inspector marks the rows it draws. No
other value family is marked. An emitter carries far more of them than any surface draws at once.

### The material shell

`StaticMaterialDef` declares a shell of two panes, per ADR-0047: the preview and the inspector
holding every section. The material drawn with its own translated shader is what its fields are
judged against, and the stack showed only the rows.

```
+----------------------------------------------------------------------------------+
| StaticMaterialDef  Characters/Ahri/Skins/Skin0/Materials/Body   [Material|...]   |
+------------------------------------------------------+---------------------------+
| PREVIEW   [Sphere v][Turntable][Ground] [Cam v][Fit] | INSPECTOR                 |
| The shader defs were not opened                      | v IDENTITY                |
|                                                      | v SAMPLERS                |
|                    (the shape)                       | v PARAMS                  |
|                                                      | v SWITCHES                |
|                                                      | v MACROS                  |
| [Draw on a shape]                                    | v TECHNIQUES              |
+------------------------------------------------------+---------------------------+
```

**The preview draws the character, and a shape behind a toggle.** Where a skin of the same file
draws with the material, the preview is that skin's, with its own transport and toolbar. A
texture is painted for the mesh it wraps, so a skin material reads right only there. A toggle in
the preview's corner, Draw on a shape, swaps in the shape. The toggle is a display preference. A
material no skin of its file links draws on the shape, with no toggle.

**The Objects grid draws a material as a thumbnail of its shape.** A sphere under the material's
translated passes, captured once their textures land, and drawing live while the pointer holds
the tile, as a particle system's does. A material with no pass that translated keeps the class
glyph and the failure mark.

**A shape draws every pass that translated, in order.** A sphere by default, or a cube, a plane or a
cylinder. The shape, the turntable and the ground are display preferences, so every material
opens on the ones a reader last picked. A skinned material draws
on a shape bound to one bone, since its shader takes the world transform from the bones. A
material whose passes all failed draws its shape in the error colour and says so in the corner,
and never falls back to the stock material, because a reader editing a shader needs to see that
it failed.

**The preview's corner says why it draws what it does.** A pass whose shader did not build, with
the reason, and the warnings about the material as a whole: no shader defs, no pass, a pass shader
that resolves to nothing, and an animated material whose preview holds its static values. A material that draws as written shows nothing there. The shader ids and
the define list stay out of the view, since no reader edits them.

The preview reads the open document, so an edit reaches it once it lands, before the file is
saved.

**A material's lists are tables.** Samplers, Params, Switches and Macros each draw a row per
element and a column per field: a sampler's name, texture and three address modes, a
parameter's name and value, a switch's name and whether it is on, a macro's define and value.
Every cell is the leaf editor its row would draw, and a field the element leaves unwritten reads
`default`.

**A row is one line.** The four tables share one name column, as wide as the longest name the
shader declares and never more than a third of the pane, so every value starts at one x. A
parameter's components keep one column each down the table, and a colour's swatch follows its
last channel. A pane too narrow for four components puts two on a line, the swatch on the first.
A sampler that writes none of its address modes reads `default` once across the three columns. A
pane too narrow for the table scrolls it sideways rather than cutting the texture's file name.

**The shader declares the rows.** Samplers, Params and Switches list every texture, logical
parameter and static switch the pass shader declares, in its order, and not only the entries the
material writes. A row the material leaves to the shader draws the shader's default in the same
fields a written value takes, with a dashed edge, no fill and muted text. Editing a default
parameter's field adds the material's own entry holding the new value. Pressing a default texture
adds the entry holding it, and a switch's box adds the entry holding the value it was set to. A
row with an entry of its own carries a reset, which takes the entry out so the default draws
again. An entry that names nothing the shader declares follows the
declared rows with a warning mark. Until the shader's defs answer, the tables list the entries
alone. A switch entry that leaves `on` unwritten is on, as the engine reads it.

**A row says what the game will do with it.** A texture whose path nothing on this machine holds,
a path written as a string, and a texture that no path reaches each put a warning mark on the
texture's row. A switch the shader compiles in carries a mark that changing it rebuilds the
shader. The preview draws the old shader until the new one answers, so a toggle never blanks it.

**Live values.** A parameter the material sets draws one field per component its mask writes,
labelled x to w, or r to a for a colour, each letter in its channel's colour as a vector's
components are in the tree. Dragging a label sideways scrubs the value, and every
preview drawing the material, the shape and the character, draws each step before anything
reaches the bin. Releasing the drag, leaving the field or pressing Enter writes the value once,
which is one undo step. The preview keeps the held value until the reads the write invalidated
answer, so it never draws the old value between. A parameter named `Color` or `Tint` with three
or more components carries a swatch that opens a colour picker, held live the same way and written
when the picker closes.

The particle system's, the skin's and the material's layouts take edits in place, the skin's
Material pane with them. The map's layout and a read-only document draw the same values as text,
with no field to hover.

**A shader def opens in the material shell.** `CustomShaderDef` declares the same two panes, per
ADR-0066. The inspector holds Identity, then Params, Textures and Switches as tables of the def's
own entries, then Feature defines as a tree. Params lists each physical parameter and its default,
Textures each texture, its default path and its shared sampler, and Switches each switch, its
default and its runtime flag.

**A default drags live on the preview.** A parameter's default scrubs as a material's
parameter does, drawn on the preview while held and written on release. A row that the drawn
permutation does not read carries an info note, and so does a compile-time switch that the shader's
TOCs do not declare. A parameter that has a note, or that the preview material sets, edits as a
plain vector, since a held value would not change the preview. The material's values carry no
note, since a material sets most of a def's rows.

**The preview draws the def through a material that uses it.** A def's defaults are placeholders
that every material overrides, most textures `black.tex`, and the game's shader cache holds only
the permutations that shipped materials select. So the preview draws the first `StaticMaterialDef`
that links the def, found by the reference walk, on the shape. The walk reads the open project's
layers before the install, so a material of the project comes first. The material's
textures, parameters and macros apply over the open def, so an edit to the def is drawn
once it is applied. Preview material in the toolbar lists every material that links the def,
and Shader defaults draws the def alone. A def that no material links draws its defaults.

**Defines picks the permutation the preview draws.** A submenu per define that the shader's
TOCs declare, each value they declare, and Not set. A pick changes the preview alone, is held for
the session and is never written to the def. The shape is bound to one bone for a skinned kind.

**A define list that the cache does not hold draws the nearest compiled permutation.** The corner
lists every define that the search set and removed. A def with no compiled permutation within three changes
draws the error color, and the corner gives the reason.

**The menu bar of a material.** The Preview menu holds On a shape where a skin of the file draws the
material, Shape, Turntable, Ground, Camera, View mode and Fit. Shape, Turntable and Ground apply
while the material draws on a shape. A `CustomShaderDef` adds the Shader menu, which holds the
material that the preview draws through, Reset permutation and one submenu per define that its TOCs
declare. The menu reads the def while it is open, and it shows a disabled item if no material links
the def or the def declares no define.

### How the panes are arranged

The picture above is where the panes start, not where they stay. A pane is a tab of the same split
tree the project editor runs its document panels on, per ADR-0034, so the gestures are the ones a
reader already knows from the tabs: drag a pane's tab onto another panel's edge to split it, onto
the panel itself to share that panel's strip, and drag a seam to resize. A seam dragged past a
panel's minimum collapses that panel, to its strip in a column and to a rail of its panes' icons in a row, per
[Collapsing a panel](PROJECT_EDITOR.md#collapsing-a-panel).

```
one reader's arrangement: the strip takes the window,
the curve and the inspector share a strip under it

+-----------------------------------------------------------------+
| EMITTERS                          [Filter      ][Cards|Table] x |
|-----------------------------------------------------------------|
| [card][card][card][card][card][card][card][card][card][card]    |
| [card][card][card][card][card][card][card][card][card][card]    |
|=================================================================|
| CURVE | INSPECTOR                                x              |
|-----------------------------------------------------------------|
|  1.0 +--+                                                       |
|  0.0 +---+--------------------------------------------------+   |
+-----------------------------------------------------------------+
```

The arrangement belongs to the project. A modder sets it once and every particle system they open
in that project opens that way, because the proportions belong to the kind of work rather than to
the file. It survives a restart in `.ltk/editor.json`, beside the document panels.

**A pane's own controls sit at the right end of its strip.** The Emitters filter and its
Cards/Table control are there rather than on a row of their own, so a reader looks in one place for
whatever a pane can be told to do, and the cards get the row back.

A pane closes from its own tab, and **Panes** on the breadcrumb row lists every pane with a tick
against the open ones. Reopening puts a pane in the panel the reader last touched, since the panel
it was closed from is the one that was pruned. The same menu carries **Reset layout**, which is the
way back to the picture above.

**The preview opens widest, over the timeline.** A closed pane is not drawn at all. A reader who
wants the room closes one and costs the renderer nothing, and the Panes menu brings it back. A
saved arrangement with no `timeline` leaf opens without the pane, and the Panes menu adds it.

**A pane maximizes from its tab.** A double click on a pane's tab fills the shell with that pane,
and the rest of the tree waits behind it. A second double click, or Esc, restores the tree.
Maximizing writes nothing to the arrangement. The editor grid maximizes a document panel the same
way, per [the panel layout](PROJECT_EDITOR.md#maximizing-a-panel).

**The open tab joins its pane.** A pane's strip is a rail in `surface-800`, and a tab is as tall
as the rail. The open pane's tab takes the fill and the edge of the pane under it and covers the
rail's bottom edge, so the two read as one shape, and a tab behind it is its glyph and its title
alone. Each tab leads with the glyph
the Panes menu lists the pane by, and its title is written as the menu writes it.

**A tab has a menu.** A right click on a pane's tab offers Float, Maximize or Restore, and Close,
on the open tab and on one behind it alike (`PaneStrip` in `src/modules/editor/layout`).

**A pane floats.** The open pane's tab carries a Float button, shown with its Close, and every
tab's menu carries Float. It takes the
pane out of the tree into a frame over the shell, and the panel it left gives its room to the one
beside it. The frame stays open until its own Close, moves by its header, sizes by its corner and
stays inside the shell. Its Dock button puts the pane back in the panel the reader last touched.

- a pane is in the tree, floating or closed, never two of them. The Panes menu ticks a floating
  pane as it does an open one, and unticking it closes the frame.
- a frame opens under the press that floated it, and over it where there is no room under, so the
  row or tab that was pressed stays in view. One opened again opens where it was last left.
- a press on a frame brings it in front of the others
- the pane's body is not rebuilt when it floats or docks, so the preview keeps its WebGL context
  and a curve keeps its selection
- Reset layout docks every floating pane where it started
- which panes float is the project's for the session. It is not written to `.ltk/editor.json`,
  so a pane floating at exit is closed at the next start.

**Why.** A pane in the tree takes a fixed share of the window whether or not the reader is using
it, and sits where the tree puts it. A reader tuning one row wants the curve beside that row, and
one arranging nodes wants the preview over the graph, for as long as that task lasts.

### The timeline

The timeline is the particle shell's fifth pane, per ADR-0037. It reads the run the shell holds
above the panes, and it draws one lane per emitter under one playhead.

```
TIMELINE  EMITTERS | |< (>) >| @  0.42 / 1.60 s | (L) 1.000x      (H) | Chance [==|--] 0.55
 (o) [Filter    ] S | 0     .25   .5    .75   1.0   1.25
                    | |-----|-----[=====]-----|-----|
  [#] Orb         [0] (o) S  [#####]~~~~////              312
  [/] Sparkles    [1] (o) S     [##]~~~~~~////             48
  [@] Smoke       [2] (-) S  [############################>  844
v [*] Burst       [3] (o) S        [###]~~~               120
    |-- Spark     [0] (o) S          [#]~~  [#]~~  [#]~~   36
  [ ] Glow SIMPLE [0] (o) S     [#]~~                      12

[###] emitting   ~~~ particle life   //// linger   [===] loop range   > endless
(>) play, filled   @ restart   (L) loop   (H) histogram   | a hairline between groups
```

**The transport row.** The transport sits in the timeline pane's strip, after its tabs, so the
lanes keep the row a separate transport row would take. Step back, play, step forward and restart
come first, with play the one filled control. The time follows as `0.42 / 1.60 s`, the current time bright and the span muted. A
hairline then sets off how the run plays: the Loop toggle and the speed. The view switches
sit at the far end behind a second hairline: Add marker, the Snapping toggle, the Histogram toggle and the dice button of
[the random spread](#the-random-spread), which opens the chance pin in a popover and reads the
pinned chance beside the dice, lit while one holds. Loop and Histogram are icon toggles lit while on, and
their tooltips name them, with Loop's naming its key. Restart plays the run from zero.

**Loop switches the rig between Replay and Once.** A system that ends opens on Replay, so the
switch is on. With Loop off, the run pauses at the end of its span, and Play starts it again from
zero. Turning Loop on at the end plays the run from zero, and turning it off during a later pass
keeps the time the playhead reads. A switch of Loop is a change of the rig, so the rig becomes the
author's. Under Continuous the switch takes no press, since the run never starts over.

The speed is a number typed to three places, `1.000` by default, between 0.05 and 2, with a pair
of arrows on its right that nudge it by 0.1, by 0.01 under Alt and by 0.5 under Shift. The bracket keys walk it through 0.05, 0.1, 0.25, 0.5, 1, 1.5
and 2. The name filter sits in the ruler row's head cell, between the eye and the S, over the
names it narrows, as the strip's filter narrows the cards. The seed and the rig are the viewport's, per [the viewer](#the-viewer).

**A lane is an emitter.** Its head carries its eye, a 20 px square of what the emitter draws, its
name, its index in its own list, a SIMPLE tag for the second list, the struck eye of a `disabled`
emitter, and the solo toggle. The square is the card's square at lane height.

**The head fits the longest name.** Its width is what the system's longest name and index read in,
capped at a third of the pane. Past the cap a name is cut in its middle, because a system's
emitters share a prefix and differ at the end.

**A lane's bar is the emitter's timing.** A solid bar spans the emission window, from
`timeBeforeFirstEmission` to `lifetime`. Both are times on the system's clock, so `lifetime` is
where the bar ends and not how long it is. An emitter with no `lifetime` runs to the edge
under an arrow. A faded tail runs past the bar to the peak of `particleLifetime`, and a hatched
tail runs on to the end of the linger. The live count stands at the lane's right edge, under a
`live` caption on the ruler's row. With the Histogram switch on, a histogram over the bar draws
the emitter's live particles per step, filled in as the run plays. The switch is off by default,
and the bar's own timing reads clear.

**A bar edits by dragging.** On an emitter's own lane, a drag on the bar moves it whole, so it
writes `timeBeforeFirstEmission` and `lifetime` together. Its left edge trims the first emission
and keeps the end, so it writes `timeBeforeFirstEmission` alone, its right edge writes `lifetime`,
and the end of the hatch writes `particleLinger`. Every lane has all three edges, a burst's and a very short bar's
included, and the edge nearest the pointer wins, the end over the start on a tie. Handles show
while the pointer is over the lane and the held one lights, the cursor says what a press takes,
and the value reads beside the edge during the drag.

- a dragged edge snaps, per the snapping paragraph below, and a line marks the snap
- the preview plays the dragged timing as the drag goes, replayed to the playhead
- the release writes the drag as one edit, one undo step, and Escape drops it
- a press on the bar that never travels seeks, as the rest of the lane does
- an endless bar's arrow drags too, which gives the emitter a `lifetime`
- a child lane's bars stand for spawns and do not drag, and a simple emitter's linger is capped
  to nothing, so its bar has no linger edge
- a drag on a bar of a selected lane changes every selected bar by the same seconds, and the
  release writes all of them as one edit. A bar without the dragged edge stays as it is: an
  endless bar on an end or a linger drag, and a simple emitter's bar on a linger drag

**A double click opens the exact times.** A double click on the bar opens a popover with the
start delay, the lifetime, Emits until the system stops, the emitter linger, the particle linger
and its mode, Repeats in cycles with the period and its active part, the single burst switch and
`HasVariableStartTime`. Each field commits on its own. Emits until the system stops clears
`lifetime`, which no drag can do. A line under the emitter's name states how long the emitter
emits for, because `lifetime` is an end time counted from the system's start and not a duration.

**Bursts and cycles are marked.** An `isSingleParticle` emitter's whole output is one burst,
drawn as a diamond at its start, and its bar has no end edge. An emitter with a `period` and a
`timeActiveDuringPeriod` draws a notch where each cycle opens and darkens the part of each cycle
past the active time, and the run emits in the lit parts alone. A cycle counts from the system's
start, so a delayed bar may open partway through one. A `timeActiveDuringPeriod` with no `period`
darkens everything past the system's first seconds.

**An emitter node carries the lane's eye and solo.** Hide in the preview and Solo sit on each
emitter node's header and read and write the lanes' own sets, so a node hidden, or left out by
another's solo, fades on the canvas. The `disabled` flag, which writes the file, is the power
button beside them.

**Lanes run in draw order**: the ground layer first, then `pass`, the blend mode's rank,
`miscRenderFlags` and the index, which is `compareDrawOrder`. A child system's emitters nest under
the emitter whose particles carry them, collapsed, with their bars at the times this run spawned
them.

**A click does the one thing its target names.** The name selects the emitter, and the crumb, the
inspector and the Emitters pane follow. Ctrl or Command and a click on a name adds that lane to the
selection or removes it, and Shift and a click selects every lane from the last one clicked to this
one, in the order the lanes are listed. The selection never empties, and the inspector shows the
lane clicked last. A child lane is always selected alone. A selection made anywhere else, in the
strip, the Graph or a child lane, ends the timeline's selection. With focus in the lanes, `Ctrl+D`,
`Ctrl+C` and `Delete` act on every selected emitter, per
[Duplicating, pasting and deleting an emitter](#duplicating-pasting-and-deleting-an-emitter), and
S and M solo or mute all of them. The ruler and a lane's track seek, and a drag along either
scrubs. A child lane selects its
emitter into the inspector, under a banner naming the child system and an Open system link to its
own tab, and opens the card of the emitter carrying it. Dragging a bar's edge to write
`timeBeforeFirstEmission` and `lifetime` belongs to [leaf editing](#editing).

**A child's emitter reads as the system's own.** Its groups draw under the same headers, Defaults
lists what it leaves unauthored, its curves take the curve pane, and a followed field crosses
between a child and the system's emitters. A struct opened on one is open on the other, held by
its path under the emitter. The banner is the one difference on screen. Lanes nest one level,
and a grandchild's lanes are its own system's, reached by Open system.

**The eye and solo hide an emitter and leave it running.** A lane's eye is open while the emitter
draws and shut while it is muted. With any emitter soloed, only the soloed ones draw. The
simulation runs whole either way, per decision 2.46 of `docs/plans/vfx-particle-renderer.md`, and
neither toggle writes `disabled`. The viewport carries no Solo pill.

**A stroke sets many lanes.** A press on an eye or an S and a drag down its column gives every lane
passed the state the first took. Alt and a click shows that lane alone, and a second one shows
every lane again. Shift and a click sets every lane from the last one pressed to this one, in the
order the lanes are listed. Over the heads, an eye shows or hides every lane and an S clears every
solo.

**The ruler zooms and loops.** The timeline opens fitted to the run's span. A Continuous run is
the exception, because its span is always at least 60 seconds. It opens on the latest time a bar
ends, and at least one second:

- an emitter with a `lifetime` ends at the end of its linger
- an emitter with no `lifetime` counts as its start plus its longest particle lifetime
- a `disabled` emitter is ignored

Ctrl and the wheel zoom about the pointer, and zoom out as far as the run's span. Shift and the
wheel pan, and a double click on the ruler refits. A drag along
the ruler scrubs, and the playhead follows the pointer from the press. Shift and a drag along the
ruler sets an in and an out, and the run loops between them. A drag on an edge of the band moves
that edge, and a drag on the band moves the whole range. A double click inside the band, or its
x, clears it. A run with no range loops as the Loop switch says. While Shift is down the ruler's
cursor is a crosshair, and resting the pointer on the ruler names its gestures.

**Markers name times on the ruler.** A marker is a flag at the top of the ruler with its name
beside it, and a dashed line down the lanes. Add marker in the transport and `Ctrl+M` add one at
the playhead, and the ruler's menu adds one where it opened. A second marker at the time of one is
not added. A click on a flag seeks there, a drag moves it and snaps, and Escape drops the drag. A
double click names it: Enter or leaving the field keeps the name, a blank one clears it, and
Escape drops the edit. The menu on a flag renames or deletes it, and a delete raises a toast with
Undo. The playhead's chip stands over a flag at its time.

Markers are kept per system in the project's `.ltk/editor.json`, so they last across sessions and
never reach the packed mod. A layer rename carries the markers of the layer's files to the new
name. When a layer file or its system is gone from the project, its markers leave the file the
next time the project's files are read. A file under an ignored directory keeps its markers,
since the project's listing does not name its objects. A system opened outside a project has
none.

**Snapping.** A time a gesture moves snaps: a dragged bar edge, the playhead scrubbed on the
ruler, a track or its flag, the loop's in and out as they are drawn or dragged, and a marker. It
lands on a target within 6 px: 0, the end of the span, every emitter's bar edges, cycle notches
and bursts, the loop's in and out, the markers, the playhead and the ruler's ticks, the labelled
whole seconds among them. A target that is the time being moved is left out, and a scrub leaves
out the minor ticks too, which would quantize it to their spacing. Between targets a time rounds
to whole frames, 1/60 s, and Ctrl rounds to thousandths. Shift moves free of the targets, and the
Snapping toggle in the transport, on by default, turns them off for every gesture.

**The playhead is a flag.** Its chip on the ruler reads the time, and its line runs down every
lane with a faint glow, so it reads over the bars and the histogram. A drag on the chip scrubs,
as a drag on the open ruler does. A dashed line
follows the pointer through the ruler and the lanes, its own chip reading the time a press would
seek to, so no track needs a crosshair cursor.

**The ruler says where the run ends.** Everything past the run's span is shaded on the ruler and
under every lane. Minor ticks cut each labelled step, a second into quarters and a fraction of one
into fifths, and the last label carries the unit. Resting the pointer on a bar lists its times:
when it emits, how long its particles live on, and where its linger ends.

**A scrub moves the run live.** The run keeps a checkpoint every quarter second of simulated time
within a budget of bytes, and a seek replays from the nearest one, per decision 2.46. A drag moves the run with the pointer,
a step back costs one frame, and a loop's wrap costs no replay from zero.

The clock pauses while a drag scrubs, on the ruler, the flag, a lane's track or the mini
transport's scrub, and a playing run plays on from where the drag lets go. Play and pause do not
change during a scrub.

**The keys** act anywhere in the shell outside an editable field. The shell takes focus when its
tab opens or comes to the front, unless a control other than the tab itself has focus, such as the
Objects grid or the content tree. A focused slider keeps its arrows, Home and End, and every other key reaches the run,
so Space plays or pauses after a drag on the scrub or the chance pin. A focused tab, menu item or
option keeps Space.

| Key                     | Does                                               |
| ----------------------- | -------------------------------------------------- |
| Space                   | Play or pause                                      |
| Left, Right             | One frame back or forward, 1/60 s                  |
| Shift+Left, Shift+Right | 0.1 s back or forward                              |
| Home                    | Restart and play                                   |
| End                     | Pause at the end of the span                       |
| L                       | Loop on or off                                     |
| Alt+Up, Alt+Down        | The previous or next particle system of the folder |
| F                       | Fit the camera                                     |
| S, M                    | Solo or mute the selected emitters                 |
| `[`, `]`                | The next speed detent down or up                   |
| Ctrl+M                  | Add a marker at the playhead                       |
| Esc                     | Restore a maximized pane                           |

**The preview carries a mini transport while no timeline shows**: play, a scrub, the time, the
Loop toggle and the chance pin, with the timeline closed or the preview maximized. A stack holds no timeline pane. Its preview carries
the mini transport, and its Emitters section keeps the strip. Its scrub is a rail filled up to the
playhead, which is a line over it, and both it and the time follow the clock every frame.

### The viewer

The preview pane draws the run on the particle renderer of `docs/plans/vfx-particle-renderer.md`.
Its controls sit at its top right: the Show menu, the view mode menu, the camera menu, Fit and the
rig.

**The Show menu** ticks Ground, Midlane, Gizmo, Stencil masks and Stats, and stays open while they
are set. Its trigger counts the ones on. Midlane draws on the ground alone, so it is off while
Ground is. Stencil masks is off by default, per [the stencil](#the-stencil).

**The view mode menu** draws the scene Lit, Unshaded, Untextured, or as its triangle edges alone
(Wireframe). Below the modes, the Wireframe overlay tick draws the edges over a Lit or Untextured
scene, and is disabled under the other two. The skin and map previews carry the same menu, and one
choice holds for every preview.

Unshaded draws each material's base texture without light and without the game's shaders.
Untextured draws every surface in one flat neutral under the scene's light, opaque and double sided,
without the game's shaders. A particle is unlit already, so it draws the same in Lit and Unshaded.

The edges are each mesh's own geometry in one flat accent. A particle's edges draw after every
emitter, and a distorting emitter's edges draw with the rest. Under the overlay the edges are part
transparent, and the surface reads through them. A character's attached mesh stays shaded.

**The camera menu** holds Game, Orbit, Top, Front and Side, and a system opens on Game. Game is the
in-match camera at the game's own distance: a 56 degree pitch and a 40 degree vertical field of
view, the meta defaults of `DynamicCameraSettings` and `CameraConfig.ZoomFov`, standing 2250 units
off the rig's ground point along its look, which is `CameraConfig.mZoomMaxDistance`. `map11.bin`
overrides none of the three. Its wheel dollies between the game's two zooms, 1000 and 2250, and
Fit restands it. The match camera faces `+Z`. Top, Front and Side are orthographic. A drag from any
preset turns into Orbit from where the camera stands, holding its projection until the drag ends
and then showing the same height of the scene through the other one. A move between presets, a
fit and a gizmo pick all animate, and reduce motion makes them instant.

**Fit, and F,** frame the system's definition at its rig, at the active preset's angle: a champion
about every stop the rig makes, and each emitter's spawn origin, offset and shape as the run opens.
The box is read off the definition rather than the run, so the same system frames the same way on
open, on F and at any moment of its play. A child set's emitters ride their parent's particles and
add nothing to it. The skin's preview frames its mesh.

**The next system opens in the last view.** A particle preview opens with the camera the last one
left, under the same preset, so stepping through systems compares them at one angle and one
distance. It frames the system instead where no preview was open before this session, and where
the middle of the system's box is out of view. That opening frame is instant. Fit and F animate.
The ground, the renderer and the particle textures carry over too, so the new system draws on a
scene that is already up rather than on a blank pane.

**A read that fails says why.** The notice over the scene names the error and offers Retry, which
reads the system again. The run waits at its start while the system's first textures and meshes
load, for at most four seconds, so a short effect plays from its first frame on screen.

**The orbit.** The left button orbits, the right pans, the middle and the wheel dolly toward the
pointer. A flat preset's wheel zooms in place of the dolly.

**A click on a particle selects its emitter.** A left press released within four pixels of where
it began picks the particle drawn under the pointer, the front one where several overlap, and
selects its emitter as a click on that emitter's lane head does. The inspector and the timeline
follow. A child's particle selects its child lane, and a deeper child selects the child lane it
descends from. A texel of a quad's texture with no alpha picks nothing, a hidden, muted or culled
emitter picks nothing, and a click on empty space leaves the selection as it is. A drag orbits,
and a press on a gizmo's handle is the gizmo's.

**The axis gizmo** sits in the pane's top left corner and turns with the camera: the corner of a
cube, three arms on the viewport's own axes with a lettered head each, and a square face between
every two. An arm, its head and the face across it wear that axis's channel colour. A head or a
face stands the camera on its axis, picking Side, Top or Front. Picked again while the camera
already stands there, it turns the camera to the axis's other end, on Orbit.

**The rig pill** names the carrier beside an icon of its motion, and where the rig came from:
Auto, the spell whose missile the system is, Custom, a template's name or the context it was opened
from (ADR-0057, ADR-0065). Its popover says the same in a line, with Reset to auto beside it for a
rig that is not the system's own. Under it are the carrier (Ground and Missile, and Bone while a
skin's joint carries the run), the playback (Once, Replay and Continuous), the height, the
missile's fields, the stop, the flex channels, and the seed with its reroll.

**A Missile rig names the spec it stands for.** Its menu picks the movement class, the class's own
fields follow it, then the distance, the height solver and its fields, the vertical facing,
Land at launch height (`mUseHeightOffsetAtEnd`) and the target height offset. A circle turns
about the origin at the distance, and every other movement crosses it. The height is the launch
height, and the flight sets every height after it.

**The system picks its own rig.** A system that a spell of its character fires as its missile flies
that spell's missile and Replays, and the pill names the spell. Otherwise a system with a trail
flies a straight missile and Replays, a system with an emitter that has no `lifetime` plays
Continuous on the Ground, and any other Replays on the Ground. Ground stands at zero, and a missile
launches at half a champion's height. A switch of
carrier keeps the playback, the stop and a height the author tuned. An edit that changes the rig
the system picks takes effect when the run next starts over, never under the author. A
Continuous run lasts the minute a seek reaches and never starts over, so a stop shows the
linger.

**A missile faces along its travel.** A missile's effect is authored travelling along its own
`Y`, so the system's local `Y` follows the 3D travel and its local `Z` points up, and the vertical
facing decides whether the travel pitches.

**Open effect carries the rig a view built.** The spell's Missile pane opens its projectile
effect on the spell's own flight, and its hit effect on the ground. The skin preview's Open
effect menu lists each idle effect, which opens Continuous on its joint, and each particle
event of the clip playing, which opens on its joint and replays once per pass of the clip. A
skin's effect opens with the skin and the clip in the character picker, the character posed
from the event's frame. The pill names the view as the rig's source, and `Ctrl` opens the tab
beside.

**The gizmo** draws the selected emitter's origin and its offset as lines, its spawn shape as
a body in faint faces under crisp edges, and the births of its emission mesh and surface as
points, per [the emission source](#the-emission-source). It is the one gizmo of the editor: the Geometry node's
Show shape switch opens its emitter and turns the gizmo on, pressed while the gizmo shows that
emitter. Hovering any node of an emitter in the Graph pane draws that emitter's gizmo in a near
white over the run, and choosing an emitter anywhere, a pick in the viewport included, selects
its master node in the Graph pane and centers the view on it.

**The handle menu** in the viewport's controls picks which of the open emitter's spatial values a
drag edits: Offset (`translationOverride`), Turn (`rotationOverride`), Emitter position, the emit
offset of a point or legacy shape, Shape size (a box's half-extents, a sphere's radius, a
cylinder's radius and height), Emission mesh scale, or Birth velocity. The velocity handle is the tip of a faint straight line, as far as the birth
velocity alone carries a particle over its life. Beside it runs the path the engine flies one
particle along, acceleration, drag and forces included, with a dot at each tenth of its life, so
the spacing reads as its speed. A value animated over the emitter's life is listed disabled, since its
curve edits it, as is a size or an offset the shape does not have. Offset and Turn are never
disabled for an override the file does not hold: choosing one writes the override at zero, which
draws the emitter where it already is, and gives the handle a value to move. Such an item carries
a plus, and one line under the list says what the plus means, so the menu states it once. A drag previews through the
run and pauses it, Escape cancels it, and the release writes the value as one edit.

The menu's button names the chosen handle, and reads Handle while none is chosen. A chosen
handle draws the part of the gizmo it edits with the Gizmo switch off too: Shape size and the
emit offset draw the spawn shape, and Emission mesh scale draws the birth points. The emitter's
marks follow a drag, so the shape resizes under the handle.

**The target gizmo** moves the system's target. Target handle in the rig popover turns it on
for a still rig and a flight, and it stands on the target while no handle is chosen. A drag moves
the target of the still rig, or the point the flight lands on, for the whole system. On a still rig
of a system whose emitters mark the far end of a beam, a drag sets only the direction, and the
target stays on the ground at that reach, as the game keeps a fixed-range beam at the end of its
range. A still rig
faces its target, so the beams and every emitter that the system's orientation turns follow the
drag while the run plays, and the camera does not reframe. The drag changes the rig to a custom
one, and Reset to auto returns the target the system picks. The rig's target is a preview
setting, so a drag writes nothing to the file.

**The controls** over the viewport's top right corner are grouped by a rule: what is drawn
(Show, the shaders switch, the view mode), the camera and Frame the system, the handle menu,
and the rig. The bar wraps to a second line in a pane too narrow for one.

**Background color and Capture image** are on the skin and map viewports. The background color
replaces the sky and the theme's color, is exact in a capture, and persists until it is reset. The
ground, the map geometry and any post effect still draw over it, so an image for keying turns the
ground off. Capture image saves the frame of the click as a PNG at the viewport's own pixel size,
through a save dialog. The image contains no orientation gizmo and no joint names.

**Stats** draws the live particles, the live child systems and the frame's milliseconds in the
bottom right corner, on a plate that reads over any ground. The count is of simulated particles,
a muted emitter's included.

**An edit shows on the particles alive.** An edit, an undo or a redo that changes a value the
simulation reads replays the run to its current phase under the new values, playing or paused.
The clock does not move. An edit of a value only the draw reads, such as a colour or a texture,
needs no replay.

**What persists.** Ground, Midlane, Gizmo, Stencil masks, Stats, the view mode and its overlay, the
camera preset, the
timeline's Histogram switch, the inspector's Defaults switch and the graph's minimap switch are
display preferences, app-wide and persisted. The rig, the seed, the speed, mute and
solo, the loop range, the pinned chance and the playhead belong to the run, kept per system for
the session, per ADR-0037, so a file reopened finds them again. A run left at its end reopens at
zero.

**The skin's preview** takes the keys, the camera menu with Fit, the axis gizmo and the speed
detents, per "The preview" in docs/ux/SKIN_EDITOR.md.

### The inspector

The inspector draws the target the crumb names. For an emitter it draws every group the emitter
sets, each a section that folds under a header that sticks to the pane's top while its rows scroll.
A child lane's emitter draws the same, under the banner of [the timeline](#the-timeline). The
emitter's crumb segment and a card's name open the emitter, and a card's chip and the crumb's group
menu scroll to a group and leave the rest drawn, so a reader holding Birth against Scale keeps
both. A section reads its curves as it scrolls into view, and a folded section reads none. The read
is bounded by what is on screen, per [what a layout reads](#what-a-layout-reads).

**A keyed or randomised value draws as its socket does.** The row of a value that has keys or a
probability table takes the row the emitter node draws in that value's socket, in the value's hue:
its curve, colour band or key summary as a strip that opens it in the curve pane, then its mode
toggle. A child system's values draw as plain rows, because the run's graph holds the opened
system alone.

```
INSPECTOR  Orb [0] / Birth v          Chance 0.55
----------------------------------------------------------------
 +------------------------------------------------------------+
 |                 emitter preview, 160px                     |
 +------------------------------------------------------------+
 [F][+][P]  [ Search emitter properties                      ]
----------------------------------------------------------------
 v EMISSION
     rate                    [5          ] /s
     particleLifetime        [0.7        ] s
     lifetime                [4.25       ] s
 v BIRTH
     birthOrbitalVelocity  [x 0 ][y 5 ][z 0 ]
   | birthVelocity         [x -200..0][y 0..5][z 0]     2 channels
   ! birthColor            [#### gradient ####]          A 0.1 .. 1
 v POSITION
     SpawnShape            [Legacy v]  VfxShapeLegacy
   | EmitterPosition       [x 0 ][y 0..20][z 0 ]          Y uniform
     isGroundLayer         [x]
 v SCALE
     scale0                [~~~~~ curve ~~~~~]             animated

|  a field the birth roll reaches   !  a field that rerolls every frame
```

**An action bar leads the search row,** and it holds three controls: Add property, the View menu
and the Emitter menu. Everything else the row once drew as a button of its own is an item of one
of the two menus, since nine icons in a row left the reader to learn each by hovering it.

- **Add property** is the one button, because it is the row's authoring action
- **View** holds what the inspector shows: Defined only, Preview, under a Changes heading Marks
  and Changed only, and under Baseline what a change is measured from, Opened or Game. Its button is pressed while a filter hides rows.
- **Emitter** holds what is done to the open emitter whole: Duplicate, Copy, Paste, Add from
  template, Mask and Delete. A child lane's emitter draws no Emitter menu.

Defined only (`F`) draws
only the properties the file defines and drops every field drawn at its schema default. The switch
is remembered across emitters and sessions. With it on and nothing defined, the pane says so.

Add property (`+`) puts an add box in place of the search. The box lists the
fields the emitter's class declares and the emitter does not define, matched by label, name, hash
or group as the search matches them, and takes `name: kind` for a field no table names. A pick adds
the field at its schema default, unfolds its section and scrolls to it, and the box clears for the
next one. `Escape` clears the box, and on an empty box returns to the search. This is the way to
define a field while only defined properties are shown.

Preview (`P`) draws the open emitter's graph node preview over
the properties, as wide as the panel: the same particle surface, trail swatch or live draw, the
same strip under it, played on the run's own playhead. The backdrop switch sits in its corner. The
switch is on by default and remembered. A child lane's emitter draws no preview, because the run
plays the opened system and not the child's.

**The crumb holds still and the header moves.** The crumb's group segment names the group last
picked, so the menu's own trigger never changes label under the pointer, and the sticky header
names the group on screen.

**A field keeps its own name.** A row reads `particleLifetime`, the name ritobin, the tree and the
meta wiki use. The name's hover card carries the declared type, the default and the wiki's written
doc for the field. The name column fits the longest name the inspector draws, capped at 40% of the
pane, and past the cap a name is cut in its middle, as a lane's is.

**A value reads as what it means.** An enum reads its name, and a flags field reads its named bits,
off the tables `model.ts` holds. An enum edits from a select of its names, and a flags field from a
menu with a switch per named bit, which stays open for the next and keeps any bit no name covers.
Both show the number the file holds beside them. A field name that classes write with different
meanings takes its table on one class alone: `flags` reads as the system flags on
`VfxSystemDefinitionData` and as a plain number elsewhere. A number carries its unit - `s`, `deg`, `units`, `/s` - and a
random range reads `min .. max`. Which unit a field carries is a table written by hand, as the
groups are. A vector's axes are tinted x, y and z, in columns of one width down the pane. A path
reads its file name whole and its folder dimmed, cut inside the folder where the column runs out.

**A curve and a colour ramp draw on a plate of one width.** Both sit in the value column on the
row's own line, at the width every other plate down the pane takes, so a row keeps one height
whatever it holds. A curve stretched over the whole pane is a hairline, which reads as a stray rule
rather than as a shape, and plates of two widths are the ragged column the inspector exists to keep
straight. A plate is recessed off the row, because the row is what a reader scans and the plate is
what they stop on. The shape chip sits after it. A click on a plate aims the curve pane, and a
click on the name opens the field card.

**The roll rail says when a value is rolled.** A gutter at the pane's left edge, outside the fold
carets and outside every indent, carries a segment beside each field whose tables draw more than
one value and whose roll has a time of its own: the accent for the one birth roll that every
`birth` field and `particleLifetime` share, and the warning tone for a table the engine re-rolls
every frame, per [the random spread](#the-random-spread). A field that is random under neither
clock keeps its chip and takes no segment, because the rail answers when a value is drawn rather
than whether it is random. A segment breaks where a row the rail does not reach sits between two it
does, so the rail never claims a row it does not describe, and it crosses a group boundary because
the birth roll does. A folded section draws no segment, because a segment belongs to a row. The
rail is a mark and not a control, so nothing is clicked on it. A click on the rail lights every row
of the roll and focuses the transport's chance slider.

**A struct opens in place.** A pointer, an embed or a list row carries a caret in the row's gutter
and opens into its own field rows, indented under it and read on open. It reads the class it holds
where its value would be and past the name column's measured edge, because the column is arithmetic
over names and the value column of a struct is empty. A struct inside one opens the same way. A row
starts folded, and an open one stays open on the next emitter, held by its path under the emitter,
because a reader comparing spawn shapes walks the lanes.

The gutter is every field row's, a caret's width before the name whether the row folds or not, so
the names of one level line up and the caret has a target the height of the row rather than the
glyph. A click anywhere on a row that folds folds it, as a click on a tree row does, because a
reader opening ten structs in a row aims at the row and not at twelve pixels of it. A chip on the
row keeps its own click.

**Defaults** in the inspector's header adds every field the class declares and the emitter does
not author, dimmed at its default.

**The chance belongs to the run, and the header reads it.** The slider sits in the transport, per
[the random spread](#the-random-spread), and the header carries the pinned value while a pin holds.
A reading with no run has no birth to pin and the header carries nothing.

**A row is shaped as its input.** The inspector is read-only, and each widget is the box
[leaf editing](#editing) turns into an input.

The row is `FieldRow` and `ValueCell`, and every layout that draws field rows draws these, the
skin's inspector and the stacked layouts included. The plate is theirs too. The roll rail, the
sticky header and the group menu are the particle system's own, because a birth roll and a group
are things only an emitter has.

### The primitive

An emitter's `primitive` is the shape each of its particles draws as, and it is a group of its
own. Its row is a picker over the classes deriving from `VfxLegacyPrimitiveBase`, grouped by what
they draw, each with a line saying what that is. The trigger reads the class in the meta wiki's
words, and the class name beside it is the class card, which carries the wiki's page for it.

```
v PRIMITIVE
    Render Primitive       [Mesh v]  VfxPrimitiveMesh
                           +----------------------+
                           |  sketch, turning     |
                           +----------------------+
      Align Pitch To Camera  [ ]
      Align Yaw To Camera    [x]
      Mesh                   VfxMeshDefinitionData
        Mesh Name            [ASSETS/Effects/orb.scb   ]
        Submeshes To Draw    0 items
```

| Family         | Classes                                       |
| -------------- | --------------------------------------------- |
| Quads          | Camera quad, Camera unit quad, Arbitrary quad |
| Rays and beams | Ray, Beam, Camera segment beam                |
| Trails         | Camera trail, Arbitrary trail                 |
| Meshes         | Mesh, Attached mesh                           |
| Other          | Planar projection, Non-renderable             |

**An emitter naming no primitive reads as a camera quad.** The engine draws one, so the trigger
reads Camera quad, dashed as every default is, and Not set at the top of the list clears a held
class back to it. A class the list does not carry reads as its own name and stays listed while the
emitter holds it.

**A swap keeps what both classes declare.** Picking a class writes it and keeps each field that the
held class and the new one declare with one type, so Mesh to Attached mesh keeps `mMesh` and the
two trail classes keep `mTrail`. Every other field is dropped. The swap is one edit, and an undo
brings the dropped fields back.

**Every field the class declares draws under it.** A field the file leaves out draws dimmed at its
default, and its first edit writes it. An embed of the class - `mMesh`, `mTrail`, `mBeam`,
`mProjection` - draws its name and class with its own fields indented under it, open rather than
folded, and the first edit of one of those fields creates the embed on the way. The embeds draw
after the class's own fields.

**The sketch shows what the class draws.** A plate under the picker draws three particles and the
geometry the class builds from them, with a camera turning about them once in twenty seconds. A
camera quad stays square to the view, an arbitrary quad foreshortens as the camera passes, a ray
and a beam turn about their own axis, a trail runs through its particles, a projection lays a
decal on the ground, and a non-renderable draws the particles alone. The shapes follow the class
pages on the meta wiki. A drag turns the sketch by hand, and reduced motion holds it still.

**A mesh class draws its own mesh.** Mesh and Attached mesh draw the mesh the emitter names,
through the viewer's loader and with its submesh choice, fitted to the plate and lit from above.
An edit of `mMeshName` redraws it. A stand-in solid holds the place while the mesh loads and where
no file resolves, which is where an attached mesh draws the unit it is attached to. The sketch
paints a 2D canvas, so the inspector opens no second WebGL context beside the viewer.

### The emission source

The Source group of the inspector holds the fields a particle's birth position is built from.
The engine adds four terms, and the group lists their fields in the order the engine adds them:

1. `EmitterPosition`
2. a point of the emission mesh, times `emissionMeshScale`
3. a point of the emission surface, times its `meshScale`
4. the spawn shape's offset

The rules below are the ones the meta wiki states for `VfxEmitterDefinitionData`,
`VfxEmissionSurfaceData` and the classes the surface holds.

```
v SOURCE
    Emitter Position          [0   ][0   ][0   ]
    Emission Mesh             [ASSETS/Effects/ring.scb ]
    Emission Mesh Scale       [1   ]
    Emit Along Mesh Normals   [x]
    Emission Surface          VfxEmissionSurfaceData
      Surface                 [Skinned Mesh v]  VfxEmissionMeshData  [Use host]
        Mesh Name             [ASSETS/Characters/Ahri/ahri.skn ]
        Skeleton Name         [ASSETS/Characters/Ahri/ahri.skl ]
        Submeshes             [Body x] [Tail x] [Add submesh  ]
        Max Joint Weights     [4   ]
        Mesh Scale            [1   ]
        Emit Along Surface Normals  [x]
      Spawn Generator         [Not set v]
    Spawn Shape               [Sphere v]  VfxShapeSphere  [cube]
      Radius                  [40  ] units
      Flags                   [FillVolume v] 1
```

**The surface has two parts, and each is a picker.** `EmissionSurface` and
`ParticleSpawnDataGenerator` are independent pointers. Each row is a select over the classes the
pointer can hold, with one line per class and the class card beside it.

| Part            | Class                                      | Points come from                               |
| --------------- | ------------------------------------------ | ---------------------------------------------- |
| Surface         | `VfxEmissionMeshData`                      | Triangles of a skinned mesh, posed by the unit |
| Surface         | `VfxEmissionSkeletonData`                  | Bones of the unit's skeleton                   |
| Surface         | `VfxEmissionLinkedMeshData`                | A mesh the game links to the effect            |
| Spawn Generator | `NavigationGridParticleSpawnDataGenerator` | Tagged cells of the navigation grid            |

**A part that is absent from the file shows Not set.** The first pick writes the definition and
the part as one edit. Not set clears the part and keeps the definition. A class that is not in
the list is shown under its own name and stays listed while the file has it. A swap keeps the fields both
classes declare with one type, as the primitive picker does.

**Submeshes and joints are chips.** `Submeshes` and `JointMask` store name hashes. A chip shows the
name the loaded mesh or skeleton has for the hash, and the hash where no file has loaded. The add
field lists the names of the loaded file that the list does not hold yet. With no file loaded it
takes a typed name. A chip whose hash matches nothing in the loaded file has a warning mark.
The joint list offers only joints that have a parent, because a listed joint is the child end of
its bone. An empty list shows Whole mesh or Every joint, which is what the engine does with it.

**Use host writes the file paths.** In a run with a character host, the Surface row of a skinned
mesh or skeleton surface shows Use host. It writes the host skin's mesh and skeleton
paths to `meshName` and `skeletonName` as one edit. The button is hidden once the surface names
those files.

**`AnimationName` is drawn only when the file has it.** A complex emitter does not read the
field, so the row has a line that says so, and the field is not offered as a default.

**The surface uses the host's pose.** The engine skins a mesh surface and measures a skeleton surface
in the pose of the unit the effect is bound to. The preview uses the pose of the character host,
matching joints by name. A joint the host lacks keeps its rest pose. The host is the skin the
system was opened from, with that skin's clip and the frame of the event. The viewport has no
control that chooses one, so a system opened any other way has no host. The host is kept per open
system for the session and is shared by the viewport and the inspector.

**With no host the preview uses the rest pose.** In game a mesh or skeleton surface adds no point
when the effect is bound to no unit. The preview differs so that a surface can be authored
without a host, and a note in the group says so.

**How each source is sampled.**

| Source        | Pick                                   | Direction                                |
| ------------- | -------------------------------------- | ---------------------------------------- |
| Emission mesh | A triangle by area                     | The triangle's normal                    |
| Skinned mesh  | A triangle by count, whatever its size | The vertex normals, skinned and blended  |
| Skeleton      | A bone by its length in the rest pose  | A random direction at right angles to it |

A direction replaces the direction of the birth velocity and the birth acceleration and keeps
their lengths. The mesh's applies under `useEmissionMeshNormalForBirth`, the skinned mesh's under
`useSurfaceNormalForBirthPhysics`, and the skeleton's always. Where the mesh and the surface both
give one, the surface's is used. The spawn shape's rotation is applied after both.

**The viewport shows birth positions.** With the gizmo on, the open emitter's emission mesh and
surface draw as 320 points, taken at the playhead from the same samplers the simulation reads.
Each point with a direction has a short line along it. The points follow the host's pose.
The spawn shape's offset is not added, since the gizmo draws the shape itself.

**The handle menu scales the mesh.** Emission mesh scale drags `emissionMeshScale`, or the
`meshScale` of a skinned mesh surface on an emitter with no emission mesh. The handle scales all
three axes together, by the axis dragged furthest.

**Notes state what the game does with the emitter.** They are lines at the top of the Emission
and Source groups, one per condition below. A warning is a state the game ignores or never emits
from.

| Group    | Tone    | Condition                                                                  |
| -------- | ------- | -------------------------------------------------------------------------- |
| Emission | Warning | The rate is zero and nothing else makes the emitter emit                   |
| Emission | Warning | The end time is at or before the start delay                               |
| Emission | Warning | A period has no active time                                                |
| Emission | Info    | A single burst has a period                                                |
| Emission | Info    | `rateByVelocityFunction` replaces `rate` and `flexRate`                    |
| Source   | Warning | A simple emitter names an emission mesh or a surface                       |
| Source   | Warning | A skinned mesh surface has an empty mesh or skeleton name                  |
| Source   | Warning | A skeleton surface has an empty skeleton name                              |
| Source   | Warning | No name of `Submeshes` is in the loaded mesh                               |
| Source   | Warning | No joint of `JointMask` ends a bone of the loaded skeleton                 |
| Source   | Info    | The definition sets neither part                                           |
| Source   | Info    | The surface is a linked mesh                                               |
| Source   | Info    | A spawn generator is set                                                   |
| Source   | Info    | A mesh or skeleton surface is previewed with no host                       |
| Source   | Info    | A direction is given and the birth velocity and acceleration are both zero |

**A line at the top of the Emission group shows the rate at the playhead.** It shows the `rate` curve at
the emitter's phase and the most one step spawns at that rate, which is the rate times 0.33 plus
one, and at most 1000. A single burst shows its count and its time. Outside the emitter's window
the line shows Not emitting at the playhead.

**What the preview does not model.** The spawn generator's offset and its rate factor, `flexRate`
and `flexParticleLifetime`, and a linked mesh, which only a superward region links.

### The spawn shape

`SpawnShape` sets where a particle is born about the emitter. Its row is a select over the classes
deriving from `IVfxShape`, with one line per class and the class card beside it.

| Item     | Class                   | Fields                                                 | Particles are born on                  |
| -------- | ----------------------- | ------------------------------------------------------ | -------------------------------------- |
| Not set  | none                    | none                                                   | The emitter's origin                   |
| Point    | `VfxShapePointDoNotUse` | `emitOffset`                                           | One fixed offset                       |
| Legacy   | `VfxShapeLegacy`        | `emitOffset`, `emitRotationAngles`, `emitRotationAxes` | An offset that can be random or curved |
| Box      | `VfxShapeBox`           | `Size`, `flags`                                        | The faces of the box                   |
| Sphere   | `VfxShapeSphere`        | `radius`, `flags`                                      | The surface of the sphere              |
| Cylinder | `VfxShapeCylinder`      | `radius`, `height`, `flags`                            | The wall of the cylinder               |

**`flags` of a box, sphere or cylinder reads its one bit, FillVolume.** With the bit set, particles
are born inside the shape. The schema gives `flags` no default, so a shape that leaves it out shows
0, which is the value the engine reads.

**A legacy shape's rotations are one list.** `emitRotationAngles` and `emitRotationAxes` are
parallel lists, and angle `i` turns about axis `i`. Emit Rotations draws an Axis row and an Angle
row per rotation. Add rotation appends a turn of 0 about +Y, and the remove button on an angle
removes the rotation from both lists. Each change is one edit. An angle is a `ValueFloat`, so it
can be random or follow a curve like any other value row.

**A pick follows the primitive picker's rules.** Not set clears the pointer, a class the list does
not carry is shown under its own name, a swap keeps the fields both classes declare with one type,
and every field the class declares is drawn under the row. `VfxShape`, the class before the split,
is listed only while the file holds it.

**Show shape in preview turns the viewport's gizmo on and off.** The gizmo draws the open emitter's shape, and
the handle menu's Shape size and emit offset handles edit it, per [the viewer](#the-viewer).

### The sprite sheet

The Texture group opens on the sprite sheet where the emitter's `texDiv` cuts its texture into more
than one cell. The texture draws under its grid, and each cell of the run carries its place in
play order, from `startFrame` for `numFrames` cells, wrapping past the grid's last cell. A cell
the run does not play is dimmed.

The cell that a particle born at the emitter's start draws at the playhead is outlined, at
`frameRate` times the constant of `birthFrameRate`, so the sheet steps with the preview. An
emitter with `isRandomStartFrame` outlines none, because each particle opens on a cell of its
own. A line under the sheet gives the frame count, the rate, and how many runs a particle's
lifetime plays, which is the number to read when a run cuts off or repeats.

In a document that takes edits, a click on a cell writes it as `startFrame`, and a shift-click
writes `numFrames` so the run ends on that cell. The rows under the sheet stay the way to type
the same numbers.

### The stencil

An emitter's `stencilMode`, `stencilRef` and `StencilReferenceId` are a group of their own, after
Render. The rules below are the ones the meta wiki states for those fields on
`VfxEmitterDefinitionData`. How the viewport draws them is decision 2.53 of
docs/plans/vfx-particle-renderer.md.

A mask is a reference value in the stencil buffer. One emitter writes it where it draws, and other
emitters draw only inside or only outside what was written. Two emitters use the same mask when
they have the same `stencilRef` modulo 64, or the same `StencilReferenceId`.

```
v STENCIL
  (i) No emitter of this system writes this mask. ...
    Stencil Mode            [Inside mask v] 2
    Stencil Reference       [Mask 2 v]  Written by stencil_mask
    Stencil Reference ID    [0x00000000]
```

**Stencil Mode is a choice of what the emitter does with its mask.** Each item has one line that
says what it draws. The number the file has is shown beside the trigger.

| Mode | Item               | The emitter                                              |
| ---- | ------------------ | -------------------------------------------------------- |
| `0`  | Off                | Draws with no stencil test                               |
| `1`  | Write mask         | Draws everywhere and writes the mask where it draws      |
| `2`  | Inside mask        | Draws only where the mask is written                     |
| `3`  | Outside mask       | Draws only where the mask is not written                 |
| `4`  | Write mask outside | Draws only outside the mask and adds what it draws to it |

**Stencil Reference is a choice among the masks of the system.** The list has one item per mask an
emitter of the system uses, with the emitters that write it on a second line. Numbered masks come
first in ascending order, then masks named by a `StencilReferenceId`. New mask takes the lowest
reference from 1 that no emitter uses. Reference 0 is not offered as a new mask, because the buffer
is cleared to it.

A pick of a numbered mask writes `stencilRef`, and clears a `StencilReferenceId` the emitter
authors, since the id would replace the number. A pick of a named mask writes the id. Outside a
run the row is the plain number field, because the list of masks is read from the run's system.

**Stencil Reference ID stays a plain hash row.** It is the way to share a mask with another
system or with a material pass.

**Notes state what the game does with the fields.** They are lines at the top of the group, one
per condition below.

| Tone    | Condition                                                                  |
| ------- | -------------------------------------------------------------------------- |
| Warning | A simple emitter has a stencil mode, which the game does not read          |
| Warning | A resolved custom material replaces the emitter's stencil fields           |
| Warning | Every writer of the mask draws after this emitter                          |
| Info    | A `StencilReferenceId` is set while the mode is off                        |
| Info    | A `StencilReferenceId` and a `stencilRef` are both set                     |
| Info    | The reference is past 63, so it is read modulo 64                          |
| Info    | The emitter draws inside or outside a mask no emitter of the system writes |
| Info    | The emitter writes a mask no emitter of the system tests                   |

The draw order of the third row is the engine's: `pass` ascending, then the keys `drawRanks`
compares. A test against reference 0 needs no writer and gets no note.

**A mark on a lane and on a graph frame says which mask the emitter uses.** It is a glyph for the
role and the mask's number or id, after the emitter's name. Its hover names the role and lists the
emitters that write the mask and the emitters it masks. While the pointer is on a mark, every mark
of the same mask takes the accent and their lanes take a fill. A child lane draws no mark.

**The Emitter menu's Mask submenu does the common steps as one edit each.**

- An item per mask of the system puts the emitter inside that mask. A mask the emitter writes is
  not listed.
- New mask from this emitter copies the emitter to the place after it as a mask writer and puts
  the emitter inside the new mask. The copy is named after the emitter with `_mask` added. It has
  the lowest free reference, a `pass` one below the emitter's, `AlphaAdd` and a constant black
  `Color`, so it adds no colour. It has no child particle set. The copy has the emitter's shape,
  so nothing is masked until the copy's shape is edited.
- Turn stencil off sets the mode to Off. It is listed for an emitter with a mode.

A simple emitter draws no submenu.

**The preview shows a written mask as a tint.** The emitter and geometry node previews draw the
mask of a writing emitter in the wire colour at 35% opacity, under the emitter's own colour. The
viewport does the same while Stencil masks is ticked in the Show menu.

### Child particles

An emitter's `childParticleSetDefinition` is a section of its own after Forces, and no group
repeats its row. The section edits the systems that each particle of the emitter spawns. What the
run does with a set is decision 2.33 of docs/plans/vfx-particle-renderer.md, and bones are 2.35.

```
v CHILD PARTICLES
    [0] Sparks_Child             picked   [Bone      ] [open][^][v][x]
    [1] Smoke_Child                       [Bone      ] [open][^][v][x]
    [2] 0x9b0300f3      ! unresolved      [Bone      ]       [^][v][x]
    [+ Add child                                                     ]
    Spawn on death          [x]
    Child index             [0          ]
    Inheritance             Not set
```

The section is folded on an emitter with no child, and opens to the Add child picker.

**The set has no mode field.** The engine reads two lists that are parallel by index,
`childrenIdentifiers` and `boneToSpawnAt`, and branches on whether the bone list is empty.

| `boneToSpawnAt` | Each particle spawns                                            |
| --------------- | --------------------------------------------------------------- |
| Empty           | One child, the one `childrenProbability` indexes                |
| Not empty       | Every child, child `i` at bone `i`, and none if it is too short |

**Bone is a child's entry of `boneToSpawnAt`.** Each child row has the field, empty for a child
with no bone. The first bone written adds an empty bone for every other child, so the list is as
long as the children. A child with an empty bone in such a set spawns nothing, since the skeleton
has no joint of that name. Clearing the last bone removes the list. The bone resolves on the
emitter's own skinned mesh where its primitive has one, and otherwise on the unit the effect is
bound to.

**A child row names the system and its place in the list.** The name is the last segment of the
system's path. Open system opens the system in its own tab, and Move up, Move down and Remove
change `childrenIdentifiers`. A move or a removal takes the child's bone with it, so the two lists
stay parallel. Each is one edit.

**Add child is a combobox with two sections,** in the shape of
[a path field](#a-path-field)'s list.

```
 [+ Add child                                        ]
 EFFECTS
   * Sparks_Child    Characters/Ahri/Skins/Skin0/Particles/
   * Smoke_Child     Characters/Ahri/Skins/Skin0/Particles/
 NEW EFFECT
   + Blank
   + Explosion
```

- Effects lists every system of the file by its name, with its folder dimmed after it, and
  after them each system that a `ResourceResolver` of the file maps a key to and the file does
  not declare. A pick writes the `effect` link.
- New effect lists Blank and each system template. A pick creates the object and then adds it
  as a child, which is two undo steps. The object is named after the emitter's system with
  `_Child` added, and a number where that name is taken.

Typing narrows both sections to the entries that contain each word. A pick adds the child and
clears the field. The emitter's own system is not listed, because a system that links itself is
a cycle the run ends as no child. The picker writes no `effectKey`. A child that names its
system by key reads and edits as any other.

**Child index is `childrenProbability`.** The value is an index into the children,
`trunc(max(0, value)) % count`, and not a weight. It is read at zero for a birth spawn and at the
particle's lifetime in seconds for a death spawn. A constant value marks the child row it selects.
The row stays an ordinary value row, so a curve or a random range is edited in the curve panel.
The row is dimmed and takes no edit while the set does not read it: a set that writes a bone, or
one with a single child.

**One line warns of a set with fewer bones than children,** which spawns nothing.

**A child the preview cannot load is marked unresolved.** The row shows the link or the key as
the file writes it. The run spawns nothing for it, and it keeps its place in the list, since
Child index reads the list as authored.

**A child is hidden and soloed on its node in the Graph pane.** The two switches are per child
system and leave the file alone, as an emitter's are. A hidden child hides the children under it.
A soloed child draws without the emitter that carries it. The child's lanes dim while it is
hidden. The sets last for the session and are not kept with the run's memory.

## The curve panel

A value family's `dynamics` is a column of keys: a `times` list, a `values` list of the family's
own width, and a `probabilityTables` list beside them. ADR-0032 draws it, and the four
`VfxAnimated*` classes share their field hashes, so one widget over `(times, values[channel])`
reads a float, a vector and a colour alike.

### The window a curve is drawn over

A key time is a share of a life, so the window every curve draws over is 0 to 1, widened at either
end by whatever key reaches past it. A file holds times outside that range and none of them are
clipped.

Whose life it is depends on the field. A particle-level value is sampled at
`clamp01((now - birthTime) / lifetime)`, so the window is the particle's own and the clamp is the
engine's. An emitter-level one such as `rate` is sampled on the emitter's clock instead. The panel
draws one window either way, because which clock a field runs on is not something a curve carries.

The window rather than the curve's own first and last key, because where in a life a value moves
is half of what it says. A colour keyed 0.2 to 0.8 holds, fades, and holds again, and a plot
fitted to its own keys draws that identically to a colour that ramps across the whole life.

```
keys at 0.20 and 0.80              the same keys, fitted to themselves

|RRRRR|R------>G|GGGGG|            |R------------------->G|
0.00  0.20    0.80  1.00           0.20               0.80
```

Outside the outermost key a value holds flat, which is what the engine samples there. A band
paints that as a run of the end colour and a plot draws its line to the edge of the box, so the
hold is a shape rather than an absence. Every surface that draws a curve shares this window: the
row strip, the emitter card's square, the sparkline and the dock.

### The time marks

**The playhead is a flag.** Where the run's playhead reaches a curve, the plot draws its line with a
glow, a dot where each drawn channel crosses it, and a chip on the time axis that reads its time.
A colour ramp draws the line over its band and the chip under it. The chip has the timeline's
flag width and colour, so the two read as one playhead. The line, the dots and the chip follow
the clock every frame, as the timeline's flag does. A birth value reads at its emitter's life
ratio, and a per-particle value at the life ratio of the particle the run follows. Where no
particle lives, or the value is not in the opened system, the plot draws no playhead.

**The pointer has its own mark.** A dashed line follows the pointer over the plot, with a grey chip
on the time axis that reads its time, on every curve, random or not.

### The dock

The curve draws in a dock under the object tab, collapsed until a mark targets it and open from
then on for the life of the tab. A popover would close on the first click into another cell, which
is the click a reader tuning a value makes most.

```
+-----------------------------------------------------------------+
|  Glow [0]  .  rate      complexEmitterDefinitionData[0].rate    |
|  [X] [Y] [Z]                                    Graph   Table   |
|   12 /s +                    ___----                            |
|       8 + - - - - - - - ___--- - - - - - - - - - - - - - - - -  |
|       4 +-----                                                  |
|         0        .25       .5        .75        1               |
+-----------------------------------------------------------------+
```

**The target follows its field.** Selecting another emitter aims the dock at the same field of
that emitter, so the curve, the crumb and the inspector name one emitter. Where the next emitter
holds the field flat or not at all, the shell's pane lists the fields it animates instead and a
stack's dock draws its muted line. The field stays held, and the next emitter that animates it
takes the curve back. A field of a struct opened in place is not followed. A target no
emitter owns, such as a system field or a row of Properties, stays until another mark replaces it.
A dock once open stays open when a follow lets go. There is one dock in the app: a mark on
a bin file tab's row opens the object tab with the dock already targeted, the way Show in
properties switches the mode.

The caption is the label chain, with the wire path dimmed beside it. The chain is what the
reader clicked, which the surface it was clicked on names: an emitter and its index in the panel,
and the property path in the tree. The path is what a bug report needs. The caption leads the one
toolbar row, which carries every control: the channel chips, the Random chip, the chance slider and
the tabs. The row never wraps: the caption truncates as the pane narrows, then the key count
hides, then the Random chip keeps its icon alone.

A shell holds the curve in its curve pane. Aiming a curve brings that pane to the front of its
panel where another pane covers it. Where the reader closed the pane, aiming a curve floats it
instead, per "A pane floats" under [how the panes are arranged](#how-the-panes-are-arranged), so
the curve opens beside the row or node that asked for it and the tree does not move. A follow
from emitter to emitter floats nothing, so a frame the reader closed stays closed.

A value mode control aims the dock from its Curve segment, and so does Show curve on the row menu
of a value that has dynamics. In an editable inspector, choosing Curve on a constant value creates
a flat two-key curve from its current value. Choosing Constant nulls `dynamics` and keeps
`constantValue`.

### The row's value mode and random trigger

A value-family row in an editable layout draws its constant inline, a joined Constant and Curve
mode control, then the random trigger where the value has a meaningful probability table. The
mode control keeps the same width and position in both states.

```
birthScale0     [X 10 .. 20] [Y 10 .. 20] [Z 10 .. 20]   [-|~] [dice linked]
birthRotation0  [X 0 .. 360] [Y 0] [Z 0]                 [-|~] [dice uniform]
```

The Constant segment nulls the `dynamics` pointer. The Curve segment creates a flat curve when
none exists, and otherwise aims the dock's Graph. The separate random chip aims the same Graph,
where [the random spread](#the-random-spread) draws. An aim naming a reading switches the dock to
it, so a trigger lands on what it names rather than on whichever tab the dock was left on.

The chip says what is random in the fewest words the row leaves it. Where the value column already
draws the range, as the inspector's does, the chip names the shape: `uniform`, `split`, `custom`,
`linked` for channels drawing one table over one base, and a count of channels that differ.
Anywhere else it carries the range itself, `XYZ 10 .. 20`. A table on a per-frame field reads
`random every frame` in the warning tone, which the inspector leaves to its roll rail, and a set
the game cannot read reads `broken` in the danger tone.

The mode control is drawn for every supported editable value family. A read-only row gets its
Curve segment only where dynamics exist. The random chip appears only after the tables read as a
meaningful spread. It is absent while they are unread and once they read as filler, because a set
of tables that each multiply by 1 draws nothing a reader needs to open.

### The tabs

**Graph** plots the keys over [the window](#the-window-a-curve-is-drawn-over). A vector draws a
line per channel, X red, Y green and Z blue as Riot draws them, with chips that mute one. A
scalar draws in the float socket's hue, which its value node carries in the Graph pane, and a
random band has its least and most drawn as edges over a light fill, as the node's picture does. The
value axis takes three to five round ticks over faint grid lines, a stronger line at 0 and the
unit by the top tick. The time axis ticks at quarters.

A click selects one key. Shift-click selects the range from the last key, and Ctrl-click or
Command-click toggles one key in the selection. Dragging empty graph space draws a selection box
over every channel. Delete removes the selected keys from the parallel time and value lists as one
edit. A key or a stop dragged past its neighbour swaps with it: the line draws in time order
while the drag lasts, and the release rewrites every key between the old place and the new one as
one edit, with the selection following the key. The graph and the Table select. One strip under them holds the selected key's exact fields,
its time and a field per channel, and a multiple selection shows its count there. The strip is one
line of the same height whether a key is selected or not, so a selection never takes room from the
graph, and a pane too narrow for its fields narrows them. The gestures sit behind the info
mark at the strip's end.

A colour draws as a gradient editor instead: a bar of the stops, a marker per stop hanging off it
at the stop's own time, and the keys themselves under them. A marker drags along the axis once the
pointer has travelled a few pixels, so a click only selects it.

```
+-----------------------------------------------------------------+
|  +-----------------------------------------------------------+  |
|  |///////////// bar over a checkerboard //////////////////////|  |
|  +-----------------------------------------------------------+  |
|      V           V                V                       V      |
|     [#]         [#]              [#]                     [#]     |
|   0.00                                                    1.00   |
|   Time      R      G      B      A                               |
|   0.000  [#] #FF0000FF  1      0      0      1                   |
|   0.250  [#] #FFEEDDAA  1      0.93   0.86   0.67                |
+-----------------------------------------------------------------+
```

**The keys sit under the ramp rather than behind a tab of their own.** A stop's numbers are what a
reader compares against the ramp they are looking at, and a tab is a click plus a place to
remember. The rail and the table are one selection, so picking a marker highlights its row and
picking a row moves the marker. A colour's strip therefore offers Graph alone, because a Table tab
would draw the rows a second time.

**A colour plots no channel lines and offers no channel chips.** Four lines crossing a ramp are
what a colour is made of rather than what it looks like, and a modder reads a colour curve as the
ramp a particle runs through. The stop is where the numbers are: a marker points at the bar rather
than floating under it, so it reads as a stop of that ramp and not as a chip beside one, its body
carries the colour it lands on, and the picked one is ringed in the accent.

The bar takes a fixed height and the group centres in the pane. A ramp says the same thing at any
height, so a reader who drags the dock taller gets the room rather than a taller ramp.

Picking a stop is the whole of the gesture. The panel writes nothing yet, per
[where editing is allowed](#where-editing-is-allowed), and the readout's hex copies. It opens on
the first stop rather than on none, because a readout that is blank until a click reads as a
header rather than as a value.

A curve of one key draws flat across the box. It is a value that animates to nothing, which reads
as a line held at its own level and not as a mark in the corner of an empty plot.

**Table** is the keys as rows, a time and a channel per column, which is the form an edit takes.
Each column carries the hue its line draws in on the graph, and a colour's row carries a swatch
and its `#RRGGBBAA` ahead of the four numbers, so a key is read as a colour there too. It is the
same table a colour's graph draws under its ramp, which is why a colour is offered no tab of it.
A value with no keys is offered no Table either, because it has no rows.

### The randomizer

A value row authors its value in one of three modes, switched on the row: **Constant**, one
value; **Random**, a value drawn once at birth; and **Curve**, a value over time. Random hides the
tables. The row shows a Min and a Max, one field per channel each, and a random sign per channel,
and nothing about chance or factors.

```
Initial Velocity   [- * ~]
  Min  X [-1200]  Y [100]  Z [0]
  Max  X [ -510]  Y [400]  Z [0]
       X [+-]     Y [+-]   Z [+-]
```

- a particle lands between Min and Max on each channel, and the hint on Min and Max says how
  the channels roll. A birth vector and `birthColor` roll each channel apart, so the draws fill
  a box. The UV birth values share one roll, so theirs lie on the line from Min to Max
- random sign draws the ends or their negatives, the side picked by the channel's own roll. A
  colour has no sign
- the randomizer owns the base: each channel's base is the end farther from 0, and its table
  multiplies it from Min over base to Max over base, so a channel whose base was 0 still draws
- a value reads as Random where its curve holds one level and it carries tables. A curve that
  animates reads as Curve, and the dock draws its spread
- Random from Constant gives the value a curve at its own level and a table per channel, both
  ends on that level. Curve from Random clears every table slot to null, the schema's default
- a one-line host, such as a graph node or an emitter table cell, keeps the row's chip instead
  of the fields

### The random spread

`probabilityTables` is one nullable slot per channel, and a table is the chance against a factor:
a particle's birth rolls a chance, reads a table at it, and multiplies the sampled value by what
it reads. A birth vector and `birthColor` roll once per channel, so X and Y of one particle move
apart. `particleLifetime` rolls on its own. The UV birth values, the random start frame and the
birth-random colour lookup share one roll per particle, which `ParticlesShareRandomValue` makes
one per emitter.

**The spread draws on the Graph rather than on a tab of its own.** A table plotted as a line reads
as a curve over time, which it is not. What a modder asks is what the value draws, the curve times
the table, and the Graph draws that in one of two forms.

**A value with no keys draws lanes in place of the time plot.** Its curve is one level, so time
says nothing, and a lane is the surface an edit drags.

```
X  -55 .. -33 or 33 .. 55 /s |  ____       ////       __|_   41.2  [keys]
   split                     | -60   -30     0     30    60
Y  -10 .. -8 or 8 .. 10 /s   |  ____       ////       _|__    8.6  [keys]
   split                     | -10   -5      0     5     10
Z  0  fixed                  |  -----------|-----------
```

- one lane per channel, on its own scale with round ticks and 0 marked where it falls inside, so
  Y at 10 gets the width X at 55 does
- one row per channel or group of channels, read left to right: the names, the range's least, the lane, the range's
  most with the unit, and the shape switch. A pane too narrow to give the lane room takes each channel on
  two lines, the fields and then the lane across the whole width, a fixed channel's included, so
  every row keeps one shape
- a uniform or split draw as its bar or bars, a light fill inside solid edges as the Graph pane's
  value node draws one, and a custom table as density in a filled step area over a faint outline
  of its whole span, both in the channel's hue, a split's gap hatched. A density bin that draws at
  all reaches at least an eighth of the peak, so a thin tail out to the range's end stays visible
- a fixed or filler channel as a thin dim lane with one tick at its value
- after the lane, the value at the pin and a keys button
- lanes scroll when the dock is short, and a muted chip hides its lane

**Editing.** Under [where editing is allowed](#where-editing-is-allowed), every edit writes the
table and is one undo step:

- the label's two fields are the least and the most the channel draws, in the value's unit where
  the base holds still and as `×` a factor where it moves. A split's fields are its two sizes,
  behind `±`, which both halves share
- each end of a lane's block drags, or steps with the arrow keys, and a split's outer ends move
  together, as do its inner ones. The number follows the handle while it is held, and the lane
  leaves a quarter of room past the ends to drag into
- three icons under the label switch the shape, their names on hover: fixed, uniform and split.
  A fixed channel opens a quarter either side of its factor, and a split takes the sizes of the
  range it came from. A custom table keeps its keys and names itself beside them
- channels that draw one table over one base share one row, named by every channel, such as
  `XYZ`. An edit of the row writes each channel, so a uniform scale stays uniform. The row's
  unlink button gives each channel its own row until the value closes, and the first of those
  rows carries the button that joins them again
- a set of fixed tables still draws its lanes, so every channel offers its shapes
- a curve writing no tables gets **Add random** on the toolbar, a fixed table per channel

**A value that animates keeps its time plot, with a density edge.** A random channel carries a band
from the curve at its least factor to the curve at its most, and a split carries two. A column on
the plot's right edge shares the value axis and draws the density at one time: the pointer's, else
the playhead's, per [the time marks](#the-time-marks), and 0 while neither reaches the curve. A readout row per channel
under the plot reads that time: range, unit, shape, pin value and a keys button.

```
50 /s |          |  ___----====  |##
25    |- - - ___-|- - - - - - - -|####
 0    |==.-'=====|===============|##
      0   .25   .36    .75     1  births
X  12 .. 36 deg   uniform   pin 24.0  [keys]
Y  0              fixed
```

**The words.** A range is the result, the base times the factor. A base that animates has no one
result, so the popover reads the factor alone. The shape is `uniform` for two keys on 0 and 1,
`split` for one step of 0.01 chance or less, and `custom` for anything else. Filler reads dim:
`fixed` for a table of 1, `x2 always` for one other number, `no effect, base is 0`. A slot left
null beside a table reads `no table`, and lists of two lengths read as such, both in the danger
tone under a line saying the game crashes on the first and reads the second as 0.

**The keys button opens a popover** of chance, factor and result, the factor range over it. A key
outside 0 to 1 draws dim as `never rolled`. It sits on a split or a custom channel, whose fields
do not say every key, and its chance and factor are fields where the table can be written.

**A colour with no keys draws one bar from chance 0 to 1,** every colour the roll gives, with the
pin marked on it. A colour that animates draws its ramp at chance 0, at 1, and at the pin.

**The chance can be pinned.** Each birth draws its own chance until the Pin switch behind the dice button is
on, and its slider then sets the chance. Nothing else sets it: a lane or a ramp only marks it,
every lane together, because one roll serves every channel. It pins every birth of the whole run, children included, and the viewport says so in its corner with a
cross that lets it go. The run keeps drawing its own rolls under a pin, so letting go returns the
same run. The transport carries the same slider, per [the timeline](#the-timeline), because the
pin belongs to the run rather than to any one reading of it, and
[the inspector](#the-inspector)'s header reads the pinned value.

The `probabilityTables` chip in the toolbar carries the one-roll sentence as its tooltip, and is
drawn only where the value has tables.

A table on `Color` or `scale0` re-rolls every frame and every channel, and the toolbar warns of it.
Those two are the only fields that do. The toolbar and the inspector's roll rail are the only
places that say so: the Problems panel's `vfx/per-frame-random` and `vfx/broken-random` are held
back while their findings are too noisy to draw.

### Where a curve is drawn small

A field row draws a sparkline on a plate under its name, in every layout that draws field rows, at
one width down the pane. It is the first place a reader sees the shape of a `ValueFloat` without
leaving the row. It carries no axis and no number: it answers whether a value moves rather than what it is
worth. Its channels share one colour at that size, where the graph tells them apart.

A table cell keeps the mark. The same rule over the emitter table's four value columns is 240
curves on one screen. A field row reads its curve as its section scrolls into view, and a folded
section or a panel the table has folded away reads none. What is not drawn is not read.

A curve of one key draws no sparkline. A single key is the constant the row draws.

### What has no curve

A value whose `dynamics` is null draws no mark, and its row menu offers no curve. Adding one is a
write that sets a null pointer to a class, which nothing in the editor does yet, so the menu
promises nothing it cannot do.

## Editing

### The sandbox

A document opens in a sandbox, the data source it reads from and writes to (ADR-0056). A tab
opened in a project opens in the project's sandbox, which stacks the project's layers over the
game in the order a build applies them. The game sandbox is the installed game alone.

| Opened in    | A layer file | A game chunk a layer ships | A game chunk no layer ships        | A loose file |
| ------------ | ------------ | -------------------------- | ---------------------------------- | ------------ |
| Project      | Editable     | The layer's file, editable | Declared. ADR-0042                 | Read-only    |
| Layer subset | Editable     | The layer's file, editable | With the subset's edits, read-only | Read-only    |
| Game         | Its project  | The game's copy, read-only | The game's copy, read-only         | Read-only    |

A path resolves to the copy the build uses, so a game chunk a layer ships opens as that layer's
file and its edits save to it. A layer file is always read in its own project, so every tab of
it shares one tree and one save.

**The Sandbox options** lead the header row of a bin tab. The button names the sandbox,
`Sandbox (<name>)`, then where the next edit lands: the target layer's glyph and title, and the
chosen module when one is chosen. A read-only tab shows a lock and no target. The hover card says
what a sandbox is and where this tab's edits go. The options contain:

- **Read from**: the project and the game, which switch the tab in place. The game opens the
  install's copy of the same path, read-only, and is disabled for a file the install holds no
  copy of, with that reason under it. An object tab switches by its object and not by its
  path: it opens the file the picked sandbox resolves the object to, so the mod's declaration
  and the game's are one switch apart when they sit in different files.
- **Layers**, for a project of more than one layer: a submenu of one switch per layer in build
  order. The tab
  and its viewport stack the chosen layers alone, as a build of those layers writes them, and the
  button reads `Sandbox (<name>, 2 of 3 layers)`. Choosing every layer returns to the project.
  A switch redraws in place: the viewport keeps its camera, its run and what it has drawn, and
  each file that the new stack resolves differently replaces the old one when it lands. The layer of the tab's own file and the last chosen
  layer are disabled. Audio reads still use every layer of the project.
- **Declared in**, on an object tab whose object several files of the sandbox declare: the
  files, a layer's ahead of the install's, each with its layer or its archive under it. The
  one the tab reads is checked, and picking another switches the tab to it in place. With no
  object index built, the group offers the build instead, since the install's files are
  unknown.
- For a declared document, three rows that each name their current value and open their list
  in a submenu, so the options stay short however many layers and modules a project holds:
  - **Active layer**: the project's layers. Left out for a project of one layer.
  - **Module**: Automatic, every module of the active layer, and **New module**, which adds
    an empty module at the end and chooses it. A `target` module is listed disabled, with the
    reason under it. The outline names and renames modules.
  - **Mark changes from**: every layer, with how many rows its declarations change in this
    file. A layer switched off leaves its rows unmarked, and the active layer always marks its
    own. Left out for a project of one layer.

  See [Game data declarations](#game-data-declarations).

A link followed out of a tab opens in that tab's sandbox, so a link out of a declared document
opens declared, and one out of a game tab opens in the game.

A viewport draws the stack. A layer bin reads with the declarations of the sandbox's layers
applied in build order, and the assets it names resolve to the highest layer that ships them. The rows of a layer
file remain the file on disk, and a row a declaration overrides carries the mark.

### Where editing is allowed

The sandbox is one gate, and the file is the other. A `PTCH` file is read-only in any sandbox,
for a reason of its own that [A patch bin is read-only](#a-patch-bin-is-read-only) gives. The
header of a read-only document names the gate it stands behind: the game sandbox, a file outside
a project, a patch layer, or a project's declarations turned off.

A read-only document draws the same blocks with the widgets disabled, and offers **Copy into
layer**, which writes the chunk into the active project's layer and reopens it editable. That
is the route a modder wants anyway, because a change to a game file is a change that has to
live in a mod.

### Game data declarations

A declared document draws the game's copy of the chunk with the project's declarations
applied: every layer in build order, through the function and the schema the overlay build
uses. What the reader sees is what the build makes.

| Part                | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| The Sandbox options | Name the layer an edit writes to and the module its new keys join        |
| The mark            | Stands on each row a declaration of the chosen layer touches             |
| The hover           | Names the layer and spells the game's value as a declaration writes it   |
| A leaf edit         | Writes one key under an `entries` module of the layer's `game_data.yaml` |
| Undo and redo       | Restore the manifest and source texts from before and after the edit     |

The options open on the layer last used for the project, else `base`, and switch among the
project's layers in build order. A declaration another layer holds draws applied, and its row
carries that layer's glyph. The hover lists each layer that declares the row, in build order,
with the value it writes, and the game's value. The build keeps the last layer's. Mark changes
from turns a layer's marks off, per project, in `.ltk/editor.json`.

**Use game data declarations** is a per-project setting in `.ltk/editor.json`, flipped from
the command bar. It is not in the Sandbox options, which are per tab. A project that has not
chosen reads it as on when a layer already holds a `game_data.yaml`, `.yml`, `.toml` or
`.json`, and as off otherwise. Off, the document still draws the declarations applied with their
marks, so the view matches the build, and takes no edit. The Sandbox button shows a lock in
place of the target, the layer and module choices are disabled under a line saying declarations
are off, `+ Object` is gone, and the row menu drops the object edits,
**Paste reference**, **Merge reference** and **Move to module**. The toolbar shows
**Declare edits**, which turns the setting on.

An edit is on disk once it answers, so a declared document has no unsaved state and no save
status. The entry is spelled by its name from the tables, else by its hash. An undo over a
manifest edited since, by hand or from another tab, is refused and leaves the file as it is.

Every row edit lands as the declaration that says it.

| Row edit                                  | Declaration                            |
| ----------------------------------------- | -------------------------------------- |
| A leaf set, a field of a list element     | `path: value`, `list[i].field: value`  |
| Add an entry to a map                     | `+map: {key: value}`                   |
| Remove an entry of a map                  | `-map: [key]`                          |
| Set the key of a map entry                | `-map: [old]` and `+map: {new: value}` |
| Add an item at the end of a list          | `+list: [value]`                       |
| Remove an item of a list of leaves        | `-list: [value]`                       |
| Remove an item of a list of structs       | `-list: [index]`                       |
| Insert mid-list, move up, move down       | The whole list                         |
| Give an option a value, or clear it       | The option's value, or `null`          |
| Give a pointer a class, or set it to null | A struct pin, or `null`                |
| Add a property                            | A set of the new property              |
| Add a dependency                          | `links: [path]` in a `target` module   |
| Remove a dependency                       | `-links: [path]` in a `target` module  |

A declaration is checked before it stands. The project's declarations apply again, and the
value under the edit has to come out as the edit left it. Where the keys above do not, the
whole value is set in their place and the signed keys of that path are dropped: a removal by
value in a list holding the value twice is one such case. An edit under a whole value the
layer already sets joins that set. A row whose declaration sets a whole list or map says so
on its mark, because a later change of the game's no longer reaches it. An edit that neither
form reproduces is refused, and the manifest is left as it was. Where a later layer declares
the value, the refusal names that layer, because the build keeps its value over the edit's.

An edit of an object that a module's `source` document creates lands in that document, in the
object's `set`, unless a later module of the manifest declares the same path. A set of a list
item or a struct field that a set value holds replaces that node of the value where it stands.

A map is compared by its entries in any order, because an addition lands at the end of one.

An edit that rewrites a whole property, such as a duplicate emitter, declares the same keys
where the list only gained items at its end or lost one item: `+list: [value, ...]` or
`-list: [index]`. Any other change of the property sets it whole.

An object is created and removed through an `objects` entry of a `target` module for the
chunk (ADR-0049).

| Action                  | Where                       | Declaration                                  |
| ----------------------- | --------------------------- | -------------------------------------------- |
| Duplicate as new object | An object row's menu        | `<name>: {clone: <object>}`                  |
| `+ Object`              | The toolbar                 | `<name>: {class: <class>}`                   |
| `+ Object`, a template  | The toolbar                 | `<name>: {class: <class>, set: <template>}`  |
| Remove object           | An object row's menu        | `<object>: {remove: true}`, or drops a clone |
| Restore object          | A removed object row's menu | Drops the `remove: true`                     |

A new object is named on a line after the file's objects, never in a dialog. `+ Object`
opens it on a class search: the classes the file holds first, then every class the schema
knows. A particle system then picks what it starts from: Blank, or a system template such as
Explosion (ADR-0058). A duplicate opens it on the name. The name starts as
`Mods/<mod>/<source, template or class>`, the prefix the game-data reference suggests, with the
caret at its end. Enter declares the object, and Escape steps back to the template, to the class
or closes the line. A template writes its whole value in the object's `set`, its
`particleName` the name's last segment and its `particlePath` the name, as one undo step, and
the system opens on the template's rig. A name the chunk holds
already is refused on the line under the name, which stays open.

A bin the project holds takes the same actions without Restore object. Each is an edit of
the file itself and one undo step: a duplicate copies the object and rewrites the hash fields
that hold its own path, and the save appends a new object after the file's others. A copy of
an object from another chunk needs the game, so only a declared document makes one.

Removing an object the layer created drops its creation, so no `remove: true` is written
for it. An object the layer removes keeps its row, struck through with a `removed` mark: it
opens nothing, takes no edit, and its menu offers Restore object and Copy path. An object
the layer creates carries the layer's glyph on its row. A creation or a removal the apply
skips draws its reason on the object's row, or in the toolbar where the chunk holds no
such object.

Three edits are refused with the reason. A path through a field no table names has no
spelling in a declaration, and neither has a map key the file holds twice. No declaration
removes a property, so Remove property is disabled and its menu item carries the reason.

An edited property takes the type the schema gives it at the install's build. Where the meta
database does not describe the install's build yet, it takes the type at the newest build the
database names. A field no build of the database knows types from the game's copy, and an
added one is refused with that reason.

What the apply reports draws on the row it names, over every layer of the project and not
the chosen one alone. A skipped key draws a warning with its reason, the key as the manifest
spells it and the layer holding it. A property typed from the game's copy, where the schema
says nothing, draws as information. A key that reaches no row lists under its object, and a
diagnostic that names no object of the chunk, a link or an override file, draws in the
toolbar.

The row menu carries the declaration actions.

| Item                | Offered on             | What it does                                          |
| ------------------- | ---------------------- | ----------------------------------------------------- |
| Copy as declaration | Any row of any bin     | The row as an `entries` module, ready under `modules` |
| Copy reference      | A value row of any bin | `!ref <entry>:<path>`, the path Copy path writes      |
| Paste reference     | A declared document    | Sets the row to the copied reference                  |
| Merge reference     | A list or a map of one | Adds the copied reference with `+`                    |

Both copies work on a read-only bin, because a declaration is written from the game's copy
as often as into it. An object row copies as its entry with every field, and an object tab's
menu offers the same copy, because the tab draws no row for the object itself. An object
copies no reference, because a reference names a value.

An object and a struct copy as a block of their fields, the way an author writes one: a
nested struct is a nested block, and no class is pinned. An apply sets the fields one by one
on the game's own struct. A field no table names is left out, and so is a map entry whose
key has no spelling. An apply leaves each as the game has it, and the copy's toast says how
many. A list whose items hold such a field copies a key per item, `list[i]`, each a block of
its named fields. A row whose path runs through a field no table names copies neither, and
its items are disabled with the reason as their title. The app holds the reference it copied, so a paste reads no
clipboard.

A reference reads the installed game and never the project: the first chunk declaring the
entry in the game index's order, which is the overlay's rule. A row whose declaration is a
reference draws the resolved value, and its mark names the entry and the path it came from. A
reference the game does not answer is written all the same, and the apply reports it on the
row.

One re-apply over the largest skin bin of the install (Viego, 3.7 MiB, 483 objects) takes
65 ms in a release build.

### A game bin a layer ships

A game chunk that a layer of the project ships opens as that layer's file, which is the copy the
build packs. Its edits save to the file, as any layer file's do (ADR-0040).

The build then applies every layer's `game_data.yaml` over that file. A row that a declaration
overrides shows the declaring layer's glyph. Its hover lists each layer that declares it in build
order, the value each writes, and the file's own value. The build packs the last layer's value.

### A patch bin is read-only

A `PTCH` file is a layer rather than a file of its own. After its object table it carries
property-patch records - an entry hash, a value type, a path and a value each - and the game
applies them to whatever bin the layer is attached to. Riot ships its UI variants that way, as
a few hundred one-property edits rather than a duplicated scene. A patch bin is mostly patches
and only incidentally objects.

`ltk_meta` reads the three lists a patch holds, `deleted`, `objects` and `patches`, through
`BinOverride::from_reader`, and writes them through `BinOverride::to_writer`. A record's path is
the crate's own `PropertyPath`, the syntax [Addressing a node](#addressing-a-node) adopts. The
file tab draws the records, per [A patch bin's records](#a-patch-bins-records).

A `PTCH` opens read-only whatever its source. No edit writes a record, and the position that
addresses a record (ADR-0041) holds only while the record list does not change. Patch authoring is
the feature that opens the write. The header names the file a patch layer.

### What an edit is

A patch, applied to the tree in Rust, answered with the rows that changed.

| Operation       | Carries                                       |
| --------------- | --------------------------------------------- |
| Set value       | A path and a value                            |
| Insert item     | A holder path, an index, and a key or a class |
| Remove item     | A path                                        |
| Move item       | A path, and a destination                     |
| Add property    | A holder path, and a field                    |
| Remove property | A path                                        |
| Set map key     | A path, and a key                             |
| Set pointer     | A path, and a class or null                   |

A text or number field is controlled locally and commits on blur or on `Enter`, and
`Escape` drops the draft. A patch per keystroke is a round trip per keystroke, and neither the
tree nor the disk wants one.

A value drawn as a chip - a string naming a file, a `hash`, a `link`, a `file` - keeps its chip,
and the row's edit action opens a field over it with the string, the name, or the hex. The
action shows on the hover of a tree row and of a layout cell, and the row menu offers it as
**Edit value**. A name typed into a `hash` or a `link` is hashed in Rust, and the document keeps
the name, so the row draws it again where no table names the hash. A typed field name, class
name, map key, object name and chunk path draw the same way. A cleared `hash`, `link` or
`file` writes the zero hash, which the game reads as no link. An integer an enum table reads
edits through a select of the engine's words, and a flags value through its number.

A field whose value is refused stays open with what was typed, marked with the reason, so
the reader corrects the text rather than typing it again. `Escape` drops the text and the mark.

### The row keys

A tree row takes focus, and one row is the tree's tab stop.

| Key                  | Does                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `Up`, `Down`         | The row above or below                                           |
| `Home`, `End`        | The first or the last row                                        |
| `Right`              | Opens a shut row, or steps to its first child                    |
| `Left`               | Shuts an open row, or steps to its parent                        |
| `Enter`, `F2`        | Opens the row's value for an edit. `Enter` opens a row with none |
| `Alt+Up`, `Alt+Down` | Moves a list item, per the section below                         |
| `Ctrl+Enter`         | Inserts an item after the focused one                            |
| `Shift+F10`          | The row menu                                                     |

`Enter` and `Escape` in a field return focus to its row when nothing else takes it, so a run of
edits is keyboard-complete.

### A path field

A `file` value and a string that names a file are edited in a path field. It is the edit field
from "What an edit is", with a list of files below it, so a modder picks a file instead of pasting
its path. The tree, the class views and the inspector use the same field.

| Row                                | Edited in                                                          |
| ---------------------------------- | ------------------------------------------------------------------ |
| A `file`                           | A path field                                                       |
| A string that contains a path      | A path field. A path is read as "A string that names a thing" says |
| A string with a path property name | A path field                                                       |
| Any other string                   | A plain field                                                      |

A path property name ends in `texture`, `TextureName`, `TexturePath`, `MeshName`, `MapName`,
`skeleton`, `SkeletonName`, `simpleSkin`, `AnimationFilePath`, `FilePath`, `FileName` or `Path`,
or starts with `icon`. The exact names `mapName` and `path` are not path property names.

| Draft                 | The list shows                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Unchanged, or cleared | Project files of the expected kind, then **Same folder**: the files in the current path's folder |
| Typed                 | Project files that match the terms, then **Game**: matching game files, ranked in Rust           |

Terms match the same way as in the palette. The text is split on whitespace, and each term must
appear as a contiguous substring. The frontend matches project files, because it already has the
content tree. Rust matches game files over the game index. A path field search has a separate
cancel ticket, so it does not cancel a palette search, and a palette search does not cancel it.

Files of the kind the field expects rank first: a texture for `texture`, a mesh for `MeshName`.
The kind comes from the extension of the current path, or from the property name when the field
contains no path. In the game group, files from the document's archive rank next. Files of
other kinds are still listed lower down, so a wrong kind guess does not hide a file.

A path that the project also has appears once, in the project group, because the project's copy
replaces the game's when the mod is enabled. Files excluded by the ignore rules are not listed.
Chunks that no hashtable names are not listed, because they have no path.

`Enter` picks the highlighted suggestion. While the draft is search terms, the top suggestion is
highlighted, and an `Enter` pressed before any suggestion answered picks the top one when the
list answers, or writes the terms where it answers none. While the draft contains `/`, nothing is highlighted, so `Enter` writes the typed
path. A string field that contains text other than a path highlights nothing, so `Enter` keeps its
text. A click picks a suggestion. `Escape` discards the draft, as in any field.

A picked path is written with its source's spelling: the author's casing for a project file, and
lowercase for a game file. The game lowercases a path before it hashes it, so both spellings
reference the same chunk.

### A sound field

A string that holds an event name is edited in a sound field: the edit field of a path field, with
event names below it. The sound fields are `SoundEventData.mSoundName` of a clip event,
`soundOnCreateDefault` and `soundPersistentDefault` of a `VfxSystemDefinitionData`, and
`SoundOnCreate` and `SoundPersistent` of a `VfxEmitterAudio`.

| Draft                 | The list shows                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| Unchanged, or cleared | A group per bank unit of the bin's character skin, with the events that it lists     |
| Typed                 | The unit events that match the terms, then **Other game events**: the game's matches |

The scope is the bin's character. For a bin under `data/characters/<name>/`, the units are those
of `skins/skinN.bin` with the bin's own skin number, then those of `skins/skin0.bin`, so
`animations/skin7.bin` lists the skin 7 units first and the base units after. A bin without a skin
number reads the base skin, and a bin outside the characters folder lists only the game's matches.
A skin bin that the project edits lists the project's units in place of the game's.

Terms match as in a path field. An event that an earlier group lists is not listed again. Rust
searches the game's event names, at most 30 shortest first, and the list counts the rest.

`Enter` picks the highlighted suggestion, the top one while the draft is search terms. A typed name
that no group lists is written as typed.

### Adding a property

**Inline, and never a dialog.** An expanded holder - an object, an embed, a pointer struct that
is not null - ends in an add line under its last property, and an object tab's roots end in one.
An editable holder expands while it is empty, so an embed with no fields still has its line.
The holder row's `+` action and its menu item open the holder and focus the line.

The line is a field. The text narrows the fields the holder's class and its bases declare at the
install's build, less the ones the holder writes, each with its kind and the class that
declares it. `Enter` adds the highlighted field.

A field the schema does not offer is typed the way ritobin writes one: `mySpeed: f32`,
`tags: list[hash]`, `names: map[hash,string]`, `mesh: embed = SkinMeshDataProperties`. A name
is hashed as any field name is, and `0x` with eight hex digits is taken as the hash.

| Added field            | Starts at                                                    |
| ---------------------- | ------------------------------------------------------------ |
| A declared leaf        | The schema's published default                               |
| A declared list, map   | The default's items where they are leaves, empty otherwise   |
| An embed, a pointer    | Its class with no fields. The game reads each at its default |
| A fixed list of embeds | That many embeds of the class, each with no fields           |
| A typed field          | Its kind's zero value                                        |
| No published default   | Its kind's zero value                                        |

An added property lands at the end of its holder, and the game reads fields by hash. Focus moves
to the new value: a number, a vector and a colour into their first box, a string, a hash, a link
and a file into their field. `Enter` on that value returns focus to the add line, so a run of
fields types straight through. An added embed opens and focuses its own add line. A kind with no
field to type into leaves focus on the add line, which clears for the next field.

**Remove property** is the property row's `-` action and a menu item. The game reads the
field's default where the file writes none. An undo of a remove puts the property back at its
position.

### Editing a list, a map, an option and a pointer

**Every add is inline, and a list takes an item at any position.** A list of a few thousand items
is common in a particle system, so an add that only reaches the end of one is an add a modder has
to scroll for.

```
weights       list[f32]           3 items     [list+]
  [0]  [ 0.5 ]                                [row+][-]
  [1]  [ 1.0 ]                                [row+][-]
  + add item
emitters      list[pointer]       2 items     [list+]
  [0] VfxEmitterDefinitionData                [+][row+][-]
  + [ Vfx|                                  ]
    | VfxEmitterDefinitionData   in list    |
names         map[hash,string]    1 entry     [list+]
  {"Idle"}  string  "idle.anm"                [row+][-]
  + [ key| ]
scale         option[f32]         [ 1.5 ]     [x]
mesh          pointer             null        [+]
  + [ SkinMeshDataProperties|               ]
```

| Row                       | Hover actions                              | Menu                                          |
| ------------------------- | ------------------------------------------ | --------------------------------------------- |
| A list                    | Add item                                   | Add item                                      |
| A map                     | Add entry                                  | Add entry                                     |
| An item of a list         | Insert after, Remove item                  | Insert after, Move up, Move down, Remove item |
| An entry of a map         | Insert after, Remove entry, the key's edit | Insert after, Remove entry                    |
| An absent option          | Set value                                  | Set value                                     |
| A present option          | Clear value                                | Clear value                                   |
| A null pointer            | Set class                                  | Set class                                     |
| A pointer holding a class | Add property                               | Add property, Set to null                     |

**A list.** An expanded list ends in an add line. `Enter` on it appends an item and focuses the
item's value, and `Enter` on the value returns focus to the line. The list row's **Add item**
reaches the end from anywhere, paging the rows in on the way. An item row's **Insert after** and
`Ctrl+Enter` on a focused item put an item right after it. An item of a leaf kind starts at the
kind's zero.

**A class is picked in the line.** An item of an embed or a pointer list is a struct, so its add
line and its Insert after line are a field over classes: the ones the list holds already, the
class the schema declares for the list, and the classes that derive from it at the install's
build. A name the schema does not offer is typed in and hashed. An added struct opens and focuses
its own add line, where its properties go.

**Order.** `Alt+Up` and `Alt+Down` move the focused item one place, and Move up and Move down do
the same from the menu. Focus follows the item. A map's entries keep their order, because the game
reads a map by key.

**A map.** The add line and an entry's Insert after line are a field for the key: digits for an
integer key, the text for a `string`, and a name or `0x` and eight hex digits for a `hash`. `Enter`
adds the entry at its value's zero and focuses the value. An entry's key edits in place through
the name's edit action. A key the map holds already is refused and the field is marked.

**An option.** Set value on an absent option writes its kind's zero and focuses it, and an option
of a struct picks the class in a line under it. Clear value empties a present one.

**A pointer.** Set class on a null pointer opens a class line under it, over the class the field
declares and its subclasses. Set to null drops the class and every property under it, and an undo
brings them back.

Each of these is an edit, with the undo of every other. A removed item or entry comes back at its
index, a move goes back, and a key edit restores the key. The rows a reader expanded under a list
follow an insert, a remove, a move and a key edit, so an expanded item stays the one expanded.

### Duplicating, pasting and deleting an emitter

An emitter of a system's `complexEmitterDefinitionData` or `simpleEmitterDefinitionData` is
duplicated, copied, pasted and deleted whole, with every hash, class, link and nested struct
under it.

| Where                                          | Duplicate emitter | Copy emitter | Paste emitter           | Delete emitter |
| ---------------------------------------------- | ----------------- | ------------ | ----------------------- | -------------- |
| The Graph menu on a master node                | Yes               | Yes          | After the node          | Yes            |
| The Graph menu on the canvas                   |                   |              | At the end of each list |                |
| The inspector's Emitter menu, on the open card | Yes               | Yes          | After the card          | Yes            |
| The Graph pane, one master node selected       | `Ctrl+D`          | `Ctrl+C`     | `Ctrl+V`, after it      | `Delete`       |
| The Graph pane, several master nodes selected  | `Ctrl+D`          | `Ctrl+C`     | `Ctrl+V`, at the end    | `Delete`       |
| The Graph pane, no master node selected        |                   |              | `Ctrl+V`, at the end    |                |
| The timeline, with focus in the lanes          | `Ctrl+D`          | `Ctrl+C`     | `Ctrl+V`, after it      | `Delete`       |

**Duplicate, copy and delete act on every selected emitter.** A shortcut, or a menu item on a
node of the selection, acts on the emitters of all selected master nodes. A menu item on a node
outside the selection acts on that node alone.

**A duplicate lands right after its source.** A pasted emitter keeps the list it was copied from.
The pasted emitters of the list of the emitter that the paste was asked on land after it, in
order, and the others land at the end of their own list. A duplicate and a delete are one
`editProperties` edit, and a paste is one `createAndEdit` edit, so each is one undo step. In a declared document a duplicate, a paste and a template land at the end of the list
instead, so the declaration adds the emitter, and a delete removes it by index. The game's other
emitters stay the game's, and a later patch of theirs still reaches the mod.

**A copy is JSON text on the clipboard.** It carries `"format": "ltk-manager/vfx-emitters"`, the
entry of the source system, and for each emitter its list, its numbered mask and the backend's
copy under `"format": "ltk-manager/bin-value"`. The backend copy holds the class and the value as
`ltk_meta` serializes it, so a paste reads it back exactly in another system or another open
document. A paste also takes a bare `ltk-manager/bin-value` copy of one emitter, which lands in
the complex list. Copy works on a read-only document, such as a game file, and a paste needs a
document that takes edits. Where the webview refuses to read the clipboard, a paste takes the
last copy made in the session.

**A copy carries the child systems that it links.** Each system that a copied emitter's
`childrenIdentifiers` names by its `effect` link is copied whole when the source document holds
it, and so is each system that those systems link in turn. A paste creates each carried system
that the target document cannot link as a child, under its own name, in the same undo step. A
child named by `effectKey` carries nothing, because the target document's own resolver maps the
key.

**A paste into another system keeps masks apart.** A pasted emitter on a numbered stencil mask
that the target system already uses moves to the lowest free reference, and every pasted emitter
on the same mask moves with it. A mask named by `StencilReferenceId` is kept, since the id is the
way to share a mask between systems. A paste into the system that the copy came from keeps every
mask.

**The name is unique within the system.** An `emitterName` another emitter of the system's lists
holds gains `_copy`, then `_copy2` and on, after any copy suffix it already carries: duplicating
`Spark` gives `Spark_copy`, and duplicating `Spark_copy` gives `Spark_copy2`. A pasted name no
other emitter holds stays. A child particle set names a system rather than an emitter, so
nothing else is renamed.

**A paste refuses what is not an emitter.** Clipboard text that is no copy, or a copy of another
class, leaves the list as it was, and a toast names the reason as for every refused structural
edit.

### Adding an emitter from a template

A VFX template is a tuned emitter or system the editor ships, stored as a copied emitter is
(ADR-0058). Add from template sits beside Paste emitter in the Graph menu on a master node and on
the canvas, and in the inspector's Emitter menu on the open card. The quick add lists the emitter
templates too.

**A template lands where a paste would**, after the emitter it was asked on, else at the end of
the complex list, as one property edit and so one undo step. Its emitter keeps the template's
English name, such as `Sparks`, and a name the system already holds gains a number: `Sparks2`,
`Sparks3` and on.

**A system template lands every emitter it holds**, such as Explosion's flash, fireball, debris,
smoke, ring, heat and scorch, in the same single edit, each named apart. The run then plays on the
template's rig, such as Missile's flight, unless the author or a context chose the rig in hand,
and the rig pill names the template as its source.

**A template names only assets the game ships**, under `assets/shared/particles/`, so it draws
at once and the project gains no file. The plan and the list of templates are
`docs/plans/vfx-templates.md`.

### Adjusting a system

Adjust sits at the end of the row of an editable particle shell, and in the Edit menu. Its popover holds a hue slider
from -180 to 180 degrees, a scale slider from 0.25× to 4×, a reset and Apply.

**The preview follows the sliders before anything is written.** Apply writes both adjustments as
one grouped edit, so one undo step, and closing the popover without Apply drops them. A value that
an adjustment leaves equal takes no edit. The adjustments change the system's own emitters, so a
child system keeps its values.

**The hue turn changes the tints:**

- `color` and `birthColor`, their constant and every key
- `colorModulate` of a projection, `mAnimatedColorWithDistance` of a beam and
  `SeparateLingerColor` of a linger
- `fresnelColor` and `reflectionFresnelColor` of a reflection

The turn keeps each color's brightest channel and its alpha, and a gray takes no edit.
`erosionMapChannelMixer` and `palleteSrcMixColor` are channel weights and stay. Textures are not
recolored.

**The scale multiplies the lengths:**

- the particle's size: `birthScale0`, or `scale0` on an emitter that sets no `birthScale0`,
  because the size is their product
- `EmitterPosition`, `translationOverride` and `emissionMeshScale`
- `birthVelocity`, `velocity`, `birthAcceleration`, `acceleration` and `worldAcceleration`
- the spawn shape's `Size`, `radius`, `height` and `emitOffset`
- a trail's or a beam's `mBirthTilingSize` and `mCutoff`, and a beam's source and target offsets
- a field's `Position`, `radius`, `acceleration` and `velocityDelta`
- a linger's keyed velocity and acceleration, a projection's `mYRange`, and `visibilityRadius`

Drag, rotation, orbital velocity and every time stay.

### Editing a node's structure in the Graph pane

A node under an emitter stands for a value of the file, so the Graph pane edits the value's
place as well as its fields. Each gesture is one edit, so one undo step.

| Gesture                                              | Edit                                                      |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Forces, in the Effects header's plus menu            | A force of the kind picked, at its game defaults          |
| Add item, under a list node's items or in its menu   | An item of the last item's class, at the list's end       |
| Duplicate, or `Ctrl+D` on one node selected          | A copy of a list item, right after it                     |
| Remove item or Remove force, or `Delete` on one node | A list or map item leaves its list                        |
| Reset to default, or `Delete` on one field's node    | The field leaves its holder, which then reads the default |
| Add child, on a Children node or an emitter node     | A child by link or key, or a new system and its link      |
| Remove child, or `Delete` on a child system node     | The child's identifier and its bone leave the set         |

**Add field is a plus on a header.** Each group heading of an emitter node lists the group's
unwritten fields, and the emitter's own header lists those of the groups it writes nothing of,
a submenu per group. A Texture node's header lists the texture and render fields, and the texture's
effects, alpha erosion, distortion and reflection, which the node draws as sections of their own
under its rows rather than as nodes. A Geometry node's header lists the spawn shape, the primitive
and the fields that orient it, and draws the shape and the primitive as sections. The Effects
group always draws, so its menu offers the forces before the emitter holds any, and the fields
leave out the force collection, which adding a force writes when it is missing.

#### Adding from the keyboard

**Tab opens the quick add.** With the Graph pane focused, Tab or Shift+A opens a search box at
the pointer, and a double click on bare canvas opens one at the click. Over an emitter's node, or
with one selected, it lists that emitter's unwritten fields under their groups, then the forces.
It always lists New emitter, which appends a complex emitter named `Emitter1`, `Emitter2` and on,
and the emitter and system templates, which land after the emitter it was opened over, else
last.
Typing narrows the list by an entry's name or its group, Enter adds the highlighted entry, and
Escape or a press outside closes it. A field added this way shows at its default on its node,
which unfolds, until an edit writes it.

**An empty socket plugs in a node.** A value field that holds a constant has a hollow socket on
its left edge. A drag out of it that ends on the canvas, or a click on it, opens the quick add
with what plugs in: Curve, a flat curve at the constant's level, or Random range, both ends on
the constant. The field then carries its curve and draws its value node.

**A file drops from the content tree.** A file dragged out of the content tree onto a path field
of a node writes its game path there, where the field takes that kind of file. Dropped on an
emitter's node away from such a field, a texture writes the emitter's `texture`, and a mesh makes
its primitive a `VfxPrimitiveMesh` holding it. Only a file under a `.wad.client` folder has a
game path, so only such a file drags. The drag runs on pointer events rather than the webview's
drag and drop, which the window's own file drop takes on Windows.

**A keyed value reads at the playhead on the canvas.** A value node's curve or colour band carries
a line at the run's time, with a dot per channel on a curve, and its header reads the value
there, a colour as a swatch. A value drawn in its socket carries the line alone, so its row
holds still. The time is the curve pane's: the emitter's life ratio for a birth value, and the life
ratio of the particle the run follows for any other, with no line or reading while none lives.

### Validation

The backend validates every patch against the kind and rejects what does not fit - 300 into a
`U8`, a string into an `F32`, an element into a container of another kind. The frontend
clamps the same ranges so the common case never round-trips, and the backend is what decides,
because a guard that lives only in the frontend is a guard an IPC caller walks past.

A rejected patch leaves the tree untouched and marks the field, and the save state goes to
`blocked` for as long as a field is invalid, exactly as the strings editor does. An edit that
lands elsewhere meanwhile does not clear it. The mark goes when the field sends a value that
lands, when `Escape` drops its text, or when its tab closes. An integer is checked against its
kind's range before it is sent.

A refused structural edit - an insert, a remove, a move, a pointer's class - has no field to
mark, so a toast names the reason.

### Save

Autosave. There is no save button, the debounce is the strings editor's `SAVE_DELAY_MS`, and
the state union is the one that editor already ships.

```
clean -> pending -> saving -> clean
                           -> failed
blocked                              while any field is invalid
```

The tab's unsaved dot follows `blocked` and `failed` only. A document that autosaves is clean
between keystrokes, and a dot that blinks on every edit means nothing. The dot is what makes a
close or a quit ask before it drops edits that did not reach the file. `Ctrl+S` and a quit write
a save still waiting on the debounce at once, and `Ctrl+S` on a failed save tries it again.

A failed save names its reason on the hover of **Couldn't save**, and **Retry** writes through
the tab's open document, whichever tab queued the save.

**The write is a delta over the bytes the document opened.** ADR-0040. The document holds its
file's bytes beside the tree, and the path hash of every object a patch touched. A save mounts
those bytes as a `BinStream`, replaces each touched object with its copy from the tree in a
`BinDelta`, and writes through `write_patched` to a temp file beside the target, then renames.
An object no patch touched keeps every byte. The written bytes are the next save's base.

**A file changed on disk refuses the save.** The save reads the file first and compares it with
the base. A difference writes nothing, and the save state goes to `failed` with the toolbar
naming the change and offering **Reload**. The tree keeps its edits until the reload, which
reopens the file and drops the edits and the undo stack.

A tab closed with an edit still waiting on the debounce saves it before the close.

### The version-3 write

A save writes version 3, including when the file opened as version 1 or 2. Objects with no
edits keep their bytes.

A save validates every base object's structure before output. Legacy kind numbering refuses
the save, including in an object replaced by an edit. A failed save keeps the file on disk and
the document's unsaved edits.

### Undo

An inverse-patch stack in Rust, bounded, one per open tree. `Ctrl+Z`, and `Ctrl+Shift+Z` or
`Ctrl+Y`, while a document over the tree is the active tab of the focused group, wherever focus
is inside it, including nowhere after a field closes. A file tab and the object tabs over one asset share a tree
(ADR-0028), and they share its stack. An undo never crosses into another asset's tree. An undo
that crosses tabs undoes work a user is not looking at.

An undo is a patch, and it saves like one. A text field holding an uncommitted change takes the
keystroke as the field's text undo, and so does a text field that contains no document value, such as
a filter. An undo answers how it moved the rows, so the rows a reader expanded follow it as they
follow the edit, in every tree over the asset. An undo that fails names its reason in a toast.

### Dependencies

A `PROP` bin's dependency list draws as a row pinned over its objects, folded, with the count.
The header's count opens it and moves to it. Each dependency is a row of the tree, and a `PTCH`
has none.

| Part         | What it does                                                                             |
| ------------ | ---------------------------------------------------------------------------------------- |
| The chip     | The brex spelling where one folds the path, else the path, resolved as a `file` link     |
| The hover    | The full path, and the layer or archive that holds it, or the missing mark               |
| Click, Enter | Opens the file                                                                           |
| The menu     | Open file, Open file beside, Copy path, Edit path, Move up, Move down, Remove dependency |
| The add line | Closes the list. A path or its brex spelling, added at the end                           |

Copy path copies the path, never its brex spelling. Edit path opens the full path in place, F2
from the row. Typed brex expands to its path before it is saved, and a spelling that does not
expand, an empty path and a path the list already names are refused on the line. `Alt+Up` and
`Alt+Down` move a row, a drag onto another row moves it there, and Delete removes it. Each edit
joins the tree's undo stack and saves as the delta of [ADR-0040](../adr/0040-a-bin-save-writes-the-edited-objects-over-the-bytes-it-opened.md)
with the new list.

A declared document adds at the end and removes, through the `links` and `-links` of a `target`
module of the chunk (ADR-0050). Edit path, the moves and the drag are disabled, their reason on
the menu item. A dependency the chosen layer adds carries its mark, and one it removes stays
struck through at the end of the list with **Restore dependency**.

### What an edit cannot do

- Change an object's path hash. It is the object's identity, and every link to it holds it
- Change an object's class. The properties of the old class are not the properties of the new

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

**The lazy read is not this feature's.** It is the object index's, which sweeps 42,306 files in
a build and cares about the 242x, and it exists as `BinStream::entries`. One file at a time
does not care. The editor ships on `Bin::from_reader` and takes `BinStream` for the read-only
case if a measurement ever asks for it, as an optimisation and not a prerequisite.

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
| One open document, in memory    | 25MB   |

## What has to land first

Nothing hard-blocks the first stage.

| Item             | Where     | Status                                                  |
| ---------------- | --------- | ------------------------------------------------------- |
| `ltk_meta` 0.8.1 | Workspace | Compiled, pinned to the rev that carries the walk       |
| `bin_tables()`   | This repo | Landed 2026-08-23, as `BinHashTables`                   |
| `BinStream`      | Upstream  | Landed in 0.8.1. The object index's, optional here      |
| The delta write  | Upstream  | `write_patched` at the pinned rev. ADR-0040             |
| Patch records    | Upstream  | `BinOverride` reads and writes one. ADR-0041 draws them |
| The meta dump    | Upstream  | Stage four only, for schema-aware editing               |
| `ltk_ritobin`    | Upstream  | Git only. Publish before the text view                  |

`ltk_meta` is a dependency of the workspace already, through the problems pass.

## The backend

`core/src/bin_document.rs` holds the parsed tree, the patch application, and the row
projection. It knows about `ltk_meta`, `AssetRef` and the hashtable cache, and it knows
nothing about Tauri.

`src-tauri/src/commands/bin.rs` is the seam, and `BinDocuments` is a third managed state
beside `SettingsState` and `PatcherState`.

| Command             | Answers                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `bin_open`          | A handle, the header facts, and the root rows                          |
| `bin_children`      | The rows under one address                                             |
| `bin_read`          | The rows under each of several addresses, in one call                  |
| `bin_edit`          | What the edit reports beside the change, or a rejection. ADR-0051      |
| `bin_choices`       | The fields a holder can add, or the classes an object or an item takes |
| `bin_undo`          | Whether an edit was held to revert                                     |
| `bin_redo`          | Whether an undone edit was held to apply                               |
| `bin_reload`        | Nothing. Every id over the asset reads the file again                  |
| `bin_save`          | Nothing, or a refusal naming a file changed on disk                    |
| `bin_roots`         | A file's rows at depth zero, read again after an edit                  |
| `bin_close`         | Nothing                                                                |
| `class_schema`      | One class's fields and their declared kinds, at the install's build    |
| `declared_objects`  | What declares each of a page's link and hash targets, in link order    |
| `locate_game_files` | The install's copy of each of a page's `file` targets                  |

`bin_edit` takes one `BinEdit` per store method: `patch` answers the value the leaf held,
`insertItem`, `moveItem` and `setKey` answer the item's new path, and an object create, a
dependency insert and a module action answer the new hash, the position and the declared state.
Every other edit answers `done`.

An object tab is `bin_open` with an entry named, answering that object's rows at depth zero and
the header facts of the object. A file tab and the object tabs over one asset share one held
tree. The store keys on the asset and counts the tabs over it.

Errors carry a `code` and typed fields the way [error handling](../ERROR_HANDLING.md) describes,
with the node address as a field of a rejected patch.

## The frontend

`src/modules/workshop/bin/` holds the file document, the object document, the row components,
the widget matrix keyed by kind, the cards, and the class layouts keyed by class hash. It is a
sibling of `preview/` rather than a part of it. The preview module draws an asset and this one
edits a document.

`PreviewDocument` routes a property bin here instead of to `BinPreview`, and `BinPreview` stays
as the fallback for a file that does not parse.

The design system rules the blocks lean on:

- `DS-RADIUS` - a row is dense inline chrome, so `rounded-sm`
- `DS-GAP` - the row list is a `flex` with a `gap`, never `space-y-*`
- `DS-VEIL` - a row's hover is `bg-surface-veil`, because a row owns no surface
- `DS-KIND-HUE` - a kind is not a status. A hue that tells the kinds apart is its own scale
- `DS-TOKEN` - a `Color` swatch draws the bin's value, which is data and not a token

A bin already has a tint. `fileKindIcon.ts` gives `property_bin` the `--ltk-riot-red` mark,
the tab takes it through the existing descriptor, and no `doc-*` token is added.

## What ships in what order

Three tracks. The reading track is one epic, the views track another, and the editing track
its own.

**The reading track.**

1. **The viewer.** `bin_open`, `bin_children`, the leaf widgets read-only, the container rows,
   the four tables, and the address on every row with a **Copy path** behind it. Landed
2. **Type tags and cards.** Every row's tag, the class and field cards with their copy actions,
   and one vocabulary with the Problems finding. The schema crosses IPC once per class
3. **The object tab.** ADR-0028, with its three routes in: a `$` hit, an object block, an
   Objects browser row
4. **Chips that open.** `link`, `file` and a declared `hash` as chips, the per-page check, the
   resolution order, and the other declarations in the Sandbox options
5. **The Objects browser**, and Reveal in Objects. [Project editor](PROJECT_EDITOR.md#objects-browser)
6. **The References document**, fed from the index. Find all references on a class
7. **The texture swatch**, on the `?w=` parameter the explorer thumbnails share
8. **The walk**, for an embedded class and for incoming links
9. **The `@` scope** over the open rows

**The views track.** ADR-0030, in shipping order.

1. **String links.** A string that names a chunk or an object, as the chip its kind draws
2. **The projected read, and the value rows.** `bin_read`, and the swatch and strip on a
   `ValueColor` row
3. **The view mode, and the material layout.** The registry, the segmented control, the
   renderer with its Other section, Show in properties, and the first layout
4. **The skin layout**, with its preview slot empty
5. **The VFX layout**, with the emitter table
6. **The animation graph table**, as the clips pane of docs/ux/SKIN_EDITOR.md

**The editing track.**

1. **Leaf editing.** The primitive widgets on the Properties rows, the `patch` edit, validation,
   autosave as a delta (ADR-0040), the refusal of a file changed on disk, undo. Layer sources
   only
2. **Container editing.** Add, remove, reorder, and a `Map` key. This is where the complexity
   is
3. **Cells that edit.** A layout's cell is a path and a value, so the leaf widgets reach every
   layout at once
4. **Schema-aware editing.** The meta dump, a field's declared type, and the subclasses an
   `Embedded` accepts

The tracks interleave as complaints dictate. Each step is useful alone.

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
| What does a `Matrix44` look like when a user actually has to change one?     |
| Should two layers' copies of one bin be comparable, and is that this doc's?  |
| Is a `{k}` map subscript worth emitting before one is confirmed in game?     |
| Should an edit be offerable as a patch record once `ltk_meta` can write one? |
| Does a child lane's emitter take edits in its parent's tab, or only its own? |

### Answered

| Question                                                                    | Answer                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Does a search inside one open bin belong here, or in the project bar?       | The project bar, as its `@` scope. "Why one control" is the bar's rule, and a bin tab with a box of its own is a second control   |
| Does a class view get to hide the properties it handles, or only reorder?   | Neither. A layout places every field, and what it does not name falls into Other. Properties is the same rows as a tree. ADR-0030 |
| Is eight open documents the right bound, or should it follow the tab strip? | Thirty-two, above the tabs a user keeps open. A call on an evicted document reopens it. ADR-0026                                  |
