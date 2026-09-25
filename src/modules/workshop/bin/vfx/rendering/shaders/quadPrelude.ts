import type { VertexPrelude } from "@/modules/viewport";

import { LAYER_UV, QUAD_CORNER } from "./quad";

/**
 * The vertex the engine's CPU builds for one quad corner, out of the instanced attributes of
 * `quadBuffers`, which the translated `quad_vs` reads, per "The engine builds the quad
 * vertices on the CPU" in docs/plans/hexshade-vfx.md.
 *
 * - `POSITION` is the corner in three's world, which the environment's clip transform takes
 *   unchanged.
 * - `COLOR` is stored BGRA, and already premultiplied where the blend mode asks.
 * - `TEXCOORD.xy` is the base layer's uv inside the atlas and `TEXCOORD1.xy` the mult
 *   layer's, or the ramp lookup without one. The prelude places each layer's cell. The
 *   frame is 0 and `TEXTURE_INFO` is the identity, which leaves both unchanged.
 * - `TEXCOORD.w` is the erosion drive.
 *
 * `MULT_LAYER` routes the mult layer. The orientation defines are `QUAD_CORNER`'s.
 */
export const QUAD_PRELUDE: VertexPrelude = {
  source: /* glsl */ `
in vec2 corner;
in vec3 center;
in vec3 size;
in vec4 color;
in float roll;
in vec3 basisX;
in vec3 basisY;
in vec3 basisZ;
in vec3 uvTurn;
in vec4 uvShift;
in vec3 uvTurnMult;
in vec4 uvShiftMult;
in vec3 lookup;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform float reach;
uniform float pivot;
uniform vec2 cell;
uniform vec2 uvCenter;
uniform vec2 flip;
uniform vec2 cellMult;
uniform vec2 uvCenterMult;
uniform vec2 flipMult;

${QUAD_CORNER}
${LAYER_UV}

void enginePrelude() {
  vec2 uv = cornerUv();
  engine_POSITION = cornerWorld();
  engine_COLOR = color.bgra;
  vec2 base = uvShift.zw + layerUv(uv, uvTurn, uvShift, uvCenter, flip) * cell;
  engine_TEXCOORD = vec4(base, 0.0, lookup.z);
#ifdef MULT_LAYER
  vec2 mult = uvShiftMult.zw + layerUv(uv, uvTurnMult, uvShiftMult, uvCenterMult, flipMult) * cellMult;
  engine_TEXCOORD1 = vec4(mult, 0.0, 0.0);
#else
  engine_TEXCOORD1 = vec4(lookup.xy, 0.0, 0.0);
#endif
}
`,
  inputs: ["a_POSITION", "a_COLOR", "a_TEXCOORD", "a_TEXCOORD1"],
};
