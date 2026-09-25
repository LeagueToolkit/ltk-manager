# Hexshade for VFX

The VFX preview draws a particle with the game's own particle shader: the shipped DXBC blob the
emitter selects, translated by Hexshade and bound by the names the blob's reflection carries. The
hand-written particle materials stay as the fallback and the reference. The Game shaders switch
(`previewShaders`) chooses between them, as it does for skins and maps.

This plan starts from the code on `fix/hexshade-coverage` (PR #713): every translated pass of a
material draws, linked-bin skin materials resolve, and a map's materials resolve through the
project layer. It is the Hexshade route for the first item of #677. Each ticket leaves the preview
drawing.

## What the code is

**The VFX renderer** is three.js with hand-written GLSL in `ShaderMaterial`s. Paths below are
relative to `src/modules/workshop/bin/vfx/`.

- `rendering/components/VfxSystem.tsx` routes each emitter by `rendering/utils/drawKind.ts` to
  `Quads.tsx` (camera, camera-unit, arbitrary and ray quads), `Trails.tsx`, `Beams.tsx`,
  `Meshes.tsx` or `AttachedMeshes.tsx`. Distortion is not a kind: any kind can distort, and then
  draws on `DISTORTION_LAYER`.
- `rendering/utils/materials.ts` builds `quadMaterial`, `meshMaterial`, `attachedMaterial`,
  `ribbonMaterial` and `wireMaterial`. The GLSL is in `rendering/shaders/` (`quad.ts`, `mesh.ts`,
  `ribbon.ts`, `custom.ts`). The defines and uniforms are in `rendering/utils/uniforms.ts`, and
  the blend state is `drawState` in `rendering/utils/blend.ts`.
- Quads are one `InstancedBufferGeometry` per emitter with 12 per-instance attributes, capped at
  4096 (`rendering/utils/buffers.ts`). Meshes are one `InstancedMesh`, capped at 512. Trails and
  beams are a `BufferGeometry` built on the CPU (`rendering/shaders/ribbon.ts`). Attached meshes
  are up to 8 `SkinnedMesh` slots. `rendering/components/Passes.tsx` holds the depth pre-pass for
  soft particles and the distortion pass.
- `engine/parsing/readVfxSystem.ts` reads `CustomMaterial.Material` into
  `EmitterModel.customMaterial`, a `MaterialPreview`. `customMaterial.ts` draws it with
  `CUSTOM_FRAGMENT`: the base texel times the vertex colour times the tint, with an alpha test.

**The VFX resolver** is `crates/ltk-manager-core/src/vfx/resolve.rs`, called by `read_vfx_system`
in `src-tauri/src/commands/vfx.rs`. A `CustomMaterial` link resolves through `linked_material`
with the VFX bin itself as the shader defs (line 187), so its `CustomShaderDef` is not found.

**Hexshade** is these pieces:

- `crates/hexshade`: `ShaderPath::Generated` for a `CustomShaderDef` and `ShaderPath::Hlsl` for an
  engine shader, and `ShaderCache::program(shader, &Defines)`.
- `crates/ltk-manager-game/src/program.rs`: `read_programs` for materials,
  `read_default_skinned_program` for the engine's `LIT_UBER` (the pattern for an engine shader),
  and `define_list`, which adds the studio defines by `MaterialKind`.
- `src-tauri/src/commands/material.rs`: `read_material_programs` over a `MaterialSource`
  (`document`, `file` or `map`), and `read_default_skinned_program`.
- `src/modules/viewport/hexshade/`: `createProgramMaterial`, `bindProgramTextures` and
  `writeProgramGlobals` in `programMaterial.ts`, `EngineEnvironment` with its `"group"` and
  `"uniform"` bindings, `ProgramMaterials`, `programPasses` and `passTwin`.

## What the data is

**The default particle shaders** are engine HLSL shaders, not `CustomShaderDef`s. Their TOCs are
`assets/shaders/hlsl/<file>-dx11` in `ShaderCache.dx11.wad.client`, and the same chunks ship in
`Bootstrap.windows.wad.client`. Measured on the 16.19 install:

| TOC                          | Permutations | Base defines                                                                                                                                                   |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `particlesystem/quad_vs.vs`  | 16           | `DISABLE_FOW MASKED ALPHA_EROSION MULT_PASS`                                                                                                                   |
| `particlesystem/quad_ps.ps`  | 256          | the above, `COLORPALETTE_COLORBLIND SOFT_PARTICLES PALETTIZE_TEXTURES ALPHA_TEST`                                                                              |
| `particlesystem/mesh_vs.vs`  | 256          | `LOCAL_SPACE_UV SEPARATE_ALPHA_UV DISABLE_FOW USE_VERTEX_COLORS REFLECTIVE MASKED SCREEN_SPACE_UV MULT_PASS`                                                   |
| `particlesystem/mesh_ps.ps`  | 2048         | `SEPARATE_ALPHA_UV DISABLE_FOW REFLECTIVE MASKED SCREEN_SPACE_UV COLORPALETTE_COLORBLIND SOFT_PARTICLES PALETTIZE_TEXTURES ALPHA_EROSION ALPHA_TEST MULT_PASS` |
| `skinnedmesh/particle_vs.vs` | 256          | as `mesh_vs`                                                                                                                                                   |
| `skinnedmesh/particle_ps.ps` | 1024         | as `mesh_ps`, without `SOFT_PARTICLES`                                                                                                                         |

Every base define is a single `NAME=1`. The shipped TOCs are complete over their own space, so any
define set drawn from the base defines resolves.

**The engine picks the pair from the mesh an emitter resolves**, not from the primitive kind:

| Pair                                                  | Drawn for                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `quad_vs` + `quad_ps`                                 | an emitter with no mesh: every quad, trail, ray, beam and ribbon |
| `mesh_vs` + `mesh_ps`                                 | a mesh emitter, and a `REFLECTIVE` quad                          |
| `skinnedmesh/particle_vs` + `particle_ps`             | an attached mesh, on the character's skinned mesh                |
| `quad_vs_fixedalphauv` + `quad_ps_fixedalphauv`       | `uvMode` 2 (`LOCK_ALPHA`)                                        |
| `quad_screenspaceuv` (vs + ps)                        | `uvMode` 1 (`SCREEN_SPACE`)                                      |
| `quad_ps_slice`, `mesh_ps_slice`, `particle_ps_slice` | `SLICE_RANGE`                                                    |
| `distortion_*`, `particle_distortion_*`               | the distortion pass                                              |

The `particle_shaders` example of ltk-manager-game lists the TOC of each stage of every
`ParticleShader` pair. The distortion pairs in the 16.19 shader cache are `distortion_vs` and
`distortion_ps`, `distortion_mesh_vs` and `distortion_mesh_ps`, and
`skinnedmesh/particle_distortion_vs` and `particle_distortion_ps`, and `ALPHA_TEST` is the one
particle define they declare. `EmitterModel` carries no `SLICE_RANGE`. `particleShaderOf`
answers no slice pair.

`quad_vs_fixedalphauv` does not translate: it reads `SV_VertexID`, which dxbc-spirv lowers
through `BaseVertex`, and SPIRV-Cross has no `BaseVertex` in the ES profile. A `LOCK_ALPHA`
quad draws with the hand-written material until Hexshade patches that input.

**The define set comes from the emitter's fields:**

| Define                                                   | Set when                                                                             | Status                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| `DISABLE_FOW`                                            | always in the preview                                                                | fixed                               |
| `MASKED`                                                 | never. It masks by the navmesh texture                                               | fixed                               |
| `COLORPALETTE_COLORBLIND`                                | never                                                                                | fixed                               |
| `ALPHA_TEST`                                             | `alphaRef` is not 0. `AlphaTestReferenceValue` is `alphaRef / 255`                   | attested                            |
| `ALPHA_EROSION`                                          | an erosion definition is present, with or without a texture name                     | attested                            |
| `MULT_PASS`                                              | the mult layer (`textureMult`) is present                                            | attested site, condition to confirm |
| `SEPARATE_ALPHA_UV`, `SCREEN_SPACE_UV`, `LOCAL_SPACE_UV` | from `uvMode`, on the mesh path. The quad path uses a separate file per mode instead | attested                            |
| `PALETTIZE_TEXTURES`                                     | a palette definition is present                                                      | inferred                            |
| `SOFT_PARTICLES`                                         | a `VfxSoftParticleDefinitionData` is present                                         | inferred                            |
| `REFLECTIVE`                                             | a `VfxReflectionDefinitionData` is present                                           | inferred                            |
| `USE_VERTEX_COLORS`                                      | the mesh path only                                                                   | inferred                            |

**The engine builds the quad vertices on the CPU**, four per particle at a 28-byte stride, and
the layout matches the input signature of `quad_vs`:

| Byte  | Format   | Semantic       | Content                                           |
| ----- | -------- | -------------- | ------------------------------------------------- |
| `+0`  | float3   | `POSITION0`    | the world-space corner                            |
| `+12` | R8G8B8A8 | `COLOR0`       | the colour, stored BGRA. The shader reads `.zyxw` |
| `+16` | half2    | `TEXCOORD0.xy` | `uvMatrix0 * corner`, the base layer              |
| `+20` | half2    | `TEXCOORD0.zw` | the animation frame, and the alpha-erosion drive  |
| `+24` | half2    | `TEXCOORD1.xy` | `uvMatrix1 * corner`, the mult layer              |

The corners run `(0,0)`, `(1,0)`, `(1,1)`, `(0,1)`. On the camera quad, `u = corner.x + 0.5` and
`v = 0.5 - corner.y`. The arbitrary quad is the camera quad with `x` and `y` swapped.

`quad_vs` decomposes the frame `floor(TEXCOORD0.z)` against `TEXTURE_INFO`
(`{cols, 1/cols, 1/rows, ...}`) into the base uv, and against `TEXTURE_INFO_2` into the mult uv
under `MULT_PASS`. It pushes the position along the view ray by `PARTICLE_DEPTH_PUSH_PULL`
(`DepthPushPull`, default 0), and projects with `mProj`. It forwards the erosion drive under
`ALPHA_EROSION`.

**What the pixel stage binds that the engine fills:** `PIXEL_COLOR_REMAP_RAMP_SharedTexture` is a
global remap keyed on luminance, which a 1x1 transparent-black texture turns off. `FOW_MAP` and
`NAVMESH_MASK_TEXTURE` are left out by `DISABLE_FOW` and `MASKED`. `sDepthTexture` and
`cDepthConversionParams` are the scene depth for `SOFT_PARTICLES`. An erosion definition with an
empty texture name binds 1x1 opaque white, and a named but missing texture binds transparent
black.

**Blending lives in the material, not the shader.** `blend.ts` already maps `blendMode` to
factors. Blend modes 0 and 2 premultiply the colour by alpha on the CPU, in the vertex colour.

**Custom particle materials** are `StaticMaterialDef`s of `type` 2 (`MaterialKind::Particles`),
compiled under `assets/shaders/generated/`. `DefaultParticleQuadUnlit` and
`VFX_Uber_StaticMesh_Unlit` carry runtime switches, which reach the shader as `$Globals` floats
named `switch_<NAME>`. No shipped material that Hexshade has drawn so far uses them, so that
path is covered by unit tests only.

**The shader file a custom material names fixes its vertex layout.** No define or technique
follows the primitive. Measured over the 174 champion WADs, Map11 and Common, 1,200 emitters
link a custom material, and those the table leaves out link one no scanned WAD declares:

| Emitters                    | Material kind | Vertex inputs                                                     |
| --------------------------- | ------------- | ----------------------------------------------------------------- |
| 8 arbitrary quads           | Particles     | the `quad_vs` layout                                              |
| 9 meshes, on `.scb` files   | Particles     | the `mesh_vs` layout, placed by `CharacterPerDrawVertexCB.mWorld` |
| 864 meshes, on `.skn` files | SkinnedMesh   | the skin streams, placed by `BonesCB.BONES` alone                 |
| 289 attached meshes         | SkinnedMesh   | the skin streams, placed by `BonesCB.BONES` alone                 |

None of them reads `kColorFactor`, the uv rows, `COLOR_LOOKUP_UV` or the erosion members, and
`PARTICLE_COLOR_FACTOR` is declared but unread. `EMITTER_DEPTH_PUSH_PULL` is read by all of them.
`HKG_Eyes_Blink_Mat` and two `AlphaBlend_Additive_Scroll_Packed` materials write
`depthCompareFunc` 0, which both usual orderings read as never.

## Decisions

**Both stages translate, behind an instanced prelude.** Each draw path gets a small GLSL prelude
that computes the engine's per-vertex inputs from our instance attributes: the vertex the
engine's CPU would have built. A text patch turns the translated vertex shader's `in a_*`
attributes into globals and renames its `main`. The prelude fills the globals and calls it. The
translated shaders then run unchanged, and instancing and the draw-call count stay as they are.
The pixel stage takes two patches. A member the engine binds per draw and a prelude writes per
instance reaches it through a flat varying, and it reads the frame copy with `v` turned over.
Two options lost:

- Building the engine vertices on the CPU. The billboard math (`BILLBOARD`, `DIRECTED`, `RAY`,
  `PLANE`, `FALLOFF`) is GLSL in `rendering/shaders/quad.ts`, so this is a rewrite, and it loses
  the instanced quad buffer.
- Translating the pixel stage alone. A custom material's pixel shader expects the outputs of its
  own vertex shader, so skipping that stage breaks the case #677 needs.

**The splice is a frontend text patch** in `src/modules/viewport/hexshade/`. The backend
translation does not change, and `PIPELINE_VERSION` stays. dxbc-spirv names an index-0 semantic
bare (`a_TEXCOORD`) and the rest with the index (`a_TEXCOORD1`). Varyings are
`v_<SEMANTIC><index>`.

**The define set is computed in TypeScript**, beside `EmitterModel`, which is what the renderer
already reads. The backend command takes a closed enum of engine particle shaders and a define
list, never a free path from the frontend.

**The hand-written materials stay.** They draw while the switch is off, while a program compiles,
and wherever a read fails. A failed read logs its reason, as a skin pass does.

**Engine buffers bind as per-material uniforms** (`EngineEnvironment` `"uniform"` mode, as
`Character` uses). WebView2 allows 24 uniform-buffer bindings, and a scene holds many emitters.

**Programs compile ahead of their first draw** through `renderer.compileAsync`. A translated pair
links in about 25 ms, so a scene with dozens of permutations would stall one frame otherwise.

## Tickets

### V1: shader defs for VFX custom materials

`resolve_system` takes the shader defs, and `read_vfx_system` passes them through
`shader_defs(&app_handle, assets)` in `src-tauri/src/commands/material.rs`. `linked_material` in
`resolve.rs` resolves against them instead of the VFX bin.

Done when a resolver test with a `CustomShaderDef` in a separate defs document resolves the
custom material's `shader` path, and the existing VFX tests pass.

### V2: the engine particle shader command

A `ParticleShader` enum in `crates/ltk-manager-game/src/program.rs` names each engine pair (quad,
fixed-alpha-uv quad, screen-space-uv quad, the slice variants, mesh, attached mesh), and maps each
to its `ShaderPath::Hlsl`. `read_particle_program(document, shader, defines, options)` answers a
`PassProgram`, built the way `read_default_skinned_program` builds `LIT_UBER`'s, with the studio
defines added through `define_list` under `MaterialKind::Particles`. Register it through
tauri-specta and regenerate the bindings.

Done when a unit test in `program/tests.rs` resolves the quad pair's define list, and an example
or test over the installed shader cache finds every file name the enum maps to.

### V3: the prelude and the quad path

- `spliceVertexProgram(glsl, prelude)` in `src/modules/viewport/hexshade/` turns the translated
  vertex shader's attributes into globals, renames its `main`, and appends the prelude's `main`.
- The quad prelude computes `a_POSITION` (the world-space corner), `a_COLOR` (BGRA, premultiplied
  for blend modes 0 and 2), `a_TEXCOORD` (base uv, frame, erosion drive) and `a_TEXCOORD1` (mult
  uv) from the instance attributes, with the math `rendering/shaders/quad.ts` uses today. The
  corner positions are in the engine's space. Check how `EngineEnvironment` folds the mesh's
  `matrixWorld` (the `AXIS_SIGN` mirror) into the clip transform.
- The engine buffers the quad pair reads are filled from the emitter model: `TEXTURE_INFO`,
  `TEXTURE_INFO_2`, `PARTICLE_DEPTH_PUSH_PULL`, `AlphaTestReferenceValue` and the erosion values.
  List them from the pair's sidecar rather than by guess.
- `Quads.tsx` draws with the program material while the switch is on and the program is ready,
  and with the hand-written material otherwise.

Done when, in a headless browser page (not the app), every `quad_vs` and `quad_ps` pair whose
signatures match links with the prelude, and the translated quad matches the hand-written quad on
fixed inputs for a set of permutations. The hand port was checked define by define against the
16.18 variants (`docs/plans/vfx-particle-renderer.md` section 2.50), which makes it the reference.
If the translated and hand-written quads disagree beyond sampling differences, stop and report:
the prelude is what this plan rests on.

A headless Edge page ran the check over the `particle_shaders` dump. All 32 define sets and the
four orientations match within 0.0014. The hand-written `FRAGMENT` alpha-tests after the soft fade,
as `quad_ps` does.

The prelude writes each layer's uv inside the atlas, with its cell already placed, frame 0 and an
identity `TEXTURE_INFO`. Each layer keeps the flipbook the simulation plays for it, where the
engine decomposes one frame number against both layers' grids. A custom vertex shader that
reads the frame reads 0.

### V4: define sets for every shipped emitter

`particleShaderOf(emitter)` in `rendering/utils/` answers the pair and the define set by the two
tables above. A gated sweep reads the VFX bins of a sample of champions and Map11, computes each
emitter's define set, and requires a TOC hit for every one. Where the four inferred rows are
wrong, the sweep shows it as misses.

Done when the unit tests pass and the sweep reports no miss.

### V5: custom materials on quads

An emitter whose `customMaterial` resolves reads its programs through `read_material_programs`
(`{ kind: "document" }`, or `{ kind: "file" }` for a material a linked file declares), and draws
every translated pass through `programPasses` and `passTwin`, spliced with the V3 prelude.
Runtime switches write their `switch_<NAME>` floats.

Done when a custom-material emitter draws with its translated passes, falls back to
`CUSTOM_FRAGMENT` on a failed read, and a unit test covers the runtime switch write.

### V6: meshes, ribbons and attached meshes

Ribbons and beams draw with the quad pair from a prelude over their CPU-built vertices. Meshes
draw with `mesh_vs` and `mesh_ps`, with a prelude over the `InstancedMesh` inputs. Attached
meshes draw with `skinnedmesh/particle_vs` and `particle_ps` on the skinned environment
`Character` uses.

The engine binds a mesh particle's members once a draw, and a draw is one particle. The mesh
prelude writes them per instance: `mWorld`, `kColorFactor`, both layers'
`vParticleUVTransform` rows, `COLOR_LOOKUP_UV` and the erosion drive in
`cAlphaErosionParams.x`. A stage reads a block through an accessor, which answers a member's
registers from the prelude, and the pixel stage's accessor from a flat varying. The prelude
states the vertex in the engine's space, so the reflection samples the cube map on the engine's
axes.

An attached mesh draws one slot per particle, so each slot writes its members as uniforms and
takes a separate environment. The environment folds a detached skin's transform into
the clip transform, as three draws it.

A custom material draws its translated passes on every path, a later pass on a twin of the
instanced mesh or of the slot's skin. On a mesh, the prelude binds a stage that reads the skin
streams wholly to bone 0, whose `BONES` rows are the particle's world over the vertex's pose, so
the stage deforms the vertex in the mesh's own space as the engine does. A skin's own bones
place an attached mesh's material.

The same headless check compares every quad and ribbon set, and every mesh and attached set
under the default uv mode, with the hand-written material, and the base and full mesh sets
posed by their bones and on the ground. A mesh set under another uv mode, which the hand port
draws differently, has to link and draw. 213 of 214 cases match within 4/255. The hand port
carries the rim and the reflection by the alpha before the erosion and saturates the colour after
the soft fade, as `mesh_ps` and `particle_ps` do. The case apart is a ground-layer mesh, whose
flattened faces tie in depth and differ at 2 of 662 pixels.

The check also draws 60 distinct custom materials from the survey on the paths their emitters
take, the mesh posed and unposed, and requires each to draw inside the silhouette the
hand-written material covers. 50 do. The rest draw what their shaders ask:
`depthCompareFunc` 0 draws nothing, a vertex deform in world units reaches past the silhouette,
and `HKG_RM_LavaLamp` discards outside blobs the fixture mesh does not reach. With the depth
test forced to less-equal, `HKG_Eyes_Blink_Mat` draws inside the silhouette.

### V7: soft particles and distortion

`SOFT_PARTICLES` binds `sDepthTexture` and `cDepthConversionParams` from the depth pre-pass in
`Passes.tsx`. The distortion pass draws with the `distortion_*` pairs and the scene colour copy.

A distorting emitter draws the distortion pair of its kind on `DISTORTION_LAYER`, with
`SAMPLER_BACK_BUFFER_COPY_SharedTexture` bound to `FRAME`. The pair reaches the copy at a D3D
screen coordinate, whose `v` runs down the screen, so the translation reads it with `v` turned
over. On quads, ribbons, meshes and skins, every distortion pair reads back the texel of a
known frame under each fragment at zero power, and at a known power the texel the engine's warp
reaches, right and down the screen.

## What stays out

- Material drivers and `dynamicMaterial` (#677).
- Fog of war, the navmesh mask, the colour-blind palette and the shadow pass.
- The mapgeo texture override list.
