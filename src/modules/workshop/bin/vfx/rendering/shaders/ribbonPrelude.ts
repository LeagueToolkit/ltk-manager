import type { VertexPrelude } from "@/modules/viewport";

import { GROUND } from "./quad";

/**
 * The vertex the engine's CPU builds for one ribbon vertex, out of the attributes of
 * `ribbonBuffers`, which the translated `quad_vs` and `distortion_vs` read as they read a
 * quad corner's. See `QUAD_PRELUDE`.
 *
 * The ribbon writer has already placed each layer's uv in cell units, so the prelude only
 * lands it in its cell. `MULT_LAYER` routes the mult layer.
 */
export const RIBBON_PRELUDE: VertexPrelude = {
  source: /* glsl */ `
in vec3 position;
in vec2 uv;
in vec2 cell;
in vec4 tint;
in vec2 lookup;
in float erode;
in vec2 multUv;
in vec2 multCell;

uniform mat4 modelMatrix;
uniform vec2 cellSize;
uniform vec2 cellSizeMult;

${GROUND}

void enginePrelude() {
  engine_POSITION = grounded(modelMatrix * vec4(position, 1.0));
  engine_COLOR = tint.bgra;
  engine_TEXCOORD = vec4(cell + uv * cellSize, 0.0, erode);
#ifdef MULT_LAYER
  engine_TEXCOORD1 = vec4(multCell + multUv * cellSizeMult, 0.0, 0.0);
#else
  engine_TEXCOORD1 = vec4(lookup, 0.0, 0.0);
#endif
}
`,
  inputs: ["a_POSITION", "a_COLOR", "a_TEXCOORD", "a_TEXCOORD1"],
};
