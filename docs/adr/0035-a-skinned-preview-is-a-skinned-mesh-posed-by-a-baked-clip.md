# ADR-0035: A skinned preview is a SkinnedMesh posed by a baked clip

- **Status:** Accepted (2026-09-10)
- **Date:** 2026-09-10
- **Crates:** `ltk-manager-core` (`preview::skeleton`, `preview::animation`, `skin`), over
  `ltk_anim` 0.3.6
- **Related:** T6 in `docs/plans/vfx-particle-renderer.md`, whose decision 2.6 is the replay a seek
  runs and whose decision 2.9 is the rig. [ADR-0030](0030-a-class-view-is-a-layout-over-the-rows.md),
  whose skin layout holds the slot. The slot is stated in "The layouts" in `docs/ux/BIN_EDITOR.md`.

## Context and problem statement

A skin's `.skn` is a mesh whose vertices each name up to four joints of its `.skl`, and an `.anm`
poses those joints over time. More than one preview wants a posed character: the skin layout's
mesh card, and a particle viewport whose system rides a champion. A character also wears idle
effects, particle systems standing on a joint for as long as the character stands, so a posed
character and a particle system share one scene and one clock.

The questions are where the skinning runs, what crosses the wire, where a clip is evaluated, and
how a particle system reaches a joint without the particle code knowing what a pose is.

## Decision

**three.js skins the mesh.** A `SkinnedMesh` binds to a `Skeleton` whose bones stand in the
`.skl`'s influence order, so a vertex's blend index names its bone as the `.skn` wrote it and no
index is rewritten. The inverse bind matrices are the `.skl`'s own.

**Three buffers cross the `ltk-asset` scheme, one `AssetRef` each.** `?as=geometry` is LTKG version
2, which adds each vertex's four shader joints and weights. `?as=skeleton` is LTKS: every joint's
name, track hash, parent, local bind pose and inverse bind, then the influence table. `?as=animation`
is LTKA, the clip baked by `ltk_anim` at its own frame rate. The layouts are the module docs of
`preview/mesh.rs`, `preview/skeleton.rs` and `preview/animation.rs`.

**Rust bakes the clip and TypeScript interpolates it.** The pose at a time is a pure function of
that time: two baked frames, lerped and slerped, and the parents walked. Nothing a pose holds
depends on the order it is asked in, so a seek reaches what a play reaches.

**A particle system rides a joint as a `bone` motion of its rig.** The rig asks an `Anchor` for its
origin and its basis at the run's time, and `jointAnchor` answers for one joint of a pose, carried
into the engine's space. The particle code knows an anchor and never a pose.

**`src/modules/viewport` is the shared scene.** The canvas, the camera, the stage, the buffer
readers, the pose, the anchor and `Character` live there, and a preview draws its own children
inside `Viewport`. The skin card and the particle viewport are two consumers of it.

**A skin is read as a typed model.** `resolve_skin` answers the mesh, the skeleton, the textures,
the overrides, the hidden submeshes, the scale, the graph and the idle effects, each asset located.
`resolve_clips` answers the graph's clips that play one `.anm` each. The generic system read is the
wrong instrument, because it inlines every system a resolver maps.

## Consequences

- **Positive:** one posed character for every preview, and a system on a joint reuses the replay of
  decision 2.6 unchanged.
- **Positive:** the skinning shader is three's own, so the character draws under the particles'
  camera and colour space with no shader of its own.
- **Negative:** a baked clip costs 40 bytes per joint per frame, capped at `MAX_POSES`, where an
  evaluator on the frontend would cost nothing on the wire.
- **Neutral:** the files hold the engine's space, so the character crosses the one mirrored axis of
  world.ts as the particle pool does, and a joint reaches the pool as it stands.
- **Negative:** a compressed clip poses wrong in its opening keys, league-toolkit#235, and a legacy
  `.skl` panics inside `ltk_anim`, league-toolkit#234.
- **Neutral:** the material is an unlit `MeshBasicMaterial`, so a character reads flat and an alpha
  cutout draws opaque.
