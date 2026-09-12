import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { type LineSegments, type Mesh, Vector3 } from "three";

import { AXIS_SIGN } from "@/modules/viewport";

import { AXIS, axisInto, multiplyInto, standingInto } from "./basis";
import { fragmentTests, premultiplyInto } from "./blend";
import { colorLookupInto } from "./colorLookup";
import { distorts, trailFacesTheCamera } from "./drawKind";
import { DrawPair, useDrawPair } from "./drawPair";
import { TRAIL_MODE } from "./enums";
import { ribbonMaterial } from "./materials";
import type { EmitterModel } from "./model";
import { sourcesScrollInto } from "./palette";
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
} from "./particleRead";
import { FRAME_SLOTS } from "./pool";
import {
  commitRibbon,
  type Cursor,
  packUv,
  ribbonBuffers,
  strand,
  UV_STRIDE,
  writeTrail,
} from "./ribbon";
import type { Point } from "./rig";
import { type LayerDraws, layersOf } from "./uniforms";
import type { EmitterSamplers } from "./useVfxTextures";
import { uvDraw, uvTransformInto } from "./uvTransform";

/** How many points one strand holds, which caps its share of its pool. */
const TRAIL_POINTS = 1024;

/** How many vertices one emitter's strands share across every source, four of the longest. */
const TRAIL_VERTICES = TRAIL_POINTS * 2 * 4;

/** Scratch the frame reuses, so a draw allocates nothing per particle. */
const DRAWN = { scale: new Float32Array(3), color: new Float32Array(4) };
const UV_DRAWN = uvDraw();
const BASIS = new Float32Array(9);
const STOOD = new Float32Array(FRAME_SLOTS);
const STRAND = strand(TRAIL_POINTS);
const ORDER = new Int32Array(TRAIL_POINTS);
const CURSOR: Cursor = { vertex: 0, index: 0 };
const PLACED = drawnPlace();
const LOOKING = new Vector3();
const VIEW: [number, number, number] = [0, 0, 0];

/** The ramp and the soft fade a ribbon's shader compiles, and neither the rim nor the reflection. */
const DRAWS: LayerDraws = { ramp: true, sheen: false, fade: true };

export interface TrailsProps {
  emitter: EmitterModel;
  /** Every system whose pool holds this emitter's particles, each strung as a strand of its own. */
  sources: readonly Source[];
  samplers: EmitterSamplers;
  /** Where the emitter falls in the system's draw order, from `drawRanks`. */
  rank: number;
  hidden: boolean;
}

/**
 * One emitter's particles, strung along one ribbon in the order they were born.
 *
 * Each particle is a point: its position, `scale0.x` as the half-width, its colour, its
 * birth tiling and the odometer at its birth. A camera trail expands across the view and
 * its tangent, and an arbitrary one along each particle's own `+X`, so it stands however
 * the particle was turned.
 */
export function Trails({ emitter, sources, samplers, rank, hidden }: TrailsProps) {
  const trail = emitter.trail;
  const buffers = useMemo(() => ribbonBuffers(TRAIL_VERTICES), []);
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

  const drawn = !hidden && !emitter.disabled && trail !== null;
  const facesEye = trailFacesTheCamera(emitter);

  useFrame((state) => {
    if (!drawn || trail === null) {
      buffers.geometry.setDrawRange(0, 0);
      return;
    }

    sourcesScrollInto(emitter, sources, material.uniforms.paletteScroll.value as number[]);
    state.camera.getWorldDirection(LOOKING);
    VIEW[0] = LOOKING.x * AXIS_SIGN[0];
    VIEW[1] = LOOKING.y * AXIS_SIGN[1];
    VIEW[2] = LOOKING.z * AXIS_SIGN[2];

    CURSOR.vertex = 0;
    CURSOR.index = 0;
    for (const source of sources) {
      strandInto(source, emitter);
      writeTrail(
        STRAND,
        {
          view: facesEye ? (VIEW as Point) : null,
          wake: trail.mode === TRAIL_MODE.wake,
          smoothing: trail.smoothing,
          cutoff: trail.cutoff,
          layers: { base: emitter.uv, mult: emitter.multUv },
        },
        buffers.arrays,
        CURSOR,
      );
    }
    commitRibbon(buffers, CURSOR);
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

/** One source's particles of `emitter` as a strand, into `STRAND`, in the order they were born. */
function strandInto(source: Source, emitter: EmitterModel): void {
  const pool = source.pool;
  const frame = frameOf(source, emitter);
  const time = frame.now;
  let held = 0;
  for (let at = 0; at < pool.count && held < TRAIL_POINTS; at += 1) {
    if (pool.emitter[at] !== emitter.index) continue;
    ORDER[held] = at;
    held += 1;
  }
  ORDER.subarray(0, held).sort((left, right) => pool.serial[left] - pool.serial[right]);

  STRAND.count = held;
  for (let slot = 0; slot < held; slot += 1) {
    const at = ORDER[slot];
    appearance(pool, at, emitter, time, DRAWN);
    premultiplyInto(emitter, DRAWN.color);
    drawnPlaceInto(pool, at, frame, PLACED);
    STRAND.position.set(PLACED.place, slot * 3);
    STRAND.width[slot] = DRAWN.scale[0];
    STRAND.color.set(DRAWN.color, slot * 4);
    STRAND.tiling.set(pool.tiling.subarray(at * 2, at * 2 + 2), slot * 2);
    STRAND.odometer[slot] = pool.odometer[at];
    STRAND.erode[slot] = erosionDrive(pool, at, emitter, time);

    standingInto(pool.rotation, at * 3, legacyRoll(pool, at, emitter, time), BASIS);
    standingFrameInto(pool, at, emitter, frame, STOOD);
    multiplyInto(STOOD, BASIS, BASIS);
    if (PLACED.orbited) multiplyInto(PLACED.turn, BASIS, BASIS);
    axisInto(BASIS, AXIS.x, STRAND.side, slot * 3);

    const age = time - pool.birthTime[at];
    const through = age01(pool, at, time);
    uvTransformInto(pool, at, emitter.uv, 0, age, through, time, UV_DRAWN);
    packUv(UV_DRAWN, STRAND.uv, slot * UV_STRIDE);
    if (emitter.multUv !== null) {
      uvTransformInto(pool, at, emitter.multUv, 1, age, through, time, UV_DRAWN);
      packUv(UV_DRAWN, STRAND.multUv, slot * UV_STRIDE);
    }
    colorLookupInto(emitter, pool, at, through, STRAND.lookup, slot * 2);
  }
}
