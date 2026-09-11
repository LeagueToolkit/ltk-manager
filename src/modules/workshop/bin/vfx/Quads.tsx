import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Mesh } from "three";

import { AXIS_SIGN } from "@/modules/viewport";

import { mirrorInto, multiplyInto } from "./basis";
import { fragmentTests, premultiplyInto, sortsBackToFront } from "./blend";
import { quadBuffers, QUADS_PER_EMITTER, written } from "./buffers";
import { colorLookupInto } from "./colorLookup";
import { distorts, drawsAsQuad, facesTheCamera, isRay, isUnitQuad } from "./drawKind";
import { DrawPair, useDrawPair } from "./drawPair";
import { SIMPLE_ORIENTATION } from "./enums";
import { quadMaterial } from "./materials";
import type { EmitterModel } from "./model";
import { sourcesScrollInto } from "./palette";
import {
  age01,
  appearance,
  type DrawFrame,
  drawnPlace,
  drawnPlaceInto,
  erosionDrive,
  frameOf,
  particleBasisInto,
  type Source,
  spinOf,
} from "./particleRead";
import { FRAME_SLOTS } from "./pool";
import { type LayerDraws, layersOf } from "./uniforms";
import type { EmitterSamplers } from "./useVfxTextures";
import { layerOf, uvDraw, uvTransformInto } from "./uvTransform";

/** Scratch the appearance pass writes into, reused across every particle of a frame. */
const DRAWN = { scale: new Float32Array(3), color: new Float32Array(4) };

/** The same, for whichever of the two layers the write is on. */
const UV_DRAWN = uvDraw();

/** The basis one particle stands on, in the engine's space and then the viewport's. */
const BASIS = new Float32Array(FRAME_SLOTS);
const MIRRORED = new Float32Array(FRAME_SLOTS);

/** Where one particle draws, in the engine's space, before the mirror. */
const PLACED = drawnPlace();

/** The pool holds degrees and the shader's basis takes radians. */
const DEGREE = Math.PI / 180;

/** The ramp and the soft fade a quad's shader compiles, and neither the rim nor the reflection. */
const DRAWS: LayerDraws = { ramp: true, sheen: false, fade: true };

/** The particles one frame draws, by slot: which pool index, of which source, in what order. */
interface Picked {
  readonly order: Int32Array;
  readonly owner: Int32Array;
  readonly drawing: Int32Array;
}

export interface QuadsProps {
  emitter: EmitterModel;
  /**
   * Every system whose pool holds this emitter's particles, read every frame.
   *
   * The driver for an emitter of the opened system, and each live child for an emitter of
   * a child. The clock each carries is read rather than passed, because its value moves
   * every frame and a prop carrying it would rerender each emitter at the display's rate.
   */
  sources: readonly Source[];
  samplers: EmitterSamplers;
  /** Where the emitter falls in the system's draw order, from `drawRanks`. */
  rank: number;
  hidden: boolean;
}

/**
 * One emitter's particles, as quads: camera-facing, arbitrary, or rays.
 *
 * A frame writes instanced arrays and leaves the expansion to the vertex shader, so no
 * matrix per particle reaches the GPU. A camera quad takes its roll alone, an arbitrary
 * quad and a ray the basis the CPU builds for the particle, and a simple emitter's quad
 * the world plane its `orientation` names.
 */
export function Quads({ emitter, sources, samplers, rank, hidden }: QuadsProps) {
  const buffers = useMemo(() => quadBuffers(QUADS_PER_EMITTER), []);
  const material = useMemo(
    () =>
      quadMaterial(
        emitter.blendMode,
        samplers.base,
        { bias: emitter.depthBias, pushPull: emitter.depthPushPull },
        {
          billboard: facesTheCamera(emitter) || emitter.legacySimple !== null,
          ray: isRay(emitter) && emitter.legacySimple === null,
          plane: emitter.legacySimple?.orientation ?? SIMPLE_ORIENTATION.camera,
          unitQuad: isUnitQuad(emitter),
          pivotUp: emitter.pivotUp,
        },
        layersOf(emitter, samplers, DRAWS),
        fragmentTests(emitter),
      ),
    [emitter, samplers],
  );

  useEffect(() => () => buffers.geometry.dispose(), [buffers]);

  const pair = useDrawPair<Mesh>(material, distorts(emitter));

  const drawn = !hidden && !emitter.disabled && drawsAsQuad(emitter);
  const sorted = sortsBackToFront(emitter.blendMode);

  /* Scratch keyed by the emitter's own slot rather than by a pool index, which runs to a
     whole pool's capacity: the particles, the depth each stands at from the eye. */
  const picked = useMemo<Picked>(
    () => ({
      order: new Int32Array(QUADS_PER_EMITTER),
      owner: new Int32Array(QUADS_PER_EMITTER),
      drawing: new Int32Array(QUADS_PER_EMITTER),
    }),
    [],
  );
  const depth = useMemo(() => new Float32Array(QUADS_PER_EMITTER), []);

  useFrame((state) => {
    if (!drawn) {
      buffers.geometry.instanceCount = 0;
      return;
    }

    const frames = sources.map((source) => frameOf(source, emitter));
    sourcesScrollInto(emitter, sources, material.uniforms.paletteScroll.value as number[]);

    let held = 0;
    sources.forEach((source, from) => {
      const pool = source.pool;
      for (let at = 0; at < pool.count && held < QUADS_PER_EMITTER; at += 1) {
        if (pool.emitter[at] !== emitter.index) continue;
        picked.order[held] = at;
        picked.owner[held] = from;
        picked.drawing[held] = held;
        held += 1;
      }
    });

    if (sorted) {
      const eye = state.camera.position;
      for (let slot = 0; slot < held; slot += 1) {
        const from = picked.owner[slot];
        drawnPlaceInto(sources[from].pool, picked.order[slot], frames[from], PLACED);
        const x = PLACED.place[0] * AXIS_SIGN[0] - eye.x;
        const y = PLACED.place[1] * AXIS_SIGN[1] - eye.y;
        const z = PLACED.place[2] * AXIS_SIGN[2] - eye.z;
        depth[slot] = x * x + y * y + z * z;
      }
      picked.drawing.subarray(0, held).sort((left, right) => depth[right] - depth[left]);
    }

    write(sources, frames, emitter, picked, held, buffers);
    buffers.geometry.instanceCount = held;
  });

  return <DrawPair pair={pair} geometry={buffers.geometry} material={material} rank={rank} />;
}

/** Each particle's centre, scale and colour, in the order the sort left them. */
function write(
  sources: readonly Source[],
  frames: readonly DrawFrame[],
  emitter: EmitterModel,
  picked: Picked,
  held: number,
  buffers: ReturnType<typeof quadBuffers>,
): void {
  const centers = buffers.center.array as Float32Array;
  const sizes = buffers.size.array as Float32Array;
  const colors = buffers.color.array as Float32Array;
  const rolls = buffers.roll.array as Float32Array;
  const bases = [
    buffers.basisX.array as Float32Array,
    buffers.basisY.array as Float32Array,
    buffers.basisZ.array as Float32Array,
  ];
  const turns = [buffers.uvTurn.array as Float32Array, buffers.uvTurnMult.array as Float32Array];
  const shifts = [buffers.uvShift.array as Float32Array, buffers.uvShiftMult.array as Float32Array];
  const lookups = buffers.lookup.array as Float32Array;

  for (let instance = 0; instance < held; instance += 1) {
    const slot = picked.drawing[instance];
    const at = picked.order[slot];
    const pool = sources[picked.owner[slot]].pool;
    const frame = frames[picked.owner[slot]];
    const time = frame.now;
    appearance(pool, at, emitter, time, DRAWN);
    premultiplyInto(emitter, DRAWN.color);

    const age = time - pool.birthTime[at];
    const through = age01(pool, at, time);
    colorLookupInto(emitter, pool, at, through, lookups, instance * 3);
    lookups[instance * 3 + 2] = erosionDrive(pool, at, emitter, time);

    for (let layer = 0; layer < turns.length; layer += 1) {
      const over = layerOf(emitter, layer);
      if (over === null) continue;

      uvTransformInto(pool, at, over, layer, age, through, time, UV_DRAWN);
      turns[layer][instance * 3] = UV_DRAWN.turn;
      turns[layer][instance * 3 + 1] = UV_DRAWN.scaleU;
      turns[layer][instance * 3 + 2] = UV_DRAWN.scaleV;
      shifts[layer][instance * 4] = UV_DRAWN.offsetU;
      shifts[layer][instance * 4 + 1] = UV_DRAWN.offsetV;
      shifts[layer][instance * 4 + 2] = UV_DRAWN.cellU;
      shifts[layer][instance * 4 + 3] = UV_DRAWN.cellV;
    }

    drawnPlaceInto(pool, at, frame, PLACED);
    centers[instance * 3] = PLACED.place[0] * AXIS_SIGN[0];
    centers[instance * 3 + 1] = PLACED.place[1] * AXIS_SIGN[1];
    centers[instance * 3 + 2] = PLACED.place[2] * AXIS_SIGN[2];

    sizes[instance * 3] = DRAWN.scale[0];
    sizes[instance * 3 + 1] = DRAWN.scale[1];
    sizes[instance * 3 + 2] = DRAWN.scale[2];

    colors[instance * 4] = DRAWN.color[0];
    colors[instance * 4 + 1] = DRAWN.color[1];
    colors[instance * 4 + 2] = DRAWN.color[2];
    colors[instance * 4 + 3] = DRAWN.color[3];

    /* A roll is an angle rather than a position, so the mirrored axis reaches it as a
       reversed turn about the view axis. */
    rolls[instance] = -spinOf(pool, at, emitter, time) * DEGREE;

    particleBasisInto(pool, at, emitter, frame, BASIS);
    if (PLACED.orbited) multiplyInto(PLACED.turn, BASIS, BASIS);
    mirrorInto(BASIS, 0, MIRRORED, 0);
    for (let column = 0; column < 3; column += 1) {
      bases[column][instance * 3] = MIRRORED[column];
      bases[column][instance * 3 + 1] = MIRRORED[3 + column];
      bases[column][instance * 3 + 2] = MIRRORED[6 + column];
    }
  }

  /* Only the instances written go up, which for an emitter drawing few is most of the cost. */
  if (held === 0) return;
  for (const attribute of [
    buffers.center,
    buffers.size,
    buffers.color,
    buffers.roll,
    buffers.basisX,
    buffers.basisY,
    buffers.basisZ,
    buffers.uvTurn,
    buffers.uvShift,
    buffers.uvTurnMult,
    buffers.uvShiftMult,
    buffers.lookup,
  ]) {
    written(attribute, held);
  }
}
