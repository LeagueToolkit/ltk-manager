import { COLOR, ERODE, FETCH, SOFT, WARP, WIRE } from "./quad";

export const RIBBON_VERTEX = /* glsl */ `
attribute vec2 alphaUv;
attribute vec2 cell;
attribute vec4 tint;
attribute vec2 lookup;
attribute float erode;
attribute vec2 multUv;
attribute vec2 multCell;

varying vec2 vUv;
varying vec2 vAlphaUv;
varying vec2 vCell;
varying vec4 vColor;
varying vec2 vLookup;
varying float vErode;
varying vec2 vMultUv;
varying vec2 vMultCell;

void main() {
  vUv = uv;
  vAlphaUv = alphaUv;
  vCell = cell;
  vColor = tint;
  vLookup = lookup;
  vErode = erode;
  vMultUv = multUv;
  vMultCell = multCell;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIBBON_FRAGMENT = /* glsl */ `
${WIRE}
uniform sampler2D map;
uniform float alphaRef;
uniform int address;
uniform vec2 cellSize;

uniform sampler2D mapMult;
uniform vec2 cellMult;
uniform int addressMult;

varying vec2 vUv;
varying vec2 vAlphaUv;
varying vec2 vCell;
varying vec4 vColor;
varying vec2 vLookup;
varying vec2 vMultUv;
varying vec2 vMultCell;

${FETCH}
${COLOR}
${ERODE}
${WARP}
${SOFT}

void main() {
#ifdef WIREFRAME
  gl_FragColor = wireColor;
  return;
#endif
  vec4 texel = vec4(1.0);
#ifdef HAS_MAP
  texel = fetch(map, vUv, vec4(0.0, 0.0, vCell), cellSize, address);
#if LOCK_ALPHA == 1
  texel.a = fetch(map, vAlphaUv, vec4(0.0), vec2(1.0), address).a;
#endif
#endif
#ifdef RAMP_AT_MULT
  texel = colored(texel, vMultCell + vMultUv * cellMult);
#else
  texel = colored(texel, vLookup);
#endif
#ifdef HAS_MAP_MULT
  texel *= fetch(mapMult, vMultUv, vec4(0.0, 0.0, vMultCell), cellMult, addressMult);
#endif
  texel.a *= eroding(vCell + vUv * cellSize);
  vec4 lit = texel * vColor;
  if (lit.a < alphaRef) discard;
  lit = softened(lit);
#ifdef DISTORTS
  gl_FragColor = warp != 0.0 ? warped(vUv, lit.a) : lit;
#else
  gl_FragColor = lit;
#endif
}
`;
