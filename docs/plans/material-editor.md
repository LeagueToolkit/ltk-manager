# Material editor

A `StaticMaterialDef` opens into a view of its own: a preview mesh drawn with the material's
translated program in the centre, and an inspector of every parameter, texture and switch the
material's shader declares beside it. An edit reaches the preview while the control is still
held, and lands in the bin when it is released. This is the first authoring surface of Hexshade,
in the place Maya's Hypershade, Blender's material preview and Unreal's material instance editor
hold in their tools.

The drawing side is `docs/plans/shader-pipeline.md`, tiers T1 to T4, built 2026-09-22. This plan
starts from that code and adds no translation work.

## What the code is

- **The material view is a stack.** `materialLayout` in
  `src/modules/workshop/bin/classes/utils/classLayouts.ts` draws Identity, Samplers, Params,
  Switches, Macros and Techniques as sections of generic rows. It names no shell.
- **Shells are data.** `ShellKind` in `bin/shell/utils/shellPanes.ts` is `vfx | skin | map`, and
  ADR-0036 makes a new shell a pane set, a default tree and one frame component.
  `ClassView.tsx` picks the frame by `layout.shell` and hosts one preview through a portal.
- **The backend owns the document.** `useLeafEdit` sends `patch`, `editProperty`, `insertItem`
  and `removeItem` edits through `bin_edit` (ADR-0051), invalidates the `DOCUMENT_READS` roots of
  `tree/hooks/useBinEdit.ts`, and the save queue writes 600 ms after the last patch (ADR-0040).
  Undo is `bin_undo` and `bin_redo`.
- **The program read already sees unsaved edits.** `read_material_programs` with
  `MaterialSource::Document` reads the open, edited tree, and answers one `MaterialProgram` per
  entry with a `ResolvedPass` and a `ProgramRead` per pass.
- **The frontend material is built per program.** `createProgramMaterial` in
  `src/modules/viewport/hexshade/programMaterial.ts` packs `$Globals` into a plain `vec4` array
  uniform, keeps the member offsets in the `programGlobals` WeakMap, and binds textures and pass
  state. `EngineEnvironment` writes the engine blocks once per frame.
- **Gaps.** No primitive mesh exists in the viewport. The logical-to-physical parameter scatter
  lives in Rust alone (`pass_params` in `crates/ltk-manager-core/src/material/pass.rs`), so the
  frontend cannot place an edited value in `$Globals` by itself. The `skin-programs` query is not
  in `DOCUMENT_READS` and has `staleTime: Infinity`, so a material edit does not reach the skin
  preview today. `read_material_programs` parses `shaders.bin` on every call.

## What an edit changes

The cost of an edit is decided by what it touches in the program, not by which field it is.

| Edit                                      | Touches                       | Cost                                  |
| ----------------------------------------- | ----------------------------- | ------------------------------------- |
| `paramValues` value, material or pass     | `$Globals` values             | uniform write, no backend call        |
| Runtime switch                            | `switch_<NAME>` in `$Globals` | uniform write, no backend call        |
| Pass render state                         | material flags                | `applyPassState`                      |
| Sampler address or filter                 | sampler state                 | `applySampler`, texture `needsUpdate` |
| Sampler `texturePath`                     | one texture                   | texture load and rebind               |
| Compile-time switch, `shaderMacros`, type | the define list               | new program: permutation, translation |
| Pass `shader` link                        | the shader                    | new program: new TOCs                 |

The first four rows are the edits a reader makes by dragging, and they stay on the GPU. The last
two are discrete, a toggle or a pick, and they go through the backend. A translation is 6 to
33 ms cold and a disk read warm, so a recompile on a toggle is acceptable without a spinner, but
the preview keeps drawing the last program until the new one is ready.

## Decisions

**A material opens into a shell of its own.** `materialLayout` names `shell: "material"`, with
the panes `preview` and `inspector` (a `program` pane was built and removed in M4), the preview
first and widest. Below the shell width the preview stands above the stack, as the skin's does. One ADR records it, amending
ADR-0036: "A material opens into a shell of its own".

**The shader declares the inspector's rows.** The rows are the `CustomShaderDef`'s logical
parameters, textures and switches, not the material's own list entries. A parameter the material
does not set draws the shader default, muted, with a mark that it is inherited. Editing it inserts
the entry, and a reset removes it. This is the Unreal material-instance model: the parent declares,
the instance overrides. The raw lists stay reachable in Properties.

**A parameter's control comes from its logical mask.** `fields` 1 is a number, 3 two numbers, 7
three and 15 four. A name ending in `Color` or `Tint`, and a 7 or 15 mask, draws the colour
control of `src/components/ColorPicker.tsx`. A texture draws `TextureSwatch` with its sampler
state. A switch draws a `Switch`, with a mark on a compile-time one that a toggle recompiles.

**The scatter crosses IPC once.** `ResolvedPass` gains a `layout`: each logical parameter's
physical target and component mask, plus the physical member offsets the sidecar already has.
The frontend applies a held value through that layout into the material's `$Globals` array and
sets `uniformsNeedUpdate`, as `environment.draw` already does. The Rust scatter stays the
authority, and the committed value comes back through it.

**A drag previews locally and commits on release.** The same pattern as the force gizmo
(`previewForceValue`): the overlay lives in the preview until the pointer is released, then one
`patch` edit lands, the query refetches, and the overlay is dropped. One release is one undo step.

**A program's material survives a value edit.** The frontend keys the built material by the pass
and its two shader ids. A refetch with the same ids writes the new values into the existing
material instead of building a new one, so a committed slider does not recompile or flicker.

**The preview mesh follows the material's kind.** A `StaticMesh` material draws on a plain `Mesh`.
A `SkinnedMesh` material draws on a `SkinnedMesh` with one identity bone, weights `(1, 0, 0, 0)`
and integer index 0, because a skinned program reads its world transform from `BonesCB` and would
collapse to the origin on a plain mesh. The geometry carries `a_POSITION`, `a_NORMAL`,
`a_TEXCOORD`, a white `a_COLOR`, and for a skinned kind `a_BLENDWEIGHT` and `a_BLENDINDICES`. No
cached permutation reads tangents, so the geometry has none until LIT_UBER (T5) needs them.

**The preview shapes are few.** A UV sphere is the default. A rounded cube, a plane and a
cylinder cover flat, edged and wrapped UV cases. The shape is the reader's, remembered per
project, not per material. The mesh that links the material is a later mode (M7).

**The studio is the skin viewport's.** The preview reuses `Viewport`, `Sun`, `Sky`, `Stage` and
the camera presets, with an orbit camera and an optional turntable. The engine environment is the
one T4 built, with the same open questions about the ambient cube and the sun.

**A failed program draws the error material and says why.** `ProgramNotes` over the preview's
corner shows the reason from `ProgramRead::Failed`. The fallback stock material of
`resolve_material` is not used in this view, because a reader editing a shader needs to see that
the shader failed.

## Panes

```text
+-----------------------------------------------+---------------------+
| preview                                       | inspector           |
|                                               |  Identity           |
|    sphere, drawn with the material's program  |  Textures           |
|                                               |  Parameters         |
|  [shape] [turntable] [backdrop] [pass: 0 v]   |  Switches           |
|                                               |  Macros             |
|                                               |  Passes             |
+-----------------------------------------------+---------------------+
```

- **Preview.** The mesh, the shape picker, the turntable, the backdrop menu and a pass picker for
  a multi-pass technique. A failed pass and the material-wide warnings show over its corner.
- **Inspector.** The shader-declared rows above, grouped. Techniques and child techniques draw as
  generic rows, since they are rare and structural.

## Tiers

Each tier leaves the view working.

### M1: the shell and the sphere

- `ShellKind` gains `material`, `SHELL_PANES` its three panes, `defaultShellLayout` and
  `defaultShellArrangements` its tree. `materialLayout.shell = "material"`.
- `MaterialShell` in `ClassFrames.tsx` beside `SkinShell` and `MapShell`, and a branch in
  `ClassView.tsx`.
- `src/modules/viewport/hexshade/previewMeshes.ts`: the shape geometries with the attribute names
  above, and the one-bone skeleton for a skinned kind.
- `MaterialPreview`: a `materialQueries.programs(document, entry)` query over
  `read_material_programs` with `MaterialSource::Document`, its root added to `DOCUMENT_READS`.
  The `skin-programs` root joins it, which closes the skin preview's gap.
- The program pane with the define list and the failure reason.
- ADR "A material opens into a shell of its own" and the shell's row in "The shell" of
  `docs/ux/BIN_EDITOR.md`.

Verification: open five materials of each kind from a skin and from Map11's `.materials.bin`.
Each draws on the sphere, a skinned one does not collapse, and a Properties edit followed by a
tab switch shows the change.

Built 2026-09-23 as ADR-0047, not yet seen on screen. The three.js side is `MaterialSubject` in
`src/modules/viewport/hexshade/components/`, and the workshop side is
`src/modules/workshop/bin/material/`. The query is `materialQueries.program`, keyed
`material-program`. The shape, the turntable and the ground are display preferences in
`workshopLayout.ts`. Two differences from the list above: the cube is a plain box, since a
rounded one needs `three/examples`, which nothing else imports, and the program pane leaves the
translated GLSL out until a reader asks for it.

Judged on screen the same day, which changed the direction. A texture is painted for one mesh's
UV layout, so a sphere draws a skin material as noise, and the shape's winding was reversed
(fixed: the geometry is no longer mirrored, only the object is). The user chose:

- **Edit beside the character.** The skin shell gains a Material pane (`MaterialPane`), which
  follows the submesh picked on the character or its own list. This is M7 pulled forward, from
  the skin's side rather than the material's.
- **The sphere is the default, the character a toggle.** A second pass the same day reversed
  the fallback: the material tab opens on the shape, and Draw on the character
  (`previewMaterialOnSkin`) swaps in the skin of its own file that links it
  (`useLinkingSkin`).
- **The character is the default, the shape a toggle.** A third pass reversed it again: the
  material tab draws its file's linking skin, and Draw on a shape (`previewMaterialOnShape`)
  swaps in the shape. The grid thumbnails stay on the sphere.
- **M6 through the Objects grid.** The grid's existing preview pool (`ObjectPreviewScene`)
  gained a `material` kind: a sphere thumbnail, live on hover like a particle system. No
  separate swatch renderer was built. Each tile is one `read_material_programs` call, which
  parses `shaders.bin` each time until M4 caches it.
- **Tables for the lists.** `MaterialTables.tsx` draws samplers, params, switches and macros a
  row per element and a column per field, through the `material-*` section widgets. This is the
  first half of M2. The shader-declared rows (defaults for what the material leaves unwritten)
  are the second half.

### M2: the shader-declared inspector

**Built 2026-09-23.** `ResolvedPass.schema` (`ShaderSchema`: logical params with mask and packed
default, textures with default path and shared sampler, switches with default and the runtime
flag) comes from the `ShaderDef` the resolve already reads. `MaterialTables.tsx` merges it with
the material's entries through `declaredRows`. An inherited row adds its entry through one
`editProperty` on the list (insert, then set `name` and the value), and a reset is `removeItem`.
Not built: the colour control of the mask rule, a mark on a compile-time switch, feature defines
in the schema. A section's header count is still the material's entries.

- `MaterialProgram` gains a `schema` from the `ShaderDef` the resolve already reads: logical
  parameters with mask, default and source, textures with default path and sampler name,
  switches with default and the runtime flag, feature defines.
- Section widgets `material-textures`, `material-params` and `material-switches` in `WIDGETS`,
  each a component per ADR-0030. An edit goes through `useLeafEdit`: a set parameter is a leaf
  edit, an inherited one an `insertItem` of a new `StaticMaterialShaderParamDef`, a reset a
  `removeItem`.
- A game bin opened in a project declares into its layer (ADR-0042). `paramValues` is a list,
  so a declared edit is positional. The widget writes by the entry's current index and the
  plan accepts the drift ADR-0042 already describes.

Verification: every row of a material matches its shader def. A reset returns the default and
removes the entry from Properties. Undo restores it.

### M3: live values

**Built 2026-09-23.** No `ResolvedPass.layout` was needed: M2's `SchemaParam` already carries
each logical parameter's `physical` target and `fields` mask. `programMaterials.ts` holds
`scatter` and `withHeld` (the frontend mirror of the Rust scatter, tested on the same cases) and
`ProgramMaterials`, the one cache `Character` and `MaterialSubject` share. It keys a material by
material hash, shader and both stage ids, refreshes textures, pass state and `$Globals` in place
on a refetch, and draws a held value on every program of its material. `ProgramGlobals.members`
now keeps every stage's location of a member, which also fixes a light map written to one stage
only. The held value lives in `material/state/heldValue.ts`. `LiveParam` scrubs through base-ui's
`NumberField.ScrubArea`, commits one `patch` edit on release, blur or Enter, and lets the held
value go once the program reads refetch. Not built: a held value on the Objects grid tiles, and
the colour rule's switch between the two controls.

- `ResolvedPass.layout` in `pass.rs`, the logical-to-physical map, exported through ts-rs.
- `applyHeldValue(material, layout, name, value)` in `programMaterial.ts`, writing through the
  `programGlobals` offsets.
- The number, vector and colour controls call it on change and commit on release.
- The material cache keyed by pass and shader ids, and a value refresh in place.

Verification: a unit test of the frontend scatter against the Rust `scatter` for masks 1, 3, 7
and 15 at non-zero component offsets. A held drag on a colour redraws every frame with no IPC in
the devtools network log. A release adds one undo step.

### M4: recompile on toggle

- A compile-time switch, a macro edit and a `type` change commit at once and refetch. The preview
  keeps the old material until the new program is ready, then swaps.
- `read_material_programs` keeps the parsed `shaders.bin` per asset lookup generation instead of
  parsing it per call, which a toggle-heavy reader otherwise pays every time. **Built
  2026-09-23**, ahead of M3: `ShaderDefsCache` in `material/defs.rs` keeps the parsed defs per
  asset and parses again only when the bytes differ from the ones it parsed. The skin and map
  reads share it through `shader_defs` in `commands/material.rs`.
- The program pane marks the define that changed.

**Built 2026-09-23.** The toggle path needed no new code: `material-program` and `skin-programs`
are in `DOCUMENT_READS`, the query key does not change on a refetch so the old program draws until
the new one answers, and `ProgramMaterials` builds the new permutation beside the old one before
the old is retired. The program pane was removed on the user's call, as too technical for a
reader. What it said moved: a failed pass and the material-wide warnings to `ProgramNotes` over
the preview's corner, the per-texture warnings to a mark on the texture's row, and the recompile
to a mark on a compile-time switch. The define list and the shader ids are no longer shown.

Verification: toggling each switch of a shader with at least four compile-time switches draws
without a blank frame. The second toggle of the same value answers from the translation cache.

### M5: textures and samplers

- A texture path field with an asset picker over the project and game layers. None exists today
  (`PathField` is filesystem-only), so the picker is its own small piece, reusable by any
  `texturePath` row outside this view.
- The address and filter modes as named choices instead of raw `u32`, closing the open item of
  the class views.
- A texture change reloads one texture through `useAssetTextures` and rebinds it.

### M6: swatches

The Hypershade grid: every `StaticMaterialDef` of the open bin, or of a skin and its linked bins,
as a thumbnail rendered on the sphere. One shared offscreen renderer draws them in turn into a
render target and keeps the pixels, so the grid does not hold one WebGL context per swatch. A
click opens the material in its shell.

### M7: on its own mesh

A preview mode that draws the skin or map mesh that links the material, with every other submesh
dimmed. It reuses `Character` and `Backdrop` with the program swapped in by hash. The reverse
lookup, which meshes link a material, is a walk over the skin's submesh overrides and the map's
mesh list.

## What stays out

- **New shaders.** A node graph that writes a new shader needs an HLSL to DXBC compiler and a
  shader cache chunk the game loads. That is its own research, and the editor here edits the
  instance of a shader Riot shipped.
- **`dynamicMaterial` drivers.** The preview shows static values and marks the material animated,
  as the skin preview does. Issue #677 covers the VFX side.
- **Child techniques** as a preview mode, Mantis lighting, fog of war, shadows.
- **Creating a material** from a shader def. It is a small step after M2, since the schema is the
  scaffold, but it needs a decision on where a new object is placed in a bin.

## Open questions

- The pass picker draws one pass at a time. A two-pass material (an outline hull over a body) may
  need both passes drawn, and `programWith` takes only the first today.
- The colour rule reads a name. A mask of 7 or 15 without `Color` in the name may still be a
  colour, and a `Color` parameter may hold a scale. The inspector offers a switch between the two
  controls, remembered per shader parameter.
- Whether the studio lights match the skin viewport or a neutral grey studio. The skin viewport's
  is the default until the T4 open items are judged on screen.
