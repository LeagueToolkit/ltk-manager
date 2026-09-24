import { useFrame } from "@react-three/fiber";
import { Fragment, useEffect, useLayoutEffect, useMemo } from "react";
import {
  DetachedBindMode,
  DoubleSide,
  FrontSide,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  type ShaderMaterial,
  SkinnedMesh,
} from "three";

import { type CharacterSkin, useCharacterSkin } from "@/modules/viewport";

import type { EmitterModel } from "../../engine/model/model";
import {
  age01,
  appearance,
  erosionDrive,
  frameOf,
  type Source,
} from "../../engine/simulation/particleRead";
import type { EmitterSamplers } from "../hooks/useVfxTextures";
import { useWireTwin, WIRE_ORDER } from "../state/wire";
import { fragmentTests, premultiplyInto } from "../utils/blend";
import { distorts } from "../utils/drawKind";
import { bucketRange, bucketsOf } from "../utils/emitterBuckets";
import { DISTORTION_LAYER, PARTICLE_LAYER } from "../utils/frame";
import { attachedMaterial } from "../utils/materials";
import { sourcesScrollInto } from "../utils/palette";
import { rangesDrawn } from "../utils/submeshes";
import { type LayerDraws, layersOf } from "../utils/uniforms";
import { layerOf, uvDraw, uvTransformInto } from "../utils/uvTransform";

/** How many particles of one attached emitter draw at once, each a whole character. */
const ATTACHED_PER_EMITTER = 8;

/** What a submesh the emitter's lists leave out draws with. */
const SKIPPED = new MeshBasicMaterial({ visible: false });

/** The bind that leaves the skeleton's own inverse binds in charge. */
const IDENTITY = new Matrix4();

/** Scratch the frame reuses, so a draw allocates nothing per particle. */
const DRAWN = { scale: new Float32Array(3), color: new Float32Array(4) };
const UV_DRAWN = uvDraw();

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
 */
export function AttachedMeshes({ emitter, sources, samplers, rank, hidden }: AttachedMeshesProps) {
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
          }
          sourcesScrollInto(emitter, sources, uniforms.paletteScroll.value as number[]);

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

/** `twin`'s own material disposed, and nothing for the shared `SKIPPED` stand-in. */
function disposeTwin(twin: SkinnedMesh | null): void {
  if (twin === null) return;
  const material = twin.material;
  for (const held of Array.isArray(material) ? material : [material]) {
    if (held !== SKIPPED) held.dispose();
  }
}
