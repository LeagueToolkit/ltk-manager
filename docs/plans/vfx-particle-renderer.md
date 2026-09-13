# VFX Particle Renderer — Implementation Plan

> Status: **T0, T1, T2, T3, T5's static half, T7 and T9 built** (2026-09-10), plus the preview rig
> of 2.9. Section 2.10 reorders the tiers against a survey of shipped data. Section 2.11 is what
> changed next: draw order, the alpha test, the depth flag, `EmitterPosition`, `LOCK_ALPHA` and the
> UV rates. Section 2.12 is what changed after that: the trail, the ray, the beam and the shape
> extents are now the engine's own builders. Section 2.13 is what changed next, together with what
> a review of the renderer found: the textures' colour space and `v`, the mesh alpha, the emitter's
> own frame and the system's orientation and transform. Of T8, the palette, the colour ramp, the
> linger and the alpha erosion are built. Section 2.14 is what changed of T5 and where child sets
> and emission surfaces now sit, T9 and T6.
> Section 2's decisions were settled with the maintainer over
> four rounds, and section 2.8's five over one more. Sections 1, 3 and 6 are evidence gathered the
> same day against this repository at `70df62a` (`feat/vfx-pane-layout`) and the LTK meta API's
> dataset of 2026-08-24.
> Section 4 is the work and section 5 is what precedes it.

A particle system opens in the bin editor as rows of numbers. This plan draws it.

Scope is one renderer, in ThreeJS, mounted in the shell's `preview` pane. The first milestone
draws camera-facing quads. Every tier past it is a primitive kind or a field group added to the
same evaluator.

## 1. Current state (verified 2026-09-08)

| Piece                           | Where                                            | Shape                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `preview` pane              | `src/modules/workshop/bin/shellPanes.ts`         | A registered `ShellPaneId` with an i18n label. Absent from `defaultShellLayout()`                                                                                                             |
| Pane content                    | `ShellPaneTree.tsx`, `ShellPaneContent`          | `Record<ShellPaneId, ShellPane>`. The `preview` key takes a component                                                                                                                         |
| Value families                  | `valueRows.ts`                                   | `ValueColor`, `ValueColorRgb`, `ValueFloat`, `ValueVector2`, `ValueVector3` decode to `CurveKey[]` and `ProbabilityTable[]`                                                                   |
| Channel naming and hue          | `curveChannels.ts`                               | `CHANNELS`, `STROKE`, `CHIP` per family                                                                                                                                                       |
| Bin commands                    | `src-tauri/src/commands/bin.rs`                  | `bin_open`, `bin_children`, `bin_read`, `class_schema`, `bin_close`                                                                                                                           |
| The projected read              | `useBinRead.ts`                                  | Level-by-level, batched under `READ_ROW_CAP` = 2000 rows                                                                                                                                      |
| Asset commands                  | `src-tauri/src/commands/preview.rs`              | `read_asset_info`, `save_asset_copy`. 56 lines                                                                                                                                                |
| The asset URI scheme            | `src-tauri/src/protocol.rs`, `main.rs:61`        | `ltk-asset`, registered asynchronous. Path is a base64url `AssetRef`, `?w=` picks a mipmap                                                                                                    |
| The asset URL helper            | `src/modules/workshop/preview/assetRef.ts`       | `previewUrl(asset, minWidth?)`, `assetKey`, `assetArchive`. No width answers full resolution                                                                                                  |
| Texture decode                  | `crates/ltk-manager-core/src/preview/texture.rs` | `render(bytes, min_width)`, `info(bytes)`. `ltk_texture` 0.6.0 with `intel-tex`, a dependency                                                                                                 |
| Archive reads                   | `ltk_manager_core::game_wads::WadCache`          | A four-entry LRU over mounted archives                                                                                                                                                        |
| `AssetRef`                      | `crates/ltk-manager-core/src/preview/source.rs`  | `Layer`, `GameChunk { wad, pathHash }`, `File`. Bound into `@/lib/tauri`                                                                                                                      |
| Texture prior art in the editor | `TextureSwatch.tsx`                              | Draws a chunk's pixels at row height off `previewUrl`                                                                                                                                         |
| Mesh                            | `ltk_mesh`                                       | `skinned/` (`.skn`) and `static/` (`.scb`, `.sco`). Not a dependency                                                                                                                          |
| Animation                       | `ltk_anim`                                       | Compressed and uncompressed assets, joints, an evaluator. Not a dependency                                                                                                                    |
| league-toolkit deps             | `Cargo.toml`                                     | `ltk_wad` 0.5.4, `ltk_texture` 0.6.0, `ltk_file`, `ltk_hash`, `ltk_meta`, `ltk_rst`, `ltk_hashtable`. `ltk_meta`, `ltk_hash`, `ltk_io_ext` and `ltk_primitives` are patched to rev `0bc9d0ea` |
| ThreeJS                         | —                                                | Absent                                                                                                                                                                                        |

`READ_ROW_CAP` bounds one projected read at 2000 rows. One `VfxSystemDefinitionData` carries a
list of emitters, each with 139 properties, each property a nested value class. The pane's read
is a separate command rather than a batch of projected reads.

## 2. Decisions

### 2.1 Rust resolves references. TypeScript evaluates them

`read_vfx_system(asset, objectHash)` walks the object subtree in one call and returns the
existing `BinValue` tree. Four things happen in Rust:

- `Pointer<...>` and `Link<...>` are chased to their targets
- `texture`, `falloffTexture`, `particleColorTexture`, `emissionMeshName` and
  `VfxMeshDefinitionData`'s three name fields resolve to an `AssetRef` each
- `primitive` resolves to its concrete class hash
- Values are otherwise untouched

The mapper is TypeScript, beside `valueRows.ts`, on the same `nameHash()` the editor's rows
already use. Curve keys stay keys. Sampling, integration and rendering are one language.

A pre-sampled lookup table cannot round-trip a curve's key times. `IntegratedValueFloat` and
`IntegratedValueVector2` accumulate rather than sample, and a probability table is drawn from
rather than interpolated.

### 2.2 A texture reaches the GPU on the `ltk-asset` scheme

`previewUrl(assetRef)` with no width answers a full-resolution URL. `THREE.TextureLoader` takes
it. The pixels never cross the JavaScript heap, `WadCache` holds the archive open, and the
webview caches the response.

The renderer adds no protocol and no decode path. `TextureSwatch` draws the same chunks through
the same helper.

The scheme is the seam and the payload is swappable. Raw BCn blocks answered to a
`THREE.CompressedTexture` are a change inside `protocol::serve` and its `preview` module.

### 2.3 The stepper is pluggable

```ts
interface Stepper {
  advance(frameTime: number): Step[];
}
```

`VariableStepper` yields one step per frame. `FixedRateStepper` banks frame time and spends it
in whole steps of `1 / rate`, interpolating the system position across them, clamping a step's
spawn count at `rate / 3 + 1`. The integrator takes `Step[]` and knows neither.

Frame accuracy is the target. The variable stepper is what the first tiers run on.

### 2.4 The viewport is the `preview` pane

`ShellPaneContent`'s `preview` key takes the viewport component. ADR-0034 makes a fifth pane one
id and one registry entry, and `preview` is already the fourth. `defaultShellLayout()` gains the
pane.

### 2.5 An edit swaps the definition and keeps the pool

The emitter instance holds a pointer to its definition. A new snapshot replaces that pointer.
Live particles keep their birth values and their positions. The next appearance pass reads the
new definition.

This is the shape of the engine's own override table: a value is transformed in place at
evaluation time, and the particle pool is not consulted.

### 2.6 The simulation is seeded

One seeded xorshift per system. The engine's own unit-float generator is a xorshift64 returning
`[0, 1)`. Every roll draws from the seeded stream in a fixed order: birth values, `startFrame`
under `isRandomStartFrame`, `ChanceToNotExist`, the noise field's unit vectors.

A time is reached by advancing from zero. A scrub bar, a reproducible screenshot and a snapshot
test over the pool follow from that. `Math.random()` appears nowhere in the simulation path.

### 2.7 The ground is a textured plane

A plane at champion scale, textured with a ground texture taken from a real map, plus a grid and
an axis gizmo. Its height is what `isFollowingTerrain` and `isGroundLayer` read.

No host model. `.skn`, `.skl` and `.anm` belong to T6.

### 2.8 What T0 settled

Five questions T0 reaches that the four rounds did not cover.

| Question                | Answer                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| The ThreeJS binding     | `@react-three/fiber`. The scene is JSX and the particle buffers are written in `useFrame`     |
| Bundle weight           | `VfxViewport` is a lazy chunk, warmed by an effect as soon as a system opens                  |
| `read_vfx_system`'s key | `BinDocumentId` and the object hash, which is what decision 2.5's hot swap reads              |
| One emitter or all      | The whole system, the strip's selection at full alpha and the rest at 35%, with a Solo toggle |
| Spawn shapes            | Absent from T0. Every particle is born at the emitter's origin, and T3 is where that changes  |

### 2.9 A rig drives the system, because the file does not

A `VfxSystemDefinitionData` describes emitters and says nothing about where the effect goes. The
engine keeps that on a system instance separate from the definition, which carries an attachment
point, a target attachment point and a kill flag, and drives the system's position from them each
frame. Attachment is either fixed-world or bone-wrap.
What makes an effect a missile is the spell script that flies that instance, not a field in the
bin.

A preview has no script, so the reader picks. The **rig** is a motion and a lifecycle:

| Part      | Values                                                      |
| --------- | ----------------------------------------------------------- |
| `Motion`  | `still`, `path` (from, to, speed), `orbit` (radius, period) |
| `RigLife` | `once`, `loop`                                              |

Named behaviours are presets over that pair rather than cases in the evaluator. Still is `still` and
`once`, Burst is `still` and `loop`, Missile is `path` and `loop`, Trail is `orbit` and `once`. A
looping run restarts on `runLength`, which for a path is the flight time, because a missile's system
dies where the missile lands, and for everything else is the system's own span.

**Where a run stands is read off the clock, never stored.** `phaseAt` is `time` for a rig that plays
once and `time % runLength` for one that loops, so nothing the rig remembers about when the reader
picked it can make a play and a seek disagree, which decision 2.6 does not allow. A rig that counted
from where it was bound would put the scrub and the transport at different points of the loop, and
would drift by the overshoot of a frame on every cycle.

The rig lives on the driver rather than the model. Changing the **motion** restarts, because asking
for a different motion is asking to watch a different thing rather than to join one part-way along a
path it never travelled. Tuning a **parameter** of the motion in hand keeps the pool, on the reason
decision 2.5 keeps it across an edit, so a drag along a slider moves what it is describing.

The scrub spans `max(systemSpan, runLength)`, so a flight longer than the effect is reachable.

`flightPath` centres its path on the origin at half a champion's height, so an effect authored about
its own origin is on screen for the whole run and clears the ground plane. The path's direction is
not a control: the reader orbits the camera instead.

**A moving origin alone draws no trail**, which is why `bindWeight` (`0xca406316`) joined the field
set. It blends a particle between emitter space and world space: zero anchors it where it
was born, so a system flying a path lays a trail behind it, and one carries it along. The meta
schema's default is a constant `0.0`, so a still rig changes nothing about how a system already
drew. It is sampled once per emitter against the emitter's life rather than per particle, which is
where `acceleration` and `drag` are already read, and is a coarser reading than the per-particle
world transform pass the engine folds it into.

What the rig does not carry yet: a **target** a reader can place, so a missile's path is a distance
and a speed, and what a beam reaches for is where the path lands (`targetAt`). `EmitterPosition`
and `IsEmitterSpace` are read since 2.11, and a particle is born at the origin plus the emitter's
own offset in either space. The rig can also **stop** the system, `stopAt`, which is what the
linger of "What of T8 is built" waits on.

## 3. Reference

### 3.1 The primitive kind is `ParticleSystem::QUAD_TYPE`

Primitive behaviour indexes by a number with no name of its own. The number is this enum.

| kind | name                  | meta class                      | behaviour                                                               |
| ---- | --------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| 0    | `CAMERAQUAD`          | `VfxPrimitiveCameraQuad`        | —                                                                       |
| 1    | `ARBITRARYQUAD`       | `VfxPrimitiveArbitraryQuad`     | `isDirectionOriented` applies                                           |
| 2    | `RAY`                 | `VfxPrimitiveRay`               | —                                                                       |
| 3    | `MESH`                | `VfxPrimitiveMesh`              | `isDirectionOriented` applies                                           |
| 4    | `CAMERATRAIL`         | `VfxPrimitiveCameraTrail`       | —                                                                       |
| 5    | `ARBITRARYTRAIL`      | `VfxPrimitiveArbitraryTrail`    | —                                                                       |
| 6    | `BEAM`                | `VfxPrimitiveBeam`              | Folds one further colour factor from the primitive sub-object           |
| 7    | `PLANAR_PROJECTION`   | `VfxPrimitivePlanarProjection`  | —                                                                       |
| 8    | `CAMERA_UNIT_QUAD`    | `VfxPrimitiveCameraUnitQuad`    | The camera quad's builder at half the factor, so it spans `scale0` once |
| 9    | `CAMERA_SEGMENT_BEAM` | `VfxPrimitiveCameraSegmentBeam` | Folds one further colour factor. Excluded from direction orientation    |
| 11   | `ATTACHED_MESH`       | `VfxPrimitiveAttachedMesh`      | `isDirectionOriented` applies. Orientation comes from the attachment    |

The direction-orientation mask `((kind - 1) & 0xF5) == 0 && kind != 9` selects exactly
`{1, 3, 11}`. Three further kinds exist that the renderer draws nothing for: 12, and
`VfxPrimitiveLaser` at 14 and `VfxPrimitiveRibbon` at 15, which only a bin authors and no
primitive factory produces. `VfxPrimitiveNonRenderable` is the concrete class the meta tree
carries without a kind.

### 3.2 Enums

The engine names these enums as follows.

```
blendMode : U8                        ParticleSystem::BLEND_MODE
  0 ADD              3 NONE             6 MIN
  1 ALPHA            4 ALPHAADD         7 MAX
  2 SUBTRACT         5 PREMULTIPLIEDALPHA  8 TARGETALPHA

uvMode : U8                           ParticleSystem::UV_MODE
  0 DEFAULT          2 LOCK_ALPHA       4 LOCAL_SPACE_MULT
  1 SCREEN_SPACE     3 LOCAL_SPACE      5 LOCAL_SPACE_BOTH

texAddressModeBase : U8               ParticleSystem::TEXTUREADDRESS
  0 WRAP   1 MIRROR   2 CLAMP   3 BORDER

colorLookUpTypeX / colorLookUpTypeY : U8   ParticleSystem::COLOR_LOOKUP_TYPE
  0 CONSTANT   1 LIFETIME   2 VELOCITY   3 BIRTH_RANDOM

renderPhaseOverride : U8              ParticleSystem::RENDER_MODE
  0 DEFAULT          3 DISTORTION_ALL   6 HUD_LAYER
  1 SHADOW           4 POST_DISTORTION  7 NOT_SET
  2 DISTORTION_NO_CHARACTER            5 GROUND_LAYER

stencilMode : U8                      ParticleSystem::StencilMode
  0 kDisabled   1 kWriteMask   2 kTestEqual
  3 kTestNotEqual   4 kWriteMaskIfTestNotEqual

particleLingerType : U8               VfxEmitterDefinitionData::ParticleLingerType
  0 kMaxLifetimeAfterEmitterDies
  1 kFixedLifetimeAfterEmitterDies
  2 kFixedLifetimeAfterEmitterStops

importance : U8                       ParticleSystem::IMPORTANCE
  0 LOW   1 MEDIUM   2 HIGH   3 NOT_WHEN_HIGH   4 NOT_WHEN_LOW

colorblindVisibility : U8             ParticleSystem::COLORBLIND_VISIBILITY
  0 ALWAYS   1 ONLY_ON_DEFAULT   2 ONLY_ON_COLORBLIND

offsetLifeScalingSymmetryMode : U8    ParticleSystem::SYMMETRY_MODE  [flags]
  0x1 X_SYMMETRY   0x2 Y_SYMMETRY   0x4 Z_SYMMETRY
```

Three render-flag fields are single-bit:

```
colorRenderFlags : U8    0x1 APPLY_TEAM_COLOR_CORRECTION
meshRenderFlags  : U8    0x1 FORCE_ANIMATED_MESH_ZWRITE
miscRenderFlags  : U8    0x1 DISABLE_ZBUFFER   0x2 PROJECTED   0x4 DISABLE_FOW
```

On the system, `DrawingLayer` is `ParticleSystem` (`0 NORMAL`, `1 HUD`) and `ClockToUse` is
`ParticleSystem::CLOCK` (`0 AUTO`, `1 GAME`, `2 SYSTEM`).

Flag words:

```
VfxEmitterDefinitionData::BooleanStates
  0x2   kParticleIsLocalOrientation    0x1000       kIsGroundLayer
  0x4   kIsDirectionOriented           0x2000       kUseEmissionMeshNormalForBirth
  0x8   kIsUniformScale                0x4000       kUseNavmeshMask
  0x10  kHasPostRotateOrientation      0x8000       kParticlesShareRandomValue
  0x20  kIsRandomStartFrame            0x10000      kSortEmittersByPos
  0x80  kDoesCastShadow                0x80000000   kWriteAlphaOnly
  0x100 kIsRotationEnabled
  0x200 kUVScrollClamp
  0x800 kIsFollowingTerrain

VfxLingerDefinitionData::VfxLingerToggles
  0x1 kUseLingerRotation      0x8  kUseKeyedLingerDrag
  0x2 kUseLingerScale         0x10 kUseKeyedLingerVelocity
  0x4 kUseKeyedLingerAcceleration    0x20 kUseSeparateLingerColor

VfxTextureMultDefinitionData::TextureMultControlBitFlags
  0x1 kUVScrollAlphaMult   0x4 kFlipTextureMultU   0x10 kIsRandomStartFrameMult
  0x2 kUVScrollClampMult   0x8 kFlipTextureMultV
```

Seven further bits the meta dump carries are absent from the names above: `0x1` (unnamed,
`0xd1ee8634`), `0x20000` `IsEmitterSpace`, `0x80000` `HasVariableStartTime`, `0x100000`
`isSingleParticle`, `0x200000` `isLocalOrientation`, `0x20000000` `doesParticleLifetimeScale`,
`0x40000000` `doesLifetimeScale`.

The system flags word (`VfxSystemDefinitionData.flags`) is `ParticleSystem::GROUP_FLAG` for its
first nine bits:

```
0x1   FLAG_SIMULATE_WHILE_OFF_SCREEN     0x20  FLAG_SOUNDS_PLAY_WHILE_OFF_SCREEN
0x2   FLAG_RENDER_THRU_DEATH             0x40  FLAG_SIMULATE_EVERY_FRAME
0x4   FLAG_RENDER_THRU_REVIVE            0x80  FLAG_KEEP_ORIENTATION_AFTER_SPELL_CAST
0x8   FLAG_SIMULATE_ONCE_PER_FRAME       0x100 FLAG_USE_CALCULUS_FOR_PHYSICS
0x10  FLAG_SOUNDS_END_ON_EMITTER_END
```

`0x100` is the analytic-drag path: velocity zeroes at birth, and the motion follows a closed form
toward `birthVelocity / drag`. Bits `0x200`, `0x400` and `0x800` are bin-only.

Enums for later tiers: `TRAIL_MODE`, `BEAM_MODE`, `TrailSmoothingMode`, `DISTORT_MODE`,
`FIXED_ORBIT_TYPE`, `ParentInheritanceMode`, `CensorPolicy`,
`VfxMaterialOverrideDefinitionData::MaterialOverrideBlendMode`, `VfxMaterialDriverFrequency`,
`VfxAssetRemapType`. `StaticMaterialPassDef::BlendEquation`, `BlendFactor` and `StencilOp` cover
`CustomMaterial`.

### 3.3 The T0 field set

Fifteen of `VfxEmitterDefinitionData`'s 139 properties.

```
Emission     rate                     Embed<ValueFloat>
             particleLifetime         Embed<ValueFloat>
             lifetime                 Option<F32>
             timeBeforeFirstEmission  F32
             isSingleParticle         Flag
Motion       birthVelocity            Embed<ValueVector3>
             acceleration             Embed<ValueVector3>
             drag                     Embed<ValueVector3>
Appearance   scale0                   Embed<ValueVector3>
             birthScale0              Embed<ValueVector3>
             Color                    Embed<ValueColor>
             birthColor               Embed<ValueColor>
Render       texture                  String    -> AssetRef
             blendMode                U8
             primitive                Pointer<VfxLegacyPrimitiveBase>
```

`emitterName`, `disabled` and `importance` are read by the emitter strip rather than the
renderer.

### 3.4 Curve sampling

`ParticleSystem::CurveDriveParameter` has two members, `kParticleLifetime` and
`kEmitterLifetime`. A curve's normalized time has two possible denominators. The sampler takes
the denominator as an argument.

The appearance pass computes `age01 = clamp01((now - birthTime) / lifetime)` for the particle
case. `IntegratedValueFloat` and `IntegratedValueVector2` accumulate rather than sample.
`rotation0` is authored per `1 / 60` second, and the engine multiplies by `60.0`. That scale is
`rotation0`'s alone: the UV rates are `curve(age01) * lifetime` with no multiplier.

The UV transform:

```
uv      = clampOrWrap(birthUVOffset + age * birthUvScrollRate)
        + curve(particleUVScrollRate, age01) * lifetime
degrees = uvRotation + age * birthUvRotateRate + curve(particleUVRotateRate, age01) * lifetime
```

`uvScrollClamp` clamps the ramp to `[-1, 1]` and otherwise it wraps. The integrated term is never
clamped. Emitter UV scroll is `now * emitterUvScrollRate`, absolute time times rate, with no
accumulator.

**Probability tables are birth multipliers.** A curve's `dynamics.probabilityTables` holds one
nullable `VfxProbabilityTableData { keyTimes, keyValues, singleValue }` per channel. At birth,
`drawCurve` draws one unit off the particle's stream per table, reads the table's keys at that
draw and multiplies the result into the channel. That is why shipped data authors an
`emitRotationAngles` constant of `1.0` under a table of `1` to `360`, a `birthVelocity` of
`(-400, 0, 0)` under tables of `0..1`, `0.3..1` and `-1..1`, and a `birthRotation0` of
`(1, 1, 0)` under a single key of `90` and a table of `1..360`. A multiplier is the reading under
which those constants make sense. Only a birth-sampled curve draws: `particleLifetime`, the
birth values, the birth UV fields, the legacy shape's offset and angles.

**Rotations are degrees.** `birthRotation0`, `rotation0`, `birthRotationalVelocity0` and
`birthRotationalAcceleration0` are authored in degrees, which the `90` and `1..360` tables above
show, and the pool holds degrees until the draw converts. The two angular fields are
`(birthRotationalVelocity0 + birthRotationalAcceleration0 * 0.5 * age) * age`, applied to every
particle, where `rotation0` alone waits on `isRotationEnabled`.

## 4. Tiers

### T0 — camera quads

The milestone. A recognizable preview of a simple effect.

```
src-tauri/
'-- src/commands/vfx.rs          read_vfx_system
crates/ltk-manager-core/src/
'-- vfx/
    |-- mod.rs
    '-- resolve.rs               pointer chase, asset path -> AssetRef
src/modules/workshop/bin/vfx/
|-- readVfxSystem.ts             the hash-to-model mapper
|-- sampleCurve.ts               CurveKey[] + drive parameter -> value
|-- Rng.ts                       seeded xorshift
|-- stepper.ts                   Stepper, VariableStepper
|-- integrate.ts                 the per-particle step
|-- pool.ts                      parallel arrays, one index per particle
|-- quadMaterial.ts              the 9 blend modes, the 4 orientations
|-- VfxViewport.tsx              the ThreeJS canvas, grid, ground, gizmo
'-- Timeline.tsx                 scrub, play, pause, seed
```

Contents beyond the field set: the four `ORIENTATION` modes, both `CurveDriveParameter`
denominators, back-to-front depth sort with `depthWrite` off for the alpha modes,
`depthBiasFactors` and `DepthPushPull`, the `preview` pane wired into `ShellPaneContent` and
`defaultShellLayout()`, and hot-swap on an edit.

Three fields past the fifteen came with the arbitrary quad, which shipped drawn alongside the
camera quad: `rotation0` as an `IntegratedValueVector3`, `birthRotation0`, and the
`isRotationEnabled` and `isDirectionOriented` flags.

The texture path is `previewUrl` and the archive read is `WadCache`. Neither is new work.

Estimate 2 to 3 weeks.

#### What T0 left

Four of that list stand differently from how it reads.

- **Orientation is a basis, not a mode.** `ParticleSystem::ORIENTATION` names four values and no
  shipped class carries a field of that type: every `VfxPrimitive*` under
  `VfxLegacyPrimitiveBase` declares no properties at all and is a kind marker alone. What
  actually turns a quad is the matrix construction of section 8.2 — `birthRotation0` and
  `rotation0` build a basis, and `isDirectionOriented` replaces it with one whose up is the
  particle's travel. Both quad kinds draw: `CAMERAQUAD` faces the eye and takes only the roll,
  and `ARBITRARYQUAD` stands in the world on that basis.
- **The sampler takes a normalized time rather than a denominator.** Section 3.4 asks for the
  denominator as an argument, and `sampleCurve(value, t01)` takes the quotient instead, because
  the caller is the only side that knows which lifetime drives the field.
- **A probability table is still not drawn from.** `pool.roll` holds the draw decision 2.6
  reserves for it, and nothing reads it. What the engine samples from one of these tables is not
  established, so drawing from it would be a guess. Every particle of an emitter is therefore
  identical where the file keys no curve.
- **`depthBiasFactors` is a polygon offset and `DepthPushPull` a step along the view's forward
  axis.** The engine folds both into one depth term, not spelled out here.

Both of section 5's checks are still open: the calibration screenshot, and the `materialDrivers`
and `CustomMaterial` survey.

### 2.10 The tiers are ordered by what the data carries

A survey over `data/characters` of the 16.17 dump — 2654 bins, 15,574
`VfxEmitterDefinitionData` instances, none unreadable — counts how many emitters write each
field. A bin serializes only what differs from the schema default, which five spot checks
confirmed: `pass`, `miscRenderFlags`, `alphaRef`, `isUniformScale` and `particleLinger` were
off-default in every instance that wrote them. `crates/ltk-manager-core/examples/survey_vfx.rs`
is the tool, and it takes any directory of bins.

| Field                       | Emitters | Share | Tier      |
| --------------------------- | -------: | ----: | --------- |
| `pass`                      |   11,820 | 75.9% | 2.11      |
| `isUniformScale`            |    9,333 | 59.9% | —         |
| `particleLinger` above zero |    8,665 | 55.6% | —         |
| `EmitterPosition`           |    8,299 | 53.3% | 2.11      |
| `SpawnShape`                |    8,039 | 51.6% | T3, built |
| `miscRenderFlags`           |    5,681 | 36.5% | 2.11      |
| `birthDrag`                 |    5,056 | 32.5% | —         |
| `alphaRef`                  |    4,981 | 32.0% | 2.11      |
| `texDiv` cutting an atlas   |    4,645 | 29.8% | T1        |
| `alphaErosionDefinition`    |    3,756 | 24.1% | T8, built |
| `textureMult`               |    3,353 | 21.5% | T2        |
| `worldAcceleration`         |    2,702 | 17.3% | 2.23      |
| `fieldCollectionDefinition` |      403 |  2.6% | T4        |

Two readings follow. **T1's flipbook half is the worst thing on screen**, because 4,645
emitters declare an atlas and a renderer that samples the whole texture draws every cell of it
shrunk onto one quad, which is not an approximation of the effect but a different image.
**T4 belongs at the bottom**: three to four days and three documented traps, for 2.6% of
emitters.

`frameRate` is 2.5% against `texDiv`'s 31.3%, so a flipbook is overwhelmingly a cell picked at
birth rather than one played through, and the sub-rect is what matters rather than the
playback.

### 2.11 The readings replaced the guesses

These readings replaced guesses about render state and UV handling with the engine's own
behaviour. What each changed in the renderer:

| Question                  | Reading                                                                                                                                                                                   | Where it landed                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pass`                    | The first draw-order key, a signed i16 ascending, above the blend rank `{1,2,1,0,2,2,2,2,3}`, then `miscRenderFlags` as a byte, then file order. A relative priority, never a pass index  | `drawRanks` in `model.ts`, `renderOrder` on every emitter's mesh                                                 |
| `miscRenderFlags`         | Three bits. `0x1` turns the depth test off, `0x2` makes the emitter unbatchable, `0x4` emits a fog-of-war define. Nothing above `0x4` is authored anywhere                                | `fragmentTests` turns the depth test off under `0x1`. The other two draw nothing different                       |
| The `IntegratedValue` 60x | `rotation0` alone. The UV rates carry no scale and are `curve(age01) * lifetime`, which per-step accumulation equals. `uvRotation` and both rotate rates are degrees                      | `ROTATION_RATE`, `scroll()` in `integrate.ts`, `uvTransformInto`                                                 |
| `UV_MODE`                 | `LOCK_ALPHA` samples the alpha at the quad's raw corner. `SCREEN_SPACE` is the NDC through the transform plus a parallax term. `LOCAL_SPACE*` are mesh-only, one define and two selectors | The `lockAlpha` uniform. The other four still draw as `DEFAULT`                                                  |
| `uvScrollAlphaMult`       | Dead. Written by the loader, read by nothing, and the shipped shaders multiply all four channels                                                                                          | Not read                                                                                                         |
| The mult layer's book     | One frame counter serves both layers, and `isRandomStartFrameMult` is dead too. A random start is `rand * numFrames` as a float, and the run wraps before `startFrame` is added           | `readLayer` shares `randomStart`, and `bornUv` and `uvTransformInto` follow the formula                          |
| `alphaRef`                | A 0 to 255 byte over 255. `0` compiles the test out, and the fragment is discarded where the composited alpha is strictly below                                                           | The `alphaRef` uniform in both fragment shaders                                                                  |
| `particleLinger`          | Seconds, and the window the linger overrides sweep, because the deadline and the denominator are one value. Types 0 and 1 wait for a system stop, which the rig now issues                | `settle` in `integrate.ts`, `lingerSeconds`, and the rig's `stopAt`. "What of T8 is built" under T8              |
| `EmitterPosition`         | `IsEmitterSpace` picks the space the particle is stored in, and both paths apply the offset: clear bakes it in at birth, set re-adds it every frame                                       | `emitterMotion` and `emit` in `integrate.ts`. The set path adds the step's change, which lands in the same place |

Two corrections came with the answers. `uvScrollClamp` clamps the birth ramp alone, to `[-1, 1]`,
and the integrated term is added after and never clamped. The shader had been clamping the whole
coordinate to one cell, which is now the layer's own `TEXTUREADDRESS`. And the emitter's frame ran
`fmod(start + t, numFrames)` where the engine runs `start + fmod(t, numFrames)`, so a book with a
`startFrame` had been wrapping back to the grid's first cell rather than to its own.

Recorded rather than built: `SCREEN_SPACE` needs the NDC-to-UV mapping the shader applies before it
can be drawn. `worldAcceleration` was recorded here and is now built, section 2.23.

### 2.12 The ribbon readings replaced the rest

These readings replaced the rest of the guesses, about ribbons, rays and beams, and correct the
spawn-shape table. What each changed:

| Question                     | Reading                                                                                                                                                                                                                                                                                                                                   | Where it landed                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A trail's points             | A particle each, walked in birth order, `scale0.x` the half-width per point. A camera trail expands across the view and its tangent, an arbitrary one along the particle's own `+X`                                                                                                                                                       | `writeTrail` in `ribbon.ts`, `Trails.tsx`, and `basis.ts` for the particle's axes                                |
| `mMode`                      | `WAKE` runs `u` on the emitter's odometer at each particle's birth, so the texture is pinned to the path. `DEFAULT` re-measures the ribbon each frame. Shipped data authors `WAKE` alone, 91,396 objects                                                                                                                                  | `EmitterState.travelled`, `pool.odometer`, stamped in `emit()`                                                   |
| `mSmoothingMode`             | The walk's direction: `BackToFront` runs oldest to newest, the others newest to oldest, which is where `u` opens and `mCutoff` truncates. Either on mode box-filters interior points over three neighbours a side and miters each joint to the bisector. Mode 2 also narrows the width on a sharp turn against a threshold not identified | The walk, the filter and the miter in `writeTrail`. The width adaptation is not built, for want of its threshold |
| `mCutoff`                    | Truncates at that walked length from the walk's start, and never the first point. Not a gap test                                                                                                                                                                                                                                          | `writeTrail`                                                                                                     |
| Trail UV                     | `u = numerator / tiling.x`, zero at or below zero tiling rather than stretched. `v` spans `0.5 ± halfWidth / tiling.y / 2`, one repeat at zero, a literal `-y` below. Both through the particle's 2x3 transform. `mBirthTilingSize` draws per particle at birth, `z` dropped. The first point's even part is subtracted from every `u`    | `pool.tiling`, `packUv` and the affine in `ribbon.ts`, the `cell` attribute on the ribbon material               |
| `mMaxAddedPerFrame`          | The last step of the spawn count: `count >= n` returns `n`                                                                                                                                                                                                                                                                                | `emit()` in `integrate.ts`                                                                                       |
| A ray                        | Lies along the particle's own `+Z` after its whole orientation, never its velocity, and kind 2 is excluded from `isDirectionOriented`. `scale0.x` across, `.y` along, `.z` where the near edge starts. Rolls about the axis to face the eye                                                                                               | The ray branch of the quad vertex shader, and `size` as three                                                    |
| A beam's ends                | Both the system's: its position plus `mLocalSpaceSourceOffset`, its target plus `mLocalSpaceTargetOffset`. The particle contributes nothing, so every particle draws one segment                                                                                                                                                          | `writeBeam` in `ribbon.ts`, `Beams.tsx`, `Driver.origin`                                                         |
| `mMode` on a beam            | `DEFAULT` faces the eye. `ARBITRARY`, the only value authored, is `cross(L, +Y)` run through the particle's local matrix as a point and left unnormalised, so a near-vertical beam collapses and the particle's position leaks into the width                                                                                             | `writeBeam`, both paths, the leak included                                                                       |
| `scale0` on a beam           | `x` the width. `y` and `z` trim the quad in from the source and the target as shares of the length. UV: `width / tiling.x` across, the full length `/ tiling.y` along, a component at or below zero spanning one                                                                                                                          | `writeBeam`                                                                                                      |
| `mIsColorBindedWithDistance` | `mAnimatedColorWithDistance` sampled at the raw distance between the two anchors in engine units, one colour for the whole beam, only under the flag. Not a position along the beam                                                                                                                                                       | `Beams.tsx`                                                                                                      |
| `mSegments`                  | Inert on `VfxPrimitiveBeam`, which draws one quad per particle. Only the camera segment beam reads it, as ribs the particles stand in for                                                                                                                                                                                                 | Read and not applied. The segment beam draws as the plain beam, and its ribs are not built                       |
| `mMesh` on a beam            | Suppresses the ribbon, and the mesh draw dispatch excludes the kind, so nothing draws (inferred)                                                                                                                                                                                                                                          | `drawsAsBeam` refuses an emitter whose beam names a mesh                                                         |
| `mTrailMode`                 | No consumer                                                                                                                                                                                                                                                                                                                               | Read and not applied                                                                                             |
| Shape ranges                 | `Size` is half-extents, `-1..+1` per axis, and so is a cylinder's radius. A cylinder's `height` is one-sided, `0..height` up from the emitter. A volume cylinder's radial draw is `-1..+1` too                                                                                                                                            | `sampleShape`, the cylinder case                                                                                 |
| Shape angles                 | Cylinder about `+Y` by a full turn. Sphere about `+Y` then `+Z`, both full, on a vector along `+X`, so the first is the polar angle and the second the azimuth, and the shell piles up at the poles. Box by quarter turns in the same order, skipped under `flags & 1`. Every distribution is naive and is reproduced                     | As built, kept                                                                                                   |
| `flags & 1`                  | Interior against boundary. Authored on 101,615 boxes and 56,021 cylinders and no sphere, so every shipped sphere is a shell                                                                                                                                                                                                               | As built, kept                                                                                                   |

Two readings go beyond what is directly attested. The camera trail's `cameraVec` is a per-frame
constant and is read as the view direction, since a position would cross to nothing. The beam's
uv rect is taken through the particle's 2x3 transform as the trail's is, on the trail's own
evidence, though the beam does not settle it either way.

### 2.13 The palette and erosion readings, and what a review found

These readings cover the palette shader, the probability tables, the simple emitter and the
alpha erosion shader. The same day, a review of the renderer turned up what the earlier tiers had
built wrong. What each changed:

| Subject                          | Reading                                                                                                                                                                                                                                                                                                                                                           | Where it landed                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The erosion shader               | `m = saturate(dot(map, mixer))`, `alpha *= saturate((drive - m + width) / featherIn) - saturate((drive - m) / featherOut)`. Linear ramps, not smoothstep. The band runs from `drive - featherOut` to `drive + width`, so at the drive the alpha is already whole, and a value past the far edge is cut. RGB is never scaled. Runs before the alpha test           | `ERODE` in `quadMaterial.ts`, the rates inverted in `erosionUniforms`                                                           |
| The erosion sampler              | The map is read at the base layer's own uv. `erosionMapAddressMode` reaches the sampler unremapped, whose enum swaps mirror and clamp, so an authored clamp, the default, samples as a mirror                                                                                                                                                                     | `erosionAddressMode` in `readVfxSystem.ts`                                                                                      |
| What erosion removes             | `ALPHA_EROSION` and `MULT_PASS` each drop the `particleColorTexture` ramp from the colour pass, and neither touches the palette                                                                                                                                                                                                                                   | `hasRamp` in `quadMaterial()`                                                                                                   |
| The palette shader               | `u = saturate(dp4(texel, palleteSrcMixColor)) + PaletteUAnimationCurve`, `v = (paletteSelector.x + 0.5) / paletteCount + PaletteVAnimationCurve`. The palette replaces RGB and keeps the texel's alpha. Every term but `u` is a uniform, the selector sampled at zero and the two curves at the emitter's phase, so a palette is one colour per emitter per frame | `palette.ts` for the uniforms, the palette block of the quad fragment, `paletteScrollInto` per frame in `Quads.tsx`             |
| The colour lookup                | `colorLookUpTypeX` and `Y` never touch the palette. They place the `particleColorTexture` ramp: `CONSTANT` reads the scale alone, `LIFETIME` `s * age01 + o`, `VELOCITY` `s *                                                                                                                                                                                     | drift + velocity                                                                                                                | + o`divided by nothing,`BIRTH_RANDOM` `s * roll + o` off the sprite's own draw. Sampled clamped, multiplied after the palette | `colorLookup.ts`, the `lookup` attribute, `mapRamp` in the quad fragment, `particleColorTexture` on the model. Quads alone, a mesh reads it as a per-emitter uniform |
| The simple emitter's plane       | `orientation` picks a fixed plane: `CAMERA` the screen's, `WORLD_X` `U=+Y, V=-Z`, `WORLD_Y` `U=+X, V=-Z` flat on the ground, `WORLD_Z` `U=+Y, V=+X`. The quad is `P +/- A +/- B` with `A = U * scale * scaleBias.y` and `B = V * scale * scaleBias.x`, so the size is a half-extent, and the spin is in that plane in whole degrees                               | The `plane` path of the quad vertex shader, `reach` for the half-extent, `spinOf` for the whole degrees                         |
| The simple emitter's scroll      | `uvScrollRate` is a pan of the whole layer, `frac(t * rate)` on every vertex, with no birth phase                                                                                                                                                                                                                                                                 | Lowered onto `emitterUvScrollRate` rather than the birth scroll                                                                 |
| What the simple emitter skips    | `fixedOrbitType`, `lockedToEmitter` and `scaleUpFromOrigin` are authored nowhere in the game and `hasFixedOrbit` in six objects. `particleBind` is a Y-only ramp off a provider not established                                                                                                                                                                   | Carried and not drawn                                                                                                           |
| Probability tables               | The factor multiplies, never replaces or adds. One chance per particle serves every channel of every birth value. `keyTimes` is the probability axis, the scan strict, lists of two lengths worth nothing. A per-frame value with a table redraws every frame in the engine, so tables belong on birth values                                                     | `drawCurve(value, t01, chance)`, the chance drawn in `emit()`, the annihilating table in `curveTables`                          |
| `rotation0` and `birthRotation0` | Degrees, the rate per `1 / 60` second, converted only when the matrix is built                                                                                                                                                                                                                                                                                    | As built, kept                                                                                                                  |
| Textures                         | The engine's particle shaders neither decode a texel nor encode a fragment, so the pass runs on the authored bytes, and every uv formula here is DirectX's, `v` down from the first row. A flip is a post-multiply after the transform, so a flipped layer's scroll reverses                                                                                      | `PARTICLE_COLOR_SPACE`, `flipY` off, `vUv.y = 0.5 - corner.y`, the `flip` uniforms and `uvInto`                                 |
| Meshes and the canvas            | A mesh's colour carries its alpha, and the target is opaque, because a blend writes the alpha channel too and a compositor would let the pane through                                                                                                                                                                                                             | The `tint` attribute of the mesh material, `alpha: false` and the backdrop colour                                               |
| The emitter's frame              | The spawn frame is built from euler degrees and a scale override, under the system's orientation where `isLocalOrientation` is on, its default, and the definition's `transform` is the outermost factor of every particle. A particle's world matrix is its own rotation on that frame                                                                           | `EmitterState.override` and `frame`, `pool.frame`, every local term turned in `integrate()`, the basis every draw path composes |
| The system's orientation         | A missile's system is yawed to face its target and a unit's to face its travel. The rig faces a path where it is going and an orbit along its tangent                                                                                                                                                                                                             | `facingAt` in `rig.ts`, `yawInto` in `basis.ts`, `SystemStep.yaw`                                                               |

Readings the code takes that go beyond what is directly attested:

- The axis the look-at turns onto its target is `+Z`, `FORWARD` in `world.ts`. Answered in 2.17.
- An arbitrary quad spans its local `X` and `Y` by `scale0.x` and `.y`, and `.z` is dropped.
- A complex camera quad's `scale0` is a full width, where the simple emitter's is a half-extent.
  Answered in 2.16: every quad's is a half-extent.
- An emitter naming no `erosionMapName` erodes on its own texel. Answered in 2.17: on white.
- `ParticlesShareRandomValue` is not read, and every particle draws its own chance. Answered
  in 2.17: one chance per emitter per life.
- `particleIsLocalOrientation` is applied since 2.26, and the drag stays on the world's
  axes, which is exact for a uniform drag alone.

### 2.14 The mesh emitter, and what a child set is

The mesh emitter is the largest primitive family in the game, at 454,304 `VfxPrimitiveMesh` and
80,284 attached against 1,421 of every ribbon, ray and beam together. A child particle set is the
nested system a particle spawns, 51,741 sets over 191 WADs. What these readings changed of T5's
static half:

| Subject              | Reading                                                                                                                                                                                                                                                                                           | Where it landed                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The mesh's roll      | One rotation channel reaches a mesh, `(int)rotation % 360` into a 360-entry basis table, so a mesh rolls in whole degrees and no pitch or yaw of `rotation0` turns it                                                                                                                             | `spinOf` truncates a mesh kind's spin, and `face()` in `Meshes.tsx` reads the roll alone   |
| The mesh's scale     | Three identical floats, so a mesh cannot scale unevenly                                                                                                                                                                                                                                           | `SPREAD.setScalar` in `Meshes.tsx`, on `scale0.x` by this reading                          |
| The submesh masks    | A submesh name hashes to one bit of a dword, so at most 32. `mSubmeshesToDraw` naming none, or none the mesh holds, is the whole mesh, and `mSubmeshesToDrawAlways` is OR'd in after the character's own visibility mask, so a hidden cape still draws its effect                                 | `drawnIndices` in `meshBuffer.ts`, `submeshesAlways` on the model                          |
| How a mesh loads     | A precedence chain. The `.skn` and `.skl` pair wins outright where both are written and neither is `doesnotexist.*`, and only then is `mSimpleMeshName` read, under `.scb`, `.tmesh` or `.gmesh` and no other extension. No `.tmesh` ships, and 147 `.gmesh` do with no draw site found           | `skinnedMesh` and `simpleMesh` in `readVfxSystem.ts`                                       |
| The align flags      | Alive, independent and combinable, and neither set skips the alignment. Each swaps one component of a vector from the camera's matrix, and the matrix built from that is used only under the unnamed `0x6AEC9E7A`, 4,882 objects against 8,435 `AlignYawToCamera`, else a stored per-index matrix | The gate as built. The turn stays the euler reading                                        |
| The attached mesh    | `mLockMeshToAttachment` ships all true and substitutes the attachment's rotation for the particle's, translation stripped, on the attached kind's draw path                                                                                                                                       | An identity stands in for the attachment, and the kind draws where it names geometry, 2.15 |
| `meshRenderFlags`    | No reader in 16.17, against a positive control on `miscRenderFlags`. The write bit is set by every blendMode except case 3                                                                                                                                                                        | As built, `NONE` alone writes depth                                                        |
| The animation        | `mAnimationVariants` is rolled once at definition load, uniform by index, and `mAnimationName` is read only where the list is empty. All 63 shipped uses have two entries                                                                                                                         | T6                                                                                         |
| The emission surface | `emissionSurfaceDefinition` on 1,643 emitters: a skinned mesh sampled in its animated pose at every birth, triangles drawn uniformly by count rather than area, or a skeleton weighted by bone length. `useSurfaceNormalForBirthPhysics` replaces both birth directions                           | T6, a pose being what it samples                                                           |
| The flag word        | The 16.17 bits, re-attested against the 13.x order, which has two slots unregistered. `particlesShareRandomValue` is `0x8000`                                                                                                                                                                     | Nothing, a bin writing each flag by name                                                   |

Child particle sets are T9, a tier of its own.

Readings the code takes that go beyond what is directly attested:

- A mesh rolls on the channel a quad spins on, `rotation0.z`, about its own `Z`, and a
  direction-oriented mesh faces its travel.
- A mesh scales by `scale0.x`.
- The align flags are a yaw and a pitch toward the eye, whatever `0x6AEC9E7A` holds.
- `NONE` alone writes depth. Answered in 2.17, off a different bit than this section assumed.

### 2.15 What the viewport settled by eye, and the attached mesh

The mesh tier's second half was built against shipped data and the screen, each reading attested
by a system whose look it fixes:

| Subject                | Reading                                                                                                                                                                                        | Where it landed                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A mesh's attributes    | React strict mode runs a memo twice and keeps the first result, so per-instance attributes built in a memo of their own are not the ones on the geometry                                       | The attributes are built with the geometry in `useVfxMeshes`           |
| A mesh's fragment      | A mesh runs the quad's whole fragment pass: both uv layers, the palette, erosion, `LOCK_ALPHA` and the `falloff` uniform an untextured draw takes. The colour ramp stays a per-emitter uniform | `meshMaterial` and `fragmentTests` shared with the quad                |
| A mesh's scale         | `isUniformScale` is read, and the first scale component serves all three axes                                                                                                                  | `SPREAD.setScalar(DRAWN.scale[0])` in `Meshes.tsx`                     |
| A mesh's turn          | The one rotation channel is the first, about `X`, off `Ezreal_Base_R_mis` authoring `birthRotation0 (90, 0, 0)`                                                                                | `meshTurn` in `integrate.ts`                                           |
| A path rig's frame     | A rig flies on its local `Y`: `X` right, `Y` along the flight, `Z` down, the one proper rotation. Shipped missiles author everything on `Y`                                                    | `flightInto` in `basis.ts`                                             |
| A path rig's run       | The system stops where it lands, so a run is the flight plus `lingerTail` and the scrub spans it                                                                                               | `landed` in `rig.ts`, and `scrubSpan` is gone                          |
| An arbitrary quad's uv | The texture is sampled transposed, `u = 0.5 - corner.y` and `v = corner.x + 0.5`, read off three textures decoded from the WAD. A transpose mirrors, which no shipped texture could settle     | The arbitrary path of the quad vertex shader                           |
| A mesh's handedness    | The viewport mirrors on `X`, so a mesh's vertices and normals mirror with it and every face rewinds, and the material culls unless `disableBackfaceCull` is written                            | `mirrorX` and `rewind` in `meshBuffer.ts`, `backfaceCull` on the model |

`VfxPrimitiveAttachedMesh` is the kind those readings then reach. A census of the 2,235 champion
bins counts 1,974 of them: 1,519 name no geometry at all, 208 write no `mMesh`, and 247 name a
`.scb` of their own. The kind draws the character's own mesh whichever it is, section 2.18, so a
viewport draws none of them and says so in its own words rather than counting them a kind it has
no renderer for.

Readings the code takes that go beyond what is directly attested:

- The one component `isUniformScale` takes is the first. Answered in 2.19: it broadcasts the
  first over a scale that is otherwise anisotropic.
- The mesh turn is the first rotation channel, about `X`. Answered in 2.19: all three are live.
- A missile frame's `Z` is down. Answered in 2.17, that the engine builds no such frame, and
  in 2.20, that the game object it stands in for flies on its `Y` all the same.
- An arbitrary quad's uv is transposed, and whether that mirrors is unsettled. Answered in
  2.16 and confirmed in 2.19.
- The attachment matrix a preview stands in with is the identity, its translation constants unread.

### 2.16 The quad's own extent, and the kind table attested

These readings cover the quad's own extent and the kind table, against the shipped quad vertex
shader's permutations. Two of the three moved what the viewport draws:

| Subject                    | Reading                                                                                                                                                                                                                         | Where it landed                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The quad's extent          | One builder serves kind 0 and kind 8 and differs only in one factor, `0.5` for kind 8 and `1.0` for the rest, so a camera quad measures `2 * globalScale * scale0` across. The arbitrary builder carries no `0.5` either        | `REACH` in `quadMaterial.ts`, every quad but the unit one spanning twice its `scale0` |
| The unit quad              | Kind 8 is `VfxPrimitiveCameraUnitQuad`, `0xFDD6DFA2`. It measures exactly `globalScale * scale0`                                                                                                                                | `QUAD_TYPE.cameraUnitQuad`, `isUnitQuad`, and `UNIT_REACH`                            |
| The arbitrary quad's plane | The corners lie on the particle's own rows 0 and 1, and `scale0.z` is never read                                                                                                                                                | As built, kept                                                                        |
| The arbitrary quad's uv    | Written on the CPU as fp16 rather than built in the shader, which carries no quad-type define and takes its position already in world space. The uv is the camera quad's transposed: `u = corner.y + 0.5`, `v = 0.5 - corner.x` | The transpose, kept. Both signs run the other way, 2.21                               |

One reading fell out that nothing asked for. The vertex format pins two fields of the appearance
record into `TEXCOORD0.zw` as fp16 constants the four corners share: the animation frame and the
alpha erosion drive, and `ALPHA_EROSION` is the define that widens `TEXCOORD0` to a `float4` to
declare `.w`. That is an independent confirmation of the drive being per particle, which the
renderer already carries in `lookup.z`. The kind table of section 3.1 is now attested rather than
inferred, kinds 0 to 9, 11 and 12 in the factory, plus `VfxPrimitiveLaser` at 14 and
`VfxPrimitiveRibbon` at 15, which the factory cannot reach at all and only a bin authors.

The extent is the reading with the widest reach. Every complex quad in the viewport drew at half
the size the engine draws it, which nothing on screen could show without a reference to measure
against.

### 2.17 Further readings, and a frame the engine never builds

These readings moved the code in three places and confirmed it in two:

| Subject             | Reading                                                                                                                                                                                                                                                    | Where it landed                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The look-at's axis  | The look-at builds `atan2f(dx, dz)` on the flat delta with the `Y` term a hard zero, and a `Y` rotation from it writes rows 0 and 2 alone, so row 2 is the delta normalised and local `+Z` faces the target                                                | `FORWARD` in `world.ts`, as built                                   |
| The missile's frame | The engine builds none. A missile-attached system takes the game object's own matrix verbatim with its translation zeroed, and otherwise a system's frame is either a copy handed in from its driver or the look-at yaw                                    | `flightInto` is gone and both rigs stand on `yawInto`               |
| The unbound erosion | Slot 9 is bound whenever `alphaErosionDefinition` exists. An empty name skips the load and takes a 1x1 opaque white the engine makes from `0xFFFFFFFF`, which is the neutral factor. A name that resolves to nothing takes a 1x1 transparent black instead | `erosionDefault` in `quadMaterial.ts`, where the texel stood        |
| The shared chance   | The shared chance is written when an emitter restarts alone, not at creation and not per frame, so the value is one per emitter per life                                                                                                                   | `sharedRandom` on the model, `state.chance` drawn at first emission |
| The depth write     | The bit every mode but case 3 sets is the blend enable, and the depth write is a separate bit that case 3 alone sets. An alpha-tested depth prepass triggers on blend enabled with depth write, which is coherent under no other assignment                | As built, and the reading behind it corrected                       |

The missile frame is the one that asked a question the code cannot answer. No such basis exists
in the client, so a rig stands in for a game object the file does not carry, and which convention
_that object_ holds is outside the VFX code entirely. Section 2.20 is the screen answering it.

Two sites in the material builder force the depth write on whatever the blend mode says, which
nothing here reads yet.

### 2.18 The attached mesh is the character, and the alignment is a look-at

These readings refuted a reading section 2.15 had built on:

| Subject                     | Reading                                                                                                                                                                                                                                                                                                                                   | Where it landed                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| What an attached mesh draws | Kinds 11 and 17 draw the owner's own skinned mesh, and every other kind the emitter's named one. The draw enumerates the character's live skin render instances and copies each bone palette per particle, never reading the three name fields                                                                                            | `drawsAsMesh` is the plain kind again, and `drawsTheAttachment` every attached one |
| The attachment matrix       | A TRS of position, scale and quaternion rather than a 4x4, and the constants overwrite the _scale_ with `(1, 1, 1)`. The attachment's position and rotation survive and the particle's are what is dropped, so with no attachment the composite is `emitterWorld * diag(particleScale)` and every particle stacks on the emitter's origin | Nothing to draw, so nothing to build                                               |
| The lock's reach            | `mLockMeshToAttachment` is read directly, and both read sites are gated on `kind == 11 \|\| 17`. The 48 plain-mesh objects shipping it true are dead data                                                                                                                                                                                 | `lockToAttachment` is off the model, unread by anything                            |
| The aligned matrix          | The aligned matrix is a look-at. The eye is the particle, the up the camera's, and the point aimed at is blended per axis: `x` from the camera under `AlignYawToCamera`, `y` under `AlignPitchToCamera`, `z` from the camera unconditionally                                                                                              | `aimed` in `Meshes.tsx`, where a euler yaw and pitch stood                         |
| `0x6AEC9E7A`                | Not a stored matrix at all. It reaches the particle pool, whose per-particle orientation is a 4x4, identity at spawn. The flag picks whether that orientation is discarded or composed under the camera-facing rotation, its default                                                                                                      | The alignment composes, which is the default and the identity case                 |

**Pitch alone is not a pitch.** Holding the particle's own `x` and taking the camera's `y` and
`z` aims across the world's `YZ` plane, and it reads as a pitch only alongside a yaw or where the
camera shares the particle's `x`, which League's near-fixed camera azimuth mostly arranges. That
is why the euler pair looked right for the 7,742 objects that set the pitch.

**The attached mesh draws nothing here, and now says so for all of it.** Section 2.15 read the
247 champion emitters that name a `.scb` as drawable and the rest as needing a character. The
name is dead for every one of them: the kind draws the character either way. So the strip counts
all 1,974 rather than 1,727, and `Aatrox_Skin33_Emote_Homeguard_Jet_Engines_2` is a system whose
turbines a preview cannot show rather than one it can.

`0x6AEC9E7A` still has no name. Two loose ends stay recorded:
a third attached-mesh submit reached from the simple path reads the flag not at all, and the two
sites that honour it disagree, one composing `emitterWorld * attachTRS * particleScale` and the
other applying the particle scale alone with no emitter world matrix.

### 2.19 The draw paths split, and the mesh readings were the wrong path's

The engine holds three display lists, and every mesh reading of section 2.14 came from the third
alone. That list is the **simple** emitter's, so those readings govern 68 shipped character
emitters rather than the 534,588 mesh objects the framing had implied. Complex mesh particles
draw off a different particle representation entirely, and it disagrees on every point that
reached the viewport:

| Subject                | The simple path, built as 2.14 and 2.15                        | The complex path                                                                                                                                                               | Where it landed                                   |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| The turn               | One rotation channel, whole degrees, through a 360-entry table | All three components live, each about its own axis, composed `Rz . Rx . Ry` over the engine's rows, and nothing quantised                                                      | `standingInto` in `basis.ts`, for every path      |
| What the channels hold | An angle                                                       | A rate, closed-form in the particle's age rather than integrated, and where the degrees become radians is not traced                                                           | Carried as the angle the integrator already holds |
| The scale              | Three identical floats                                         | Anisotropic by default, `isUniformScale` broadcasting `.x` over all three by inference from the behaviour. The simple path never tests that bit                                | `SPREAD.set` of all three in `Meshes.tsx`         |
| `isDirectionOriented`  | Not established for a mesh                                     | Local `+Z` along the velocity, off a basis whose `+X` is the world's up crossed into it. Row 2 of a row-vector matrix is the image of local `+Z`, so the `+Y` guess is refuted | `alongInto` in `basis.ts`                         |

The arbitrary quad's uv is confirmed transposed and its signs were mirrored, which section 2.16
had already turned. Two further readings the viewport does not act on: a camera quad's roll is
the index of a 361-entry table and so is quantised to whole degrees on the complex path too,
where the renderer quantises a simple emitter's alone, and a direction-oriented camera quad
ignores its roll outright.

`blendMode` was the reading with the widest reach of any so far. All nine modes are now attested,
and four of them disagreed with what the renderer drew: `ADD` takes the colour whole where the
renderer scaled it by the alpha, `ALPHA_ADD` scales by the alpha where the renderer took it whole,
`SUBTRACT` is a darken by `dst * (1 - src)` rather than a reverse subtract, and `TARGET_ALPHA`
lays the quad under what is already drawn. `Riven_Base_Q_03_detonate_ult`'s `blastholeDark` is
what showed it: a `CracksDark` texture whose RGB is pure white and whose whole structure is in
the alpha, drawn at `ALPHA_ADD`, so an unscaled add painted a flat saturated silhouette where the
cracks belong. The factor enum each mode indexes is an inference rather than an attested mapping.

The engine has one euler builder for every primitive, and the matrix it fills is the particle
world matrix every draw path reads, the arbitrary quad taking rows 0 and 1 of it. So the
composition is not the mesh's alone: `standingInto` carries it for quads, trails, beams and
meshes together, where the renderer had built `Rz . Ry . Rx` for the first three. The two agree
wherever the roll is zero, which is why the change moved nothing already on screen.

The rate reading is the one left open. The renderer integrates an angle from `birthRotation0`
and the rotational velocity, which equals a rate times age wherever the velocity is constant and
the birth angle is zero, and differs under either. Where the engine folds `birthRotation0` in is
not traced, so the integrator keeps its angle until it is.

### 2.20 A missile's object frame flies on `Y`, which the screen settled

Section 2.17 took its own refutation one step too far. That the engine's VFX code builds no
missile basis is attested, and the conclusion drawn from it - that the honest stand-in is
therefore the look-at yaw - does not follow. A missile-attached system copies the **game
object's** own matrix, and no VFX code builds that either, so which axis that object flies on is
outside what the VFX code can settle. The rig has to carry the object's convention, and the
only evidence for it is what the shipped systems author against it.

`Ezreal_Base_BA_crit_mis` is that evidence, drawn on `Missile` at `0.55x`:

- `arcane_noodles` is a `VfxPrimitiveArbitraryQuad` with **no rotation authored at all**, so its
  quad stands on the spawn frame and nothing else. It writes `birthScale0 (20, 70, 1)`, a quad
  70 long on its own `Y`, and `birthVelocity (50, -200, 0)`, streaming back along that same `Y`.
  Under a flight frame the noodles trail the missile down their long axis, which is the name and
  the art. Under the yaw the same quad stands 70 tall across the flight and reads as a sliver.
- `leading_glow1` is the same kind and turns with it.

So the frame goes back to `flightInto`: local `Y` along the flight, `X` to its right, `Z` down.
The `90` degrees about `X` that separates it from a yaw is real, but it belongs to the object's
frame rather than to an artist's `birthRotation0`, and an emitter that authors no rotation cannot
be supplying it.

A census of `birthRotation0` over 243,307 mesh emitters closed it from the other side. Of the
43,164 in missile-named systems, `|x| == 90` is 30.3% and exactly `(90, 0, 0)` is 13.2%, against
14.8% and 6.3% across mesh emitters at large. So the pitch is enriched about twofold on missiles
and is still a minority: no authored convention explains the split, and a frame that leans on one
lands on a third of them and turns the rest twice. The `90` belongs to the meshes that want
standing up, not to the frame, which is the object's own and is what artists author against.

What stays settled regardless: the unit look-at's axis is `+Z` and stands, and the mesh readings
of section 2.19 are the complex draw path's own and are untouched by which frame the system
stands on.

### 2.21 The arbitrary quad's uv runs against the attested pair

Section 2.16 took `u = corner.y + 0.5`, `v = 0.5 - corner.x` and turned the renderer's own pair
180 degrees onto it. `Aatrox_Base_W_Core_Area` says the renderer had it
right: `GroundLines2`, `darkglow` and `decal` are its three `VfxPrimitiveArbitraryQuad` emitters,
every one a ground decal on a directional texture, none of them authoring a single uv field, and
all three drew their cone pointing backwards. The six mesh emitters beside them, which carry
their orientation in geometry rather than in uv, were unaffected.

So the transpose is attested and stands, `v` running along the `scale0.x` axis as the aspect
factor of section 2.5 cross-checks, and both components run the other way. The corners here ride
a basis mirrored on `X` where the engine's ride its own. A symmetric sprite shows none of this,
which is how the pair survived a round of screenshots either way.

### 2.22 The camera look-at splits on the resource kind, and a mesh carries no mirror

Two readings, one from the engine and one from the screen.

A left-handed look-at is reached only where the emitter resolved a `.skn` pair, and a
right-handed one serves `.scb` and `.tmesh`/`.gmesh` on the complex path. Nothing downstream
compensates, and the difference is not a mirror:
`inv(LookAtRH) = Ry(180) . inv(LookAtLH)` with a determinant of `+1` either way, the forward and
the right both flipping while the up stands. So a camera-aligned `.scb` shows the camera its back
where a `.skn` shows its front, on the engine's attested `+Z` forward. Which is intended is not
established, and 411,658 `.scb` against 48,672 `.skn` says artists author against the
right-handed one. `skinned` on the model carries the slot the geometry came from, and `aimed` in
`Meshes.tsx` turns the basis half a turn for everything that is not a `.skn`.

The beam's own look-at is argument order and nothing else: it passes the far endpoint as the eye,
so the right-handed call yields the left-handed one's rotation and the translation row is thrown
away. A camera quad never calls a look-at at all, taking its axes from a fixed orientation table,
so there is no handedness to reconcile between a quad and a mesh.

The screen settled the other. A mesh's vertices were mirrored on `X` at load, on the argument that
the viewport's `X` is the engine's negated, and `Riven_Base_R_Sword` drew its blade at the
opposite handedness to the glow quads around it. The geometry arrives in the viewport's own space
already, so the mirror was the second one applied to it, and the winding turn that compensated the
mirror goes with it.

### 2.23 `worldAcceleration` is a draw-time offset, and drag reaches the emitter's drift

The two terms do not compose. The engine writes both to their own destination: `a * t` into the
particle's world velocity, and `a * t * t` into the translation row of the matrix the draw reads.
Only the square is a position, so the drawn offset is `a * t * t` alone. The world-velocity slot
is also where `bindWeight * parentVel` and the emitter-space velocity land, which is what makes
it a velocity rather than a second position.

What reads that world velocity is not recorded anywhere, so the `a * t` half is not applied. The
two places here that would notice are the `VELOCITY` colour lookup and the direction-oriented
aim, both of which read the particle's own velocity plus the emitter's drift.

`t` is the particle's whole lifetime and not its age, and the field is never written between the
two places that read it. The contribution is therefore fixed over a particle's life rather than
accumulated over it, which is not the same thing as substep-independent integration. What
follows from reading `pool.lifetime` at draw time is the engine's own discontinuity: a type 1 or
2 linger rewrites the lifetime to `age + particleLinger` in one frame, and the offset jumps with
it. `drawnPositionInto` in `integrate.ts` is the one place that arithmetic lives, and the four
draw paths each take their position from it.

**The curve is read against the emitter's own life.** What this field's `dynamics` is sampled
against is not directly attested, and every other emitter-level curve here is read against the
emitter's phase, so that is the reading. The shipped data says the choice is nearly free: over 56
bins carrying the field, **650 of 652 emitters key exactly one point**, which samples the same
whatever the time is. Two emitters in that sample would draw differently under a particle-age
reading.

Magnitudes, from the same census, as `|a|` against the constant `particleLifetime`:

| percentile | `\|a\|` | lifetime | `\|a\| * t * t` |
| ---------- | ------- | -------- | --------------- |
| p25        | 50      | 0.60     | 18              |
| p50        | 100     | 0.80     | 64              |
| p75        | 400     | 0.50     | 100             |
| p95        | 1,500   | 0.40     | 240             |
| max        | 2,500   | 0.75     | 1,406           |

So the median authored value moves a particle 64 units, about half a champion, and the tail moves
one 1,406. A displacement that large on a short-lived emitter is the reading's own consequence
rather than a bug in it.

One alternative stays open and would change the result. It may be that an `IntegratedValue`
returns an integral over `[0, age01]` rather than a plain sample. Under that reading `a * t` is
`curve * age`, which is the physically correct velocity of a constant acceleration, and the drawn
offset ramps from zero instead of standing still. Settling it needs a read this plan has not
done, the same one left open for the UV rates.

**Drag holds up, with one correction.** The order is the renderer's own: the acceleration is
added to the velocity first, the drag is computed from what that leaves, and the clamp that cannot
cross zero is the engine's own and not this renderer's. `drag` is `Embed<ValueVector3>` and the
engine sums a per-axis birth drag into it, so per axis is right as well. The correction is which
velocity the drag acts on: the engine sums the particle's own velocity and the emitter's before
the drag block and damps that sum, keeping the change on the particle's velocity alone. The
renderer had been damping the particle's own velocity and adding the emitter's `velocity`
undamped afterwards, so a dragged emitter drift never spent itself. Both now go through the drag
and only the particle's keeps the change.

`kAnalyticDragMotion` stays unbuilt. It is the `flags & 0x100` branch, which zeroes the birth
velocity and carries the motion in closed form, and it needs the per-particle `birthDrag` that
T0's field set does not read.

### 2.24 Two rotation channels, the travel, and a name with no trailing zero

These readings answer four open tasks. Three of the findings reach the renderer, one closes a
question left open, and three confirm what is already built.

**`birthRotationalAcceleration` has no `0` on the end.** `0x36fa5371`, `Embed<ValueVector3>`, where
its neighbours `birthRotation0` and `birthRotationalVelocity0` both carry the suffix. The reader
hashed the suffixed spelling, which no bin writes, so the field read as its default on every
emitter and a particle's spin ran at a constant rate instead of accelerating. `meta-cli` answers
`no-such-property` for the suffixed name, and the field is spelled without one.

**`birthOrbitalVelocity` is a second rotation channel, and it is not a spin.** `0x51433ef4`,
`Embed<ValueVector3>`, live on 137,241 objects across 195 WADs. The angle is `age * rate` in
**radians**, the `pi / 180` the spin channel carries never reaches it, and the engine folds the
turn into the world matrix **after** the
translation row is set. Right-multiplying a matrix that already carries a translation turns that
translation too, so the particle is carried around an origin rather than spun in place - which is
what the field's name says, and what running the two channels together had lost.

The units settle it from the data even without the code. `birthOrbitalVelocity` has a median
magnitude of `1.0` and never reaches 90, where `birthRotationalVelocity0` sits at 60 and
`birthRotation0` clusters on 90, 180 and 360. Read as degrees a second, a modal `(0, 1, 0)` is one
revolution per six minutes on a particle that lives a second, which is no rotation at all. Read as
radians it is one revolution per 6.28 seconds.

`drawnPlaceInto` in `integrate.ts` applies both draw-time channels in the engine's own order: the
orbit first, because the integrator builds it into the matrix, then `worldAcceleration` on top
un-turned, because the transform pass adds that to the translation row afterwards. Each draw path
composes the returned turn over the particle's own basis.

**The orbit turns about the rig's origin.** The engine's translation row at that step holds the
particle's position in the system's space, so the origin of the turn is the system's. The renderer
stores a particle's position in the rig's world instead, so it subtracts the origin, turns, and
adds it back. What the renderer does not reproduce is the engine's full matrix chain - the system
orientation is right-multiplied one step earlier there and baked into the spawn frame here - so an
orbit under a turned system orientation is a reading rather than an attested match.

**The travel is its own channel.** The engine keeps the frame displacement over `dt` as a value
of its own, zero for a particle born during the step, and a direction-oriented particle aims
along _that_, not along the stored velocity. The renderer had been aiming along `pool.velocity`
and reading the colour lookup's `VELOCITY` off that
plus a raw `sampleCurve(emitter.velocity)`. Neither holds once 2.23's drag correction landed: the
stored velocity converges toward the negative of the emitter's drift while the particle travels
forward, and the drift the integrator applies is turned by the particle's birth frame where the
draw's copy is not. `pool.travel` now carries the displacement and all three readers take it.

**What confirms, and needs nothing.** The `.scb`/`.skn` handedness split of 2.22 stands, and
`inv(LookAtRH) = Ry(180) . inv(LookAtLH)` is the arithmetic already built. The align flags need
no change either, since the reader resolves both by name hash rather than by memory layout.
`VfxPrimitiveCameraUnitQuad`'s half-extent stands too, built in 2.16 as `UNIT_REACH`. The
component and shimmer family is live at last, but its 168 objects are all Summoner's Rift map
materials rather than champion VFX, so it stays a tier of its own.

**What it takes away.** A census undercuts the reconciliation 2.20 leans on. Over 243,307 mesh
emitters, `|x| == 90` is 14.8% overall and 30.3% on missile-named systems, and exactly
`(90, 0, 0)` is 13.2% there. A rig that bakes `Y = travel` into the system frame lands correctly on
about a third of missile mesh emitters and double-rotates the rest, so the flight basis of
`basis.ts` is a preview convenience rather than the engine's behaviour. The attested half of 2.20 -
the matrix cells, and that no VFX-side remap exists - is untouched.

**The question that is now worth more than any other.** Three fields evaluate an `IntegratedValue`
and multiply the result by the particle's lifetime: the UV rates, `worldAcceleration`, and
`rotation0`. One reading infers, short of a direct read, that the evaluator returns an
**integral** over `[0, age01]` rather than a plain sample, on the grounds that it is the only
dimensionally sound reading. A second line of evidence reaches the same shape from the other side
and records `rotation0 * 60 * lifetime` as confirmed but unexplained, because under a plain
sample it is a constant offset rather than the rate its name and its authored values describe.

Under the integral reading all three fall out: the UV term scrolls, `rotation0` is a steady spin
which is exactly what this renderer already accumulates per step, and `worldAcceleration`'s
`a * lifetime` becomes the physically correct velocity `a * age`. Under the plain reading none of
them does. Settling it needs one further read this plan has not done. Until then, `rotation0`
keeps accumulating and `worldAcceleration` keeps 2.23's plain sample, so the renderer currently
holds one of each reading, which is the strongest argument for settling it.

### 2.25 A distorting emitter warps the frame rather than colouring it

`VfxDistortionDefinitionData` (`0x49d51b69`) carries three fields, and what the engine does with
them is not directly attested: `distortion` (`0xbc5efeaa`, `F32`, default 0), `distortionMode`
(`0x40c58b71`, `U8`, default 1) and `normalMapTexture` (`0xe672d557`, `String`, resolved through
`ASSET_FIELDS` like every other texture name). An emitter points at one through
`distortionDefinition` (`0xbc809cdb`).

**What is attested.** The engine names seven display lists, three of which are
`Render_Distortion_No_Character`, `Render_Distortion_All` and `Render_Post_Distortion`, and
`renderPhaseOverride` chooses the list an emitter draws in. The shader cache carries
`shaders/skinnedmesh/distortion_diffuse_alpha.ps`, which names the diffuse alpha as what a
distortion is masked by. That is the whole attested surface.

**What the screen settles.** Over 18 shipped bins holding the block, 67 emitters carry it, every
one at `blendMode` 1 (`ALPHA`), none writing `renderPhaseOverride`, and 66 of the 67 draw as a
quad. The Aatrox base `R_Fear` system's `distort` emitter is the worked case: a quad at
`blendMode` 1 whose own `texture` is `Aatrox_Base_R_color_hold.dds`, a near-white gradient, at a
scale that covers the champion. Drawn as colour it is a white sheet over the whole viewport, which
is not what the game shows. So a distorting emitter is not in the colour pass at all: its texel is
a warp, and `distortion` at a median of `0.02` is how far in screen widths.

**What the renderer does.** `distorts(emitter)` in `model.ts` puts the emitter's geometry on a
layer of its own, `frame.ts`, which the colour pass leaves out. `Distortion.tsx` then draws two
passes instead of one: the colour pass as it always was, a `copyFramebufferToTexture` of the frame
as it stands, and the distorting emitters over it with neither the colour nor the depth cleared.
`warped` in the shared fragment of `quadMaterial.ts` reads the normal map's `xy` as the direction,
scales it by `distortion` and by the fragment's own alpha, and lays what it covers back over the
frame under that alpha. Both passes reach the canvas, so a viewport carrying no distorting emitter
draws the colours it drew before and one carrying a still emitter draws them too.

Rendering the frame into a buffer of its own and compositing it was tried first and is wrong here.
A ThreeJS render target's programs write the working colour space rather than the canvas's, section
`getUnlitUniformColorSpace` of its own renderer, where this renderer's particle materials write
their authored bytes to the canvas unconverted on purpose (`PARTICLE_COLOR_SPACE` in `world.ts`).
The two cannot both be carried through one composite, and the whole viewport came back a power
darker.

**The map's alpha is the mask, and its texels say so.** Reading the block's `xy` as the direction
and the emitter's own texture alpha as the mask draws the quad's rectangle over the screen: a
distorting emitter's texture is as often opaque, so the mask is one everywhere. The 255 `*distort*`
and `*_normal*` textures the install ships settle both halves. 145 of them are blue-dominant, a
tangent normal flat at `(128, 128, 255)`, and another 33 sit at `(128, 128, 128)` - flat at `0.5`
in `xy` either way, so `xy * 2 - 1` is zero wherever nothing ripples and no rectangle is drawn.
77 carry white in all three channels and can only be a mask. And **242 of the 255 vary their alpha
by more than a sixth of its range**, `lulu_base_w_cas_distort.dds` being the clean case: 64 by 16,
white throughout, an alpha from 0 to 255 and nothing else in it.

So the map is `xy` for the direction and alpha for the mask, and the alpha both shapes the warp and
scales how far it carries. The emitter's own texture alpha multiplies in, which costs nothing where
it is opaque.

**What is a reading and what to ask.** That the map's `xy` is a signed direction flat at `0.5`,
that its alpha is the mask, that `distortion` is a fraction of the screen's width rather than of
the quad or a world distance, and that the warp composes with nothing else - all four are inferred
from the field names, the texels and the screen. `distortionMode` is read and
unused: 54 of the 67 leave it at its default of one, eight write 2 and five write 3, and what it
selects is not established. The three distortion display lists are not told apart either, since no
shipped emitter writes `renderPhaseOverride` at all.

### 2.26 A particle of its own orientation turns with its system

The engine multiplies in the per-tick world matrix under `particleIsLocalOrientation`
(`0x37ddb774`, bit `0x2` of the flag word), and post-multiplies the spawn frame **only where the
flag is off**. So the flag chooses which frame a particle's own rotation stands on: the system's
orientation as it is now, or the one baked at its birth. It rides on 7,434 of the 41,872 emitters
of the local dump, 17.8%, which is the widest thing the renderer carried and did not read.

`standingFrameInto` in `integrate.ts` is that choice, and the four draw paths take their frame from
it rather than from `pool.frame` directly. The live orientation is the driver's, `world.basis`
under the rig's own yaw, which is `SystemStep.yaw` beside the definition's `transform` - the same
two factors the spawn frame is built from, minus the emitter's `rotationOverride` and
`scaleOverride`, which live in the spawn frame the engine drops here.

A still rig draws both readings the same, so the flag only shows where the rig moves: a particle of
its own orientation swings with the system where every other one keeps the heading it was born
under. The physics are untouched, because the engine integrates velocity in local space either way
and the emitter-local terms `integrate()` turns are the spawn frame's in both readings.

### 2.27 A field's presence is not its gap

`survey_vfx` counts one row per `VfxEmitterDefinitionData` instance that writes a hash, so a row is
the count of emitters that _mention_ a field rather than the count that authors it away from its
default. Where a field's default is the drawn behaviour, the two differ by an order of magnitude. A
value census closes the difference, reading every object that mentions a field and bucketing what
it actually holds.

**`uvMode` is two live modes, not six.** Over 150 bins and 575 writers:

| value             | count | share | state                            |
| ----------------- | ----- | ----- | -------------------------------- |
| `2 LOCK_ALPHA`    | 448   | 77.9% | built                            |
| `1 SCREEN_SPACE`  | 127   | 22.1% | blocked on the NDC-to-UV mapping |
| `3 LOCAL_SPACE`   | 0     | 0%    | unauthored                       |
| `4 LOCAL_SPACE_*` | 0     | 0%    | unauthored                       |
| `5 LOCAL_SPACE_*` | 0     | 0%    | unauthored                       |

The 2,895-writer row is `LOCK_ALPHA`, which the renderer draws. What remains is `SCREEN_SPACE`
alone, around 640 emitters, and it waits on the mapping section 2.11 records. The three local-space
modes are authored nowhere in the dump, so T1's "all six `UV_MODE` values" is two.

**`stencilMode` is authored on every emitter that writes it.** The census covers the whole
population, 1,552 writers over 39 bins, which is the survey's own count for the field:

| value                   | count | share |
| ----------------------- | ----- | ----- |
| `2` compare `kEqual`    | 764   | 49.2% |
| `3` compare `kNotEqual` | 514   | 33.1% |
| `1` `kAlways` + mask    | 266   | 17.1% |
| `4` `kNotEqual` + mask  | 8     | 0.5%  |
| `0` off                 | 0     | 0%    |

The enum, its compare ops and the `stencilRef` gate are fully attested, which makes this the one
unbuilt gap with a full reading behind it. Seven of the
39 bins are `maps/mapgeometry/map11` materials and `maps/shipping/map11`, at 20 objects each. The
rest are Aatrox skins, `sru_baron` and `sightward`.

**The reference the compare modes test against is written outside the emitter.** A preview holds a
rig, a ground plane and the emitters, and nothing writes a stencil buffer, so `kEqual` against an
all-zero buffer hides 82% of the population. The renderer reads the mode and draws the emitter
regardless, because a viewport that is exact and empty says less than one that shows the particle.

**`reflectionDefinition` is an embedded struct, so its row is its gap.** 1,401 writers over 150
bins, every one of them an embed, and nothing yet documents what the engine does with it.

**`flexShapeDefinition` is attested for its birth offset alone.** The clear-path spawn base is
`EmitterPosition + flexShapeOffset * scale`, and the `IsEmitterSpace` set path zeroes that triple
so the flex contribution is dropped. The arithmetic is attested and the intent is not. What the
definition evaluates to remains open.

**The queue is coverage against attestation.** An unattested gap is a guess whatever its count,
and the branch builds the attested set and leaves the rest open.

| gap                    | writers | real gap          | attestation      | standing          |
| ---------------------- | ------- | ----------------- | ---------------- | ----------------- |
| `stencilMode`          | 1,552   | 1,552             | full, 3.3        | next              |
| T9 child particle sets | 1,320   | 1,320             | full, answered   | queued            |
| T4 force fields        | 1,189   | 1,189             | full, T4 section | queued            |
| `flexShapeDefinition`  | 3,945   | embeds            | birth offset     | open              |
| `reflectionDefinition` | 1,688   | embeds            | none             | open              |
| `uvMode`               | 2,895   | ~640, all blocked | full, section 4  | out, blocked      |
| T6 skinned mesh        | 12,495  | the skinned share | full             | out, 3 to 5 weeks |

The three `IntegratedValue` fields stand on one reading rather than two: the evaluator returns an
integral over `[0, age01]`, under which the UV rates, `worldAcceleration` and `rotation0` are each
physical. 2.24 holds the argument, and one further read would settle it.

### 2.28 The queue after the censuses, and the one reading the screen has yet to judge

**The `ltk_mesh` allocation guard is out of scope.** The abort of 2.27 is real and reachable, and
the guard that would have closed it here was written and dropped at the maintainer's call. Nothing
in this renderer defends against a malformed `.skn` any more, so the reachable abort stands as the
upstream crate's to fix.

**`FlexShapeDefinition` is asked, and the census moved the question.** A value census over the
whole dump, 4,007 `VfxFlexShapeDefinitionData` structs across 215 bins, says the class is two
fields:
`scaleBirthScaleByBoundObjectSize` on 2,750 and `scaleEmitOffsetByBoundObjectSize` on 2,174, both
clustering on `0.005`, with `ScaleBirthTranslationByBoundObjectSize` on 40 and the two `Height`
scalars on 35 each. The two `Radius` scalars and `flexScaleEmitOffset` are authored **nowhere**,
and `flexBirthTranslation` is authored **once**, at its own default.

So the attested birth offset, `EmitterPosition + flexShapeOffset * scale`, is `(0, 0, 0)` on every
emitter that ships, and the flex contribution the `IsEmitterSpace` path drops is nothing.
`mFlexID` (`0x46bcba8a`) is authored on **zero** bins on either flex value class, so the flex
mechanism itself has no shipped user. The gap that remains is the bound-object scaling.

**`worldAcceleration` moves onto the `IntegratedValue` reading.** 2.24 put three fields on one
inference and left the renderer holding one of each reading. `rotation0` and the two UV rates
already accumulate per step, which is that integral, so the unification is one place:
`drawnPlaceInto` multiplies the drawn offset by `age01`, and it ramps from zero to
`a * lifetime * lifetime` over the life instead of standing at it from birth. The endpoint is
unchanged and the whole ramp below it is new. **The screen has not judged this yet**, and the
`worldAcceleration` bins of 2.23 are the re-shoot that settles it. Where they disagree, the screen
wins.

**`stencilMode` is read and not tested against.** `0x1aef807c`, `U8`, default `0`, with
`stencilRef` at `0x7b43e2ec`. The enum's compare ops are attested as `kAlways` for `kWriteMask`,
`kEqual` for `kTestEqual` and `kNotEqual` for both `kTestNotEqual` and `kWriteMaskIfTestNotEqual`,
and `stencilRef` is attested as read off a mode alone. The model
carries the mode, the reference and which two modes take the write-mask path, and no material
enables the compare, because a preview writes no stencil buffer and 82% of the population tests
against a reference nothing sets. An emitter of a mode draws exactly as it did. The compare ops
stay recorded here rather than in a table no renderer reads: enabling them against an all-zero
buffer would discard the `kEqual` half of that 82% and pass the `kNotEqual` half, neither for the
engine's own reason.

**Five of the seven review findings landed.** The two mediums both did. `quadType` answers null
for `VfxPrimitiveLaser`, `VfxPrimitiveRibbon`, `VfxPrimitiveCameraSegmentSeriesBeam` and
`VfxPrimitiveNonRenderable` rather than reading four classes as camera quads, so `isUndrawn` names
them and the viewport's notice counts them. `LayerChunks` walks a project's layers from the bottom
of the stack, under the manifest's own priorities, so `asset_at` answers with the highest-priority
layer's file rather than the first directory read.

Two of the lows landed with them, both in `meshBuffer.ts`: a submesh whose run the index block
does not hold is dropped rather than copied through a clamping `subarray` into a fan through
vertex zero, and the reader validates a block before it allocates for it. The other three lows,
at `quadMaterial.ts:338`, `chunk_names.rs:89` and `src-tauri/src/commands/vfx.rs:44`, are recorded
as file and line alone with no finding text, and nothing at those lines reads as a defect on its
own, so they wait for the review's own words.

**Both ribbon artifacts are closed.** A joint's miter is now the bisector of its own two segment
normals: the walk keeps each joint's unmitered across and bisects against that, where it had been
folding the last bisector back in and running an exponential moving average along the ribbon. And
a camera trail whose tangent crosses the view to nothing — two points on top of each other, or a
strand seen along its own length — takes the last joint's across, or any direction across the view
at the head, rather than collapsing both vertices onto the point.

The same collapse is open one function down: `writeBeam` normalises a zero `WIDE` for a beam
pointed at the eye and is left as found, because it is outside what the review reported.

### 2.29 What the two definition classes carry, and the three fields read off nothing

A coverage census walks every `VfxSystemDefinitionData` resolved to json, tallying the fields
authored on each struct of the two definition classes. **2,235 bins, 8,282 systems, 9,087 system
objects and 44,571 emitter objects**, which is
the whole dump rather than the `data/characters` slice section 2.10's shares are drawn from. A bin
serializes only what differs from a property's default, so a tally is what shipped data authors.

| class                      | properties | read | unread | unread and authored | unread and never |
| -------------------------- | ---------- | ---- | ------ | ------------------- | ---------------- |
| `VfxSystemDefinitionData`  | 34         | 4    | 30     | 16                  | 14               |
| `VfxEmitterDefinitionData` | 139        | 80   | 59     | 46                  | 13               |

**The system definition is read for four fields, and most of what it carries is not the
renderer's.** `particleName` and `particlePath` are on all 9,087 and are identity.
`visibilityRadius` at 2,481 is culling a preview does not do, and the two `sound*Default` fields at
1,055 and 860 are audio. Two rows are renderer work: `assetRemappingTable` on 701 systems, whose
`VfxAssetRemapType` section 3.2 already lists for a later tier, and `buildUpTime` on 184.

**`birthDrag` is the largest unbuilt behaviour on the emitter.** 10,068 objects, 22.6%, second only
to `importance`, which is a LOD selector. Section 2.23 names it already: `kAnalyticDragMotion`
stays unbuilt because it needs the per-particle `birthDrag` that T0's field set does not read. It
is authored eight times as widely as T9 and T4, the two tiers ranked ahead of it.

The rest of the top of the unread list: `isGroundLayer` 8,888, `useNavmeshMask` 4,490,
`FlexShapeDefinition` 4,203, `emitterLinger` 3,579, `softParticleParams` 2,598,
`reflectionDefinition` 1,688, `directionVelocityScale` 1,642, `Filtering` 1,360,
`childParticleSetDefinition` 1,320 and `fieldCollectionDefinition` 1,224.

**The census settles two counts 2.27 left disagreeing.** `reflectionDefinition` is 1,688, which is
the queue table's figure rather than the 1,401 of the prose above it, and
`childParticleSetDefinition` is 1,320, exactly T9's row. `fieldCollectionDefinition` is 1,224
against T4's recorded 1,189.

**Three fields the renderer reads are authored on nothing.** Counted twice, once by the walk above
and once by scanning every object's raw dump for the hash:

- **`IsEmitterSpace`** (`0xa786282d`), zero. The two paths have one live branch in shipped data,
  every emitter takes the clear one, and the set path that drops the flex contribution never
  runs. Whether anything but a bin ever sets the `0x20000` bit remains an open question.
- **`birthRotationalAcceleration`** (`0x36fa5371`), zero. Section 2.24 records the reader being
  moved off the suffixed spelling, which no bin writes, onto this one. No bin writes this one
  either, so the correction changed no shipped emitter. The spelling is still the attested one and
  the reader is still right.
- **`scaleOverride`** (`0x0e5b32e1`), zero.

### 2.30 `birthDrag` is one term of the drag pass, and every writer authors it

A value census over the whole dump opens each `Embed<ValueVector3>` rather than counting the
struct. **10,054 objects over 323 bins write
`birthDrag` (`0x8275da98`), and every one of them authors a non-zero drag.** 9,498 carry a
constant and 556 carry a `dynamics` curve, and no writer keys the default. So the 22.6% of 2.29 is
the gap as well as the presence, which is what the branch's own rule asks of a row before it is
built.

The magnitudes, as `|v|` over the constants: p10 1.414, p25 2.598, p50 5.196, p75 8.660, p95
15.588 and a maximum of 5,000. A drag of 5 halves a velocity in 0.2 seconds, so the median writer
is authoring a particle that stops well inside a typical lifetime. The common vectors are uniform —
`[5,5,5]` on 1,082, `[4,4,4]` on 861, `[3,3,3]` on 711 — but the per-axis writers are not a tail:
`[0,2,0]` on 274, `[1,0,1]` on 241 and `[0,0,2]` on 116 damp one plane and leave the rest alone,
which is the shape section 8.2 attests independently.

**The build is one sum, not a second pass.** The damping coefficient is the definition's
`drag` plus the particle's own birth drag, per axis, so `integrate()` reads
`motion[held + 3 + axis] + pool.birthDrag[slot + axis]` where it read the emitter's alone. The
order 2.23 settled is untouched: the acceleration lands on the velocity first, the drag is computed
from what that leaves, the clamp cannot cross zero, and the sum of the particle's velocity and the
emitter's drift is what is damped while only the particle's half keeps the change. A keyed linger
drag switches in as before and the birth term is added to whichever value it holds.

The pool carries three floats per particle beside `angularAcceleration`, drawn at the particle's
one birth chance against the emitter's own phase, which is where every other birth curve is read.
Held rather than resampled: a curve authored over the emitter's life gives a particle the
coefficient it was born under for as long as it lives.

**`kAnalyticDragMotion` is unblocked and still unbuilt.** 2.23 records it as needing the
per-particle birth drag that T0 did not read, and T0 now reads it. The path itself is the
`flags & 0x100` branch, `FLAG_USE_CALCULUS_FOR_PHYSICS` of section 3.2, which zeroes the birth
velocity and carries the motion in closed form. It is its own decision and its own census.

**The `writeBeam` collapse is closed.** `cross(TO_EYE, DELTA, WIDE)` is exactly zero for an eye on
the line through the beam's two ends, and the four corners then land on the beam's own axis, so the
beam vanishes as the view orbits past that angle. It takes any direction across `TO_EYE` there,
which is the fallback `writeTrail` already uses at the head of a strand seen along its own length.
The `ends.eye === null` branch below it degenerates on a zero `length` alone, and a beam of no
length draws no area whichever way its width points, so that branch keeps the unnormalised width
section 3.6 attests.

### 2.31 The spawn frame carries a scale, which the mesh path read as a turn

Four defects a `/code-review high` over the whole branch found, none of them in a queue, and a
fifth a review of the fixes found behind the first. Two carry a failure the screen shows and three
are latent.

**A tune that shortens a looping run no longer replays it.** `steer` recomputes the origin and the
orientation at the new rig's phase and left `phase` itself on what the last step reached, which is
the field `run` compares against to find a loop. A looping rig's phase is the clock modulo
`runLength`, so the missile rig's Speed slider and the trail rig's Revolution slider both shorten
that run under the phase already reached and wrap it back below itself: `run` reads the wrap as a
loop and empties the pool mid-drag, which is the pinning the docstring says `steer` exists to
prevent. The phase now moves with the rig. `driver.test.ts` had a test named for this that steered
a `once` rig, where `phaseAt` returns the clock and no wrap exists, so it could not reach the bug.

**`swap` held the same stale phase, and a review of the fix found it.** `runLength` is the system's
own span for every motion but a path, and `swap` recomputes `span` and `tail` from the new
definition, so an edit that shortens a lifetime wraps the phase under a looping rig exactly as a
tune does. The pool decision 2.5 exists to keep is then emptied by the edit that was meant to leave
it alone. The phase moves with the edit for the same reason it moves with the rig.

**A scaled basis reaches `Quaternion.setFromRotationMatrix`, which reads a rotation alone.** The
spawn frame is `world x (yaw x standing(rotationOverride) x diag(scaleOverride))`, and `worldOf`
copies the system transform's upper block with whatever scale it carries. `Quads` hands those
columns whole to the vertex shader, which applies the scale correctly, where `Meshes` read a turn
off them and dropped the size. `unscaleInto` in `basis.ts` takes each column's length out of the
basis and reports it, `face` reads the turn off what is left, and the lengths multiply into the
per-particle `SPREAD` that `Matrix4.compose` takes beside the turn.

The census says which half of that is shipped. **`scaleOverride` (`0x0e5b32e1`, `Vec3`, default
`[1,1,1]`) is authored on zero objects of the whole dump**, so `overrideInto` is a rotation on
everything that ships. That is 2.29's own count carried forward rather than a fresh census, which a
field with no writers has no values to run. **`transform` (`0xe1ad931b`, `Mtx44`) is authored on
151 of 9,087 `VfxSystemDefinitionData`, and 13 of those carry a scale** — 110 are a rotation or a
translation alone and 28 are the identity written out. Seven of the thirteen are one object,
`0x7357c318`, repeated across seven map bins, so the scale reaches **seven distinct systems**.
The census is gated on the class hash because `0xe1ad931b` is `transform` on map materials too,
and an ungated walk over the same corpus returns 11,099.

Twelve of the thirteen are uniform, between `0.5` and `2.0`, and a uniform scale commutes with the
rotation either side of it, so `compose(place, turn, spread)` is exact for them.
`characters/sru_baron/skins/skin0.bin` `0x15d6632c` is the one per-axis writer, `[0.5, 1, 1]`, and
there the frame is `R_frame x diag(s) x R_roll`, which a translation-rotation-scale compose cannot
hold. It is exact only where the particle's own roll leaves the halved axis alone. **One shipped
system draws its meshes on an approximation**, and the exact form is a matrix built by hand for a
path whose camera alignment, orbit and roll are all quaternions.

**Three limits of the fix, all recorded rather than closed.** The `AlignYawToCamera` and
`AlignPitchToCamera` branch of `face` returns before the spawn frame is read at all, so a
camera-aligned mesh on one of those seven systems still draws unscaled, where `Quads` multiplies
the same frame in. Whether the engine's look-at drops the frame's scale along with its rotation is
unattested. `unscaleInto` normalises by column length, so a transform of negative determinant
still reaches the quaternion as a reflection, filed under the unscaled rows. And no test reaches
`face` itself: `unscaleInto` carries three of its own and
the composition at the call site carries none, because a mesh draw needs a camera and a renderer.

`axisInto` carries the same hazard one step further out: its doc says the unit vector a basis sends
an axis to, and it reads the column without normalising it, so `Trails` takes a strand's side
vector off a scaled frame at the scaled length. Unread against these seven and not changed here.

**Two lows behind them.** `swap` compared emitter _count_, so an edit that replaced one emitter, or
moved one between `complexEmitterDefinitionData` and `simpleEmitterDefinitionData`, kept every live
particle of that index evaluating against another emitter's curves and textures. The pool's
`emitter` column is a position in the concatenated list, so an index addresses the same definition
only while its list, its place in that list and its name all hold, which is what `addressTheSame`
compares. The name is what tells a replacement from a tune, and the price of it is that **renaming
an emitter restarts the effect** where decision 2.5 would otherwise keep the pool.
`appearance` wrote into the caller's reused scratch with `sampleCurveInto`, which writes
only the channels the curve carries, so a type-mismatched bin left the previous particle's channels
in place — `drawnPlaceInto` guards the identical hazard with `WORLD_ACCELERATION.fill(0)` and
`appearance` was the one caller that did not. Both factors now stand at one before the curve, which
leaves a missing channel on the birth value alone.

`writesStencil` is dropped. It read the two write-mask modes for a material that never enabled
the compare, and it followed the stencil compare table out for the same reason.

### 2.32 A child set is one linked system, and a force field is a noise field

The two rows section 4 ranks next, censused inside their own classes rather than counted at the
pointer, generalising the same approach to any class hash reached through a `Pointer`. Both
totals match 2.29's, 1,320 and 1,224, so the presence counts stand and what follows is the shape
behind them.

**T9 is one shape and the rest is a tail.** `VfxChildParticleSetDefinitionData` (`0xb520045a`) is
1,320 objects over 87 bins, and `childrenIdentifiers` (`0x663f55e6`,
`List<Embed<VfxChildIdentifier>>`) is authored on 1,319 of them. **1,214 hold exactly one child**,
68 hold three, 28 two and 6 five, with one each at four, seven and eight. Behind them
`boneToSpawnAt` (`0x64fe08ec`) reaches 166, `childEmitOnDeath` (`0xc35d9c0f`) 150 and **every one
of those is `true`**, `childrenProbability` (`0xf1d201d5`, `Embed<ValueFloat>`) 50, and
`ParentInheritanceDefinition` (`0xdc65f8fe`) 12.

`VfxChildIdentifier` (`0x969aee94`) is 1,523 objects naming a system two ways and never three:
`effect` (`0x6e6e8d54`, `Link<VfxSystemDefinitionData>`) on 805 and `effectKey` (`0x9b0300f3`,
`Hash`) on 718, with `effectName` (`0x48130c4f`, `String`) on **zero**.
`VfxParentInheritanceParams` (`0x12ab5c27`) is 12 objects in 3 bins of which **10 author nothing at
all**: `Mode` (`0xec6ee012`, `U8`) is written twice, both `10`, and `RelativeOffset` never. So the
build is one linked system spawned per child, the flag that spawns it on death, and a probability
on 3.8% — and the inheritance params are a stub rather than a gap.

**T4 is a noise field wearing a collection.** `VfxFieldCollectionDefinitionData` (`0xbbc023b8`) is
1,224 objects over 146 bins, and **every list it holds is exactly one entry**:
`fieldNoiseDefinitions` (`0xfa390047`) on 892, `fieldAttractionDefinitions` (`0xc3e452a8`) on 216,
`fieldDragDefinitions` (`0xb639c899`) on 136, `fieldOrbitalDefinitions` (`0x6a906762`) on 88 and
`fieldAccelerationDefinitions` (`0x5d60e987`) on 56. That is 1,388 fields over 1,224 collections,
so a collection is one kind and a second is the exception, and **noise alone is 64% of the
population**.

Inside the kinds, `Position` (`0x934f4e0a`, `Embed<ValueVector3>`) is the field that separates
them: attraction authors it on 85.2% and drag on 32.4%, where noise authors it on 15.0%. Noise
carries `axisFraction` (`0xcf0bf7fe`, `Vec3`) on 891, modal `[1,1,1]` on 630 of them, with `radius`
(`0x0dba4cb3`), `frequency` (`0x2fb31c01`) and `velocityDelta` (`0x0bad81a4`) each on about 82%.
Attraction is `radius` on 99.5% and `acceleration` (`0x2fa0ba9d`, `Embed<ValueFloat>`) on 98.6%.
Drag is `radius` and `strength` (`0xe07a18b0`) on 97.8% each. Orbital and acceleration are the two
thin ones: `isLocalSpace` (`0x3040923e`) is `false` wherever it is written on either, orbital's
`direction` (`0xdf6dc76a`) reaches 36.4% so 56 of 88 orbital fields ride the default, and 13 of the
56 acceleration fields author neither of their two properties.

**The ranking the census argues for.** T9 ahead of T4, because one child, one link and one death
flag covers 92% of the child sets, where a force field pass is five kinds of which four are needed
for a third of the population. Within T4, noise first and orbital and acceleration last. The
magnitudes are unread: every field above a `Vec3` is an `Embed` of a value class, and a build that
depends on what is inside one needs the same kind of value census that opened `birthDrag`.

### 2.33 A child set is a system of its own, riding its particle

T9, built in the order its tier names: the one-child birth path, the death spawn, then the
inheritance bits. Bones wait on T6 and the inherited scale waits on a reading.

**The resolver reaches 1,257 of 1,523 children, 83%, where it reached 805, 53%.** A census
classifies every shipped `VfxChildIdentifier` by how it names its system, off the bins as shipped
and under the same first-resolver rule `resolve.rs` takes. 805
carry an `effect` link to a system of the same bin, which the resolver already inlined. 452 carry
an `effectKey` that a `ResourceResolver` of the same bin maps to one of its systems, 215 a key no
resolver of the bin holds, and 51 a key that resolves to another bin. No shipped key is mapped to
a null link, and every in-bin target is a `VfxSystemDefinitionData`. `resolve.rs` now inlines
the 452: a `resourceMap` entry is read off every `ResourceResolver` of the document, the first
resolver holding a key wins, and a key mapped to a null link stays a key, because a null link is a
hit that suppresses the effect. The reader takes `effect` ahead of `effectKey`, which is the
engine's own order, and a child it cannot reach keeps its place so `childrenProbability` indexes
the list as authored.

**Each child is a system: its own pool, its own emitters and its own stream.** `children.ts` holds
them. A child is created after its parent's step, for every particle born since the last, and first
stepped on the step after. It stands on its particle's drawn
place and whole turn, with the turn's scale taken out, and follows both live. The particle's death
stops the child and leaves it where it stood. **That the child's particles then play out
under its own linger policy is a reading**: the engine's own description says they play out, and
the preview applies the same linger policy to it, whose `particleLinger` default is attested as
`0.0`. So a child whose emitters write no linger loses its particles at once, as a stopped root does. A
child is reaped once it has nothing to draw and nothing to spawn. Its stream
is seeded off the viewport's seed, where it hangs in the tree and the serial of the particle it
rides, so the parent's stream is untouched and a seek reaches the children a play reaches, which
is why a rewind now starts the serials over.

**The death spawn replaces the birth spawn.** The last step's place and turn of every
particle of a death-spawning emitter is kept, and a particle missing from the next step spawns its
child there, never following anything. A fire-and-forget child whose emitters never end would run
for good, so the preview stops one at its own `systemSpan`.

**`childrenProbability` is the index of section 4**, `max(0, value) % count`, read at zero on a
birth and at the lifetime on a death, and only for a set of several children and no bones, so a
one-child set draws nothing off any stream. The lifetime passed is seconds, as
`GetParticleLifetime` returns, against the curve's own key times, and it is the one the last step
left, so a linger cap landing in the step the particle dies is not seen. A set naming bones spawns nothing: each child needs its
bone on the emitter's pose, a preview holds none, and a missing pose is a silent skip.
The same guard, fewer bones than children, lands in the same place.

**The caps are the renderer's own**, since the engine bounds neither recursion nor cycles. The tier asked for a depth cap and one pool budget, and the build adds a count: a child nests
four deep at most, 512 children live at once, and together they hold room for 131,072 particles,
each pool sized off the child's own rates between 16 and 4,096 and recycled on reap. The
resolver's open-object guard already ends a cycle as a link, which reads as no child.

**The inherited scale is one, and exact for 1,988 pairs of 2,699, 74%.** The inherited scale is
`|system scale * scaleOverride * particleScale|`, and the census pairs 2,699 parent emitters with
their inlined children's emitters on the parent's `birthScale0.x * scale0.x`, read off each
constant and the schema's default of one where the field is unwritten. No parent authors that
scale as a curve alone, and the 90th percentile stands at `15.0`. So an inherited scale of one is
exact on every pair where the parent is authored at one, whichever of the particle's scales
`GetParticleScale` returns, and the open question is the tail: whether that getter reads the birth
scale times the curve or the curve alone. Mode bits `0x4`, `0x8` and `0x10` all act on that scale,
so all three are no-ops until it is read.

**`ParentInheritanceDefinition` is built where it is not a scale.** `0x2` stands the child on the
frame the particle was born in, dropping the particle's own turn, and `RelativeOffset` is added to
the particle's place, turned by the particle's whole turn unless `0x1` is set. The two bits sit at
separate sites, so `0x2` leaves the offset's turn alone. An edit to either reaches a
child already live. 2.32 found the offset authored on
no shipped object and ten of the twelve inheritance objects authoring nothing, so the only shipped
`Mode` is `10`, which is `0x2` and `0x8`.

**The draws read every live child of a definition.** `Quads`, `Meshes`, `Trails` and `Beams` take a
list of sources, each a pool with its clock and placement, where they took one pool and one clock.
The driver is the one source of the opened system's emitters and keeps a live list per child
definition, addressed by a path of emitter index and child slot, `3.0`, with a grandchild after a
slash, `3.0/1.0`. `drawnEmitters` in `definitions.ts` lists every emitter the viewport draws, the
opened system's first and each child's after it in draw order, and the textures and meshes are
keyed by that entry. Solo narrows to the opened system's emitter a child descends from. A trail
strings each source's particles as a strand of its own, and a beam reaches from each source's own
ends. A palette's scroll is one uniform per emitter, so every child of one definition takes the
first one's phase.

**An edit keeps the children it can.** A swap that keeps the opened system's shape repoints every
child at the definition it holds under the same path, and drops one whose own shape changed, the
rule decision 2.5 keeps one level up.

**Not inherited and not built.** Colour, velocity and the seed are not inherited, attested from
the creation path. **What is inherited and is not built** is the parent system's material
overrides, its palette and quality index and its skin and texture handle: a preview system
carries none of the first three, and the handle is a character's. Camera-facing
sizes do not take a system's scale, which holds for a root transform's scale too, 2.31. A
definition inlined at two places is two definitions whose textures load twice. The resolver takes
the first `ResourceResolver` of the document holding a key, where the engine's own "newest wins"
is the order resolvers were added to a live scope, which a bin does not record. Only a
`VfxChildIdentifier`'s `effectKey` is resolved, since other classes write the field and nothing
reads theirs as a child. None of this has been judged on the screen.

### 2.34 A beam scrolls along its length, and a locked alpha holds the whole texture

`Xerath_Base_idle` is what showed both. Its body energy is fifteen idle effects, each a
`VfxPrimitiveBeam` from a joint to its `targetBoneName`, and two of its textures carry the reading
in their channels:

- `Xerath_Base_Q_Beam_03` is white, with its whole shape in the alpha: a column down `v` with a
  torn edge either side. `BaseEnergyBlend` scrolls it at `birthUvScrollRate (0.5, 0)`.
- `Xerath_Base_Q_BeamEnergy` is a 4x4 book of wisps whose alpha is one rounded square over the
  whole texture rather than one per cell. `BaseEnergyAdd` draws it under `LOCK_ALPHA`.

**A beam's texture runs `v` along the length, and its `u` scroll runs along it too.** A census of
every champion WAD, 174 of them, tallies each ribbon emitter's texture by its aspect and its
scroll by the axis it moves:

| Family          | Tall  | Wide   | Scrolls `u` | Scrolls `v` | Tall, `u` | Tall, `v` |
| --------------- | ----- | ------ | ----------- | ----------- | --------- | --------- |
| Camera trail    | 1,545 | 39,102 | 36,523      | 771         | 676       | 174       |
| Arbitrary trail | 1,211 | 23,453 | 20,791      | 741         | 501       | 187       |
| Beam            | 5,708 | 1,842  | 6,155       | 2,510       | 2,884     | 843       |

A trail's `u` runs along its length, and its
textures are wide and scroll `u` by 28 to 47 to one. So an artist lays a ribbon's long axis along
the length and scrolls along it. A beam's textures are tall, which is `v` along the length, paired
with `mBirthTilingSize.y`, and they still scroll `u`. Both hold only where the
particle's transform acts on the place along the beam first and across it second, and lands
transposed. `cornerInto` runs `uvInto` on `(along, across)` and swaps the pair. Before this,
`Beam_03`'s column slid across the beam and wrapped at its edge, which is the hard cut the screen
showed. Xerath's Q agrees: `Xerath_Base_Q_beam` tiles `y` at 700, 1,100 and 1,400 against a
1,450 range and scrolls `u` at `-2` and `-3`. Which of the two a flip and a turn act on is not
attested, and both follow the transform.

**`LOCK_ALPHA` samples the whole texture.** A quad's alpha is attested at its own corner, `{0,0}`
to `{1,1}`, and a mesh's at its uv turned and scaled without the translation column. A book's cell
is a translation, so neither reads it, which is what `BeamEnergy`'s one rounded square assumes.
The quad and the mesh both sampled the alpha inside the particle's cell, and a ribbon ignored the
mode. `alphaUv` on the ribbon now carries its uv turned and scaled without the scroll, and the
fragment pass reads the alpha there under the layer's address mode. A ribbon takes the mesh's
reading, since neither primitive is attested for it directly.

The screen confirmed both on `Xerath_Base_idle`, the flow's direction along each beam included.

### 2.35 An attached mesh draws its character, and a bone set spawns on its joints

The skin preview holds the character both readings need, so both draw there. A particle viewport
of one system still draws neither.

**An attached mesh is the character's skin under the particle's material.** Section 2.18 has
kinds 11 and 17 answer with the owner's own skinned mesh and copy its bone palette per particle,
the attachment keeping the owner's place and turn and dropping the
particle's. `AttachedMeshes` draws one `SkinnedMesh` a particle, up to eight an emitter, on the
`Character`'s own geometry and skeleton through `useCharacterSkin`. Its bind is detached and the
identity, so a skinned vertex lands where the character stands and the mesh's own transform is the
particle's scale. The material is the mesh emitter's fragment pass with the per-particle values
as uniforms.

A census of the 174 champion WADs counts 65,274 attached emitters, and it settles the scale:

- `birthScale0` is unwritten on 40,445, at its schema default `(1, 1, 1)`, and the two commonest
  written constants are `(1, 1, 1)` and `(1.01, 1, 1)`. `isUniformScale` is on 48,926 and never
  off. So the particle's scale multiplies the character's size, and `1.01` is a shell one percent
  out.
- `scale0` is written on 6,549, 6,055 of them keyed and most from zero, which is a grow-in.
- `mSubmeshesToDraw` narrows 46,099 and `mSubmeshesToDrawAlways` adds to 24,716. `rangesDrawn`
  reads both as section 2.14 has a mesh read them, with the character's hidden submeshes taken out
  after the first and the always list added after that. So the character keeps a geometry group
  for every submesh and hides one by its material.

Where the engine's bone palette carries `skinScale` is not traced, so the preview takes the
character as drawn. The polygon offset that holds an overlay in front of the skin is the
renderer's own: `depthBiasFactors` ships on 39,522 of these emitters and is unread, and so is
`reflectionDefinition` on 23,053, which is the rim most of them draw.

**A bone set spawns on the character's joints.** Every
child of a set naming bones spawns, child `i` at bone `i`, and a set with fewer bones than
children spawns none. The joint is read under the pose re-rooted at the parent particle, so a
child stands at the particle's place plus the joint's origin turned by the particle, under the
particle's turn times the joint's. A carried child follows its joint every step, a death child
stands where it was spawned, and a joint the skeleton lacks skips that child alone. The rig
carries a `joints` lookup, which `idleRig` fills off the pose at `skinScale`, and each bone child
draws off a stream of its own. Of 2,870 shipped bone sets the commonest names are `joint1`,
`joint2` and `Root`. The first two read as an effect's own rig rather than a champion's, which a
skinned mesh primitive would carry, so the preview finds the `Root` and `Head` sets on the
character and skips the rest, as a missing joint is skipped.

Neither has been judged on the screen.

### 2.36 A force field acts on the step's velocity, and noise is a reading

T4, built off a census of every field collection in the 174 champion WADs, and four further
readings.

**The census**, over the 174 champion WADs. 41,198 emitters carry a
`fieldCollectionDefinition`, 155 of them simple. Noise is on 26,404, drag on 8,533, acceleration
on 6,619, attraction on 4,606 and orbital on 3,232, and a list holds more than one field on ten
collections. Section 2.32 counted the 16.17 dump of `data/characters`, 1,224 collections whose
every list is one entry, and this counts every champion WAD, which is where the ten come from. Noise alone is 23,278 collections, then drag alone 4,274, acceleration alone 3,131
and attraction alone 2,337, and acceleration with drag is the commonest pair at 1,837. Almost every
value is a constant:

- Noise: `frequency` modal at 10 then 50, 5 and 75, `velocityDelta` at 20, 10 and 50, `radius` at
  500, 1,000 and 100, and `axisFraction` `(1, 1, 1)` on 20,351 of 26,097. `Position` is written
  on 4,384. 4,926 fields leave all three scalars at zero and draw nothing.
- Attraction: `acceleration` at 100 and 200 over a `radius` of 500, keyed on 806. Drag:
  `strength` at 2 and 1 over a `radius` of 1,000.
- Orbital `direction` is written on 1,342, and `isLocalSpace` is written only as `false`, on
  1,956 orbital and 6,427 acceleration fields, against its `true` default.

**The four attested kinds.** `forceFields.ts` holds one pure function each.
Acceleration adds `a * dt`. Attraction pulls at a constant `strength * dt` inside its radius, the
distance it normalises by floored at one unit. Drag takes `strength * dt` of each axis and never
turns one round. Orbital turns the motion across its axis tangential about the emitter, keeping
the speed, the motion along the axis and the sense it already turns in. `applyFields` runs them in
the engine's own order after the particle's own drag, so a drag field damps the noise of the same step.

**Four further readings, each the user's own pick:**

- **What a field changes stays.** The engine hands the fields `&V`, the step's velocity with the
  emitter's drift in it, and only the per-particle drag writes back. The preview keeps the
  change in the particle's own velocity, so a field is a force: an attraction accelerates and
  noise random-walks. That is also the reading under which noise weakens at fewer substeps.
- **Noise is one kick a step.** `velocityDelta` along a unit direction, scaled per axis by
  `axisFraction`, inside `radius` of `Position`. The direction holds for each `1 / frequency`
  seconds of the particle's age, every engine step at a frequency of zero, and is hashed off its
  serial, the field's place and that window, so a seek replays it without drawing from the
  system's stream.
- **A kick is brought to 30 Hz.** Noise is not `dt`-scaled and the engine steps at 30 Hz on High,
  where the preview steps once a frame, so a kick is `velocityDelta * dt * 30`. A longer step
  kicks at most the stepper's eight times, as the engine's own halving of a backlog bounds it.
  Orbital needs nothing, being the same however many steps run.
- **A field stands on the emitter's frame.** `Position` is added to the emitter's own offset, its
  `EmitterPosition` and `translationOverride`, turned by the spawn frame and added to the origin
  the step starts from. So a field of no `Position` stands where the emitter's particles are born,
  an orbital field turns about that point, and a radius widens with the frame's scale.
  `isLocalSpace` turns an acceleration or an orbital axis by the same frame. Every value is read
  at the emitter's own life, as `acceleration` and `drag` already are.

**What the screen judged.** `Aatrox_Skin40_Death_ambers`, `Akshan_Skin20_Z_Zenchar` and
`Ashe_Skin76_Emote_Joke_Wind` carry noise alone, `Ahri_Skin04_dance` attraction, drag and
orbital together, `Amumu_Base_BA_Dust` acceleration with drag, and
`MonkeyKing_Skin01_Idle_Hand_R_Fire_01` an orbital field on an idle effect. The screen confirmed
every example the census named, noise's reading included.

### 2.37 Depth bias reaches every draw path, and an attached mesh keeps its stand-in for none

**A correction to 2.35.** That section says `depthBiasFactors` "ships on 39,522 of these emitters
and is unread". It was read, into `EmitterModel.depthBias` off `FIELD.depthBias` in
`readVfxSystem.ts`, and it reached the quad alone: `quadMaterial` turned it into a polygon offset
and `DepthPushPull` into a step along the view's forward axis. The mesh, attached mesh and ribbon
materials took neither, and `attachedMaterial` set a fixed `-1`/`-1` in its place.

**The pair reaches all four materials now.** The material builder every complex emitter shares
compares the pair against zero and applies it only where it is non-zero, so the reading was never
the quad's own. `polygonOffsetOf` in `quadMaterial.ts` is that rule, and the mesh, attached mesh
and ribbon materials take it as the quad does. `DepthPushPull` stays on the quad. It is the shader
constant `PARTICLE_DEPTH_PUSH_PULL`, and which of the mesh and ribbon shaders read it is not
attested.

**The census**, over the 174 champion WADs. The field is written only where it is non-zero, on
every family:

| Family          | Emitters | Pair written | Both negative | Both positive | Modal pair         |
| --------------- | -------- | ------------ | ------------- | ------------- | ------------------ |
| Mesh            | 339,645  | 38,810       | 30,425        | 3,880         | `(-1, -100)`       |
| Attached mesh   | 65,274   | 39,522       | 36,290        | 1,116         | `(-1, -1)`, 13,107 |
| Beam            | 14,124   | 439          | 368           | 21            | `(-1, -2)`         |
| Camera trail    | 51,511   | 6,067        | 4,343         | 474           | `(-1, -35)`        |
| Arbitrary trail | 33,557   | 5,382        | 3,883         | 367           | `(-1, -17)`        |
| Arbitrary quad  | 298,329  | 27,186       | 21,973        | 814           | `(-1, -80)`        |

The first component is `-1`, `0` or `1` almost everywhere and the second runs from `-1` to
`-200`, which is the slope and the constant the quad already read them as.

**An attached mesh authoring no pair keeps the stand-in.** 25,752 attached emitters write none.
The engine offsets those by nothing and the preview by `OVERLAY`, `(-1, -1)`, the modal authored
pair. The stand-in is the renderer's own, because the character and its overlay run the same
skinning through two different programs here, and a rounding difference between them would lose
the overlay the depth test. An authored pair replaces it whatever its sign, so the 1,116 positive
pairs push the overlay behind the character as the engine does.

**What to check on the screen**, after a full reload. A negative pair pulls toward the eye and a
positive one pushes away:

- Attached mesh, in the skin preview: `Aatrox_Skin26_E_Active_buff` (`Avatar`, `(-1, -1)`, the
  stand-in's own value) and `Akali_Skin85_Q_Kunai_Child` (`Avatar_outer Edge`, `(1, 30)`, now
  behind the character).
- Mesh: `Aatrox_Skin10_P_Ready` (`CrystalHighlights`, `(-1, -3)`) and `Ahri_Skin25_Orb`
  (`Inner_LightShadow1`, `(1, 13)`).
- Beam: `Aatrox_Skin09_W_Beam_Tar` (`Chain`, `(-1, -25)`) and `Renata_Skin12_Q_tether`
  (`StraightArm_Pulse`, `(1, 3)`).
- Trail: `Aatrox_Skin31_Idle_01` (`Flame_Trail5`, `(-1, -50)`), `Ahri_Skin04_Orb`
  (`Ribbon_Light`, `(1, 1)`) and `Anivia_Skin23_Idle_Tail` (`Soft_Trail_2`, `(1, 20)`).

### 2.38 A ribbon reads the colour ramp and the palette

**A correction to "What of T8 is built".** That section closes on "none of the three ribbon and
mesh materials carry a palette yet". The mesh materials do. `meshMaterial` and `attachedMaterial`
share `layerUniforms` with the quad, so they carry the palette's uniforms, and `Meshes` and
`AttachedMeshes` move its scroll every frame through `sourcesScrollInto`. What a mesh drops is the
ramp, its `colorTexture` passed as null, because the mesh fragment shader reads the lookup at a `$Globals` value
once a draw. The ribbon carried neither.

**The census**, over the 174 champion WADs. "Kept" is what survives the binding table that drops
the ramp under a mult layer or an erosion:

| Family          | Ramp written | Kept  | Dropped by a mult layer | `Y` is `BIRTH_RANDOM` | Palette with a texture |
| --------------- | ------------ | ----- | ----------------------- | --------------------- | ---------------------- |
| Beam            | 2,252        | 1,071 | 1,084                   | 181                   | 483                    |
| Segment beam    | 12           | 12    | 0                       | 4                     | 0                      |
| Camera trail    | 2,531        | 2,014 | 366                     | 254                   | 1,264                  |
| Arbitrary trail | 2,201        | 1,410 | 231                     | 491                   | 667                    |

Of the kept ramps, `colorLookUpTypeX` is `LIFETIME` on 1,057 beams, 2,002 camera trails, all 1,410
arbitrary trails and all 12 segment beams, and `CONSTANT` or `BIRTH_RANDOM` on the other 26.
`colorLookUpTypeY` is `CONSTANT` on 889, 1,757, 899 and 8 of them, `BIRTH_RANDOM` on 181, 254, 491
and 4, and `LIFETIME` or `VELOCITY` on 1, 3, 20 and none. `paletteDefinition` is on 517 beams,
1,307 camera trails and 703 arbitrary trails, and names a texture on 483, 1,264 and 667 of them.
Xerath's `BaseEnergyBlend`
writes `common_color-hold.tex`, which is plain white, so it shows nothing either way.

**What is built.** `colorUniforms` in `quadMaterial.ts` holds the palette's and the ramp's
uniforms for all three materials, and the `COLOR` chunk is the fragment step the quad and the
ribbon both run, the palette and then the ramp. `lookup` is a new ribbon vertex attribute:
`writeTrail` puts each point's lookup on both of its vertices and `writeBeam` the particle's on
all four corners, each from `colorLookupInto` as a quad's is. `Beams` and `Trails` move the
palette's scroll every frame as `Quads` does. A ribbon still draws no mult layer, but an authored
one drops its ramp. The binding table keys on the definition's `MULT_PASS`, so the ramp now drops
whether or not the mult texture has arrived, on the quad as well. Before, a quad drew the ramp
until the texture loaded and kept it where the texture never did.

**The per-particle lookup is a reading.** The quad's vertex stream and the mesh's uniform are
attested, and neither ribbon builder is. So a trail's `LIFETIME` ramp runs along the trail by each
point's age, and a beam takes its one particle's. Where the engine feeds it on a ribbon remains
open.

**What to check on the screen**, after a full reload:

- Beam ramp: `Amumu_Skin57_Q_beam` (`Beam_Chain`) and `Xerath_Base_Q_beam` (`BeamBlast`, a
  segment beam on a `BIRTH_RANDOM` row). Beam palette: `Aatrox_Base_W_Beam_Tar` (`Chain1`) and
  `DrMundo_Base_E_Beam` (`BeamBack2`).
- Camera trail ramp: `Ahri_Skin05_BA_mis` (`Flame_trail1`) and `Jade_Ashe_Base_Q_mis`
  (`misttrail`, `BIRTH_RANDOM`). Camera trail palette: `Ahri_Base_R_mis_02` (`Ribbon_1`) and
  `Akshan_Skin10_BA_mis` (`ORA_TRAILYUS1`).
- Arbitrary trail ramp: `Braum_Skin25_Q_mis` (`Trail3`) and `Alistar_Base_P_Heal_mis_01`
  (`trail_1`). Arbitrary trail palette: `Amumu_Skin44_Q_mis` (`Trail1`) and
  `Aphelios_Skin09_Q_Tar_ChildParticle` (`Trail_FG_Horizontal`).

### 2.39 `kAnalyticDragMotion` eases a particle out by the closed form

Sections 2.23 and 2.30 left it unbuilt and waiting on its own decision. The user's pick, on the
census below, was to build it as two pure functions in `analyticDrag.ts` beside `integrate()`.

**What the engine does.** Under the system's `flags & 0x100` the physics velocity is zeroed at
birth, and a per-axis terminal `birthVelocity / birthDrag` is held, zero on an axis whose birth
drag is not above zero. Each step moves the offset still to travel to `e^(-k * age)` of that
terminal, `k` being the step's drag sum, and adds what it moved over `dt` to the step's velocity.
Without the flag the stepped drag of 2.30 runs.

**The census**, over the champion WADs, the WADs at the root of
`DATA/FINAL` and `Maps/Shipping`:

| Where           | Systems | With the flag | Emitters under it | Birth velocity with a drag | With no drag |
| --------------- | ------- | ------------- | ----------------- | -------------------------- | ------------ |
| Champions       | 188,481 | 5             | 101               | 26                         | 4            |
| `DATA/FINAL`    | 34,084  | 45            | 353               | 39                         | 7            |
| `Maps/Shipping` | 27,758  | 23            | 124               | 9                          | 3            |

27 of the 45 in `DATA/FINAL` draw on the HUD layer, `drawingLayer` 1, the `SR_Pings_*` family
among them. Their modal pair is a `birthDrag` of `(0, 50, 0)` under a `birthVelocity` of
`(0, -2000, 0)`, a drop of 40 units. No emitter under the flag authors an `acceleration`, 25 author
a drift `velocity` and 2 a field collection.

**How it differs from the stepped drag.** The preview steps once a display frame, and on the
pings' modal pair the stepped drag's series lands at `v0 / k * (1 - k * dt)`: 6.7 units of the 40
at 60 Hz and 26 at 144 Hz, and at 30 Hz its clamp stops the particle on the first step. The
closed form puts a particle at the same place at the same age at any rate. Under the flag an axis
with no birth drag takes nothing of its birth velocity, whatever `drag` says, and 14 emitters
author a birth velocity with no drag at all. The acceleration, the drift and the fields still move
such an axis. The acceleration and the drift go undamped, because the closed
form replaces the damping of `V` rather than adding to it.

**What is built.** `readSystem` reads `flags` (`0x9c677a2c`, `U16`, default `0xD4`) into
`SystemModel.dragMotion`, and `stepEmitters` takes the system rather than its emitter list so the
flag reaches the step. `emit` turns the birth velocity into `pool.dragTerminal` and
`pool.dragOffset` through `analyticTerminal` and zeroes it. `integrate` adds the offset's fall over
the step, over `dt`, to the step's velocity through `analyticOffset` where the stepped drag would
run. The force fields then act on that velocity as 2.36 has them, and what they change stays in
the particle's own velocity, which the flag leaves undamped. A child system reads its own flags.
The engine tests the drag sum as a whole vector before the branch and the preview runs each axis
alone, which agree wherever no drag is negative.

**What to check on the screen.** `Tristana_Skin80_W_land`, 14 of whose emitters author a birth
velocity with a drag, `Lucian_Skin50_W_Child_Self` and `Skarner_Skin03_Recall_Ground_01`, and in
`Global.wad.client` `SR_Pings_Caution`. A particle should ease to a stop at the same place however
fast the display runs.

### 2.40 A particle mesh crosses the mirrored axis, as the character does

**What the screen showed.** `Ahri_Base_R_mis_02` on `Missile`. `cone_add` draws
`Ahri_Base_Sharp_Mesh.scb`, a cone whose tip sits at its origin and which opens along `+X`, from a
radius of 27 at the tip to 103 at `x = 151`.
`birthRotation0 (0, 180, -90)` lays that axis on the flight frame's `-Y`, which is behind the
missile, and the table's random `Y` spins the cone about its own axis. The preview opened it ahead
of the missile, against the flames trailing behind.

**Why.** `Meshes` hands the instance the engine's turn conjugated across the mirrored axis,
`S * M * S`, which is right for a vertex already in the viewport's space. The geometry arrives in
the engine's space, as `preview/mesh.rs` states and as the character's `.skn` was settled on the
screen, so every particle mesh drew at `S * M * S * v` rather than `S * M * v`: mirrored in its own
frame. A mesh symmetric across its own `YZ` plane shows nothing of it, and one modelled along its
`X`, as this cone is, turns end for end.

**Section 2.22 is corrected.** It removed the mirror over `Riven_Base_R_Sword`, whose blade drew at
the opposite handedness to the glow quads around it, and concluded that the vertices arrive in the
viewport's space. The backend never mirrored them, and the character's handedness, settled a day
later, says the files hold the engine's. `geometryOf` in `useVfxMeshes.ts` mirrors the positions and
the normals again and swaps two corners of each face, so a face keeps facing the side it faced.
What the sword showed is not explained, and it is the first thing to look at again.

**What to check on the screen**, after a full reload: `Ahri_Base_R_mis_02` (`cone_add` opening
behind the missile, around its flames) and `Riven_Base_R_Sword` (the blade against its glow quads).

### 2.41 The arbitrary quad's uv is the attested pair across the mirror

The screen confirmed 2.40 on `Ahri_Base_R_mis_02` and showed `Riven_Base_R_Sword` wrong, as 2.22
had seen it. The sword settles the arbitrary quad's uv, because both of its halves are asymmetric
and authored against each other:

- `exile_new_sword_fit_base_03.scb` is flat in its own `X`, runs from the grip at `-Y` to the tip
  at `+Y`, and bulges toward `-Z`, from a grip centred on `Z = 0` to a tip at `Z = -10`.
  `Sword_Mesh01` turns it by `(0, 1, 0)` alone.
- `sword_profile_glow_02.tex` is the same sword with its tip at `v = 0`, bulging toward `+u` from a
  grip left of centre. `Glow_Back` and `Glow_Mult` draw it on `VfxPrimitiveArbitraryQuad` at
  `birthRotation0 (0, -90, 89)`.

In the engine's own space, with the attested pair `u = y + 0.5` and `v = 0.5 - x`, that
turn lays the quad's `x` on `+Y` and its `y` on `-Z`. So the glow's tip lands on the blade's tip and
its bulge on the blade's bulge, and the art agrees with the attested pair.

The preview's corner rides the basis mirrored across `X`, which puts its corner `(x, y)` at the
engine's `(-x, y)`. The pair that follows is `u = y + 0.5` and `v = x + 0.5`. Section 2.21 took
`u = 0.5 - y` instead, which is that pair mirrored in `u`, and 2.16 before it took the pair
unconverted, which is the pair mirrored in `v`. Each was a mirror of the answer, and the three
readings that flipped it are one reading. `ARBITRARY_UV` in `quadMaterial.ts` holds the table the
vertex shader interpolates, so a test reaches it, and the sword is that test.

`Aatrox_Base_W_Core_Area`, whose decals decided 2.21, changes with this and is the first thing to
check again, beside the sword.

### 2.42 A mesh draws its rim and its reflection, which no quad shader compiles

**What the shaders say.** `reflectionDefinition` is not otherwise documented, so this section
reads the shipped shaders directly. Every mesh vertex shader and every skinned mesh particle
vertex shader permutation carries `vFresnel`, and computes per vertex, with `I` the unit ray
from `vCamera` to the vertex and `N` the normal turned by `mWorld`:

```text
facing = saturate(dot(-I, N))
rim    = (1 - pow(facing, vFresnel.w)) * vFresnel.rgb
```

Half of each under `REFLECTIVE` add `reflect(I, N)` and an opacity
`lerp(vReflection.y, vReflection.z, 1 - pow(facing, vReflection.x))`. The mesh fragment shader
adds `cube * opacity * lerp(1, vReflectionFColor.rgb, opacity)`
and then `rim * alpha` to the colour, saturated, and leaves the alpha. The skinned mesh particle
fragment shader scales both terms by the texture's alpha before the particle's colour, where the
mesh fragment shader takes the drawn alpha. `REFLECTION_MAP` is a cube, bound at a fixed sampler
slot. Neither the quad vertex nor the quad fragment shader names either constant, so the 2,227
blocks the census finds on quads, rays, ribbons and projections draw nothing.

**The census**, over the 174 champion WADs:

| Family        | Emitters | Block  | `fresnelColor` | `fresnel` | `reflectionFresnelColor` | `reflectionMapTexture` |
| ------------- | -------- | ------ | -------------- | --------- | ------------------------ | ---------------------- |
| Mesh          | 339,645  | 36,563 | 33,036         | 30,205    | 12,449                   | 4,878                  |
| Attached mesh | 65,274   | 23,053 | 20,807         | 19,801    | 9,014                    | 3,660                  |

`fresnel` is modal at 0.1 on both, 9,372 and 6,960, a thin rim at the silhouette. The maps are
`generic_white_cubemap.dds` on 2,966 and 2,141, then `aatrox_cubemap.dds`, `samira_cubemap.dds`
and `generic_blue_cubemap.dds`. The opacities stay at their defaults, `0` facing the eye and `1`
edge on, on 29,462 and 18,009.

**The lanes are a reading, the user's pick.** `vFresnel` is `(fresnelColor.rgb, fresnel)` with the
colour's alpha unread, `vReflection` is `(reflectionFresnel, reflectionOpacityDirect,
reflectionOpacityGlancing)`, and `vReflectionFColor` is `reflectionFresnelColor`. The shader fixes
the shape and the names fix the lanes. The top twelve rim colours of the two families hold over
2,300 blocks at alpha zero, `(1, 0, 0, 0)` on 621 of them, which an alpha folded into the colour
would erase. Which value the CPU side hands in remains an open question.

**What is built.** `reflection.ts` packs the three constants. The mesh and the attached mesh vertex
shaders take the facing off the geometry's normal, the one `geometryOf` computes or the character's
skinned one, and `shone` adds both terms in the fragment pass. A quad keeps `sheen` at zero.
`REFLECTIVE` is on where a map is named and its cube has arrived. `?as=cube` on the preview scheme
answers a DDS cube's six faces as one strip, `render_cube` in `preview/texture.rs`, because
`ltk_texture` decodes the first face alone. The reflected ray crosses the mirrored axis back before
it samples, because the map is authored in the engine's space, and the faces go up in DDS order with
no flip. That a D3D cube and a GL cube agree on those faces is a reading, and `aatrox_cubemap.dds`,
which is asymmetric, is the one to judge it on.

**Read on the way, and not built.** The mesh vertex shader and the skinned mesh particle vertex
shader read `PARTICLE_DEPTH_PUSH_PULL` as `P + normalize(P - vCamera) * k`, engine units along the
ray away from the eye, and the quad vertex shader as `P + (P - vCamera) * k`, a fraction of the
distance. Section 2.37 reads `DepthPushPull` on the quad as `k` units toward the eye. What the CPU
hands the constant remains open.

**What to check on the screen**, after a full reload:

- Rim on a mesh: `Aatrox_Skin33_Q_cas3` (`Center_Ripple`, `(0.3, 0.55, 1)` at 0.1) and
  `Aatrox_Skin30_W_mis` (`Dragonup`, `(0.47, 0.77, 1)` at 0.02).
- Rim on an attached mesh, in the skin preview: `Aatrox_Skin26_E_Active_buff` (`Avatar`,
  `(0.56, 0.86, 1)` at 0.1) and `Aatrox_Skin37_Idle_Sword_fresnel` (`Temp_Avatar`, at 0.03).
- Reflection: `Ahri_Skin89_E_mis` (`shield`, `generic_white_cubemap.dds`, `-1` facing the eye) and,
  in the skin preview, `Aatrox_Skin26_Recall_ShrineAppear` (`SunAltar`, `aatrox_cubemap.dds`,
  `0.3` facing to `0.2` edge on).

### 2.43 A soft particle fades over its gap to the scene, against a depth pass of its own

**What the shaders say.** 128 of the quad fragment shader's 256 permutations, and 1,024 of the
mesh fragment shader's 2,048, compile `SOFT_PARTICLES` and bind `sDepthTexture`, slot 5 of the
sampler table. The skinned mesh particle fragment shader has no such define, and neither does the
quad's fixed-alpha-uv variant, which a quad under `LOCK_ALPHA` draws through. The quad and mesh
fragment shaders compute the same fade, with `P = cSoftParticleParams` and `C =
cSoftParticleControl`:

```text
depth(z) = 1 / (z * cDepthConversionParams.y + cDepthConversionParams.x)
gap      = depth(scene) - depth(fragment)
t        = saturate((gap - P.xy) * P.zw)
fade     = S(t.x) - S(t.y),  S(t) = t * t * (3 - 2 * t)
rgb     *= C.x + fade * C.y
a       *= C.z + fade * C.w
```

The fade comes last, after the colour, the mult layer, the rim and the reflection.

**The census**, over the same WADs:

| Family               | Emitters | Block  | `deltaIn` | `beginIn` | `deltaOut` | Modal `deltaIn` |
| -------------------- | -------- | ------ | --------- | --------- | ---------- | --------------- |
| No primitive written | 548,047  | 36,039 | 33,596    | 4,626     | 1,549      | 30              |
| Mesh                 | 339,645  | 24,874 | 23,773    | 4,638     | 623        | 50              |
| Ray                  | 55,387   | 11,742 | 11,444    | 1,232     | 166        | 50              |
| Arbitrary quad       | 298,329  | 10,456 | 9,377     | 1,942     | 1,052      | 30              |
| Camera trail         | 51,511   | 3,997  | 3,665     | 449       | 88         | 10              |
| Arbitrary trail      | 33,557   | 1,551  | 1,498     | 218       | 156        | 10              |
| Attached mesh        | 65,274   | 1,260  | 1,134     | 116       | 40         | 5               |
| Beam                 | 14,124   | 243    | 202       | 49        | 1          | 15              |

`beginOut` is written on 391 and the unnamed `0x3bf176bc` on 44, always as `2`. The attached
mesh's 1,260 draw no fade.

**Four readings, each the user's pick:**

- `P.x` is `beginIn` and `P.z` is `1 / deltaIn`. The names fix the lanes, and a width that reaches
  the shader as a rate is how the erosion's feathers reach it.
- The fade out starts `beginOut` past the end of the fade in, `P.y = beginIn + deltaIn + beginOut`,
  and `P.w` is `1 / deltaOut`. Measured from the scene instead, the 1,648 drawn emitters that write
  both widths and neither begin, `Akali_Base_E_Enemy_Indicator_Red` among them at `0, 10, 0, 10`, fade
  to nothing where the widths match and below nothing where the out width is the shorter.
- A side of zero width is off. The out side has to be, or every in-only emitter fades out wherever it
  draws. The in side takes the same rule, which reaches about 1,300 emitters that write `beginIn`
  and no `deltaIn`, 826 of them also writing a `deltaOut` on no primitive.
- The fade reaches what the blend weighs the colour by: the alpha under `alpha` and `alphaAdd`,
  both under `premultipliedAlpha`, and the colour under every other mode.

**What is built.** `softParticle.ts` packs `P` and `C`, and `fadeOf` drops the block for an
attached mesh and for a quad or a ribbon under `LOCK_ALPHA`. The quad, mesh and ribbon materials run
`softened` on the fragment. The ribbons fade on a reading, that they draw through the shared quad
fragment shader as the shared quad batch suggests. Every particle drawing colour moves to
`PARTICLE_LAYER`, and `Passes`, which replaces `Distortion`, draws the scene's layer alone into a
depth target before the colour pass whenever an emitter fades. A target is safe here where 2.25
found it wrong for the frame, because its colour is never read. `perspectiveDepthToViewZ` over the
camera's near and far planes has the shader's `1 / (z * a + b)` shape, and what the engine writes
into `cDepthConversionParams` remains open.

**What to check on the screen**, after a full reload, with the stage on so the ground is there to
meet:

- Mesh: `Ahri_Base_R_mis_02` (`cone_add`, `20, 10`), `Aatrox_Skin33_Q_Indicator_03`
  (`Projector_scan`, `0, 50`) and `Aatrox_Skin26_Recall_ShrineAppear` (`MoonFocusCone`, `50, 100`).
- A band: `Akali_Base_E_Enemy_Indicator_Red` (`Light_right`, `0, 10, 0, 10`) and
  `AurelionSol_Skin11_E_ExecuteZone_ChildParticle` (`REFLECTION_SPHERE4`, `0, 75, 60, 60`).
- The unnamed byte at `2`: `Viego_Skin43_Q_CoreStab` (`Mesh_VERTICAL`) and
  `Jade_Shen_Skin51_JADE_Q_Sword_Ground` (`fireLine`), which draw as if it were zero.

### 2.44 An emitter naming no texture draws nothing, and the ground layer draws first

The first look at the examples of 2.42 and 2.43 found two faults older than either section.

**An emitter naming no texture samples transparent black.** `Ahri_Skin89_E_mis` drew hard white
squares across the view. Its `HeadButterfly1` names no texture, blends `add`, spans 450 units and
carries a child set. A quad with no texture takes a falloff that lowers its alpha alone, and `add`
takes the colour whole, so the square drew flat white. An empty name on slot 0 keeps
a 1x1 transparent black, where any other slot takes an opaque white by default.
That slot 0 is the base texture is the reading.
`baseTexture` in `useVfxTextures.ts` binds that texture for an emitter whose `texturePath` is
empty, on every draw path. The falloff stays for a named texture that has not arrived.

**`isGroundLayer` draws in a display list of its own.** On
`AurelionSol_Skin11_E_ExecuteZone_ChildParticle`, `BG_BrighterInterior5` (pass 599, ground layer,
`DISABLE_ZBUFFER`) drew over the rocks of `REFLECTION_SPHERE2` and `REFLECTION_SPHERE4` (passes 102
and 103). The flag is render-pass classification alone: the
emitter goes to `Render_Ground_Layer`, one of the engine's seven display lists, and `pass` orders
emitters inside a list only.
`compareDrawOrder` draws the ground layer first. That the list draws before the default one is the
reading. The `ground_layer` technique that flattens these emitters onto the
terrain is not built.

**The attached mesh examples of 2.42 cannot be seen.** The skin preview wears a skin's idle effects
alone, so `Aatrox_Skin26_E_Active_buff` and `Aatrox_Skin26_Recall_ShrineAppear` draw nothing in
either viewport.

**Two reports wait on a closer look.** `Aatrox_Skin30_W_mis`'s `Dragonup`, an opaque head modelled
snout along `+Z` and born at `birthRotation0 = (90, 0, 0)`, reads as turned wrong.
`Ahri_Base_R_mis_02` reads as jagged, with `Trail1` cut short. Of the paths 2.42 and 2.43 changed,
only the fade on `cone_add` and `Trail1` reaches either.

**What to check on the screen**, after a full reload: `Ahri_Skin89_E_mis` with no white square,
and `AurelionSol_Skin11_E_ExecuteZone_ChildParticle` with its rocks over the interior glow.

### 2.45 A noise field fires impulses, a field stands on the system, and the ramp rides the mult layer's lane

These readings replace two of the four in 2.36, and the ribbon's colour moved the ramp gate of
2.38 on every quad as well.

**What held.** A field's kick stays in the particle's velocity: the integrator writes what the
fields changed back into the particle's own velocity, in all three families. Under
`kAnalyticDragMotion` that kick is never damped, which 2.39 already had. Every field value is read
at the emitter phase, once a step. A ribbon carries each particle's lookup per vertex, a trail
point's on both of its vertices and a beam particle's on all four corners, as 2.38 built it.

**The noise field fires impulses.** `impulsesOwed` in `forceFields.ts` fires
one impulse on the field's first update, then the whole periods of
`frequency` crossed on absolute time since the last fire. At the bin default of `frequency = 0` a
field fires once in its life. Each impulse adds a normalised cube sample times `velocityDelta` and
each axis of `axisFraction`, with no `dt` anywhere, so the kick no longer depends on the display
rate. `radius` gates inclusively. 2.36's held direction, its kick every step and its scaling to 30
Hz are gone. The clocks live on `EmitterState.noise`, so a replay starts them over.

**A newborn takes the impulses of its birth step.** The engine integrates a particle spawned
during a step at a `dt` of zero, so the noise and orbital fields still reach it and the change
stays. `kickNewborns` in `integrate.ts` runs the fields over the step's spawns after `emit`. A
noise field of frequency zero therefore kicks the particles born on its first update and no
others.

**A field stands on the system.** A centre is its `Position` from the system's origin, turned by
nothing and scaled by nothing, and its radius is as authored. An orbital field has no centre of
its own and turns about the system's origin. `isLocalSpace` turns an acceleration or an orbital
axis by the system's orientation, and only under `isLocalOrientation`. 2.36's emitter offset,
spawn frame turn and radius widened by the frame's scale are gone.

**Under `IsEmitterSpace` every field rides the emitter's offset.** The engine hands the fields a
position its `EmitterPosition` is not yet back in, while the centres stand on the system, so the
whole field set moves with the emitter. This is probably an engine bug. The user's pick
was to reproduce it, and `fieldsOf` adds the emitter's position, turned by the spawn frame, to
every centre of an emitter-space emitter.

**The ramp shares the mult layer's lane.** The quad vertex shader writes the mult layer's uv into
the interpolator the ramp's lookup rides, and the quad fragment shader samples both there, so a
mult layer moves the ramp rather than dropping it. The quad's fixed-alpha-uv variant, which
`LOCK_ALPHA` selects, drops it, as do the mesh shaders. `colorUniforms` drops the ramp under an
erosion or under a mult layer on a locked
alpha, and `rampAtMult` reads it at the mult layer's uv in texture space everywhere else. This
replaces 2.38's gate, which dropped it under any authored mult layer.

**A ribbon draws its mult layer.** The user's pick. `Trails` and `Beams` run each particle's
`textureMult` transform beside the base's, and `writeTrail` and `writeBeam` write `multUv` and
`multCell` per vertex, a beam's transposed as its base uv is. The ribbon material samples the mult
texture there and reads the ramp at the same place. The lane and the predicate are both attested.
That `uvMatrix1` runs over the same `(u, v)` the base uv takes is the reading.

**The camera segment beam freezes its erosion.** `VfxPrimitiveCameraSegmentBeam_FillBuffers`
writes `0.0` in place of the erosion drive, so `Beams` does too for kind 9. Its other quirk, the
lookup pair decomposed as a mult uv, is not built: the segment beam draws as a plain beam, and none
of the 12 of 2.38 that carry a ramp carries a mult layer.

**Readings that stay open:**

- A noise direction is hashed off the particle's serial, the field and the impulse's count, where
  the engine draws three uniform samples from one stream. The distribution is the engine's,
  biased toward the cube's corners, and a seek replays it.
- A noise clock runs on the system's clock. Which time the engine hands its own step function
  moves only where the impulses fall in phase.
- The definition's own `transform` reaches no field. Its offset is in the origin a field stands on,
  and its basis turns nothing after the spawn frame bakes it in.
- `isLocalOrientation` is a `Flag` whose default is `true` in the meta, so `isLocalSpace` acts
  wherever an emitter leaves both alone. One reading takes the common case the other way. A still
  rig's orientation turns nothing, so the screen cannot tell.

**What to check on the screen**, after a full reload:

- Noise: `Aatrox_Skin40_Death_ambers`, `Akshan_Skin20_Z_Zenchar` and `Ashe_Skin76_Emote_Joke_Wind`,
  which 2.36 judged under the old reading. The motion comes in impulses at the authored frequency,
  alike at any display rate.
- Fields on the system: `Ahri_Skin04_dance`, with attraction, drag and orbital together.
- A ribbon's mult layer: `Xerath_Base_Q_beam` (`Beam3`) and `Amumu_Skin57_E_Swipe_childmis`
  (`Soft_Trail_short`). The ramp on the mult layer's uv: `Amumu_Skin57_Q_beam` (`Beam_Burst`) and
  `Amumu_Skin57_Q_mis` (`Beam_Chain1` to `Beam_Chain3`). A mult layer under `LOCK_ALPHA`:
  `Xerath_Base_Q_beam` (`Energy`).

### 2.46 A seek starts at a checkpoint, and a muted emitter simulates

The timeline of ADR-0037 scrubs with the pointer, steps one frame back and loops a range. Decision
2.6 reaches a time by advancing from zero, capped at `SEEK_STEPS`, 3,600 steps of 1/60 s. A seek
at ten seconds replays 600 steps of the whole system and its children.

**The run keeps a checkpoint every quarter second of simulated time.** A checkpoint holds the
pool's live rows and `pool.born`, every child system with its own pool, states and `Rng`, the
emitter states with their noise clocks, the root `Rng`, the stepper, `phase` and the origin.
`Rng.clone` stands a copy where the stream stands. The run writes one whenever its clock crosses a
quarter-second mark that holds none, in a play and in a replay alike. A seek restores the latest
checkpoint at or before its time and replays the rest, 15 steps at most while every mark is held.
The span's cap bounds the
set at 240, and a budget of 256 MiB bounds its bytes. A run past the budget keeps every second
mark it held, then every fourth, and a seek replays further from each.

**A restored run is the run.** A checkpoint copies state the seed produced. A replay from it
reaches the pool a replay from zero reaches. A checkpoint written during a play holds that play at
the frames' own `dt`. A seek through it is a run of the seed, and not the fixed-step replay a seek
from zero writes.

**A checkpoint belongs to the definition and the rig it was taken under.** An edit (decision 2.5's
swap), a steer and a reroll drop every checkpoint.

**The lanes' histogram rides the same steps.** Each step records every emitter's live count. The
lanes draw those counts. Dropping the checkpoints drops the counts, and the run refills both as it
plays.

**Mute and solo hide, and the simulation runs whole.** The root system draws every roll from one
`Rng` (`rewind` in `driver.ts`), in emitter order. An emitter left out of a step would shift the
draws of every emitter after it, and the run would stop being the one the seed names. `hiddenOf`
takes the muted and the soloed sets, and the pool never sees them.

**2.8's dim is retired.** 2.8 drew the strip's selection at full alpha and the rest at 35%. It is
not built, and mute and solo cover the reading.

### 2.47 A negative `DepthPushPull` pulls a quad toward the eye

`Jade_Teemo_Base_Q_debuf` draws its additive `sparkles` (pass 999, `DepthPushPull` -5) under the
alpha `Miss` dust and into the ground, where the effect reads them over both.

**The quad vertex shader normalises the push.** It computes `PARTICLE_DEPTH_PUSH_PULL` as
`P + normalize(P - vCamera) * k`, the same as the mesh vertex shader and the skinned mesh particle
vertex shader. Section 2.42 read it as `(P - vCamera) * k` and missed the normalisation. A
positive `k` pushes away from the eye in engine units, on every draw path.

**The CPU hands the field unchanged.** The constant binds straight from `DepthPushPull`. The
census of 2.37 has the modal values negative, -1 to -1000, and the overhead icons of this effect
at -50, which only reads as drawing over the effect when a negative pulls toward the eye.

**2.37's quad reading was the reverse.** It moved the quad `k` units toward the eye along the view
axis, so every negative push sank. `pushed` in the quad vertex shader moves each corner along its
own ray, as the shader does. Meshes and ribbons still take no push.

**A complex camera quad rolls on `x`.** The engine seeds the roll table's index from
`birthRotation0.x` and overwrites it each frame with lane 0 of the accumulated spin. `spinOf` read
lane 2, so every camera quad authoring its spin on `x`, both emitters of this effect among them,
drew unrolled. A simple emitter keeps lane 2 and its legacy roll.

### 2.48 The viewport draws into an opaque buffer

The dark squares where `Jade_Teemo_Base_Q_debuf`'s `sparkles` overlap its `Miss` dust were the
canvas's alpha channel, not a colour any shader wrote.

**ThreeJS asks for an alpha channel whatever `alpha` says.** `WebGLRenderer` 0.185 creates its
context with `alpha: true` and reads its own `alpha` only for the clear, so the viewport's
`alpha: false` left a drawing buffer with an alpha channel. The canvas is `premultipliedAlpha`,
so the compositor reads that alpha wherever a blend left it short of one.

**The two emitters wrote it apart.** `Miss` blends `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` on the alpha
lane too, which leaves `a * a + (1 - a)` under the dust. `sparkles` blends `ONE, ONE`, and its gold
book is opaque, so each of its quads lifted the alpha back to one in a hard-edged square. Read back
from the headless repro, 13,772 of the 27,000 pixels of one 180 by 150 region over the effect stand
below full alpha, and the squares stand at 255. Leaving the alpha lane alone on `sparkles` cleared
the squares, and so did an opaque context.

**What was ruled out first.** Both textures are byte for byte on the GPU, level 0 and the mip
levels 1 to 4, so no upload landed in the wrong storage.

`opaqueRenderer` in `Viewport.tsx` hands `WebGLRenderer` a `webgl2` context made with
`alpha: false`, so the buffer has no alpha channel to show. `TARGET_ALPHA` reads a destination
alpha of one against it, which is the only mode that reads the alpha at all.

### 2.49 `ADD` and `SUBTRACT` premultiply their colour on the CPU

The colour block sits beside the complex mesh path's flipbook: the appearance colour times its
own alpha, then `blendMode` 0 or 2 multiplies the RGB by the alpha and writes an alpha of one. The
shaders do not weigh the colour by its alpha anywhere, so under `ONE, ONE` the renderer added the
whole RGB of a particle whose alpha had already faded out.

`premultiplyInto` in `blend.ts` does the same to the drawn colour on every draw path, after the
beam's distance colour. Two readings ride on it: that the quad batch and the two ribbon writers
premultiply as the mesh path does, and that a distorting emitter does not, because its alpha is
the mask the warp carries.

The alpha test reads the drawn alpha after the premultiply, as the quad fragment shader does, so
an additive particle is tested on its texel's alpha alone.

### 2.50 The quad shaders checked against the shipped ones

The shipped quad vertex, quad fragment and their fixed-alpha-uv variants of 16.18 were checked
define by define against a base variant that carries only `DISABLE_FOW`. What the renderer
already matched: the Rec. 709 remap tail, `ALPHA_TEST` on the drawn alpha before the remap,
the erosion band and its two rates, the palette row and scroll, the ramp at the mult uv under
`MULT_PASS`, the soft fade's linearised gap and its two smoothsteps, and the push along the ray of
2.47. Two things did not match.

**The erosion map samples where the base texture does.** Every erosion-capable permutation of the
quad and mesh fragment shaders samples `sAlphaErosionTexture` at the coordinate `TEXTURE` itself
samples at, which carries the flipbook cell. That is `TEXCOORD1.xy` in most of them, and a
register computed from it in the rest. The fragment pass read it at the layer's own uv inside the
cell, so a flipbook with an erosion map eroded against the whole map on every frame.
`eroding` takes the base texel's atlas coordinate on the quad, the mesh and the ribbon, under
the erosion map's own address mode.

**`LOCK_ALPHA` compiles no erosion on a quad or a ribbon.** The quad's fixed-alpha-uv variant's
base defines are `DISABLE_FOW`, `MASKED`, `COLORPALETTE_COLORBLIND`, `PALETTIZE_TEXTURES`,
`ALPHA_TEST` and `MULT_PASS`, with no `ALPHA_EROSION` and no `SOFT_PARTICLES`. `drawsFixedAlphaUv`
in `drawKind.ts` is that bundle's condition, and `layersOf` drops the erosion for it as `fadeOf`
drops the fade. The ramp returns on those emitters with it, because the bundle binds the ramp
wherever it does not bind the mult layer.

**`PIXEL_COLOR_REMAP_RAMP` is not built.** Every particle fragment shader ends in it, and the
editor binds no engine remap, so the texture would be the 1x1 transparent black whose alpha keeps
the colour as it is. A sampler that changes no pixel is left out.

### 2.51 A stop waits on `emitterLinger`, a system builds up before it draws, and travel stretches

**A stopped emitter finishes once the system's age passes `emitterLinger`.** Under a soft stop the
engine finishes an emitter when the system's age passes `min(lifetime + 10, emitterLinger)`, ten
for a simple emitter, whatever its linger kind. The age is the system's and not the time since the
stop, so a stop issued past `emitterLinger` grants no wait, and the default of `0` finishes an
emitter at the stop itself. Unstopped, `kFixedLifetimeAfterEmitterStops` alone finishes on its own
end of emission. `stopWaitSeconds` in `systemModel.ts` is the value and `settle` in `integrate.ts`
reads it. Whether the engine means that clock is not established, and the user's pick was to
reproduce it. `lingerTail` takes the moment of the stop, so a missile's run reaches the wait still
owed where it lands. 3,657 emitters write the field over 192 bins, `1` on 36% and `0.5` on 22%.

**`buildUpTime` is simulated before a run's first drawn step.** The engine fast-forwards a system
by `buildUpTime` seconds when it becomes visible, and a preview system becomes visible where its
run starts. `buildUp` in `driver.ts` steps the build-up at the seek step, the rig standing where it
is, ahead of a rewind, a loop's replay and an edit that restarts the pool. How the engine steps a
fast-forward is not established. `Driver.phase` is the timeline's place in the run and `elapsed`
the emitters' age, which is the phase plus the build-up. 184 systems write it over 21 bins, `5` on
43%, `0.25` and `0.5` on most of the rest.

**A direction-oriented particle stretches with its speed.** No reading covers
`directionVelocityScale`. The renderer takes `max(directionVelocityMinScale, speed *
directionVelocityScale)` along the travel, `stretchOf` in `particleRead.ts`, on the up extent of a
camera or arbitrary quad and on the `+Z` of a mesh. At the schema's defaults, `0` and `1`, the
stretch is one. 1,651 emitters write the scale, most between `0.001` and `0.01`, and 251 write the
minimum, `1.3` on 77%. Of 422 direction-oriented writers over 80 bins, 282 are camera quads, 130
arbitrary quads, 6 rays and 4 meshes. The check that would refute the formula is `prestige_Sparks`
in `characters/jinx/skins/skin40.bin`, four direction-oriented emitters writing a minimum of `0`
and no scale, which draw at no length here.

**A direction-oriented camera quad faces the eye with its up along the travel.** The camera quad's
builder takes its axes from the particle's direction under `isDirectionOriented` and drops the
roll. How it takes them is the reading: `DIRECTED` in the quad vertex shader lays the up along the
travel as the view sees it and the side square to it in the view's plane. A direction-oriented
camera quad drew as a plain billboard before this, so the stretch had nothing to lie along.

**A ground-layer emitter is laid on the ground straight down.** `isGroundLayer` classifies the
render pass alone, and the flattening lives in a `ground_layer` technique no reading covers. The
user's pick was a vertical projection. `GROUND_LAYER` stands every vertex of a quad, a mesh, an
attached mesh and a ribbon on `GROUND_LEVEL`. Of 2,549 ground-layer emitters over 60 bins, 1,346 are
arbitrary quads, 529 meshes and 482 camera quads. A flat quad and a mesh draw alike under a top-down
render and a vertical projection. A camera quad is where the two part: a top-down render would lay
it flat, where this projects its eye-facing plane.

**`isFollowingTerrain` is not built.** The engine adds `(terrain height now - height at spawn) *
(1 - bindWeight)` to the drawn `Y`. The preview's ground is flat, so the term is zero everywhere.
415 emitters write it, all `true`.

**What to check on the screen**, after a full reload:

- A system writing `buildUpTime` opens already full, and opens full again on each loop.
- `sparks` in `aatrox_skins_skin10_skins_skin9.bin` streaks with its speed and faces its travel.
- `SpikeGroundLine` and `Dustring` lie on the ground, the second being the camera quad case.
- A stop from the rig on an emitter writing `emitterLinger` holds its particles to their natural
  lives until the system's age passes the value.

The user checked all of them on the screen, and every one reads right: build-up on the Nexus, the
FeeneyPult and the laser turret, the stop wait on the Poro follower and the cauldron, the stretch
on camera quads, arbitrary quads and a mesh, and the ground layer on arbitrary quads, camera quads
and meshes.

### T1 — subdivided textures and the UV transform

`texDiv`, `numFrames`, `startFrame`, `frameRate`, `birthFrameRate`, `isRandomStartFrame` are one
flipbook. `uvScale`, `birthUVOffset`, `birthUvScrollRate`, `particleUVScrollRate`, `uvRotation`,
`birthUvRotateRate`, `particleUVRotateRate`, `uvTransformCenter`, `TextureFlipU`, `TextureFlipV`,
`uvScrollClamp` build one 2x3 matrix that rotates and scales about the centre then translates by
the accumulated scroll.

`DEFAULT`, `LOCK_ALPHA` and `SCREEN_SPACE`, which is every mode shipped data authors. The three
local-space modes read the `textureMult` layer and appear on no emitter of the dump, section 2.27.
Estimate 6 to 9 days.

#### What T1 and T2 built

Both shipped together, because `textureMult` is the same fields under `Mult`-suffixed names and
one `UvLayer` reads either. `readVfxSystem` takes two name tables over one reader, the pool
carries eight numbers per layer per particle, and the fragment shader runs one `layerUv` twice.

The transform is section 3.4's: scale and rotate about `uvTransformCenter`, translate by the
scroll, then land inside the particle's own cell the way the layer's `TEXTUREADDRESS` says — so a
scroll wraps, mirrors or holds within its frame rather than bleeding into the neighbouring one.

Three things stand differently from how the tier reads.

- **`DEFAULT` and `LOCK_ALPHA` draw.** The other four modes are read, carried and drawn as
  `DEFAULT`. Section 2.11 has what each is.
- **The mult layer has no book of its own.** `VfxTextureMultDefinitionData` names `texDivMult`
  and no frame count, start or rate, and its `isRandomStartFrameMult` and `uvScrollAlphaMult`
  are dead, so one frame counter serves both layers and only the grid differs.
- **Quads only.** A mesh primitive carries its own uvs, and neither layer reaches it.

The questions this raised are answered in 2.11.

### T2 — `textureMult`

A second sampler and a second 2x3 matrix, multiplied in. `VfxTextureMultDefinitionData` carries
its own mults for every UV field plus `TextureMultControlBitFlags`. Estimate 2 to 3 days.
Built alongside T1 above.

### T3 — spawn shapes

`VfxShapeSphere`, `VfxShapeBox` and `VfxShapeCylinder` under `VfxShapeVolume`, plus
`VfxShapeLegacy` and the pre-14.5 `shape: Embed<VfxShape>` that shipped data still carries.
Birth position and birth direction sampling. Estimate 3 to 4 days. `EmitterPosition`, the offset
a shape is sampled around, is already read (2.11).

#### What T3 built

`SpawnShape` reads as one of five kinds by class hash, and `spawnShape.ts` draws each as
attested: an offset, then a turn that is applied to
the offset and to `birthVelocity` alike, which is the one spawn-time path that turns a velocity
and is what sends a sphere's particles outward. The survey over `data/characters` (13,502
emitters in this dump) has 54% naming a shape: point 3,026, legacy 2,080, box 940, cylinder 727,
sphere 514, and no pre-split `VfxShape`.

These ranges are attested (2.12): a box's `Size` and a
cylinder's `radius` are half-extents drawn `-1..+1`, and a cylinder's `height` runs `0..height` up
from the emitter. A surface box is the `+Z` face sent to one of the four sides by quarter turns, so
it never emits from its top or bottom, which is what the quadrant rotation does, and shipped data
sets `flags & 1` on essentially every box and cylinder and on no sphere. Every distribution is the
engine's naive one and is left so. `VfxShapePointDoNotUse` is a hash crack, and the hash is what a
bin writes.

### T4 — force fields

`VfxFieldCollectionDefinitionData`, five kinds in a fixed order: acceleration, attraction, noise,
drag, orbital. Three traps to avoid:

- attraction is constant magnitude rather than inverse-square, and `dist²` floors at `1.0`
- noise and orbital are not `dt`-scaled
- drag runs after noise

The orbital field turns the perpendicular velocity component tangential without changing its
magnitude. Estimate 3 to 4 days.

Built in 2.36, with noise on a further reading.

### T5 — static mesh primitive

`VfxPrimitiveMesh` holds `mMesh: Embed<VfxMeshDefinitionData>`. The mesh resolution chain is
`.skn` + `.skl`, then `.scb`, then `.tmesh` / `.gmesh`. `.scb` reads through `ltk_mesh`'s static
module. `mSubmeshesToDraw` and `mSubmeshesToDrawAlways` filter. `AlignPitchToCamera` and
`AlignYawToCamera` orient. Estimate 4 to 5 days.

`.tmesh` and `.gmesh` are one parser and one cache, a header plus an AABB plus N vertex streams
on the 128-byte mapgeo vertex descriptor plus a 16-bit index buffer plus named submeshes. A new
reader. Estimate 3 to 5 days.

`Preview` holds one variant, `Image`, and `protocol::serve` answers it alone. Geometry is a
second variant on the same scheme, or a command of its own. The first tier that loads a mesh
decides which. A vertex buffer on the scheme keeps the WAD read cached and the bytes off the
JavaScript heap, on the argument section 2.2 records.

#### What T5 built

The static half. A `.scb` reads through `ltk_mesh` into the `?as=geometry` buffer
`meshBuffer.ts` decodes, `Meshes.tsx` draws one emitter as one instanced mesh, and the mesh
material of `quadMaterial.ts` takes its tint and its erosion drive per instance. Section 2.14 is
what then settled: the load precedence, the two submesh lists,
the whole-degree roll and the one-float scale. Section 2.15 is what the screen settled on top.
`VfxPrimitiveAttachedMesh` draws the character rather than anything of its own, section 2.18, so
a particle viewport shows none of it and the skin preview draws it over the character, section
2.35. A `.skn` a whole pair names draws in its bind pose, unskinned, until T6.

### T6 — skinned mesh primitive

`.skn` through `ltk_mesh`'s skinned module, `.skl` joints and `.anm` through `ltk_anim`'s
evaluator, bone matrices uploaded per frame, a skinning vertex shader. `mAnimationName` and
`mAnimationVariants` select the clip. `mLockMeshToAttachment` binds it.

The variant is rolled once at definition load,
uniform by index, and the name read only for an empty list. `emissionSurfaceDefinition` belongs
here too: a surface sampled in the animated pose at every birth, and
`boneToSpawnAt` of a child set, which resolves on the emitter's own pose.

The largest single tier. Estimate 3 to 5 weeks.

#### What T6 built

The posed character, as a scene of its own before it is a primitive, per ADR-0035.

- **The wire.** A `.skn`'s blend indices and weights ride LTKG version 2, a `.skl` rides LTKS, and
  a clip rides LTKA, baked by `ltk_anim` 0.3.6 at its own frame rate. A track is found by the ELF
  hash of the joint's lowercased name.
- **The pose.** `createPose` samples the baked table as a pure function of time, and `Character`
  sets the bones of a three.js `SkinnedMesh` from it every frame. The bones stand in the influence
  order, so no blend index is rewritten.
- **The rig.** A `bone` motion rides an `Anchor`, whose origin and basis the driver reads at each
  step's time, so a seek replays a joint's travel as decision 2.6 replays everything else. The
  whole basis is the system's orientation, where the other motions yaw.
- **The first consumer.** The skin layout draws in a shell of its own around the preview, per
  ADR-0036, with the skin posed by its graph's first idle clip and the bind pose where the graph
  holds none. The transport plays, pauses, scrubs and speeds the clip. Each idle effect
  `resolve_skin` resolves through the skin's own resolver rides its `boneName` as a `bone` rig,
  runs once, and follows the scene's clock: a step as the clock advances, a replay from zero when
  it jumps, so a scrub reaches what a play reaches. The camera frames the bind pose's bounds.
- **The graph.** A graph the skin's own file does not declare is looked for through the files
  it links and what they link in turn, nearest first, so a skin animates without the object
  index.
- **Handedness.** A `.skn`, its `.skl` and its clips hold the engine's space, as the particle pool
  does, so the character draws across the one mirrored axis of world.ts, `-X`, and `jointAnchor`
  hands a joint to the pool as it stands. An idle effect's `Position` is an offset in its joint's
  own frame. The reading is the screen's: drawn in the files' own space, a character reads
  mirrored.

An attached mesh draws over the character and a bone set spawns on its joints, section 2.35. The
mesh primitive itself is not skinned, so `mAnimationName`, `mAnimationVariants` and
`emissionSurfaceDefinition` still wait on a mesh emitter drawing through `Character`, and so does
a bone set naming its own rig's joints. A compressed clip poses wrong in its opening keys,
league-toolkit#235, and a skin whose resolver another file declares wears no idle effect.

### T7 — trails, beams and rays

`VfxPrimitiveTrailBase`, `VfxPrimitiveBeam`, `VfxPrimitiveRay`, `VfxPrimitiveCameraSegmentBeam`.
A trail point is a particle, so the pool is the data structure, with the birth tiling and the
emitter's odometer beside each particle. Estimate 2 to 3 weeks.

#### What T7 built

The survey over `data/characters` puts the tier at 10.5% of emitters: ray 665, camera trail 485,
arbitrary trail 199, beam 72, and no `VfxPrimitiveCameraSegmentBeam` at all. Each is the engine's
own builder, per section 2.12.

- **A ray is a quad** through `Quads`, laid along the particle's own `+Z` and rolled about that
  axis to face the eye. `scale0.x` is across, `scale0.y` is along, and `scale0.z` is where the near
  edge starts. A ray with no rotation authored points along the emitter's `+Z` for good.
- **A trail is one ribbon per emitter** walked through its live particles in birth order, which
  the pool numbers since a retire scrambles its own order. Each particle is a point: its position,
  `scale0.x` as the half-width, its colour, its birth tiling and the odometer at its birth. A
  camera trail expands across the view and its tangent, an arbitrary one along the particle's own
  `+X`. `mSmoothingMode` sets the walk's direction, filters and miters. `mCutoff` truncates the
  walk. `WAKE` pins `u` to the odometer, and `mMaxAddedPerFrame` caps the spawns. Each uv goes
  through the particle's own transform on the CPU, base layer alone.
- **A beam is one quad per particle** from the system's position plus `mLocalSpaceSourceOffset`
  to its target plus `mLocalSpaceTargetOffset`, `scale0.x` wide, trimmed by `scale0.y` and `.z`.
  `ARBITRARY` lies across the world's up through the particle's own matrix, unnormalised.
  `mIsColorBindedWithDistance` multiplies in `mAnimatedColorWithDistance` at the raw length. A beam
  naming a mesh draws nothing. The segment beam draws the same quad, and its ribs are not built.
- **The rig has, aims and faces the system.** A path aims where it lands, an orbit at what it
  circles, and a still rig a fixed reach ahead so a beam has a length. That is `targetAt` beside
  `originAt`, and `Driver.origin` beside `Driver.target`. A path faces where it is going and an
  orbit its tangent, `facingAt`, which is the yaw every birth is placed under.

`ribbon.ts` holds both writers, `writeTrail` and `writeBeam`, in the engine's space with the mirror
on the way out, so a cross product lands as the engine's does. `basis.ts` is the particle's own
axes on the CPU, which every draw path composes onto the frame the particle was born in.

### T8 — the long tail

`alphaErosionDefinition`, `paletteDefinition` with `colorLookUpTypeX/Y`,
`softParticleParams`, `reflectionDefinition`, `VfxPrimitivePlanarProjection`, `materialDrivers`,
`CustomMaterial`, `flexShapeDefinition` and the flex family, `AssetRemappingTable`, the system
light. `childParticleSetDefinition` is T9 and `emissionSurfaceDefinition` T6, since section 2.14.

#### What of T8 is built

**The palette and the colour ramp.** Two systems rather than one.
`paletteDefinition` ships on 511 character emitters
(3.8%) and is built from uniforms: `palette.ts` gives the material the row, `(paletteSelector.x

- 0.5) / paletteCount`with the selector sampled at zero, and`Quads.tsx`moves the two
animation curves each frame at the emitter's phase. The quad fragment dots the texel with`palleteSrcMixColor`, uploaded raw, for `u`, reads the palette there and replaces the texel's
colour, keeping its alpha. The colour lookup pair places the `particleColorTexture`ramp
instead:`colorLookup.ts` is section 3.1 per axis, the ramp is sampled clamped at that
  coordinate and multiplied in after the palette, and it is dropped from the pass where the
  emitter carries a mult layer or an erosion, which is the binding table that gates it.

Quads only. A mesh reads the ramp at a per-emitter uniform in the engine and none of the three
ribbon and mesh materials carry a palette yet.

**The linger.** The linger policy is built as attested. `settle` in
`integrate.ts` runs the policy first each step: `kFixedLifetimeAfterEmitterStops` acts on the
emitter's own end of emission, and the other two wait on the system being stopped. On the first
step an emitter is seen finished its particles are marked lingering, the fixed kinds rewrite each
lifetime to the age plus the linger once, and the max kind caps every lifetime at the linger
every step. `lingerSeconds` is the capped value, and the pool's `lingerFrom` is what the
appearance pass reads the linger's progress off: `SeparateLingerColor` and `LingerScale` against
that progress, `LingerRotation` in `rotation0`'s place, and the three keyed curves in place of
`acceleration`, `drag` and `velocity`, each only where its `Use*` toggle is on. `velocity` itself
joined the field set for that, an emitter-level drift added to every particle's own each step.

The stop is the rig's: `stopAt` on `RigModel`, a switch and a slider in the rig popover, and it
is what the game issues when a buff ends. A stopped system emits nothing more, and a particle
with no linger authored vanishes at once, which is the engine's own default. `emitterLinger`
delays that finish on the system's own age, decision 2.51.

Two things the reader takes from the schema rather than the registrar. `UseLingerRotation` is
declared with the toggles' default of `kUseLingerRotation`, and the meta dump's own default for
the property is `false`, and the dump is what a bin serialises against. And `particleLinger`'s
`FLT_MAX` sentinel resolves to the cap either way, because the cap is a minimum.

**The simple emitter's `LegacySimple`.** An emitter of `simpleEmitterDefinitionData` carries
`VfxEmitterLegacySimple`, and this is what it
draws: one quad whose plane `orientation` fixes, so its only free turn is the spin in that
plane, in whole degrees, and one `birthScale` half-extent times `scaleBias` covers both
extents. `scale` stands in for `scale0`, `birthRotation` and `birthRotationalVelocity` for the
spin, and `rotation` is sampled against the age and added to it. `lockedToEmitter` lowers onto
`bindWeight` and `IsEmitterSpace`, `uvScrollRate` onto `emitterUvScrollRate` as the whole-layer
pan it is, and `scaleUpFromOrigin` lifts the quad onto its base. `hasFixedOrbit`,
`fixedOrbitType` and `particleBind` are read and not drawn: the first two are authored in six
objects and none, and the bind's provider is not established.

The block is rare: over the whole 16.17 dump on this machine, 68 of 41,872 emitters sit in the
simple list and every one carries the block, 68 write `birthScale`, four each write `scale`,
`birthRotation` and `particleBind`, and one writes `uvScrollRate`. Before this a simple
emitter drew at `birthScale0`'s default of one unit, which is to say not at all.

**Distortion.** `distortionDefinition` warps what the emitter covers rather than colouring it,
decision 2.25. The emitter draws the geometry it already draws, on a layer the colour pass leaves
out, and `Distortion.tsx` draws that layer over a copy of the frame the colour pass just made.
`distortionMode` and the three distortion display lists are read and not told apart.

**Alpha erosion.** `alphaErosionDefinition` ships on 3,756 character emitters (24.1%), and the
survey now tallies the block itself: 7,502 over the whole dump. The reader resolves
`erosionMapName` through `ASSET_FIELDS` like the other textures, `erosionDrive` in `integrate.ts`
samples `erosionDriveCurve` against the age and `LingerErosionDriveCurve` against the linger's
progress once the emitter has finished, and each of the three
materials takes that drive per particle and cuts the alpha in its fragment. The shader is
attested over every shipped erosion variant:
the map's texel, or the emitter's own where none is named, is dotted with
`erosionMapChannelMixer` and saturated, and the alpha keeps the band of values from
`drive - erosionFeatherOut` up to `drive + erosionSliceWidth`, ramped in linearly over the
feather below the drive and out over `erosionFeatherIn` inside the far edge. At the drive the
alpha is already whole. The feathers reach the shader inverted, as rates.

The drive is keyed in 6,853 of the blocks and runs `0` to `1` over the life in every block
read by hand, Aatrox's `Trail`, `embers` and `glows` among them, so a particle erodes away as
it rises. A map is named in 7,033 blocks and the mixer reads one channel of it, red in 3,776.
The slice width sits at `1` to `2` where it is written, past the map's whole range, so almost
every block is a plain dissolve, and the tail at `0.1` to `0.5` is a band burning through. The
map samples at the base layer's own uv, a mesh at its own, under `erosionMapAddressMode` as
the sampler receives it, unremapped. `erosionDriveSource` reaches no shader and is read by
nothing here.

### T9 — child particle sets

`childParticleSetDefinition` on 51,741 emitters over 191 WADs. A
particle spawns a whole system of its own, `childrenIdentifiers[i].effect`, which the resolver
already inlines under its cycle guard, so the tier is the renderer's alone.

What this settles:

- One child per particle where `boneToSpawnAt` is empty, and 96% of sets carry one identifier.
  With a bone list every child spawns, child `i` at bone `i`, and fewer bones than children kills
  the set silently.
- `childrenProbability` is an index, `max(0, value) % count`, evaluated at zero on birth and at
  the lifetime on death. Read only with no bones and more than one child, 743 sets, so 74% of
  the authored values do nothing.
- `childEmitOnDeath` replaces the birth spawn: the child is created as the parent dies,
  fire-and-forget, with its orientation's translation zeroed.
- A birth child follows its particle live, position and orientation, at
  `|system scale * scaleOverride * particleScale|`, uniform under `isUniformScale`. Colour,
  velocity and the seed are not inherited.
- The parent's death stops the child and detaches it, so it plays out frozen where it was.
- `ParentInheritanceDefinition`, 3,139 objects in 35 WADs, is `RelativeOffset` in parent space
  under four bits and a fifth unnamed one.
- The engine bounds neither recursion nor cycles. The renderer caps depth and shares one pool
  budget.

In that order: the one-child birth path with a nested driver bound to the particle, then the
death spawn, then the inheritance bits. Bones wait on T6. Estimate 1 to 2 weeks.

Built in 2.33, bones in 2.35, and the inherited scale aside.

## 5. Before T0

**Calibrate against a reference.** One shipped simple effect, screenshotted in game, matched in
the viewport. This pins handedness, up axis, scale units, texture colour space, output colour
space and tone mapping. Every later tier rests on those six values. Two days, and it either
confirms the assumptions or replaces a rebuild.

The six live in `src/modules/workshop/bin/vfx/world.ts`, each read in one place, so a screenshot
corrects a constant rather than a decision spread over the renderer. Two of them are attested
rather than assumed: `isFollowingTerrain` moves a particle's **Y** toward the terrain height,
which makes the engine's world Y-up, and the mirrored X a
`.skn` takes on the way into Maya or Blender is what makes it left-handed against ThreeJS. The
scale units and the two colour spaces are still the assumption the screenshot settles.

**Survey `materialDrivers` and `CustomMaterial`.** `materialDrivers: Map<IVfxMaterialDriver>` and
`CustomMaterial: Pointer<VfxMaterialDefinitionData>` are shader authoring rather than particle
authoring, and no enum table covers them. A count of emitters carrying either, over one champion
WAD, decides whether T0's blend model is sufficient or partial.

**The component path is not a target.** `VfxShimmerEmitterDefinitionData` and `VfxComponents` are
wired into the live simulation loop. No shipped data feeds them. A renderer for that path is a
second renderer.

## 6. Sources

- `rito-meta` (`@leaguetoolkit/meta-cli` 1) against `meta-api.leaguetoolkit.dev`, dataset
  generation 2026-08-24 — `VfxEmitterDefinitionData` with `--inherited`, the
  `VfxLegacyPrimitiveBase` and `IVfxShape` trees, `VfxMeshDefinitionData`,
  `VfxTextureMultDefinitionData`
- [ADR-0034](../adr/0034-the-shells-panes-are-the-editors-split-tree.md), whose consequence is
  that a pane is one id and one registry entry
- [ADR-0032](../adr/0032-a-curve-draws-in-a-dock-under-the-object-tab.md) and
  `docs/research/bin-editor-curve-panel.md` — the value family and its keys
