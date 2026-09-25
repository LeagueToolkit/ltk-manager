import { useFrame } from "@react-three/fiber";
import { Fragment, useEffect, useLayoutEffect, useMemo } from "react";
import {
  DetachedBindMode,
  DoubleSide,
  FrontSide,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type ShaderMaterial,
  SkinnedMesh,
} from "three";

import type { BinDocumentId } from "@/lib/tauri";
import { type CharacterSkin, useCharacterSkin } from "@/modules/viewport";

import type { EmitterModel } from "../../engine/model/model";
import {
  age01,
  appearance,
  erosionDrive,
  frameOf,
  type Source,
} from "../../engine/simulation/particleRead";
import { type SlotProgram, useAttachedPrograms } from "../hooks/useParticlePrograms";
import type { EmitterSamplers } from "../hooks/useVfxTextures";
import { useWireTwin, WIRE_ORDER } from "../state/wire";
import { fragmentTests, premultiplyInto } from "../utils/blend";
import { colorLookupInto } from "../utils/colorLookup";
import { distorts } from "../utils/drawKind";
import { bucketRange, bucketsOf } from "../utils/emitterBuckets";
import { DISTORTION_LAYER, PARTICLE_LAYER } from "../utils/frame";
import { attachedMaterial } from "../utils/materials";
import { sourcesScrollInto } from "../utils/palette";
import { writePaletteScroll, writeSlotMembers } from "../utils/particleProgram";
import { rangesDrawn } from "../utils/submeshes";
import { type LayerDraws, layersOf } from "../utils/uniforms";
import { layerOf, uvDraw, uvRowsInto, uvTransformInto } from "../utils/uvTransform";
import { addPassTwin, noDraw } from "./drawPair";

/** How many particles of one attached emitter draw at once, each a whole character. */
const ATTACHED_PER_EMITTER = 8;

/** What a submesh the emitter's lists leave out draws with. */
const SKIPPED = new MeshBasicMaterial({ visible: false });

/** The bind that leaves the skeleton's own inverse binds in charge. */
const IDENTITY = new Matrix4();

/** Scratch the frame reuses, so a draw allocates nothing per particle. */
const DRAWN = { scale: new Float32Array(3), color: new Float32Array(4) };
const UV_DRAWN = uvDraw();
const ROWS = [new Float32Array(8), new Float32Array(8)] as const;
const LOOKUP = new Float32Array(2);

/** The rim and the reflection an attached mesh's shader compiles, and neither the ramp nor the fade. */
const DRAWS: LayerDraws = { ramp: false, sheen: true, fade: false };

export interface AttachedMeshesProps {
  emitter: EmitterModel;
  /** Every system whose pool holds this emitter's particles. See `Quads`. */
  sources: readonly Source[];
  samplers: EmitterSamplers;
  /** Where the emitter falls in the system's draw order, from `drawRanks`. */
  rank: number;
  hidden: boolean;
  /** The document the system was read from, whose project the game's shaders resolve through. */
  document?: BinDocumentId | null;
}

/** One particle's draw: the character's skin under a material of its own. */
interface Slot {
  readonly mesh: SkinnedMesh;
  readonly material: ShaderMaterial;
  /** Which submeshes the emitter's lists leave in, which its edge twin draws too. */
  readonly drawn: readonly boolean[];
}

/**
 * One attached emitter's particles, each the skin of the character the system rides.
 *
 * Each particle draws the character's skin where the character stands, scaled by the
 * particle's own scale about the scene's origin, in its own colour, layers and erosion.
 * A scene with no character draws none. Decisions 2.18 and 2.35 of
 * docs/plans/vfx-particle-renderer.md.
 *
 * With the game's shaders on, each particle draws the skin through each translated pass of the
 * emitter's custom material, or through the `skinnedmesh/particle` or `particle_distortion`
 * pair, once they are ready, with materials and an environment per slot, and through the
 * hand-written material until then.
 */
export function AttachedMeshes({
  emitter,
  sources,
  samplers,
  rank,
  hidden,
  document = null,
}: AttachedMeshesProps) {
  const skin = useCharacterSkin();
  const { twinOf, shaded } = useWireTwin();
  const slots = useMemo((): readonly Slot[] => {
    if (skin === null) return [];
    const drawn = rangesDrawn(
      skin.ranges,
      skin.hidden,
      emitter.mesh?.submeshes ?? [],
      emitter.mesh?.submeshesAlways ?? [],
    );
    return Array.from({ length: ATTACHED_PER_EMITTER }, () => {
      const material = attachedMaterial(
        emitter.blendMode,
        samplers.base,
        emitter.depthBias,
        layersOf(emitter, samplers, DRAWS),
        fragmentTests(emitter),
        emitter.backfaceCull ? FrontSide : DoubleSide,
      );
      return { mesh: skinOf(skin, material, drawn), material, drawn };
    });
  }, [skin, emitter, samplers]);

  /* Held apart from the slots, so a change of wire mode rebuilds the twins alone. */
  const twins = useMemo(
    (): readonly (SkinnedMesh | null)[] =>
      slots.map((slot) => {
        const material = skin === null ? null : twinOf(slot.material);
        return material === null || skin === null ? null : skinOf(skin, material, slot.drawn);
      }),
    [skin, slots, twinOf],
  );

  useEffect(
    () => () => {
      for (const slot of slots) slot.material.dispose();
    },
    [slots],
  );
  useEffect(
    () => () => {
      for (const twin of twins) disposeTwin(twin);
    },
    [twins],
  );

  const programs = useAttachedPrograms(
    emitter,
    samplers,
    skin?.geometry ?? null,
    slots.length,
    document,
  );
  useEffect(() => {
    if (programs.length !== slots.length) return;
    const bound = slots.map((slot, at) => bindSlot(slot, programs[at]));
    return () => {
      slots.forEach((slot, at) => {
        const { previous, twins } = bound[at] ?? { previous: slot.mesh.material, twins: [] };
        slot.mesh.material = previous;
        slot.mesh.onBeforeRender = noDraw;
        for (const twin of twins) slot.mesh.remove(twin);
      });
    };
  }, [slots, programs, rank]);

  useLayoutEffect(() => {
    for (const slot of slots) {
      slot.mesh.renderOrder = rank;
      slot.mesh.layers.set(distorts(emitter) ? DISTORTION_LAYER : PARTICLE_LAYER);
    }
    for (const twin of twins) {
      if (twin === null) continue;
      twin.renderOrder = rank + WIRE_ORDER;
      twin.layers.set(PARTICLE_LAYER);
    }
  }, [slots, twins, rank, emitter]);

  useFrame((state) => {
    const stamp = state.gl.info.render.frame;
    let used = 0;
    if (!hidden && !emitter.disabled) {
      for (const source of sources) {
        const pool = source.pool;
        const frame = frameOf(source, emitter);
        const time = frame.now;
        const buckets = bucketsOf(pool, stamp);
        const [first, last] = bucketRange(buckets, emitter.index);
        for (let listed = first; listed < last && used < slots.length; listed += 1) {
          const at = buckets.order[listed];
          const { mesh, material } = slots[used];
          const twin = twins[used];
          const uniforms = material.uniforms;
          const passes = programs[used]?.materials;
          appearance(pool, at, emitter, time, DRAWN);
          premultiplyInto(emitter, DRAWN.color);
          const tint = uniforms.particleTint.value as number[];
          for (let channel = 0; channel < 4; channel += 1) tint[channel] = DRAWN.color[channel];
          uniforms.particleErode.value = erosionDrive(pool, at, emitter, time);

          const age = time - pool.birthTime[at];
          const through = age01(pool, at, time);
          for (let layer = 0; layer < 2; layer += 1) {
            const over = layerOf(emitter, layer);
            if (over === null) continue;
            uvTransformInto(pool, at, over, layer, age, through, time, UV_DRAWN);
            const turn = (layer === 0 ? uniforms.particleTurn : uniforms.particleTurnMult)
              .value as number[];
            const shift = (layer === 0 ? uniforms.particleShift : uniforms.particleShiftMult)
              .value as number[];
            turn[0] = UV_DRAWN.turn;
            turn[1] = UV_DRAWN.scaleU;
            turn[2] = UV_DRAWN.scaleV;
            shift[0] = UV_DRAWN.offsetU;
            shift[1] = UV_DRAWN.offsetV;
            shift[2] = UV_DRAWN.cellU;
            shift[3] = UV_DRAWN.cellV;
            if (passes !== undefined) uvRowsInto(UV_DRAWN, over, ROWS[layer] ?? ROWS[0]);
          }
          sourcesScrollInto(emitter, sources, uniforms.paletteScroll.value as number[]);
          if (passes !== undefined) {
            colorLookupInto(emitter, pool, at, through, LOOKUP, 0);
            for (const pass of passes) {
              writeSlotMembers(pass, {
                color: DRAWN.color,
                rows: ROWS,
                lookup: LOOKUP,
                drive: uniforms.particleErode.value as number,
              });
              writePaletteScroll(pass, uniforms.paletteScroll.value as number[]);
            }
          }

          mesh.scale.set(DRAWN.scale[0], DRAWN.scale[1], DRAWN.scale[2]);
          mesh.visible = shaded;
          if (twin !== null) {
            twin.scale.copy(mesh.scale);
            twin.visible = true;
          }
          used += 1;
        }
      }
    }
    for (let slot = used; slot < slots.length; slot += 1) {
      slots[slot].mesh.visible = false;
      const twin = twins[slot];
      if (twin !== null) twin.visible = false;
    }
  });

  return (
    <>
      {slots.map((slot, at) => (
        <Fragment key={at}>
          <primitive object={slot.mesh} />
          {twins[at] !== null && <primitive object={twins[at]} />}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The character's skin under `material`, bound to its skeleton, drawn where `drawn` holds.
 *
 * The bind is detached, so a vertex skinned by the character's bones lands where the
 * character stands and the mesh's own transform is the particle's scale on top of it.
 */
function skinOf(skin: CharacterSkin, material: Material, drawn: readonly boolean[]): SkinnedMesh {
  const mesh = new SkinnedMesh(
    skin.geometry,
    drawn.map((held) => (held ? material : SKIPPED)),
  );
  mesh.bindMode = DetachedBindMode;
  mesh.bind(skin.skeleton, IDENTITY);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** What `bindSlot` changed on a slot: the materials it replaced and the pass twins it added. */
interface BoundSlot {
  readonly previous: Material | Material[];
  readonly twins: readonly Mesh[];
}

/**
 * Bind each pass of `program` to `slot` on each submesh its lists leave in, the first on the
 * slot's skin and each later one on a twin under it, with the environment written for the slot
 * before each draw.
 */
function bindSlot(slot: Slot, program: SlotProgram | undefined): BoundSlot {
  const previous = slot.mesh.material;
  const [first, ...later] = program?.materials ?? [];
  if (program === undefined || first === undefined) return { previous, twins: [] };

  const draw: Mesh["onBeforeRender"] = (renderer, _scene, camera, _geometry, material) => {
    program.environment.write(renderer, camera, slot.mesh, 0);
    program.environment.draw(material);
  };
  slot.mesh.material = submeshMaterials(slot, first);
  slot.mesh.onBeforeRender = draw;
  const twins = later.map((material, at) =>
    addPassTwin(slot.mesh, at + 1, submeshMaterials(slot, material), draw),
  );

  return { previous, twins };
}

/** `material` on each submesh the slot's lists leave in. */
function submeshMaterials(slot: Slot, material: Material): Material[] {
  return slot.drawn.map((kept) => (kept ? material : SKIPPED));
}

/** `twin`'s own material disposed, and nothing for the shared `SKIPPED` stand-in. */
function disposeTwin(twin: SkinnedMesh | null): void {
  if (twin === null) return;
  const material = twin.material;
  for (const held of Array.isArray(material) ? material : [material]) {
    if (held !== SKIPPED) held.dispose();
  }
}
