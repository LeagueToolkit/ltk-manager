# A class view is a projection over the rows, and the tree stays underneath

Research note, and the record of what it proposes. Sections 1 to 5 are evidence gathered on
2026-09-07 against this repository at `91bc02a` (`main`), the LTK Meta Wiki as it served that
day, Riot's Game Data Server article, ritobin-lsp issue 55, and eight frames of the animation
graph editor recording. Section 6 is the proposals and section 7 what only the maintainer can
answer.

The question was how the bin editor grows a purpose-built view for a material, a skin and a
particle system on top of the generic property tree, and what each view needs from the backend
that is not there.

Four findings decide the rest:

- **Riot's own editor sits on a path-addressed get and set over a generic data server, and the
  domain tools are clients of it.** The article's one design statement about the editor is that
  GDS "abstracts away all of the file and data management for other tools, so those tools can
  focus on delivering the desired viewing and editing experience". ADR-0026 and ADR-0027 put this
  repository in the same shape already. A class view is another client of the rows.
- **The animation editor in the frames is a table and a set of tabs over one object, with the
  generic tree as a sibling tab and the 3D preview in another panel.** No node graph is on
  screen in any frame. A map of structs becomes a table with a column per chosen field, a hash
  key into a sibling map becomes a dropdown, and the other maps become tabs.
- **Everything at depth zero of an object is already on the frontend when the object tab opens,
  and the material and skin views need nothing else from the backend.** `bin_open` with an entry
  answers every property of the object in one call, and the nested rows a material or a skin view
  reads are a handful of `bin_children` calls. A VFX view over thirty emitters is the case that
  needs a projected read, because it wants ten fields of each of thirty structs of 139 fields.
- **In the bin format only `link`, `file`, and a path held as a `string` or a `hash` cross out of
  an object.** The wiki writes `List<VfxEmitterDefinitionData>` and a reader takes it for a link.
  The schema snapshot's own tuple says `['List', '0x0', 'Pointer', '0x9cde442']`: the emitters are
  embedded, nullable structs inside the system. The views below mark every field by what it
  crosses, and the wiki's wrapper is not what decides it.

## Sources

Primary, in order of weight:

- [Content Efficiency: Game Data Server](https://www.riotgames.com/en/news/content-efficiency-game-data-server),
  Bill "LtRandolph" Clark, Riot Games. The page carries no date. It names "the shiny new patch
  6.3" as the live patch and Jhin as the newest champion, which places it in early 2016.
  Fetched with WebFetch and again with `curl` for the image alt text
  and captions. The screenshots themselves are not readable through either, so what the note
  says of them is their captions and alt text alone
- [ritobin-lsp issue 55, Color swatches and picker for color values](https://github.com/alanpq/ritobin-lsp/issues/55),
  Crauzer, opened 2026-08-16, open, no labels, no comments. Read with
  `gh issue view 55 --repo alanpq/ritobin-lsp --json ...`
- Eight frames, one per second, of the Character Animation Graph Editor recording, read from
  the session scratchpad as `ggmf/frame-001.png` to `frame-008.png`
- The LTK Meta Wiki, `https://meta-wiki.leaguetoolkit.dev/classes/<name>/`, for
  `staticmaterialdef`, `staticmaterialshadersamplerdef`, `staticmaterialshaderparamdef`,
  `staticmaterialswitchdef`, `staticmaterialtechniquedef`, `staticmaterialpassdef`,
  `skincharacterdataproperties`, `skinmeshdataproperties`,
  `skinmeshdataproperties_materialoverride`, `skincharacterdataproperties_characteridleeffect`,
  `skinanimationproperties`, `resourceresolver`, `vfxsystemdefinitiondata`,
  `vfxemitterdefinitiondata`, `vfxmaterialdefinitiondata`, `valuecolor`, `valuefloat`,
  `vfxanimatedcolorvariabledata`, `vfxprobabilitytabledata`, `animationgraphdata`,
  `atomicclipdata`, `maskdata`, `trackdata`. Fetched with `curl` and read from the HTML, because
  the WebFetch summaries wrote `Link` for every pointer
- `crates/ltk-manager-core/src/meta_schema/schema-snapshot.json.gz`, format version 1, latest
  build 8104348, 5,458 classes. The `[kind, key, value, class]` tuple of every field cited below
  was read out of it, and it is what settles pointer against embed where the wiki drops the
  wrapper
- `docs/ux/BIN_EDITOR.md`, and [ADR-0026](../adr/0026-a-saved-bin-is-written-from-the-tree-the-backend-holds.md),
  [ADR-0027](../adr/0027-a-node-is-addressed-by-the-games-property-path.md),
  [ADR-0028](../adr/0028-an-object-is-a-document-of-its-own.md),
  [ADR-0017](../adr/0017-the-frontend-owns-every-user-facing-string.md),
  [ADR-0029](../adr/0029-the-generated-bindings-describe-the-wire-format-they-do-not-change-it.md)
- `docs/research/bin-object-index.md` and `docs/research/game-db-as-precomputed-index.md`, for
  the index the links resolve through and the shape this note follows
- `crates/ltk-manager-core/src/bin_document.rs`, `meta_schema.rs`, `object_index.rs`,
  `object_index/references.rs`, `object_index/wire.rs`, `preview/mod.rs`
- `src-tauri/src/commands/bin.rs` and `src-tauri/src/commands/object_index.rs`
- `src/modules/workshop/bin/`, every file, `src/modules/workshop/documents/contentDocument.ts`
  and `registry.tsx`, `src/modules/workshop/references/useFindReferences.ts`,
  `src/modules/workshop/components/ObjectGlyph.tsx`, `src/modules/editor/types.ts` and
  `components/SidePanel.tsx`, `src/lib/tauri.ts`, `src/lib/bindings/ReferenceQuery.ts`
- The `ltk_meta` checkout the workspace pins, league-toolkit `0bc9d0e`, at
  `~/.cargo/git/checkouts/league-toolkit-*/0bc9d0e/crates/ltk_meta/src/`, for what a typed read
  of a class would stand on

## 1. What GDS's editor does that ours does not

The article describes the server and the data model in words and the editor only as a
screenshot. Everything below the first table is what the text says. The screenshot captioned
"Now we're getting somewhere" with alt text "riot editor" is the one image of RiotEditor, and
nothing in the text describes its layout.

### 1.1 The data model

| GDS                                                                                                                                                                                                                | Here                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Two kinds of game data: "key-value pairs called property data" and "blobs of opaque binary data"                                                                                                                   | A `.bin` is the property data, a WAD chunk the blob                                                                               |
| One JSON file per object at a path, `PROPERTIES/Items/BlackCleaver.json`                                                                                                                                           | One object per path hash, several per file, ADR-0028 opens one as a document                                                      |
| `get?path=Items/BlackCleaver` answers the object                                                                                                                                                                   | `bin_open(asset, entry)` answers the object's rows, `src-tauri/src/commands/bin.rs:31-35`                                         |
| `set&path=PROPERTIES/Items/BlackCleaver.FlatHPMod&value=1000` edits one field by path                                                                                                                              | ADR-0027 adopts the same path language. No set exists yet, "Editing" is Proposed in `docs/ux/BIN_EDITOR.md:739`                   |
| Types are declared once, in engine code, with `PROPERTY_CLASS` and `PROPERTY` macros, and a "definition exporter" writes the JSON definition of "what classes exist, and which of their fields should be editable" | The meta schema snapshot is the community's reconstruction of that definition, `crates/ltk-manager-core/src/meta_schema.rs:27-66` |
| A complex type such as `BoundingVolume` is referenced "provided they have their own sub-properties tagged up"                                                                                                      | An `embed` or a `pointer` row, whose class the schema names                                                                       |
| A field can be skipped from the definition, so the editor never shows it                                                                                                                                           | Every field the file holds has a row, per "A kind with no widget still has a row" in `docs/ux/BIN_EDITOR.md`                      |

### 1.2 The editor, and what sits under it

The article's one statement of the editor's architecture is the finding this note rests on:

> GDS abstracts away all of the file and data management for other tools, so those tools can
> focus on delivering the desired viewing and editing experience. I consider it similar to an
> operating system's abstraction of window creation so a developer can focus on what should
> appear in that window. The tools that talk to GDS include many internally developed tools, as
> well as third party standards like Maya and Photoshop.

So RiotEditor is one client of the server, and Maya and Photoshop are others. A material is
edited where materials are edited and a texture where textures are, and both write the same
property data through the same path-addressed set. That is the relation between a class view
and the generic tree: two clients of one document, not one view replacing another. The property
markup "solves problems #2 and #3: No clear definition of which fields exist, and no type
safety", which is the role the schema plays in the field card today and the role it would play
in deciding what a view may edit.

### 1.3 The workflow it replaced

The old data was "loose files sloshing around in a big bucket of a folder called DATA", stored
"primarily in .ini files". The article's six problems, in its order:

1. "Notepad++ used to edit property data"
2. "No clear definition of which fields exist"
3. "No type safety"
4. "Merge conflict issues when multiple people hit the same file"
5. "Cumbersome concurrent versioning (Live vs. PBE vs. internal)"
6. "Loose links between files; just short name and implied search paths"

The illustrations are two: "977 spells that feature the (certainly ignored) line
'MissileEffect=AnnieBasicAttack_mis.troy'", and "every champion references a delightful field
from very early in LoL's development: 'Death=Cardmaster_Death.wav'". Both are stale references
nobody could see were stale, which is what a reference the editor resolves and marks fixes.

Problem 6 is the one the article leaves open: "the problem's more of a monster than
anticipated". It is also the one this repository meets in every class below. A material's
sampler holds its texture as a `file` since patch 16.17 and as a `string` before it. An emitter
holds its `texture` as a `string` in every build. A skin holds `simpleSkin` and `skeleton` as
strings, and a `particleName` names a system by short name. The object index resolves a `link`
and a `hash` (`docs/ux/BIN_EDITOR.md:608-664`) and nothing resolves a string that is a path.

### 1.4 Layers and versions

A layer is "a feature that can be turned on or off", and "GDS tags any changes made to any file
as part of the APItemRework layer". On disk that is `RabadonsDeathcap.json` beside
`RabadonsDeathcap.APItemRework.json`, where the second "marks the delta of each field that has
been changed. The before and after values are saved to reconcile merge conflicts later". A game
version is "a simple JSON list of layer names", and moving a feature between versions "is a
single drag-and-drop operation in our layer management window".

The repository's layer is a file, not a field delta, and the install's declaration and a layer's
copy sit side by side as two tabs where "the layout is the diff, and the editor draws none"
(ADR-0028). A `PTCH` bin is Riot's shipped form of a field delta, and the editor reads it and
draws none of its records (`docs/ux/BIN_EDITOR.md:759`). A field-level diff between two
declarations of one hash is what the article's layer file holds and what the two tabs leave to
the reader's eye.

### 1.5 What is absent from the article

The text says nothing of validation in the editor, of search, of back-references, of undo, or
of a per-type editor. Nothing in it should be cited for any of those.

## 2. What the animation graph editor shows

All eight frames are the same layout with one popup opening and closing. The recording is
titled as a graph editor, and no graph is on screen in any frame. What is on screen is the
window below, cropped at its right edge so the table's last columns and the last tab are cut.

```
+-- Animation Preview | Animation Object Tree ----+-- Skin5 (Pulsefire Ezreal) ------------------------+
| Front Left Top Flip | Order Chaos | VFX      == | == < >  [Pulsefire Ezreal]  Characters/Ezreal/Animations/Skin5 |
|                                                | Sandbox (featuredmodes) >                            |
|   3D viewport, a champion on a grid            | [Characters/Ezreal/Skins/Skin5 v]   Filter (Ctrl+F)  |
|                                                | Animations | Browsable | Tracks | Masks | Sync Groups | Interruption G... |
|                                                | + x                                                  |
|                                                |    Name                  Track            Mask Framerate  ... |
|                                                | >  Attack1 (Atomic)      [Default     v] [v]  30/30 fps  |
|                                                | >  Buffbone_Additive (Atomic) [Buffbone_Additive v] ...  |
|                                                | >  Crit (Atomic)         [Default     v] [v]  31/30 fps  |
|                                                | >  Idle1 (Atomic)        [Default     v] [v]  30/30 fps  <- selected |
|                                                |    ... Run, Run_FlyV1, Spell1..4, Taunt ...          |
+------------------------------------------------+------------------------------------------------------+
```

What each frame adds:

- **Frame 1.** The layout above. The left panel group has two tabs, "Animation Preview" open
  and "Animation Object Tree" beside it. The viewport carries view buttons, `Front`, `Left`,
  `Top`, `Flip`, `Order`, `Chaos`, `VFX`, and a hamburger. The right panel is one document
  titled `Skin5 (Pulsefire Ezreal)`. Its toolbar carries a hamburger, back and forward arrows,
  a tab reading `Pulsefire Ezreal`, and the path `Characters/Ezreal/Animations/Skin5`. Under it
  a row reads `Sandbox (featuredmodes) >`, then a picker set to
  `Characters/Ezreal/Skins/Skin5` beside a `Filter (Ctrl+F)` box. Six tabs follow,
  `Animations`, `Browsable`, `Tracks`, `Masks`, `Sync Groups`, `Interruption G...`, then add and
  remove buttons, then the table. Every row is an expander caret, a lightning glyph, a name
  with `(Atomic)` after it, a `Track` dropdown, a `Mask` dropdown and a `Framerate` cell. Track
  reads `Default` on every row but `Buffbone_Additive`, whose track is `Buffbone_Additive`.
  Framerate reads `30/30 fps` on every row but `Crit`, which reads `31/30 fps`. `Idle1` is
  selected.
- **Frame 2.** The viewport's hamburger is open. It lists six checkboxes, `Show Mesh` checked,
  `Show Skeleton`, `Show Bone Names`, `Show Selected Bone Axes`, `Show Bounding Box`,
  `Show Enemy Version`, a separator, then `Skin05`, `Form1` checked, `Form2` under the pointer,
  `Form3`.
- **Frame 3.** `Form1` under the pointer and `Form2` checked.
- **Frame 4.** The menu is closed and the mesh's shoulder differs from frame 1.
- **Frame 5.** The menu is open again, `Form3` under the pointer.
- **Frame 6.** `Form2` checked, `Form3` under the pointer, and the mesh carries a pack on its
  back it did not in frame 1.
- **Frames 7 and 8.** The menu is closed and the mesh carries the pack and an antenna.

What the frames say about the editor's relation to the property document:

1. **The document is keyed on an object path.** `Characters/Ezreal/Animations/Skin5` is the
   path an `AnimationGraphData` object carries in a skin's bin, and the picker's
   `Characters/Ezreal/Skins/Skin5` is the `SkinCharacterDataProperties` the preview dresses the
   graph in. That is ADR-0028's key, an object and not a file, with the skin as a second object
   the view reads for its preview (frame 1).
2. **A map of structs is a table.** The `Animations` tab is one row per entry of a map. Section
   4.4 reads `mClipDataMap` as `Map<Hash, Pointer<ClipBaseData>>`, and the row's `(Atomic)` is
   the pointer's class, `AtomicClipData`. The `Framerate` cell reads as `mTickDuration`, which
   `AtomicClipData` holds at `0.0333` for thirty frames a second (frame 1, section 4.4).
3. **A key into a sibling map is a dropdown, and the sibling maps are tabs.** `Track` and `Mask`
   on a clip row are keys into `mTrackDataMap` and `mMaskDataMap`, and the `Tracks` and `Masks`
   tabs are those maps. The dropdown's options are the sibling map's keys (frame 1).
4. **The row expands to the rest of the struct.** Every row carries a caret, and the table shows
   four columns of a class that holds more. What the caret opens is not in any frame.
5. **The generic tree is a sibling tab and not a mode of the table.** `Animation Object Tree`
   sits beside the preview in the left group. It is never opened in the recording, so what it
   draws is not evidence here (frame 1).
6. **The preview is in another panel with its own state.** Mesh, skeleton, bone names, bounding
   box and enemy version are the viewport's toggles, and `Form1` to `Form3` swap what the mesh
   shows, the way a skin's submesh sets do (frames 2 to 8, section 4.2).
7. **A filter box scopes the table.** `Filter (Ctrl+F)` sits beside the picker, over the rows of
   the open tab (frame 1). The bin editor plans the same as the `@` scope,
   `docs/ux/BIN_EDITOR.md:64`.
8. **A context row names a layer.** `Sandbox (featuredmodes)` reads as the article's layer, the
   feature the edit is tagged to (frame 1, section 1.4). Nothing in the frames confirms it.

## 3. What ritobin-lsp issue 55 asks for, and how it maps onto a GUI

The issue is Crauzer's, opened 2026-08-16, open with no labels and no comments. It asks for
colour swatches and a picker over three shapes of value, and lists six pieces of scope.

The values it decorates:

- "`rgba` entries, including inside `list[rgba]` / `map[hash, rgba]`"
- "`ValueColor.constantValue` (`vec4`), matched structurally on class + property hash"
- "every element of `values: list[vec4]` inside a `ValueColor`'s dynamics, so each gradient
  keyframe gets its own swatch and picker"

The scope, in the issue's numbering:

1. An LSP colour provider, "purely additive, no extension changes, no new UI"
2. An inline gradient strip "as an SVG from keyframe values provided by a custom LSP request"
3. A CodeLens, `Edit gradient`, opening a webview for editing the gradient
4. "A proper graph curve editor for each channel's `VfxProbabilityTableData`
   (`keyTimes`/`keyValues`), 4 channels for a color"
5. The same over `ValueFloat`, `ValueVector2` and `ValueVector3`, which "are structurally
   identical"
6. Lints: "`times` and `values` length mismatch", "unsorted `times`, or times outside the
   expected domain"

What it implies for a block editor rather than a language server:

| In the issue                                     | In the bin editor                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| An `rgba` gets a swatch                          | Every `rgba` row draws one already, `src/modules/workshop/bin/BinRow.tsx:387-400`                                                                   |
| A `vec4` is a colour when class and field say so | A value-level rule keyed on `(class hash, field hash)`, not a class view. `ValueColor.constantValue` is `0xb4b427aa` on `0x74f91dd`                 |
| A gradient strip from the dynamics' keyframes    | A summary drawn on the `embed` row for a `ValueColor`, from three nodes under it: `constantValue`, `dynamics.times`, `dynamics.values`. Section 4.3 |
| A curve editor per channel                       | A widget over `keyTimes` and `keyValues` of one `VfxProbabilityTableData`, which is the same shape as editing two lists                             |
| The float and vector families                    | The same rule with `ValueFloat` at `0x4300058`, and its dynamics a `Pointer`                                                                        |
| Length and ordering lints                        | Problems rules, which subscribe to the pass (ADR-0013) and address a node the way a row does (ADR-0027)                                             |

The one thing an LSP gets for free that a GUI has to fetch is the subtree. A colour provider
reads the text around the value. A row that wants to draw a gradient has a `BinValue::Struct`
with a class and a length and no children until asked, per ADR-0026. Section 6.3 is that read.

## 4. The meta classes

What a field crosses, in the words the rest of the note uses:

| Crosses   | Kinds                                                        | Resolved by                                                                                         |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Nothing   | Every leaf, and an `embed` or a `pointer` and what they hold | The row itself. A `pointer` is nullable and polymorphic, in the object                              |
| An object | `link`                                                       | The index, `src/modules/workshop/bin/linkDecision.ts:60-74`                                         |
| A chunk   | `file`                                                       | The WAD resolver and `locateGameFiles`, `linkDecision.ts:93-108`                                    |
| By name   | A `string` holding a path, a `hash` naming a key             | Nothing today. A `hash` the index declares an object under is the one case, `linkDecision.ts:77-85` |

Every type below is the snapshot's tuple at its newest revision, cross-checked against the
wiki page. A wiki page writes `List<Class>` for both a list of embeds and a list of pointers,
and the tuple's third slot is what tells them apart.

### 4.1 `StaticMaterialDef`, `0xff9d3409`

Ten fields. Parents `IResource` and `IMaterialDef`. Referenced by sixteen classes through
seventeen properties, among them `Portrait.PortraitMaterial`, `ItemDataClient.InventoryIconMaterial`,
`MapMaterialSwap.Swaps` as `Map<String, StaticMaterialDef>`, and
`SkinCharacterDataProperties.0xeda7817e`. A skin's mesh names its material as
`Link<IMaterialDef>`, the interface, so the wiki's referrer list for `StaticMaterialDef` omits
the skin mesh that is its main consumer.

| Group      | Field                 | Type                                                             | Crosses   |
| ---------- | --------------------- | ---------------------------------------------------------------- | --------- |
| Identity   | `name`                | `string`                                                         | nothing   |
|            | `type`                | `u32`, default 1                                                 | nothing   |
| Samplers   | `samplerValues`       | `list2[embed StaticMaterialShaderSamplerDef]`                    | nothing   |
|            | `.TextureName`        | `string`                                                         | nothing   |
|            | `.texturePath`        | `file` since 16.17, `string` from 15.3 to 16.16                  | a chunk   |
|            | `.samplerName`        | `string`, removed 16.13                                          | nothing   |
|            | `.addressU/V/W`       | `u32`                                                            | nothing   |
|            | `.filterMag/Min`      | `u32`. `filterMip` removed 14.17                                 | nothing   |
|            | `.uncensoredTextures` | `map[hash, file]`                                                | a chunk   |
| Params     | `paramValues`         | `list2[embed StaticMaterialShaderParamDef]`                      | nothing   |
|            | `.name`, `.value`     | `string`, `vec4`                                                 | nothing   |
| Switches   | `switches`            | `list2[embed StaticMaterialSwitchDef]`                           | nothing   |
|            | `.name`, `.on`        | `string`, `bool`                                                 | nothing   |
| Macros     | `shaderMacros`        | `map[string, string]`                                            | nothing   |
| Techniques | `techniques`          | `list[embed StaticMaterialTechniqueDef]`                         | nothing   |
|            | `.name`               | `string`                                                         | nothing   |
|            | `.passes`             | `list[embed StaticMaterialPassDef]`, 25 fields                   | nothing   |
|            | `.passes[].shader`    | `link IShaderDef`                                                | an object |
|            | `.passes[].*`         | blend, depth, stencil, cull state, `paramValues`, `shaderMacros` | nothing   |
| Rest       | `childTechniques`     | `list[embed StaticMaterialChildTechniqueDef]`                    | nothing   |
|            | `SharedTextureSets`   | `list[embed StaticMaterialSharedTextureDef]`                     | nothing   |
|            | `dynamicMaterial`     | `pointer DynamicMaterialDef`                                     | nothing   |

A material view surfaces the sampler table with its textures drawn, the params as named
vectors, the switches as named checkboxes, and the techniques folded to their pass count and
shader. The only cross-object link in the class is the pass's shader. The texture rows are
`file` values on any bin written at 16.17 or later, and the texture swatch already draws a
`file` (`src/modules/workshop/bin/TextureSwatch.tsx:44`). A layer's bin written before 16.17
holds a `string` there, and the view draws by the row's `kind`, not by the schema.

### 4.2 `SkinCharacterDataProperties`, `0x9b67e9f6`

Sixty-five fields. One descendant, `TftSkinCharacterDataProperties`. Seventeen of the fields
are unnamed hashes on the wiki, among them `0xeda7817e` as `Link<StaticMaterialDef>`.

| Group     | Field                                                                                                | Type                                                                | Crosses   |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| Identity  | `championSkinName`                                                                                   | `string`                                                            | nothing   |
|           | `skinClassification`, `skinParent`                                                                   | `u32`, `i32`                                                        | nothing   |
|           | `metaDataTags`, `attributeFlags`                                                                     | `string`, `u32`                                                     | nothing   |
| Icons     | `iconAvatar`                                                                                         | `file` since 16.17                                                  | a chunk   |
|           | `iconCircle`, `iconSquare`                                                                           | `option[file]` since 16.17                                          | a chunk   |
|           | `alternateIconsCircle/Square`                                                                        | `list[file]`                                                        | a chunk   |
|           | `uncensoredIconCircles/Squares`                                                                      | `map[hash, file]`                                                   | a chunk   |
|           | `loadscreen`, `loadscreenVintage`                                                                    | `embed CensoredImage`, `{ image, UncensoredImages }`                | a chunk   |
| Mesh      | `skinMeshProperties`                                                                                 | `embed SkinMeshDataProperties`, 43 fields                           | nothing   |
|           | `.simpleSkin`, `.skeleton`                                                                           | `string`                                                            | by name   |
|           | `.texture`                                                                                           | `file` since 16.17                                                  | a chunk   |
|           | `.emissiveTexture`, `.normalMapTexture`, `.glossTexture`, `.RoughnessMetallicAoTexture`              | `file` since 16.17                                                  | a chunk   |
|           | `.Material`                                                                                          | `link IMaterialDef`                                                 | an object |
|           | `.materialOverride`                                                                                  | `list[embed SkinMeshDataProperties_MaterialOverride]`               | nothing   |
|           | `.materialOverride[].submesh`                                                                        | `string`                                                            | nothing   |
|           | `.materialOverride[].texture`                                                                        | `file` since 16.17, plus normal, gloss, RMA                         | a chunk   |
|           | `.materialOverride[].Material`                                                                       | `link IMaterialDef`                                                 | an object |
|           | `.initialSubmeshToHide`, `.submeshRenderOrder`                                                       | `string`                                                            | nothing   |
|           | `.skinScale`, `.castShadows`, `.fresnel`, `.fresnelColor`, `.selfIllumination`, reflection fields    | leaves                                                              | nothing   |
|           | `.materialController`                                                                                | `pointer SkinnedMeshDataMaterialController`                         | nothing   |
| Animation | `skinAnimationProperties`                                                                            | `embed SkinAnimationProperties`                                     | nothing   |
|           | `.animationGraphData`                                                                                | `link AnimationGraphData`                                           | an object |
| Audio     | `skinAudioProperties`                                                                                | `embed SkinAudioProperties`, `{ PlaysVo, tagEventList, bankUnits }` | nothing   |
| VFX       | `idleParticlesEffects`                                                                               | `list[embed SkinCharacterDataProperties_CharacterIdleEffect]`       | nothing   |
|           | `[].effectKey`                                                                                       | `hash`                                                              | by name   |
|           | `[].effectName`, `[].boneName`, `[].targetBoneName`                                                  | `string`                                                            | nothing   |
|           | `[].Position`                                                                                        | `vec3`                                                              | nothing   |
|           | `mResourceResolver`                                                                                  | `link ResourceResolver`                                             | an object |
|           | `mAdditionalResourceResolvers`                                                                       | `list[link ResourceResolver]`                                       | an object |
|           | `particleOverride_DeathParticle`, `particleOverride_ChampionKillDeathParticle`, `mSpawnParticleName` | `string`                                                            | by name   |
| Rest      | `healthBarData`, `skinUpgradeData`                                                                   | `embed`                                                             | nothing   |
|           | `mContextualActionData`                                                                              | `link ContextualActionData`                                         | an object |
|           | `ChromaData`, `secondaryResourceHudDisplayData`                                                      | `pointer`                                                           | nothing   |
|           | `themeMusic`, `defaultAnimations`, `extraCharacterPreloads`                                          | `list[string]`                                                      | nothing   |
|           | `emoteBuffbone`, `emoteLoadout`, `godrayFXbone`, `armorMaterial`                                     | leaves                                                              | nothing   |

An `effectKey` resolves through the resolver. `ResourceResolver` declares no field of its own
and inherits `resourceMap` as `map[hash, link]` from `BaseResourceResolver`, `0x72a165de`. The
key of that map is the `effectKey`, and the value is the `link` to the `VfxSystemDefinitionData`.
So the VFX list of a skin is a join of two objects, the skin and its resolver, and the resolver
is a `link` the index answers.

### 4.3 `VfxSystemDefinitionData`, `0x45cd899f`, and `VfxEmitterDefinitionData`, `0x9cde442`

The system has 34 fields and the wiki describes it as "a complete particle system ("troy")". It
holds no `link` at all. Every reference out of a system lives in its emitters.

| Group    | Field                                                                                                           | Type                                            | Crosses |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| Identity | `particleName`, `particlePath`, `assetCategory`                                                                 | `string`                                        | nothing |
| Emitters | `complexEmitterDefinitionData`                                                                                  | `list[pointer VfxEmitterDefinitionData]`        | nothing |
|          | `simpleEmitterDefinitionData`                                                                                   | `list[pointer VfxEmitterDefinitionData]`        | nothing |
|          | `ShimmerEmitterDefinitionData`                                                                                  | `list[VfxShimmerEmitterDefinitionData]`         | nothing |
| Bounds   | `visibilityRadius`, `flags`, `drawingLayer`, `buildUpTime`, `transform`, `overrideScaleCap`, `selfIllumination` | leaves                                          | nothing |
| Audio    | `soundOnCreateDefault`, `soundPersistentDefault`, `voiceOverOnCreateDefault`, `voiceOverPersistentDefault`      | `string`                                        | by name |
| HUD      | `hudAnchorPositionFromWorldProjection`, `hudLayerDimension`, `HudLayerAspect`                                   | leaves                                          | nothing |
| Rest     | `materialOverrideDefinitions`                                                                                   | `list[embed VfxMaterialOverrideDefinitionData]` | nothing |
|          | `DistanceBasedTransparencyParams`, `DynamicParameterData`, `EffectorDefinition`, `PointLight`                   | `pointer`                                       | nothing |

The emitter has 139 fields, and the wiki documents most of them, which is unusual. The groups a
view surfaces:

| Group     | Field                                                                                                                                                                                                        | Type                                                                                                                                                              | Crosses   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Identity  | `emitterName`                                                                                                                                                                                                | `string`, "used ... by overrides that target emitters by name"                                                                                                    | nothing   |
|           | `disabled`                                                                                                                                                                                                   | `bool`, "a disabled emitter is skipped entirely"                                                                                                                  | nothing   |
|           | `importance`, `ChanceToNotExist`, `isSingleParticle`, `pass`                                                                                                                                                 | leaves                                                                                                                                                            | nothing   |
| Timing    | `lifetime`, `period`, `timeActiveDuringPeriod`                                                                                                                                                               | `option[f32]`                                                                                                                                                     | nothing   |
|           | `timeBeforeFirstEmission`, `emitterLinger`, `particleLinger`                                                                                                                                                 | leaves                                                                                                                                                            | nothing   |
|           | `rate`, `particleLifetime`                                                                                                                                                                                   | `embed ValueFloat`                                                                                                                                                | nothing   |
| Shape     | `SpawnShape`                                                                                                                                                                                                 | `pointer IVfxShape`, held as `VfxShapeSphere { radius }`, `VfxShapeBox { Size }`, `VfxShapeLegacy`                                                                | nothing   |
|           | `EmitterPosition`, `birthVelocity`, `velocity`, `acceleration`, `drag`, `birthScale0`, `scale0`, `birthRotation0`, `rotation0`                                                                               | `embed ValueVector3` and the integrated forms                                                                                                                     | nothing   |
| Colour    | `birthColor`, `Color`                                                                                                                                                                                        | `embed ValueColor`                                                                                                                                                | nothing   |
|           | `.constantValue`                                                                                                                                                                                             | `vec4`                                                                                                                                                            | nothing   |
|           | `.dynamics`                                                                                                                                                                                                  | `pointer VfxColorBase`, held as `VfxAnimatedColorVariableData { times: list[f32], values: list[vec4], probabilityTables: list[pointer VfxProbabilityTableData] }` | nothing   |
|           | `particleColorTexture`                                                                                                                                                                                       | `string`, "Gradient texture sampled to color particles"                                                                                                           | by name   |
|           | `blendMode`, `modulationFactor`, `alphaRef`, `colorLookUpTypeX/Y`                                                                                                                                            | leaves                                                                                                                                                            | nothing   |
| Texture   | `texture`                                                                                                                                                                                                    | `string`                                                                                                                                                          | by name   |
|           | `texDiv`, `numFrames`, `frameRate`, `startFrame`, `isRandomStartFrame`, `TextureFlipU/V`, `uvScale`, `uvRotation`, `uvScrollRate`                                                                            | leaves and `embed Value*`                                                                                                                                         | nothing   |
|           | `falloffTexture`                                                                                                                                                                                             | `string`                                                                                                                                                          | by name   |
| Rendering | `primitive`                                                                                                                                                                                                  | `pointer VfxLegacyPrimitiveBase`, held as a mesh, quad or beam primitive                                                                                          | nothing   |
|           | `CustomMaterial`                                                                                                                                                                                             | `pointer VfxMaterialDefinitionData`                                                                                                                               | nothing   |
|           | `.Material`                                                                                                                                                                                                  | `link IMaterialDef`                                                                                                                                               | an object |
|           | `.materialDrivers`                                                                                                                                                                                           | `map[string, pointer IVfxMaterialDriver]`                                                                                                                         | nothing   |
|           | `Material`                                                                                                                                                                                                   | `link IMaterialDef`, removed 14.1                                                                                                                                 | an object |
|           | `materialOverrideDefinitions`, `meshRenderFlags`, `renderPhaseOverride`, stencil fields, `softParticleParams`, `distortionDefinition`, `reflectionDefinition`, `paletteDefinition`, `alphaErosionDefinition` | leaves and `pointer`                                                                                                                                              | nothing   |
| Children  | `childParticleSetDefinition`, `Audio`, `fieldCollectionDefinition`, `Filtering`, `Linger`, `LegacySimple`                                                                                                    | `pointer`                                                                                                                                                         | nothing   |
| Flex      | `flexRate`, `flexParticleLifetime`, `flexBirthVelocity` and the rest                                                                                                                                         | `pointer FlexValue*`                                                                                                                                              | nothing   |

Two facts shape the view. The emitter's `texture` is a `string` in every build, so the swatch a
`file` row gets for free is not there for an emitter, and the view has to resolve the path. A
`ValueColor` is a struct of two, and its gradient is two lists under a pointer under it, three
nodes deep from the emitter's row.

### 4.4 `AnimationGraphData`, `0xf5fb07c7`

Nine fields. Referenced by five classes through `animationGraphData` as `Link<AnimationGraphData>`,
one of them `SkinAnimationProperties`.

| Field                                                  | Type                              | Held as                                                                                                                                                         | Crosses |
| ------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `mClipDataMap`                                         | `map[hash, pointer ClipBaseData]` | `AtomicClipData { mAnimationResourceData: embed { mAnimationFilePath }, mTickDuration, startFrame, EndFrame, mUpdaterResourceData }` and the other clip classes | nothing |
| `mMaskDataMap`                                         | `map[hash, embed MaskData]`       | `{ mId: u32, mWeightList: list[f32] }`                                                                                                                          | nothing |
| `mTrackDataMap`                                        | `map[hash, embed TrackData]`      | `{ mBlendMode: u8, mBlendWeight: f32, mPriority: u8 }`                                                                                                          | nothing |
| `mSyncGroupDataMap`                                    | `map[hash, embed SyncGroupData]`  |                                                                                                                                                                 | nothing |
| `mBlendDataTable`                                      | `map[u64, pointer BaseBlendData]` |                                                                                                                                                                 | nothing |
| `AnimStateGraphEntryClips`                             | `list[hash]`                      | Keys into `mClipDataMap`                                                                                                                                        | by name |
| `mUseCascadeBlend`, `mCascadeBlendValue`, `objectPath` | leaves                            |                                                                                                                                                                 | nothing |

A clip's track and mask are keys into the sibling maps, and the frames draw them as dropdowns.
The clip's animation file is a `string` path under an `embed`, and the frames' `Framerate` is
`mTickDuration` as a rate.

## 5. What the repository already has

### 5.1 The rows, and how many calls a view costs

`bin_open(asset, entry)` with an entry answers "every one of them", the whole property list of
the object, under `WHOLE` (`src-tauri/src/commands/bin.rs:21-23, 55-63`). So an object tab
holds every depth-zero row of its object before it draws, and a view over those rows costs no
call. `bin_children(document, entry, path, offset, limit)` answers one node's children
(`bin.rs:82-89`), and `useBinChildren` runs one query per expanded node and page
(`src/modules/workshop/bin/useBinDocument.ts:102`), so a view that reads nested rows reads them
the way the tree does, one node per call in parallel.

| View     | Reads                                                                                                                                                | Calls after the open            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Material | `samplerValues`, its N elements, `paramValues`, `switches`, `techniques`                                                                             | about 4 + N, N under ten        |
| Skin     | `skinMeshProperties`, `materialOverride` and its N, `idleParticlesEffects` and its M, the resolver's `resourceMap`                                   | about 5 + N + M                 |
| VFX      | two emitter lists, N emitters, and per emitter `rate`, `particleLifetime`, `birthColor`, `Color`, each colour's `dynamics`, its `times` and `values` | about 2 + N + 8N, N in the tens |

The third row is the one that needs a read the backend does not have.

### 5.2 What a row carries

A row is `entry`, `path` on the wire, `label` for a person, `node`, `name`, `unnamed`, `kind`,
`value` and `declared` (`crates/ltk-manager-core/src/bin_document.rs:559-577`). A `Struct`
value carries `class_hash`, `class` and `len` (`bin_document.rs:794-799`), so a view knows the
class of every `embed` and `pointer` under it without a second call, which is what routes a
`ValueColor` to a swatch or a `VfxShapeSphere` to its radius. A `Hash` value carries the name
the `binhashes` table gives it (`bin_document.rs:774-778`), which is what matches an
`effectKey` to a `resourceMap` key. `declared` carries the schema's shape and whether the file's
kind differs (`bin_document.rs:585-590`), so a view can read a sampler's `texturePath` as either
`file` or `string` from the row alone.

`children` descends by the wire path and pages (`bin_document.rs:363-380`). `object` answers
the header facts (`bin_document.rs:274-300`). Both take any entry of the file, so a view over a
skin reads the skin's resolver through the same handle when the resolver is in the same bin,
which is where a skin's resolver is declared.

### 5.3 Addresses

The wire form is hashes, `.`, `[i]` and `{key}` (ADR-0027), and `rowKey` joins the entry and the
path (`src/modules/workshop/bin/binRows.ts:7-9`). A view names the fields it reads by hash, the
form the tables can never rename: `skinMeshProperties` is `45ff5904` on the wire whatever the
table says. `fieldHash` reads it back off a path (`binRows.ts:37-39`).

### 5.4 The object document and the registry

An object is a document keyed on its declaration (ADR-0028), typed as `ObjectDoc` with `asset`,
`objectHash`, `objectPath`, `file` and an optional `objectClass`
(`src/modules/workshop/documents/contentDocument.ts:59-71`). The registry routes `kind: "object"`
to `ObjectDocument` (`src/modules/workshop/documents/registry.tsx:129-145`), typed by
`EditorDocumentDefinition` and `EditorRegistry` (`src/modules/editor/types.ts:23-41`).
`ObjectDocument` opens the handle and hands `OpenObject` the header and the rows, and `OpenObject`
draws a `DocumentToolbar` and a `BinTree` with `roots={handle.rows}` and
`rootOwner={object.classHash}` (`src/modules/workshop/bin/ObjectDocument.tsx:90-125`). That is
the one place a class view plugs in: between the toolbar and the tree, or in place of the tree,
with `object.classHash` as the key.

There is one class-keyed switch on the frontend already, `objectIcon`, which keys on the class
name to pick a glyph (`src/modules/workshop/components/ObjectGlyph.tsx:14-23`). A view keys on
the hash instead, because the header carries `class_hash` always and `class` only where a table
names it (`bin_document.rs:475-488`).

### 5.5 Links, chips and swatches

`useCheckLinkTargets` asks `declaredObjects` for every `link` and `hash` of a row group and
`locateGameFiles` for every `file` path, one call per group and kind
(`src/modules/workshop/bin/useLinkTargets.ts:179-226`), and the decisions draw an `ObjectChip`
or a `FileChip` (`src/modules/workshop/bin/LinkChip.tsx:38, 81`). A `file` chip that is a
texture carries a `TextureSwatch`, thirty-two pixels on the row and a card at 256
(`src/modules/workshop/bin/TextureSwatch.tsx:17-21, 44`), over `previewUrl(asset, minWidth)`
(`src/modules/workshop/preview/assetRef.ts:21`). `fileLinkMark` decides swatch against badge
by extension and by sniffing the bytes (`src/modules/workshop/bin/fileLinkMark.ts:28-38`). The
contexts the tree provides, `LinkAssetContext`, `LinkTargetsContext` and `LinkOpenContext`
(`src/modules/workshop/bin/BinTree.tsx:227-229`), are what a chip inside a view would read, so a
view mounted beside the tree needs the same providers around it.

`locateGameFiles(paths)` takes any chunk path (`src/lib/tauri.ts:330`). Nothing calls it for a
`string` today, and it is the resolver a view wants for `texture`, `simpleSkin` and `skeleton`.

### 5.6 The schema

`ClassSchema` is the class's name, the build it was read at, the patch that build belongs to,
and every field with its hash, name, declared shape and revisions
(`crates/ltk-manager-core/src/meta_schema.rs:227-264`). `class_schema` reads it at the install's
build (`meta_schema.rs:455-496`), `useClassSchema` holds it for the session
(`src/modules/workshop/bin/useClassSchema.ts:16-24`), and the class card sends the reader to
the wiki (`src/modules/workshop/bin/ClassCard.tsx:9-12`). The snapshot's tuple carries a class
hash in its fourth slot that the parser leaves unread, because "a `Pointer` names a base class
and holds any class derived from it" (`meta_schema.rs:136-141`). The schema knows no
inheritance, so it cannot say that `TftSkinCharacterDataProperties` is a skin. The wiki does.

### 5.7 References

`ReferenceQuery` is a class or an object (`src/lib/bindings/ReferenceQuery.ts:6-13`), answered
by `class_references` and `object_references` (`crates/ltk-manager-core/src/object_index/references.rs:98, 131`)
through `find_references` (`src-tauri/src/commands/object_index.rs:290`). "Every object of a
class" comes from the index, and "every use of an embedded class" and "every object linking to
an object" from "a walk of every bin" that is not built (`docs/ux/PROJECT_EDITOR.md:2729-2741`).
So a material view can ask which objects are materials and cannot yet ask which skins use this
one, because a skin's `Material` is a `link` inside an `embed`.

### 5.8 What the spec already decided

- "A class worth a purpose-built view can have one, without the generic view knowing" is a goal
  (`docs/ux/BIN_EDITOR.md:33`), and "Class views" is Proposed (`BIN_EDITOR.md:69`)
- "A bespoke view is a component keyed by class hash, taking the same node path every generic
  block takes, and it composes rather than replaces - a class view that handles four of an
  object's seventeen properties leaves the other thirteen to the generic rows below it"
  (`BIN_EDITOR.md:718-737`)
- The candidates it lists are the three this note was asked about, "none of them decided", and
  the section "stays a list until the generic view ships and a real complaint names the first
  entry" (`BIN_EDITOR.md:728-737`). The generic view has shipped
- The reading track puts class views at step 3, "chosen by a complaint and not by this
  document" (`BIN_EDITOR.md:981`)
- Every user-facing string is the frontend's (ADR-0017), so a view's group captions are messages
  and its field names are the row's `name`, which the tables give

### 5.9 What is not there

- No read of several nodes in one call. `bin_children` is one node, and the design budgets one
  round trip at 16ms (`BIN_EDITOR.md:880-887`)
- No resolution of a `string` path to a chunk from a row. `locateGameFiles` exists and nothing
  in the bin module calls it for a string
- No reveal of a nested row. `BinTree`'s `reveal` acts on roots and "A request for a row that is
  not a root is left alone" (`BinTree.tsx:200-206`)
- No typed decode of a class in Rust. `ltk_meta` at the pinned rev offers
  `BinObject::get_property(name_hash)` (`crates/ltk_meta/src/tree/object.rs:173`) and serde on
  the tree behind the `serde` feature the workspace enables (`tree.rs:39-41`, `property.rs:14`,
  root `Cargo.toml:29`), and no derive that reads a bin object into a struct
- No mesh, skeleton or animation preview. `AssetInfo` is `texture`, `image` or `unsupported`
  (`crates/ltk-manager-core/src/preview/mod.rs:46`), the workspace depends on `ltk_meta` and
  `ltk_texture` and not on `ltk_mesh` or `ltk_anim` (root `Cargo.toml:29, 39`), and
  `package.json` names no 3D library
- No reverse reference through an embedded link, per section 5.7

## 6. Proposals

Ranked by what each buys against what it costs. Each says which class it keys on, what it reads,
and what it needs that does not exist. "Frontend" means no new command.

### 6.1 A view registry keyed on class hash, with the tree as the fallback

A `Record<string, ClassView>` keyed on `0x` and eight hex digits, read once in `OpenObject`:
`const view = classViews[object.classHash]`. Absent, the tree draws as today. Present, the view
draws over `handle.rows` with `document`, `asset` and `object` in hand, inside the same
`LinkAssetContext`, `LinkTargetsContext` and `LinkOpenContext` the tree provides, so a chip in a
view resolves and opens the way a chip in a row does. The key is the hash and not the name, per
section 5.4. The registry is the file tab's concern later and the object tab's now, because
ADR-0028 makes the object tab the unit a modder opens and the file tab a list of blocks.

Frontend. It is the seam every other proposal plugs into, and on its own it changes nothing a
user sees.

### 6.2 The hybrid: a summary panel above the full tree

The first three views are summaries, not replacements. A `ClassSummary` slot sits between the
`DocumentToolbar` and the `BinTree`, the tree keeps every row, and the summary draws the fields
the class is opened for. This is the spec's own rule, "composes rather than replaces"
(`BIN_EDITOR.md:724-726`), and it is what the frames show as a table beside a tree tab rather
than in place of it (section 2, point 5). A summary over depth-zero rows costs nothing, per
section 5.1. A click on a summary cell reveals the row in the tree below, which needs the
nested reveal of section 5.9.

Frontend, plus the nested reveal in `BinTree`, which is frontend. Recommended as the shape of
6.4, 6.5 and 6.6, with a replacement view left for a class whose tree is unreadable rather than
long.

### 6.3 A projected read: several nodes in one call

`bin_read(document, entry, paths: Vec<String>) -> Vec<BinRows>`, or `bin_subtree(document,
entry, path, depth, limit)`, in Rust over the held tree, looping `descend` per path and bounded
by a row budget. It stays inside ADR-0026: rows cross, the tree does not. It is what turns the
VFX view's `2 + 9N` calls into two, and what lets a `ValueColor` row draw a gradient from three
nodes under it without three round trips per visible row. The path form is what a view holds
anyway, per section 5.3.

Backend, one new command in `src-tauri/src/commands/bin.rs` beside `bin_children`, and one
method on `BinDocument`. Needed by 6.6 and 6.7, and an optimisation for 6.4 and 6.5.

### 6.4 The material view, `StaticMaterialDef`, `0xff9d3409`

A header of `name` and `type`. A sampler table, one row per `samplerValues[i]`, columns
`TextureName`, the texture as chip and swatch, `addressU/V/W`, `filterMag/Min`. A params table of
`name` and four numbers. Switches as `name` and a checkbox. `shaderMacros` as key and value.
Techniques folded to `name`, pass count and each pass's `shader` chip. The rest stays in the tree
below. The texture column draws by the row's `kind`: a `file` takes the existing chip and swatch,
a `string` is resolved through `locateGameFiles` and drawn the same way, and a path neither side
holds draws as text.

Reads the depth-zero rows and about `4 + N` children calls, per section 5.1. Frontend. The
smallest of the three, self-contained, and the one whose textures already have a widget. The
"used by" list waits on the walk of section 5.7.

### 6.5 The skin view, `SkinCharacterDataProperties`, `0x9b67e9f6`

An identity strip of `championSkinName`, `skinClassification` and `skinParent`. An icon row of
`iconAvatar`, `iconCircle`, `iconSquare` and `loadscreen.image` as swatches. A mesh card of
`simpleSkin` and `skeleton` resolved by path, `texture` and the four map textures as swatches,
`Material` as a chip. A material override table of `submesh`, texture swatch and `Material`
chip. An animation line with the `animationGraphData` chip. A VFX table of
`idleParticlesEffects`, one row per effect, `effectKey` joined to the resolver's `resourceMap`
so the row carries the system's chip, and `boneName` beside it. An audio line of `bankUnits`.

Reads the depth-zero rows, `skinMeshProperties`, the override list and its elements, the effect
list and its elements, and the resolver. The resolver is a `link` the row group's check already
resolves, and when it is declared in the same file the same handle reads it. When it is
declared elsewhere, `useBinDocument(asset, entry)` opens a second handle
(`src/modules/workshop/bin/useBinDocument.ts:30-33`). Frontend, with `locateGameFiles` for the
three string paths. The view applies to `TftSkinCharacterDataProperties` only if the registry
is told so, per section 5.6.

### 6.6 The VFX system view, `VfxSystemDefinitionData`, `0x45cd899f`

A header of `particleName`, `particlePath`, `visibilityRadius`, `flags`, `drawingLayer`,
`buildUpTime` and the four audio hooks. An emitter table, one row per element of the two emitter
lists, columns `emitterName`, `disabled` as a checkbox, `lifetime` and `period`,
`rate.constantValue`, `particleLifetime.constantValue`, `birthColor` and `Color` as a swatch or a
gradient strip, `texture` resolved by path and drawn as a swatch, `blendMode`, the class of
`SpawnShape` and of `primitive`, and `CustomMaterial.Material` as a chip. A row selected in the
table reveals the emitter's rows in the tree below. The pattern is the frames', a map of structs
as a table with a column per chosen field (section 2, points 2 to 4).

Reads a projection of about ten paths per emitter. Needs 6.3, and the nested reveal of 6.2. The
gradient strip is issue 55's item 2 in block form (section 3).

### 6.7 Value-level decorations, `ValueColor` and its family

A rule keyed on `(class hash, field hash)` rather than on the object's class, per issue 55's
"matched structurally on class + property hash": an `embed` row whose class is `ValueColor`
draws `constantValue` as a swatch and, where `dynamics` holds a `VfxAnimatedColorVariableData`,
its `times` and `values` as a gradient strip on the row itself. `ValueFloat`, `ValueVector2` and
`ValueVector3` draw their constant on the row the same way. These rows sit in every VFX bin, in
every class that embeds them, and in the generic tree, so the decoration reaches a reader who
never opens a view.

Frontend over 6.3, because a decoration on a visible row is a read of three nodes under it. The
alternative is a `summary` the backend attaches to a struct row for the classes it knows, which
keeps the round trips at zero and moves class knowledge into Rust. Section 7 asks which.

### 6.8 The animation graph table, `AnimationGraphData`, `0xf5fb07c7`

The frames' editor over the same data: `mClipDataMap` as a table of key name, clip class,
`mAnimationFilePath` and `mTickDuration` as a rate, with tabs for `mMaskDataMap`,
`mTrackDataMap` and `mSyncGroupDataMap`. Track and mask as dropdowns wait on editing. Not one of
the three asked for, and listed because the frames are its specification.

Frontend over 6.3, a projection of three paths per clip.

### 6.9 The particle viewer

A follow-up and not a view. What it needs, and only the third exists:

- A typed decode of the emitter family in Rust, hand-written over `get_property` or through the
  tree's serde, since `ltk_meta` has no derive (section 5.9)
- A renderer, in the frontend as a 3D library the bundle does not carry, or in Rust as a crate
  the workspace does not depend on
- The textures, which `ltk_texture` and the preview protocol already decode
- A model of what each of the 139 fields does at run time, which the wiki documents field by
  field and no source documents as a simulation

The mesh preview a skin view would want is the same renderer.

What is worth doing first is what issue 55 scopes: swatches and gradient strips (6.7), a
flipbook strip of `texture` cut by `texDiv` and `numFrames` on the emitter row, and a curve
widget over `keyTimes` and `keyValues`. Each is two-dimensional, needs 6.3 and no renderer, and
each is what a VFX modder reads off an emitter before running the game. The viewer is measured
after those, against a complaint that names it.

### 6.10 A string that is a path resolves in the generic tree

Not a view. A `string` row whose value starts with `ASSETS/` or `DATA/` and ends in an
extension is a path the game resolves by name, the article's problem 6. Asking `locateGameFiles`
for it and drawing the chip and swatch a `file` gets, with the layer's copy first as
`decideFileLink` already orders it, reaches an emitter's `texture`, a skin's `simpleSkin` and
`skeleton`, a clip's `mAnimationFilePath` and every `particleColorTexture` in the game, in the
tree and in every view at once.

Frontend, in `linkHashes`/`linkPaths` and `decideLink`. It is the cheapest change in this note
and the one that reaches the most rows.

## 7. Open questions for the maintainer

1. **Compose or replace.** 6.2 puts a summary above the whole tree, the spec's rule. The frames
   put the table and the tree in separate tabs. A replacement view with a "Show tree" toggle is
   the third shape. Which one is the object tab's?
2. **Where class knowledge lives.** 6.4 to 6.8 hold the field hashes in the frontend registry.
   6.7's alternative attaches a summary in Rust. The projected read of 6.3 keeps Rust generic
   and the frontend the only place that knows what a `ValueColor` is. Is that the split, or does
   a per-class projection belong beside the schema in `ltk-manager-core`?
3. **Subclasses.** The schema carries no inheritance and the wiki does. Does the registry list
   `TftSkinCharacterDataProperties` by hand, or does the snapshot grow a parent table?
4. **Which view first.** The spec waits for "a real complaint". This request is one. 6.4 is the
   smallest and needs no command. 6.6 is the one a VFX modder would name and needs 6.3. Is the
   order material, skin, VFX, or does the complaint say VFX?
5. **The read's budget.** How many rows may `bin_read` answer in one call, and what does a VFX
   bin of sixty emitters cost under it?
6. **Strings as paths.** Does 6.10 belong to the generic tree, so every `string` that reads as a
   path resolves, or only to a view that knows the field? A false positive costs one
   `locateGameFiles` miss and draws text.
7. **Editing through a view.** When leaf editing lands, a cell of a view is a widget bound to
   a path, the same patch a row would send. Designing the cells as `(path, value)` pairs now
   costs nothing and keeps a view from becoming a form with its own state. Agreed?
8. **The nested reveal.** A summary cell that reveals its row needs `BinTree` to expand the
   ancestors of a non-root key. Is that a change to `reveal`, or a new prop?
9. **The renderer.** 6.9 is a 3D stack in the frontend or a Rust one, and the skin's mesh
   preview shares it. Is either in scope for this repository, or is the viewer a separate tool
   that opens the object the way VS Code opens the file?
10. **Reverse references.** A material's "used by" and a system's "used by" wait on the walk.
    Does a view draw an empty "used by" with the walk's affordance, or nothing until the walk
    ships?

## 8. What was decided

Grilled on 2026-09-07 over section 7. The rule is ADR-0030 and "Class views" in
`docs/ux/BIN_EDITOR.md`.

| Question                  | Answer                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compose or replace     | Neither. A view is a mode of the object tab beside Properties, switched by a segmented control in the toolbar. The view opens first |
| 2. Where class knowledge  | The frontend, as a declarative layout per class hash. Rust adds `bin_read` and knows no class                                       |
| 3. Subclasses             | Listed by hand on the same layout                                                                                                   |
| 4. Which view first       | The material layout and the row decorations together, then skin, then VFX                                                           |
| 5. The read's budget      | 500 rows per path, 2000 per call, an error past that. The layout batches                                                            |
| 6. Strings as paths       | In the generic tree. A prefix and an extension resolve a chunk, and any string is checked as an object hash                         |
| 7. Editing through a view | Yes. Every cell is a path and a value                                                                                               |
| 8. The nested reveal      | `reveal` learns a nested key, reached from Show in properties on a cell's menu                                                      |
| 9. The renderer           | Frontend WebGL, decided in its own ADR. The skin layout leaves a slot                                                               |
| 10. Reverse references    | Nothing until the walk ships. The kebab's Find all references is the affordance                                                     |

What section 6 did not ask and the grilling settled: every view is complete, so 6.2's summary
panel is superseded and 6.1's registry is a layout. Unplaced fields fall into an Other section
drawn by the tree. An empty section keeps its header. Fields are named by name and hashed at
load. Sampler textures are 48px tiles. A collapsed `ValueColor` row draws class, swatch and strip,
read per visible page. The float family draws the constant only. Issue 55's lints come later as
Problems rules.
