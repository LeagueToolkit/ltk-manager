import { DoubleSide, FrontSide, Object3D, type Texture } from "three";

import { AXIS_SIGN } from "@/modules/viewport";

import type { EmitterModel } from "../../engine/model/model";
import { MESH_PRELUDE } from "../shaders/meshPrelude";
import { QUAD_PRELUDE } from "../shaders/quadPrelude";
import { RIBBON_PRELUDE } from "../shaders/ribbonPrelude";
import { distorts } from "./drawKind";
import { orientationDefines, orientationUniforms, type QuadOrientation } from "./materials";
import type { ParticleDraw } from "./particleProgram";
import { erosionUniforms, offsets, OVERLAY } from "./uniforms";
import { cellSize } from "./uvTransform";

/** Three's world, which a quad and a ribbon prelude state a position in. */
export const WORLD = new Object3D();

/** The engine's space, which the mesh prelude states a vertex in. */
const ENGINE_WORLD = new Object3D();
ENGINE_WORLD.scale.set(AXIS_SIGN[0], AXIS_SIGN[1], AXIS_SIGN[2]);
ENGINE_WORLD.updateMatrixWorld();

const BOTH_FACES = () => DoubleSide;
const EMITTER_BIAS = (emitter: EmitterModel) => emitter.depthBias;

/** The faces a mesh keeps: the front alone unless it asks for both. */
const meshSide = (emitter: EmitterModel) => (emitter.backfaceCull ? FrontSide : DoubleSide);

/** An emitter's quads, spliced behind `QUAD_PRELUDE`. */
export function quadDraw(orientation: QuadOrientation): ParticleDraw {
  return {
    path: "quad",
    prelude: QUAD_PRELUDE,
    world: WORLD,
    side: BOTH_FACES,
    bias: EMITTER_BIAS,
    feed: (material, emitter) => {
      material.defines = { ...orientationDefines(orientation), ...layerDefines(emitter) };
      Object.assign(material.uniforms, {
        ...orientationUniforms(orientation),
        ...layerUniforms(emitter),
      });
    },
  };
}

/** A trail's or a beam's ribbon, spliced behind `RIBBON_PRELUDE`. */
export const RIBBON_DRAW: ParticleDraw = {
  path: "quad",
  prelude: RIBBON_PRELUDE,
  world: WORLD,
  side: BOTH_FACES,
  bias: EMITTER_BIAS,
  feed: (material, emitter) => {
    material.defines = layerDefines(emitter);
    Object.assign(material.uniforms, {
      cellSize: { value: cellSize(emitter.uv) },
      cellSizeMult: { value: emitter.multUv === null ? [1, 1] : cellSize(emitter.multUv) },
    });
  },
};

/** An emitter's mesh instances, spliced behind `MESH_PRELUDE`, posed by `bones` where set. */
export function meshDraw(bones: Texture | null): ParticleDraw {
  return {
    path: "mesh",
    prelude: MESH_PRELUDE,
    world: ENGINE_WORLD,
    side: meshSide,
    bias: EMITTER_BIAS,
    feed: (material, emitter) => {
      const erosion = erosionUniforms(emitter.erosion, null);
      material.defines = {
        ...(emitter.groundLayer ? { GROUND_LAYER: "" } : {}),
        ...(bones !== null ? { PARTICLE_SKINNING: "" } : {}),
      };
      Object.assign(material.uniforms, {
        particleBones: { value: bones },
        ...layerUniforms(emitter),
        erosionBand: { value: [erosion.sliceWidth.value, ...erosion.featherRate.value] },
      });
    },
  };
}

/**
 * One particle of an attached mesh: the character's skin, which carries every engine input,
 * so no prelude. The slot states the space it draws in. An emitter authoring no
 * `depthBiasFactors` takes `OVERLAY` in their place.
 */
export const ATTACHED_DRAW: ParticleDraw = {
  path: "attached",
  prelude: null,
  world: null,
  side: meshSide,
  bias: (emitter) => (offsets(emitter.depthBias) ? emitter.depthBias : OVERLAY),
  feed: () => {},
};

/** Each layer's cell, centre and flip, which a prelude places the layer's uv by. */
function layerUniforms(emitter: EmitterModel) {
  const mult = emitter.multUv;
  return {
    cell: { value: cellSize(emitter.uv) },
    uvCenter: { value: [emitter.uv.center[0], emitter.uv.center[1]] },
    flip: { value: [Number(emitter.uv.flipU), Number(emitter.uv.flipV)] },
    cellMult: { value: mult === null ? [1, 1] : cellSize(mult) },
    uvCenterMult: { value: mult === null ? [0.5, 0.5] : [mult.center[0], mult.center[1]] },
    flipMult: { value: mult === null ? [0, 0] : [Number(mult.flipU), Number(mult.flipV)] },
  };
}

/** `GROUND_LAYER` and `MULT_LAYER`, the mult layer being no distortion pair's. */
function layerDefines(emitter: EmitterModel) {
  return {
    ...(emitter.groundLayer ? { GROUND_LAYER: "" } : {}),
    ...(emitter.multUv !== null && !distorts(emitter) ? { MULT_LAYER: "" } : {}),
  };
}
