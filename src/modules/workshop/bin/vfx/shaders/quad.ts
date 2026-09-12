import { SHEEN } from "../uniforms";

/**
 * An arbitrary quad's uv off its corner, each row the weights of `(corner.x, corner.y, 1)`.
 *
 * The attested pair, `u = y + 0.5` and `v = 0.5 - x` over the engine's corner, whose `x`
 * runs the other way here because the corner rides the mirrored basis. Decision 2.41 of
 * docs/plans/vfx-particle-renderer.md.
 */
export const ARBITRARY_UV: readonly [Weights, Weights] = [
  [0, 1, 0.5],
  [1, 0, 0.5],
];

type Weights = readonly [number, number, number];

export const VERTEX = /* glsl */ `
const vec3 ARBITRARY_U = vec3(${ARBITRARY_UV[0].join(", ")});
const vec3 ARBITRARY_V = vec3(${ARBITRARY_UV[1].join(", ")});

attribute vec2 corner;
attribute vec3 center;
attribute vec3 size;
attribute vec4 color;
attribute float roll;
attribute vec3 basisX;
attribute vec3 basisY;
attribute vec3 basisZ;
attribute vec3 uvTurn;
attribute vec4 uvShift;
attribute vec3 uvTurnMult;
attribute vec4 uvShiftMult;
attribute vec3 lookup;

uniform float pushPull;
uniform float reach;
uniform float pivot;

varying vec2 vUv;
varying vec4 vColor;
varying vec3 vTurn;
varying vec4 vShift;
varying vec3 vTurnMult;
varying vec4 vShiftMult;
varying vec2 vLookup;
varying float vErode;

// quad_vs's PARTICLE_DEPTH_PUSH_PULL. Decision 2.47 of docs/plans/vfx-particle-renderer.md.
vec4 pushed(vec4 view) {
  view.xyz += normalize(view.xyz) * pushPull;
  return view;
}

void main() {
  // The texture's first row is v = 0, so v runs down the quad.
  vUv = vec2(corner.x + 0.5, 0.5 - corner.y);
  vColor = color;
  vTurn = uvTurn;
  vShift = uvShift;
  vTurnMult = uvTurnMult;
  vShiftMult = uvShiftMult;
  vLookup = lookup.xy;
  vErode = lookup.z;

  // The corner, lifted so the quad grows from its base where the emitter asks, and
  // reaching to the whole of scale0, which is a half-extent.
  vec2 at = vec2(corner.x, corner.y + pivot) * reach;

  // A simple emitter's world plane: the table's U and V in the engine's space, spun
  // about their normal, then mirrored.
#if PLANE >= 1
  {
#if PLANE == 2
    vec3 u = vec3(1.0, 0.0, 0.0);
#else
    vec3 u = vec3(0.0, 1.0, 0.0);
#endif
#if PLANE == 3
    vec3 v = vec3(1.0, 0.0, 0.0);
#else
    vec3 v = vec3(0.0, 0.0, -1.0);
#endif
    vec3 w = cross(v, u);
    // The roll arrives mirrored for the view axis, so it is put back first.
    float turn = -roll;
    float c = cos(turn);
    float s = sin(turn);
    vec3 spunU = u * c + cross(w, u) * s;
    vec3 spunV = v * c + cross(w, v) * s;
    vec3 offset = spunU * (at.y * size.y) + spunV * (at.x * size.x);
    offset.x = -offset.x;
    vec4 view = modelViewMatrix * vec4(center + offset, 1.0);
    gl_Position = projectionMatrix * pushed(view);
    return;
  }
#endif

  // A camera quad expands in view space, which is what makes it face the eye. Only the
  // roll of its rotation reaches it, because the other two turn it out of that plane.
#ifdef BILLBOARD
  {
    vec2 turned = vec2(
      at.x * cos(roll) - at.y * sin(roll),
      at.x * sin(roll) + at.y * cos(roll)
    );
    vec4 view = modelViewMatrix * vec4(center, 1.0);
    view.xy += turned * size.xy;
    gl_Position = projectionMatrix * pushed(view);
    return;
  }
#endif

  // The basis the particle stands on, built on the CPU, as the viewport sees it.
  mat3 basis = mat3(basisX, basisY, basisZ);

#ifdef RAY
  {
    // A ray lies along the particle's own +Z and rolls about it to face the eye: scale.x
    // across, scale.y along, and scale.z where its near edge starts along the axis. The
    // mirrored space flips a cross product, so the engine's across is the negation of
    // this one.
    vec3 axis = basis[2];
    vec3 aside = cross(axis, cameraPosition - center);
    vec3 across = dot(aside, aside) > 0.0 ? -normalize(aside) : basis[0];
    vec3 world = center
      + axis * (size.z + (corner.y + 0.5) * size.y)
      + across * (corner.x * size.x);
    vec4 view = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * pushed(view);
    return;
  }
#endif

  vUv = vec2(dot(ARBITRARY_U, vec3(corner, 1.0)), dot(ARBITRARY_V, vec3(corner, 1.0)));
  vec3 world = center + basis[0] * (at.x * size.x) + basis[1] * (at.y * size.y);
  vec4 view = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * pushed(view);
}
`;

/*
 * The texel at a coordinate, fetched the way the layer's \`TEXTUREADDRESS\` says.
 *
 * The coordinate is brought inside one cell here rather than by the sampler, because
 * the cell is a sub-rectangle of the texture and the sampler's own mode would wrap
 * across the whole atlas. Wrap and mirror fold the coordinate, clamp holds it at the
 * edge, and border is a clamp whose outside reads as nothing.
 */
export const FETCH = /* glsl */ `
vec4 fetch(sampler2D tex, vec2 placed, vec4 shift, vec2 size, int mode) {
  vec2 held;
  if (mode >= 2) {
    held = clamp(placed, 0.0, 1.0);
  } else if (mode == 1) {
    vec2 folded = mod(placed, 2.0);
    held = 1.0 - abs(folded - 1.0);
  } else {
    held = fract(placed);
  }

  vec4 texel = texture2D(tex, shift.zw + held * size);
  bool outside = any(lessThan(placed, vec2(0.0))) || any(greaterThan(placed, vec2(1.0)));
  return mode == 3 && outside ? vec4(0.0) : texel;
}
`;

/*
 * The share of a texel the erosion keeps.
 *
 * The map's value under the mixer is kept where it lies in the band from the drive up by
 * the slice width, ramped in over \`erosionFeatherOut\` below the drive and out over
 * \`erosionFeatherIn\` inside the far edge, each ramp linear at the rate the CPU inverts
 * the feather to. At the drive itself the alpha is already whole.
 */
export const ERODE = /* glsl */ `
#ifdef EROSION
uniform sampler2D mapErosion;
uniform int addressErosion;
uniform vec4 erosionMix;
uniform vec4 erosionDefault;
uniform vec2 featherRate;
uniform float sliceWidth;

varying float vErode;

float kept(float value, float drive) {
  float upper = clamp((drive - value + sliceWidth) * featherRate.x, 0.0, 1.0);
  float lower = clamp((drive - value) * featherRate.y, 0.0, 1.0);
  return upper - lower;
}

/* What the erosion reads at \`at\`, where the base layer's texture samples with its cell:
   its map there, or what the engine leaves in the slot for an emitter that binds none.
   Decision 2.50 of docs/plans/vfx-particle-renderer.md. */
float eroding(vec2 at) {
  vec4 read =
#ifdef HAS_MAP_EROSION
    fetch(mapErosion, at, vec4(0.0), vec2(1.0), addressErosion);
#else
    erosionDefault;
#endif
  return kept(clamp(dot(read, erosionMix), 0.0, 1.0), vErode);
}
#else
float eroding(vec2 at) { return 1.0; }
#endif
`;

/**
 * What a distorting fragment covers, taken from where its offset carries it.
 *
 * The map's `xy` is the direction, flat at `0.5`, and its **alpha** is the mask: it is
 * what shapes the warp and how much of it the fragment carries. `distortion` is how far,
 * in screen widths, with the horizontal half scaled by the aspect so a round warp stays
 * round, and the screen's edge pulls in the edge itself. A map the install does not ship
 * warps nothing rather than the whole quad. Decision 2.25 of
 * docs/plans/vfx-particle-renderer.md.
 */
export const WARP = /* glsl */ `
uniform vec2 viewport;

#ifdef DISTORTS
uniform sampler2D mapNormal;
uniform float warp;
uniform sampler2D frame;

vec4 warped(vec2 at, float mask) {
  vec4 held =
#ifdef HAS_NORMAL
    texture2D(mapNormal, at);
#else
    vec4(0.5, 0.5, 1.0, 0.0);
#endif
  float shown = mask * held.a;
  vec2 push = (held.xy * 2.0 - 1.0) * warp * shown * vec2(viewport.y / viewport.x, 1.0);
  vec2 taken = clamp(gl_FragCoord.xy / viewport + push, 0.0, 1.0);
  return vec4(texture2D(frame, taken).rgb, shown);
}
#endif
`;

/*
 * The palette and then the colour ramp.
 *
 * The palette replaces the colour and keeps the alpha: \`u\` is the texel under the mix
 * weights and \`v\` the row, each moved by its animation curve. The ramp is multiplied in
 * after it, at the particle's own lookup, or at the mult layer's uv where \`rampAtMult\`
 * says the lane carries that instead.
 */
export const COLOR = /* glsl */ `
uniform sampler2D mapRamp;
uniform sampler2D mapPalette;
uniform int addressPalette;
uniform vec4 paletteMix;
uniform float paletteRow;
uniform vec2 paletteScroll;

vec4 colored(vec4 texel, vec2 lookup) {
#ifdef HAS_PALETTE
  vec2 at = vec2(clamp(dot(texel, paletteMix), 0.0, 1.0), paletteRow) + paletteScroll;
  texel.rgb = fetch(mapPalette, at, vec4(0.0), vec2(1.0), addressPalette).rgb;
#endif
#ifdef HAS_RAMP
  texel *= texture2D(mapRamp, lookup);
#endif
  return texel;
}
`;

/**
 * The rim and the reflection added over the colour, as `mesh_ps` saturates them.
 *
 * `SHEEN` names the alpha that carries them.
 */
const SHEEN_FRAGMENT = /* glsl */ `
#if SHEEN == ${SHEEN.none}
vec4 shone(vec4 lit, float texelAlpha) {
  return lit;
}
#else
uniform samplerCube mapReflection;
uniform vec3 reflectionTint;

varying vec3 vRim;
varying vec4 vReflect;

vec4 shone(vec4 lit, float texelAlpha) {
  float carrier = SHEEN == ${SHEEN.texel} ? texelAlpha : lit.a;
  vec3 mirrored = vec3(0.0);
#ifdef REFLECTS
  mirrored = textureCube(mapReflection, vReflect.xyz).rgb * vReflect.w
    * mix(vec3(1.0), reflectionTint, vReflect.w);
  if (SHEEN == ${SHEEN.texel}) mirrored *= texelAlpha;
#endif
  lit.rgb = clamp(lit.rgb + mirrored + vRim * carrier, 0.0, 1.0);
  return lit;
}
#endif
`;

/**
 * The soft fade over the gap from the fragment back to the scene.
 *
 * `quad_ps` and `mesh_ps`'s own fade, reading `viewport` off `WARP`. Decision 2.43 of
 * docs/plans/vfx-particle-renderer.md.
 */
export const SOFT = /* glsl */ `
#include <packing>

#ifdef SOFT
uniform vec4 softParams;
uniform vec4 softControl;
uniform sampler2D sceneDepth;
uniform vec2 depthRange;

vec4 softened(vec4 lit) {
  float stored = texture2D(sceneDepth, gl_FragCoord.xy / viewport).r;
  float scene = perspectiveDepthToViewZ(stored, depthRange.x, depthRange.y);
  float here = perspectiveDepthToViewZ(gl_FragCoord.z, depthRange.x, depthRange.y);
  vec2 through = clamp((here - scene - softParams.xy) * softParams.zw, 0.0, 1.0);
  vec2 eased = through * through * (3.0 - 2.0 * through);
  float fade = eased.x - eased.y;
  lit.rgb *= softControl.x + fade * softControl.y;
  lit.a *= softControl.z + fade * softControl.w;
  return lit;
}
#else
vec4 softened(vec4 lit) { return lit; }
#endif
`;

/** The flat colour `wireMaterial` draws its edges in, declared only where it asks for them. */
export const WIRE = /* glsl */ `
#ifdef WIREFRAME
uniform vec4 wireColor;
#endif
`;

/*
 * The fragment pass a quad and a mesh share, each with its own vertex shader in front.
 *
 * A quad with no texture falls off from its centre rather than drawing a flat white
 * square, because an untextured particle is one whose texture has not arrived or that
 * the install does not ship, and a square of full white reads as a bug. A mesh draws
 * flat instead, having a silhouette of its own, which \`falloff\` switches.
 */
export const FRAGMENT = /* glsl */ `
${WIRE}
uniform sampler2D map;
uniform float alphaRef;
uniform vec2 cell;
uniform vec2 center;
uniform vec2 flip;
uniform int address;

uniform sampler2D mapMult;
uniform vec2 cellMult;
uniform vec2 centerMult;
uniform vec2 flipMult;
uniform int addressMult;

varying vec2 vUv;
varying vec4 vColor;
varying vec3 vTurn;
varying vec4 vShift;
varying vec3 vTurnMult;
varying vec4 vShiftMult;
varying vec2 vLookup;

/*
 * One layer's coordinate, in cells: the 2x3 matrix.
 *
 * The scale and the rotation act about \`uvTransformCenter\` and the scroll translates
 * after them. A flip mirrors the result within the cell, a post-multiply, so a flipped
 * layer's scroll runs the other way.
 */
vec2 layerUv(vec2 uv, vec3 turn, vec4 shift, vec2 about, vec2 mirrored) {
  vec2 placed = (uv - about) * turn.yz;
  float c = cos(turn.x);
  float s = sin(turn.x);
  placed = vec2(placed.x * c - placed.y * s, placed.x * s + placed.y * c);
  placed += about + shift.xy;
  return mix(placed, 1.0 - placed, mirrored);
}

${FETCH}
${COLOR}
${ERODE}
${WARP}
${SHEEN_FRAGMENT}
${SOFT}

void main() {
#ifdef WIREFRAME
  gl_FragColor = wireColor;
  return;
#endif
  vec4 texel = vec4(1.0);
  vec2 placed = layerUv(vUv, vTurn, vShift, center, flip);
#ifdef HAS_MAP
  texel = fetch(map, placed, vShift, cell, address);
  /* LOCK_ALPHA: a quad's alpha samples the whole texture at its own corner, and a mesh's
     at its uv turned and scaled without the translation that carries the scroll and the
     cell. */
#if LOCK_ALPHA == 1
  texel.a = texture2D(map, vUv).a;
#elif LOCK_ALPHA == 2
  vec2 held = vUv * vTurn.yz;
  float c = cos(vTurn.x);
  float s = sin(vTurn.x);
  held = vec2(held.x * c - held.y * s, held.x * s + held.y * c);
  texel.a = fetch(map, mix(held, 1.0 - held, flip), vec4(0.0), vec2(1.0), address).a;
#endif
#elif defined(FALLOFF)
  texel.a = 1.0 - smoothstep(0.0, 0.5, length(vUv - 0.5));
#endif
  float share = eroding(vShift.zw + placed * cell);

  /* quad_vs routes the mult layer's uv down the lane the ramp's lookup rides, in texture
     space and unfolded, so the ramp reads there too under a mult layer. */
  vec2 atMult = layerUv(vUv, vTurnMult, vShiftMult, centerMult, flipMult);
#ifdef RAMP_AT_MULT
  texel = colored(texel, vShiftMult.zw + atMult * cellMult);
#else
  texel = colored(texel, vLookup);
#endif
#ifdef HAS_MAP_MULT
  texel *= fetch(mapMult, atMult, vShiftMult, cellMult, addressMult);
#endif
  texel.a *= share;

  vec4 lit = texel * vColor;
  if (lit.a < alphaRef) discard;
  lit = softened(shone(lit, texel.a));

#ifdef DISTORTS
  gl_FragColor = warp != 0.0 ? warped(placed, lit.a) : lit;
#else
  gl_FragColor = lit;
#endif
}
`;
