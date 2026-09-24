import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { LineSegments, Mesh } from "three";

import { AXIS_SIGN } from "@/modules/viewport";

import { BEAM_MODE, QUAD_TYPE } from "../../engine/model/enums";
import type { EmitterModel } from "../../engine/model/model";
import {
  age01,
  appearance,
  drawnPlace,
  drawnPlaceInto,
  erosionDrive,
  frameOf,
  legacyRoll,
  type Source,
  standingFrameInto,
} from "../../engine/simulation/particleRead";
import { FRAME_SLOTS } from "../../engine/simulation/pool";
import { multiplyInto, standingInto, turnInto } from "../../engine/utils/basis";
import { sampleCurve } from "../../engine/utils/sampleCurve";
import type { EmitterSamplers } from "../hooks/useVfxTextures";
import { fragmentTests, premultiplyInto } from "../utils/blend";
import { colorLookupInto } from "../utils/colorLookup";
import { distorts } from "../utils/drawKind";
import { bucketRange, bucketsOf } from "../utils/emitterBuckets";
import { ribbonMaterial } from "../utils/materials";
import { sourcesScrollInto } from "../utils/palette";
import {
  type BeamEnds,
  type BeamParticle,
  commitRibbon,
  type Cursor,
  packUv,
  ribbonBuffers,
  UV_STRIDE,
  writeBeam,
} from "../utils/ribbon";
import { type LayerDraws, layersOf } from "../utils/uniforms";
import { uvDraw, uvTransformInto } from "../utils/uvTransform";
import { DrawPair, showPair, useDrawPair } from "./drawPair";

/** How many beams one emitter draws across every source, which caps its share of the pools. */
const BEAMS_PER_EMITTER = 256;

/** What a beam's colour is multiplied by when its length binds none. */
const UNBOUND: readonly number[] = [1, 1, 1, 1];

/** Scratch the frame reuses, so a draw allocates nothing per particle. */
const DRAWN = { scale: new Float32Array(3), color: new Float32Array(4) };
const UV_DRAWN = uvDraw();
const CURSOR: Cursor = { vertex: 0, index: 0 };
const EYE: [number, number, number] = [0, 0, 0];
const SOURCE: [number, number, number] = [0, 0, 0];
const TARGET: [number, number, number] = [0, 0, 0];
const OFFSET = new Float32Array(3);
const LOCAL: [number, number, number] = [0, 0, 0];
const PARTICLE: BeamParticle = {
  scale: DRAWN.scale,
  color: DRAWN.color,
  tiling: new Float32Array(2),
  tilingAt: 0,
  turn: new Float32Array(9),
  local: LOCAL,
  uv: new Float32Array(UV_STRIDE),
  uvAt: 0,
  multUv: new Float32Array(UV_STRIDE),
  lookup: new Float32Array(2),
  erode: 1,
};

/** Where one particle draws, in the engine's space, off which its local place is taken. */
const PLACED = drawnPlace();

/** The frame one particle stands its own turn on, which its emitter's flag picks. */
const STOOD = new Float32Array(FRAME_SLOTS);

/** The ramp and the soft fade a ribbon's shader compiles, and neither the rim nor the reflection. */
const DRAWS: LayerDraws = { ramp: true, sheen: false, fade: true };

export interface BeamsProps {
  emitter: EmitterModel;
  /** Every system whose pool holds this emitter's particles, each reaching from its own ends. */
  sources: readonly Source[];
  samplers: EmitterSamplers;
  /** Where the emitter falls in the system's draw order, from `drawRanks`. */
  rank: number;
  hidden: boolean;
}

/**
 * One emitter's particles, each the one quad a beam is from the system to its target.
 *
 * Both ends are the system's, the rig's origin plus `mLocalSpaceSourceOffset` and its
 * target plus `mLocalSpaceTargetOffset`, so every particle draws the same segment and
 * brings its own colour, `scale0` and uv. `mIsColorBindedWithDistance` multiplies in
 * `mAnimatedColorWithDistance` at the beam's raw length. The segment beam draws the same
 * quad, and its ribs are not built. Its erosion drive stands at zero, which its builder
 * writes in place of the particle's.
 */
export function Beams({ emitter, sources, samplers, rank, hidden }: BeamsProps) {
  const beam = emitter.beam;
  const buffers = useMemo(() => ribbonBuffers(BEAMS_PER_EMITTER * 4), []);
  const material = useMemo(
    () =>
      ribbonMaterial(
        emitter.blendMode,
        samplers.base,
        emitter.depthBias,
        layersOf(emitter, samplers, DRAWS),
        fragmentTests(emitter),
      ),
    [emitter, samplers],
  );

  useEffect(
    () => () => {
      buffers.geometry.dispose();
      buffers.edgeGeometry.dispose();
    },
    [buffers],
  );

  const pair = useDrawPair<Mesh | LineSegments>(material, distorts(emitter));

  const drawn = !hidden && !emitter.disabled && beam !== null && emitter.mesh === null;

  useFrame((state) => {
    if (!drawn || beam === null) {
      buffers.geometry.setDrawRange(0, 0);
      buffers.edgeGeometry.setDrawRange(0, 0);
      showPair(pair, false);
      return;
    }

    sourcesScrollInto(emitter, sources, material.uniforms.paletteScroll.value as number[]);
    const eye = state.camera.position;
    EYE[0] = eye.x * AXIS_SIGN[0];
    EYE[1] = eye.y * AXIS_SIGN[1];
    EYE[2] = eye.z * AXIS_SIGN[2];

    CURSOR.vertex = 0;
    CURSOR.index = 0;
    const stamp = state.gl.info.render.frame;
    const layers = { base: emitter.uv, mult: emitter.multUv };
    const segmented = emitter.quadType === QUAD_TYPE.cameraSegmentBeam;
    let held = 0;
    for (const source of sources) {
      const pool = source.pool;
      const origin = source.origin;
      const target = source.target;
      const frame = frameOf(source, emitter);
      /* The offsets are local to the system, so they turn with it before landing on the
         ends (`VfxRibbon_ShapesAndPrimitives.md` section 3.2). */
      OFFSET.set(beam.sourceOffset);
      turnInto(source.orientation, OFFSET, 0);
      for (let axis = 0; axis < 3; axis += 1) SOURCE[axis] = origin[axis] + OFFSET[axis];
      OFFSET.set(beam.targetOffset);
      turnInto(source.orientation, OFFSET, 0);
      for (let axis = 0; axis < 3; axis += 1) TARGET[axis] = target[axis] + OFFSET[axis];
      const ends: BeamEnds = {
        source: SOURCE,
        target: TARGET,
        eye: beam.mode === BEAM_MODE.arbitrary ? null : EYE,
      };

      const length = Math.hypot(
        target[0] - origin[0],
        target[1] - origin[1],
        target[2] - origin[2],
      );
      const bound = beam.colorBoundToDistance ? sampleCurve(beam.colorByDistance, length) : UNBOUND;

      const buckets = bucketsOf(pool, stamp);
      const [first, last] = bucketRange(buckets, emitter.index);
      for (let listed = first; listed < last && held < BEAMS_PER_EMITTER; listed += 1) {
        const at = buckets.order[listed];
        held += 1;

        const time = frame.now;
        appearance(pool, at, emitter, time, DRAWN);
        for (let channel = 0; channel < 4; channel += 1)
          DRAWN.color[channel] *= bound[channel] ?? 1;
        premultiplyInto(emitter, DRAWN.color);

        standingInto(pool.rotation, at * 3, legacyRoll(pool, at, emitter, time), PARTICLE.turn);
        standingFrameInto(pool, at, emitter, frame, STOOD);
        multiplyInto(STOOD, PARTICLE.turn, PARTICLE.turn);
        drawnPlaceInto(pool, at, frame, PLACED);
        if (PLACED.orbited) multiplyInto(PLACED.turn, PARTICLE.turn, PARTICLE.turn);
        for (let axis = 0; axis < 3; axis += 1) {
          LOCAL[axis] = PLACED.place[axis] - origin[axis];
        }
        PARTICLE.tiling.set(pool.tiling.subarray(at * 2, at * 2 + 2));

        const age = time - pool.birthTime[at];
        const through = age01(pool, at, time);
        uvTransformInto(pool, at, emitter.uv, 0, age, through, time, UV_DRAWN);
        packUv(UV_DRAWN, PARTICLE.uv, 0);
        if (emitter.multUv !== null) {
          uvTransformInto(pool, at, emitter.multUv, 1, age, through, time, UV_DRAWN);
          packUv(UV_DRAWN, PARTICLE.multUv, 0);
        }
        colorLookupInto(emitter, pool, at, through, PARTICLE.lookup, 0);
        PARTICLE.erode = segmented ? 0 : erosionDrive(pool, at, emitter, time);

        writeBeam(ends, PARTICLE, layers, buffers.arrays, CURSOR);
      }
    }
    commitRibbon(buffers, CURSOR);
    showPair(pair, CURSOR.index > 0);
  });

  return (
    <DrawPair
      pair={pair}
      geometry={buffers.geometry}
      material={material}
      rank={rank}
      edges={buffers.edgeGeometry}
    />
  );
}
