# Bin editor

## Changes

| Date       | Change                                              |
| ---------- | --------------------------------------------------- |
| 2026-09-12 | Band a rich value and drop the inspector's tabs     |
| 2026-09-12 | Flag the timeline's playhead and trace the pointer  |
| 2026-09-11 | Draw the random spread as lanes and a density edge  |
| 2026-09-11 | Draw a value's random spread on its graph           |
| 2026-09-11 | Draw a child lane's emitter in the inspector        |
| 2026-09-11 | Add the particle timeline, and redraw the inspector |
| 2026-09-08 | Wrap the emitter cards into the pane                |
| 2026-09-08 | Arrange the shell's panes as a split tree           |
| 2026-09-08 | Size the emitter card and filter the strip by name  |
| 2026-09-08 | Give the curve dock its table and probability tabs  |

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

| Feature               | Status      | Note                                                             |
| --------------------- | ----------- | ---------------------------------------------------------------- |
| VS Code handoff       | Available   | Opens the file as ritobin text in VS Code. `BinPreview.tsx`      |
| Object list           | Available   | The objects of one file, collapsed, with their classes           |
| Property rows         | Available   | Every leaf kind, drawn read-only                                 |
| Container rows        | Available   | The eight complex kinds, expandable                              |
| Hash names            | Available   | The four mimir bin tables, through `bin_tables()`                |
| Property paths        | Available   | The game's path syntax, as the address and as Copy path          |
| Open at object        | Available   | A `$` hit opens the declaring file scrolled to its object        |
| Type tags             | Available   | Every row's kind after its name, in ritobin's words              |
| Class cards           | Available   | A class or a field on hover, from the meta schema                |
| Object tab            | Available   | One declaration as a document. ADR-0028                          |
| Object links          | Available   | A chip that opens the object tab, resolved through the index     |
| Hash links            | Available   | A `hash` the index declares, opening the same way                |
| WAD chunk links       | Available   | A chip that opens the chunk in a preview tab                     |
| Texture swatch        | Available   | A `file` link to a texture, at row height and on a hover card    |
| Find all references   | In progress | The objects of a class from the index. The walk for the rest     |
| String links          | Available   | A string naming a chunk or an object, as the chip its kind draws |
| Value rows            | Available   | Every family's constant, and a mark where a curve carries more   |
| Class views           | Available   | A complete layout beside Properties, keyed on class. ADR-0030    |
| Curve panel           | In progress | The dock, the graph and its channels. The tabs next. ADR-0032    |
| Particle system shell | Available   | Panes under a crumb, arranged by the reader. ADR-0031, ADR-0034  |
| Particle timeline     | Available   | Lanes under one playhead, on checkpoints. ADR-0037               |
| Pane maximize         | Available   | A tab fills its split tree, and Esc restores it                  |
| Inspector rows        | Available   | Every group, named values, units, a curve per animated row       |
| Inspector bands       | Planned     | A rich value on its own band, the roll rail, and no group tabs   |
| In-document search    | Planned     | The bar's `@` scope over the open rows                           |
| Leaf editing          | Proposed    | The primitive widgets, and the patch that carries an edit        |
| Container editing     | Proposed    | Add, remove, reorder, and a `Map` key                            |
| Autosave              | Proposed    | The strings editor's debounce and save state                     |
| Undo                  | Proposed    | An inverse-patch stack per document                              |
| Schema-aware editing  | Proposed    | The meta dump, for a field's declared type and its subclasses    |
| Copy into a layer     | Proposed    | The route from a read-only game chunk to an editable copy        |
| Ritobin text view     | Proposed    | A read-only text pane, once `ltk_ritobin` publishes              |
| Patch bin records     | Planned     | `BinOverride` reads them. Drawn by nothing, so read-only         |
| Patch authoring       | Proposed    | An edit written as a patch record rather than a rewrite          |

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
- Authoring a patch record. It is named in the feature status, and it follows a viewer that
  draws one
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

Two guards sit behind that. The store is bounded to eight documents and evicts the least
recently used, and eviction refuses to drop a document with unsaved edits. A frontend that
crashes therefore costs the memory of eight trees and no more, and a bug in the close path
costs nothing a user can see.

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
rest: a number and a string sit in their fields and a bool in its checkbox from the first read,
so nothing on the row moves when editing lands. A field draws its border at rest rather than
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

| Shows        | From                                                     |
| ------------ | -------------------------------------------------------- |
| Objects      | The object count                                         |
| Version      | `Bin::version`, and `PTCH` where `is_override` is set    |
| Dependencies | The count, expanding to the list                         |
| Save state   | The strings editor's `SaveStatus`, on an editable source |

A `PTCH` bin patches objects rather than declaring them, and the header says so, because the
same block drawn under different semantics is the kind of thing a user has to be told once.
On a narrow tab the row keeps the object count, the dependencies and the fact that the file is a
patch, and drops the version and the patch tallies.
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

Copy value takes the value as the row draws it: a string, a number, a `flag` as `true` or `false`,
a colour as `#RRGGBBAA`, a vector or a matrix as its components joined by a comma, and a link as
its path or its name. A container, a map, a struct and an optional read as no single string, so
they carry no Copy value. Copy value hash is the hash behind such a link, whether or not a table
names it.

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
│ ◈ Resources · Aatrox.wad/…/skin0.bin  SkinCharacterDataProperties  17  Show in file  1 other │
│ ├ skinClassification            u32          1                                               │
│ ├ championSkinName              string       "Justicar Aatrox"                               │
│ ├ ▸ skinMeshProperties          embed        SkinMeshDataProperties                          │
│ └ ▸ armorMaterial               list[embed]  8 items                                         │
```

The facts sit at the trailing edge of the tab row, the [document chrome](PROJECT_EDITOR.md#document-chrome)
rule of one row per leaf.

| Fact               | Reads                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Class              | The class the declaration carries, as a [card](#the-class-card)        |
| Show in file       | Opens the declaring file's tab, scrolled to the object                 |
| Other declarations | A popover from the index, one row per file, each opening its own tab   |
| Mode               | The layout or Properties, where the class has a [layout](#class-views) |
| Kebab              | The object's and the class's actions, per `DS-GLYPH-ROLE`              |

With the index absent, the other declarations draw a dim "Build the object index" affordance.
Where no other file declares the object, they draw nothing.

The row carries no property count. The tree under it is the count, one row per property, and a
tally of what is already on screen is a fact the reader reads twice.

**A narrow toolbar drops what a reader reaches another way.** The class, the mode and the kebab
stay at every width. The other declarations go first, because the index is a question rather than
an answer. Show in file folds into the kebab, where the object's other actions already are. What a toolbar never does is
wrap or scroll, because a second row costs the tree a row of content at the width that has the
least of it, and a control that has scrolled out of a row is a control nobody finds.

The kebab is where the header's actions live, because a header is the one place a name sits with
no row under it to right-click. It carries Find all references, Copy class name and Copy class
hash for the class, and Copy path and Copy hash for the object.
Its click builds the index.

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

| The string                                       | Resolves through                       | Draws                              |
| ------------------------------------------------ | -------------------------------------- | ---------------------------------- |
| `ASSETS/` or `DATA/`, any case, and an extension | The WAD path resolver, the layer first | The chip and swatch a `file` draws |
| Any, hashed as an object path                    | The index, in the row group's check    | The chip an `ObjectLink` draws     |

A string that answers on both sides takes the chunk. So an emitter's `texture`, a skin's
`simpleSkin` and `skeleton`, a clip's `mAnimationFilePath` and a system's `particlePath` are
chips in every bin, in the tree and in every layout.

A path is resolved and drawn lowercased, which is the one spelling the resolver, the layer's
copy and the preview all answer under, and an author's own capitals are not it. The hash is
the game's FNV-1a over the lowercased string, which the class views reuse. A string joins the
hashes and the paths its row group already sends, so neither shape costs a call of its own.

### A project names its own chunks

The shared tables are a crawl of the retail game, so a path a mod author invents is in none of
them. A project's own content names those, and a bin opened out of a layer reads both: every
file of every layer at its path inside its archive, and every table the project's manifest
declares. The project answers first, and only a hash it does not name reaches the shared tables.

The scan runs once with the parse and is held with the open document, so a file added while a
document is open is named the next time it opens.

### A chunk nothing holds

A `file` whose path resolved and whose chunk neither a layer nor the install holds draws that
path with a warning mark. The path is what the file asks for, and the mark is that nothing
answers it. A hash no table names keeps its hex and no mark, because an unnamed chunk says
nothing about whether it is there.

A layer's copy is found at the file's path inside its archive, which is the layer entry's own
path without its leading archive directory. The document's own layer answers first.

A miss never builds the object index. A `link` a reader clicks says they want the target, and
a string that happens to hash to nothing says nothing at all, so an absent index leaves every
string as text rather than as a page of chips that would each warm it.

Copy value hash on a resolved string offers the object hash the string was resolved under. A
string that resolved as a chunk carries none, because the hash a chunk answers to is the
resolver's over the path rather than a value the row holds.

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

| Shows      | From                                                       |
| ---------- | ---------------------------------------------------------- |
| Name, hash | The tables, and the hex where no table names it            |
| Declares   | How many objects of the install declare it, from the index |
| Patch      | The patch the schema answered at, or that it has no line   |
| Meta wiki  | A link to the class's page, where its fields are written   |

The class name's actions are on [the row menu](#the-row-menu) where a row carries it, and on the
object tab's kebab where no row does.

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

| Shows      | From                                                                 |
| ---------- | -------------------------------------------------------------------- |
| Name, hash | The tables, and the hex where no table names it                      |
| Declared   | The schema's kind for the field at this build                        |
| Revisions  | The field's kinds across builds, as the schema's revisions hold them |

Copy name and Copy field hash are on [the row menu](#the-row-menu).

The kind shown on the row stays the file's kind, per [The property row](#the-property-row).

### Find all references

For a top-level class the index answers at once. Every declaration carrying the class hash is a
row, grouped by file. An embedded class and an object's incoming links are answers of the walk,
which the References document describes. Find references sits on every menu an object has, on the
menu of a row whose value carries a class, and on the object tab's kebab.

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
| StaticMaterialDef . 9 properties   [ Material | Properties ]   Show in file   [:] |
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

### A layout is complete

A layout places every depth-zero field of the object in a section. A field with a purpose-built
widget takes it, and every other field takes the cell its row would draw. A field the layout
does not name falls into a last section, Other, drawn by the tree rooted at those fields and
expandable as in Properties. So a field the game adds in a patch is on screen the day the schema
changes, and a layout is a placement rather than a whitelist.

A section whose list is empty keeps its header and draws a muted None under it, so a reader
tells an empty list from a field the class lacks, and every object of one class has one section
order. Sections collapse, and open by default.

A section the tree draws opens the fields the layout named for it, and a reader sees one level
of each without a click. Other opens none of its own, as in Properties. A tree section scrolls at
twelve rows, so no one section owns the page.

### The registry

A layout is data, keyed on the class hash, with each subclass listed by hand because the schema
carries no inheritance. It names its fields by name, and a frontend FNV-1a turns each into the
row's hash at module load, checked by a test over known pairs.

A section names one widget or none. `rows` is the elements of the containers the section placed,
each as the row [the tree](#the-blocks) draws, which is what a list takes. `override-rows` is the
same over a list one level down, which is how the skin reaches the mesh's material overrides.
`icons`, `mesh` and `effect-table` are the skin's own, and `emitters` the particle system's, each
reading the fields of one class. `fields` draws the sub-fields a section names under the row it
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
no keyboard model of its own until editing gives it one, and its read-only fields take no focus,
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
same, and a path neither side holds draws as text. The skin's icons and mesh textures draw as
tiles, because the textures are what those sections are opened for.

A widget of named cells draws the fields it names and no others, which is what the icons, the
mesh and the VFX join do. Everything else a class carries is reachable through the rows and
through Properties.

### The layouts

| Class                                               | Sections                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `StaticMaterialDef`                                 | Identity, Samplers, Params and Switches as rows, Macros and Techniques as nested trees, Other |
| `SkinCharacterDataProperties`, and its TFT subclass | Identity, Icons, Mesh, Material overrides, Animation, VFX, Audio, Other, beside a preview     |
| `VfxSystemDefinitionData`                           | Identity, Emitters as a strip of cards or as a table, Audio, Other                            |
| `AnimationGraphData`                                | Clips as a table, Masks, Tracks, Sync groups, Other                                           |

The material, the skin and the particle system are the registered layouts, with the value rows
beside them. The animation graph table follows.

A layout draws no Used by. Reverse references are the walk's, and Find all references on the
kebab is the affordance until it ships.

The skin's preview draws the skin on its skeleton, posed by a clip of its animation graph and
wearing its idle effects, per ADR-0035. An effect that draws the character draws over the skin,
and a child set naming bones spawns on the joints it names. The transport under it plays, pauses and scrubs the clip,
sets its speed and names it: an idle clip first, and the bind pose where the graph holds none. A
graph the skin's own file does not declare is read out of the files it links, which is where the
engine finds it. The camera frames the character when it lands, and again on Frame the character.

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
hold. Which fields each holds is a table written by hand, so a field the schema adds falls to
Other and is on screen the day it appears rather than landing in a group by accident. Birth is
the value a particle starts with and every other group is what it does over its life, which is
the line that puts `birthScale0` under Birth and `scale0` under Scale.

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

The skin declares a shell too, per ADR-0036, of two panes: the preview, first and the wider, and
the inspector holding every section. The posed character is what a reader of a skin is looking
at, and a square beside the mesh fields made it the smallest thing on screen. Each shell's
arrangement is its own, so arranging the skin's panes leaves the particle system's where they
were.

```
+----------------------------------------------------------------------------------+
| VfxSystemDefinitionData  Ahri_Base_Q_mis > Orb [0]   [System|Properties] [Panes] |
+------------------------------------------------------+---------------------------+
| PREVIEW  [Ground][Midlane][Gizmo][Stats][Cam v][Fit] | INSPECTOR                 |
|                                            [Burst v] | [Emission][Birth][Scale]  |
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

**One row holds the object tab's header and the crumb.** The class, the crumb, the mode control,
Show in file and Panes share it, and the preview takes the height of the row it saves.

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
a narrow window or with both sidebars open. The stack keeps the preview above the sections, the
skin's character and the particle system's run alike, and a particle system's preview carries the
mini transport there.

The strip and the lanes mark the squares' colours, and the inspector marks the rows it draws. No
other value family is marked. An emitter carries far more of them than any surface draws at once.

### How the panes are arranged

The picture above is where the panes start, not where they stay. A pane is a tab of the same split
tree the project editor runs its document panels on, per ADR-0034, so the gestures are the ones a
reader already knows from the tabs: drag a pane's tab onto another panel's edge to split it, onto
the panel itself to share that panel's strip, and drag a seam to resize.

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

### The timeline

The timeline is the particle shell's fifth pane, per ADR-0037. It reads the run the shell holds
above the panes, and it draws one lane per emitter under one playhead.

```
TIMELINE  [Filter  ]  < > >  0.42 / 1.60 s  [--|--] 1x [Loop]  Chance [==|--] 0.55

                             0     .25   .5    .75   1.0   1.25
                             |-----|-----[=====]-----|-----|
  [#] Orb         [0] (o) S  [#####]~~~~////              312
  [/] Sparkles    [1] (o) S     [##]~~~~~~////             48
  [@] Smoke       [2] (-) S  [############################>  844
v [*] Burst       [3] (o) S        [###]~~~               120
    |-- Spark     [0] (o) S          [#]~~  [#]~~  [#]~~   36
  [ ] Glow SIMPLE [0] (o) S     [#]~~                      12

[###] emitting   ~~~ particle life   //// linger   [===] loop range   > endless
```

**The transport row.** Step back, play and step forward, the playhead over the run's span as
`0.42 / 1.60 s`, the speed, the loop switch, the Histogram switch and the chance pin of
[the random spread](#the-random-spread). The speed is a slider with
detents at 0.05, 0.1,
0.25, 0.5, 1, 1.5 and 2. The name filter at the row's left narrows the lanes, as the strip's filter
narrows the cards. The seed and the rig are the viewport's, per [the viewer](#the-viewer).

**A lane is an emitter.** Its head carries its eye, a 20 px square of what the emitter draws, its
name, its index in its own list, a SIMPLE tag for the second list, the struck eye of a `disabled`
emitter, and the solo toggle. The square is the card's square at lane height.

**The head fits the longest name.** Its width is what the system's longest name and index read in,
capped at a third of the pane. Past the cap a name is cut in its middle, because a system's
emitters share a prefix and differ at the end.

**A lane's bar is the emitter's timing.** A solid bar spans the emission window, from
`timeBeforeFirstEmission` to the end of `lifetime`. An emitter with no `lifetime` runs to the edge
under an arrow. A faded tail runs past the bar to the peak of `particleLifetime`, and a hatched
tail runs on to the end of the linger. The live count stands at the lane's right edge, under a
`live` caption on the ruler's row. With the Histogram switch on, a histogram over the bar draws
the emitter's live particles per step, filled in as the run plays. The switch is off by default,
and the bar's own timing reads clear.

**Lanes run in draw order**: the ground layer first, then `pass`, the blend mode's rank,
`miscRenderFlags` and the index, which is `compareDrawOrder`. A child system's emitters nest under
the emitter whose particles carry them, collapsed, with their bars at the times this run spawned
them.

**A click does the one thing its target names.** The name selects the emitter, and the crumb, the
inspector and the Emitters pane follow. The ruler and a lane's track seek. A child lane selects its
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

**The ruler zooms and loops.** The timeline opens fitted to the run's span. Ctrl and the wheel zoom
about the pointer, Shift and the wheel pan, and a double click on the ruler refits. A drag along
the ruler sets an in and an out, and the run loops between them. A drag on an edge of the band
moves that edge, and a drag on the band moves the whole range. A double click inside the band,
or its x, clears it. A run with no range loops as its rig says.
**The playhead is a flag.** Its chip on the ruler reads the time, and its line runs down every
lane with a faint glow, so it reads over the bars and the histogram. A drag on the chip scrubs,
which gives the ruler a scrub handle while a drag on the open ruler sets a loop. A dashed line
follows the pointer through the ruler and the lanes, its own chip reading the time a press would
seek to, so no track needs a crosshair cursor.

**The ruler says where the run ends.** Everything past the run's span is shaded on the ruler and
under every lane. Minor ticks cut each labelled step, a second into quarters and a fraction of one
into fifths, and the last label carries the unit. Resting the pointer on a bar lists its times:
when it emits, how long its particles live on, and where its linger ends.

**A scrub moves the run live.** The run keeps a checkpoint every quarter second of simulated time
within a budget of bytes, and a seek replays from the nearest one, per decision 2.46. A drag moves the run with the pointer,
a step back costs one frame, and a loop's wrap costs no replay from zero.

**The keys** act anywhere in the shell outside an editable field.

| Key                     | Does                              |
| ----------------------- | --------------------------------- |
| Space                   | Play or pause                     |
| Left, Right             | One frame back or forward, 1/60 s |
| Shift+Left, Shift+Right | 0.1 s back or forward             |
| Home                    | Restart                           |
| F                       | Fit the camera                    |
| S, M                    | Solo or mute the selected emitter |
| `[`, `]`                | The next speed detent down or up  |
| Esc                     | Restore a maximized pane          |

**The preview carries a mini transport while no timeline shows**: play, a scrub, the time and the
chance pin, with the timeline closed or the preview maximized. A stack holds no timeline pane. Its preview carries
the mini transport, and its Emitters section keeps the strip.

### The viewer

The preview pane draws the run on the particle renderer of `docs/plans/vfx-particle-renderer.md`.
Its controls sit at its top right: the Show menu, the wireframe menu, the camera menu, Fit and the
rig.

**The Show menu** ticks Ground, Midlane, Gizmo and Stats, and stays open while they are set. Its
trigger counts the ones on. Midlane draws on the ground alone, so it is off while Ground is.

**The wireframe menu** draws the run shaded, as its triangle edges alone, or as its edges over the
shading. The edges are the particles' own geometry in one flat accent, drawn after every emitter,
and a distorting emitter's edges draw with the rest. Over the shading the edges are part
transparent, and the particle reads through them. A character's attached mesh stays shaded.

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

**The orbit.** The left button orbits, the right pans, the middle and the wheel dolly toward the
pointer. A flat preset's wheel zooms in place of the dolly.

**The axis gizmo** sits in the pane's top left corner and turns with the camera: the corner of a
cube, three arms on the viewport's own axes with a lettered head each, and a square face between
every two. An arm, its head and the face across it wear that axis's channel colour. A head or a
face stands the camera on its axis, picking Side, Top or Front. Picked again while the camera
already stands there, it turns the camera to the axis's other end, on Orbit.

**The rig pill** names its preset beside an icon of the motion. Its popover holds the motion, the
loop, the stop, and the seed with its reroll.

**The gizmo** draws the selected emitter's origin, its offset and its spawn shape as a wireframe.
**Stats** draws the live particles, the live child systems and the frame's milliseconds in the
bottom right corner, on a plate that reads over any ground. The count is of simulated particles,
a muted emitter's included.

**What persists.** Ground, Midlane, Gizmo, Stats, the wireframe mode, the camera preset, the
timeline's Histogram switch and the inspector's Defaults switch are display preferences, app-wide
and persisted. The rig, the seed, the speed, mute and
solo, the loop range and the playhead belong to the run, kept per system for the session, per
ADR-0037.

**The skin's preview** takes the keys, the camera menu with Fit, the axis gizmo and the speed detents. Its clip
plays on its own clock under its own transport, and it has no timeline.

### The inspector

The inspector draws the target the crumb names. For an emitter it draws every group the emitter
sets, each a section that folds under a header that sticks to the pane's top while its rows scroll.
A child lane's emitter draws the same, under the banner of [the timeline](#the-timeline). The
emitter's crumb segment and a card's name open the emitter, and a card's chip and the crumb's group
menu scroll to a group and leave the rest drawn, so a reader holding Birth against Scale keeps
both. A section reads its curves as it scrolls into view, and a folded section reads none. The read
is bounded by what is on screen, per [what a layout reads](#what-a-layout-reads).

```
INSPECTOR  Orb [0] / Birth v          Chance 0.55   Defaults ( )
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
   > SpawnShape            VfxShapeLegacy
   | EmitterPosition       [x 0 ][y 0..20][z 0 ]          Y uniform
     isGroundLayer         [x]
 v SCALE
     scale0                [~~~~~ curve ~~~~~]             animated

|  a field the birth roll reaches   !  a field that rerolls every frame
```

**The crumb holds still and the header moves.** The crumb's group segment names the group last
picked, so the menu's own trigger never changes label under the pointer, and the sticky header
names the group on screen.

**A field keeps its own name.** A row reads `particleLifetime`, the name ritobin, the tree and the
meta wiki use. The name's hover card carries the declared type, the default and the wiki's written
doc for the field. The name column fits the longest name the inspector draws, capped at 40% of the
pane, and past the cap a name is cut in its middle, as a lane's is.

**A value reads as what it means.** An enum reads its name, and a flags field reads its named bits,
off the tables `model.ts` holds. A number carries its unit - `s`, `deg`, `units`, `/s` - and a
random range reads `min .. max`. Which unit a field carries is a table written by hand, as the
groups are. A vector's axes are tinted x, y and z, in columns of one width down the pane. A path
reads its file name whole and its folder dimmed, cut from its start where the column runs out.

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
and the property path in the tree. The path is what a bug report needs. One toolbar row under it
carries every control: the channel chips, the `probabilityTables` chip, the chance slider and the
tabs.

A mark and a sparkline both aim the dock, and so does Show curve on the row menu of a value that
has dynamics. A value without one is offered neither.

### The row's two triggers

A value-family row in a layout draws its constant inline and then two triggers, the shape both of
Riot's editors use: the constant is what a modder is tuning, and the rest of the value is one
target away on the same line rather than behind a mode.

```
birthScale0     [X 10 .. 20] [Y 10 .. 20] [Z 10 .. 20]   [~] [dice linked]
birthRotation0  [X 0 .. 360] [Y 0] [Z 0]                 [~] [dice uniform]
```

**Riot's triggers add data and ours open a reading**, because nothing in the editor writes a bin
yet. The first aims the dock's Graph and carries the sparkline where the read answered the keys.
The second is the random chip, which aims the same Graph, where
[the random spread](#the-random-spread) draws. An aim naming a reading switches the dock to it, so
a trigger lands on what it names rather than on whichever tab the dock was left on.

The chip says what is random in the fewest words the row leaves it. Where the value column already
draws the range, as the inspector's does, the chip names the shape: `uniform`, `split`, `custom`,
`linked` for channels drawing one table over one base, and a count of channels that differ.
Anywhere else it carries the range itself, `XYZ 10 .. 20`. A table on a per-frame field reads
`random every frame` in the warning tone, which the inspector leaves to its roll rail, and a set
the game cannot read reads `broken` in the danger tone.

Both are drawn only where the row has dynamics, which is one condition rather than two: the
probability tables are a field inside the dynamics, so a value with no curve has no tables either.
A row with no dynamics draws neither, per [what has no curve](#what-has-no-curve). The chip is a
bare die until the tables are read, and is gone once they read as filler, because a set of tables
that each multiply by 1 draws nothing a reader needs to open.

### The tabs

**Graph** plots the keys over [the window](#the-window-a-curve-is-drawn-over). A vector draws a
line per channel, X red, Y green and Z blue as Riot draws them, with chips that mute one. The
value axis takes three to five round ticks over faint grid lines, a stronger line at 0 and the
unit by the top tick. The time axis ticks at quarters.

A colour draws as a gradient editor instead: a bar of the stops, a marker per stop hanging off it
at the stop's own time, and the keys themselves under them.

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

### The random spread

`probabilityTables` is one nullable slot per channel, and a table is the chance against a factor:
a particle's birth rolls one chance, reads every channel's table at it, and multiplies the sampled
value by what it reads. One roll serves every channel and every birth value of the particle, so X
and Y of one particle move together.

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
- a label column on the left, as wide as the widest label: channel, result range with unit, shape
- density as a filled step area in the channel's hue, a split's gap hatched
- a fixed or filler channel as a thin dim lane with one tick at its value
- after the lane, the value at the pin and a keys button
- lanes scroll when the dock is short, and a muted chip hides its lane

Under [where editing is allowed](#where-editing-is-allowed), a block end drags min or max and a
fixed channel's tick drags open into a range.

**A value that animates keeps its time plot, with a density edge.** A random channel carries a band
from the curve at its least factor to the curve at its most, and a split carries two. A column on
the plot's right edge shares the value axis and draws the density at one time: the cursor's, else
the playhead's, drawn as a vertical line. A birth value samples at the emitter's life ratio, so
its playhead is known. A per-particle curve has none and rests at 0. A readout row per channel
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
outside 0 to 1 draws dim as `never rolled`.

**A colour with no keys draws one bar from chance 0 to 1,** every colour the roll gives, with the
pin marked on it. A colour that animates draws its ramp at chance 0, at 1, and at the pin.

**The chance can be pinned.** The toolbar's slider sets it, and so does a click or drag on any
lane, which moves every lane's marker together, because one roll serves every channel. It pins
every birth of the whole run, children included, and the viewport says so in its corner with a
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

**`ltk_meta` reads them, since the rev the workspace pins.** `BinOverride` holds the three
things a patch does, `deleted`, `objects` and `patches`, reads them with
`BinOverride::from_reader` and writes them with `BinOverride::to_writer`. A record's path is the
crate's own `PropertyPath`, the syntax [Addressing a node](#addressing-a-node) adopts. What is
still upstream is the streaming form of the read, league-toolkit issue **#210**, and the delta
write-back, **#211**.

So a `PTCH` still opens read-only whatever its source, and the reason is now this editor's
rather than the crate's. Nothing here draws a patch record, and a save that rewrites records a
viewer never showed is the silent loss [Rust owns the tree](#rust-owns-the-tree) exists to
prevent. The header says both that the file is a patch layer and that its records are not
drawn, and drawing them is what opens the write.

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
| Eight open documents, in memory | 200MB  |

## What has to land first

Nothing hard-blocks the first stage.

| Item              | Where     | Status                                                 |
| ----------------- | --------- | ------------------------------------------------------ |
| `ltk_meta` 0.8.1  | Workspace | Compiled, pinned to the rev that carries the walk      |
| `bin_tables()`    | This repo | Landed 2026-08-23, as `BinHashTables`                  |
| `BinStream`       | Upstream  | Landed in 0.8.1. The object index's, optional here     |
| The write version | Upstream  | Read [The version-3 write](#the-version-3-write)       |
| Patch records     | Upstream  | `BinOverride` reads and writes one. Nothing draws them |
| The meta dump     | Upstream  | Stage four only, for schema-aware editing              |
| `ltk_ritobin`     | Upstream  | Git only. Publish before the text view                 |

`ltk_meta` is a dependency of the workspace already, through the problems pass.

## The backend

`core/src/bin_document.rs` holds the parsed tree, the patch application, and the row
projection. It knows about `ltk_meta`, `AssetRef` and the hashtable cache, and it knows
nothing about Tauri.

`src-tauri/src/commands/bin.rs` is the seam, and `BinDocuments` is a third managed state
beside `SettingsState` and `PatcherState`.

| Command             | Answers                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `bin_open`          | A handle, the header facts, and the root rows                       |
| `bin_children`      | The rows under one address                                          |
| `bin_read`          | The rows under each of several addresses, in one call               |
| `bin_patch`         | The rows that changed, or a rejection                               |
| `bin_undo`          | The same                                                            |
| `bin_close`         | Nothing                                                             |
| `class_schema`      | One class's fields and their declared kinds, at the install's build |
| `declared_objects`  | What declares each of a page's link and hash targets, in link order |
| `locate_game_files` | The install's copy of each of a page's `file` targets               |

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
   resolution order, and the other declarations in the header
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
6. **The animation graph table**

**The editing track.**

1. **Leaf editing.** The primitive widgets, `bin_patch`, validation, autosave, undo. Layer
   sources only
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
| Is eight open documents the right bound, or should it follow the tab strip?  |
| Is a `{k}` map subscript worth emitting before one is confirmed in game?     |
| Should an edit be offerable as a patch record once `ltk_meta` can write one? |
| Does a child lane's emitter take edits in its parent's tab, or only its own? |

### Answered

| Question                                                                  | Answer                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Does a search inside one open bin belong here, or in the project bar?     | The project bar, as its `@` scope. "Why one control" is the bar's rule, and a bin tab with a box of its own is a second control   |
| Does a class view get to hide the properties it handles, or only reorder? | Neither. A layout places every field, and what it does not name falls into Other. Properties is the same rows as a tree. ADR-0030 |
