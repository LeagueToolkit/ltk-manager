import { ShaderMaterial, type Texture, Vector2, Vector3 } from "three";

import { FXAA_QUALITY_OPTIONS } from "./antiAliasing";

/** How far each step of the edge search moves, FXAA 3.11's quality preset 26. */
const SEARCH_STEPS = [1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0];

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
#define STEPS ${SEARCH_STEPS.length}

uniform sampler2D frame;
uniform vec2 rcpFrame;
/* subpix, edge threshold, edge threshold floor */
uniform vec3 options;

const float STEP[STEPS] = float[](${SEARCH_STEPS.map((step) => step.toFixed(1)).join(", ")});

varying vec2 vUv;

float lumaOf(vec4 rgba) {
  return dot(rgba.rgb, vec3(0.299, 0.587, 0.114));
}

float lumaAt(vec2 at) {
  return lumaOf(textureLod(frame, at, 0.0));
}

/* A macro, since a texel offset has to be a constant expression and a parameter is not one. */
#define lumaOff(at, offset) lumaOf(textureLodOffset(frame, at, 0.0, offset))

void main() {
  vec2 posM = vUv;
  vec4 rgbyM = textureLod(frame, posM, 0.0);
  /* The game reads the centre's luma from its green channel and every neighbour's from
     the weighted sum. */
  float lumaM = rgbyM.g;
  float lumaS = lumaOff(posM, ivec2(0, 1));
  float lumaE = lumaOff(posM, ivec2(1, 0));
  float lumaN = lumaOff(posM, ivec2(0, -1));
  float lumaW = lumaOff(posM, ivec2(-1, 0));

  float rangeMax = max(max(lumaE, max(lumaM, lumaS)), max(lumaW, lumaN));
  float rangeMin = min(min(lumaE, min(lumaM, lumaS)), min(lumaW, lumaN));
  float range = rangeMax - rangeMin;
  if (range < max(options.z, rangeMax * options.y)) {
    gl_FragColor = vec4(rgbyM.rgb, 1.0);
    return;
  }

  float lumaNW = lumaOff(posM, ivec2(-1, -1));
  float lumaSE = lumaOff(posM, ivec2(1, 1));
  float lumaNE = lumaOff(posM, ivec2(1, -1));
  float lumaSW = lumaOff(posM, ivec2(-1, 1));

  float lumaNS = lumaN + lumaS;
  float lumaWE = lumaW + lumaE;
  float lumaNESE = lumaNE + lumaSE;
  float lumaNWNE = lumaNW + lumaNE;
  float lumaNWSW = lumaNW + lumaSW;
  float lumaSWSE = lumaSW + lumaSE;
  float edgeHorz = abs(-2.0 * lumaW + lumaNWSW)
    + abs(-2.0 * lumaM + lumaNS) * 2.0
    + abs(-2.0 * lumaE + lumaNESE);
  float edgeVert = abs(-2.0 * lumaS + lumaSWSE)
    + abs(-2.0 * lumaM + lumaWE) * 2.0
    + abs(-2.0 * lumaN + lumaNWNE);
  bool horzSpan = edgeHorz >= edgeVert;

  float lengthSign = horzSpan ? rcpFrame.y : rcpFrame.x;
  if (!horzSpan) {
    lumaN = lumaW;
    lumaS = lumaE;
  }
  float gradientN = lumaN - lumaM;
  float gradientS = lumaS - lumaM;
  bool pairN = abs(gradientN) >= abs(gradientS);
  float gradient = max(abs(gradientN), abs(gradientS));
  if (pairN) lengthSign = -lengthSign;

  float subpixB = ((lumaNS + lumaWE) * 2.0 + (lumaNWSW + lumaNESE)) * (1.0 / 12.0) - lumaM;
  float subpixC = clamp(abs(subpixB) / range, 0.0, 1.0);
  float subpixF = (-2.0 * subpixC + 3.0) * subpixC * subpixC;

  vec2 posB = posM;
  vec2 offNP = horzSpan ? vec2(rcpFrame.x, 0.0) : vec2(0.0, rcpFrame.y);
  if (horzSpan) posB.y += lengthSign * 0.5;
  else posB.x += lengthSign * 0.5;

  float lumaNN = (pairN ? lumaN : lumaS) + lumaM;
  float gradientScaled = gradient * 0.25;
  bool lumaMLTZero = lumaM - lumaNN * 0.5 < 0.0;

  vec2 posN = posB - offNP * STEP[0];
  vec2 posP = posB + offNP * STEP[0];
  float lumaEndN = lumaAt(posN) - lumaNN * 0.5;
  float lumaEndP = lumaAt(posP) - lumaNN * 0.5;
  bool doneN = abs(lumaEndN) >= gradientScaled;
  bool doneP = abs(lumaEndP) >= gradientScaled;
  if (!doneN) posN -= offNP * STEP[1];
  if (!doneP) posP += offNP * STEP[1];

  for (int i = 2; i < STEPS; i++) {
    if (doneN && doneP) break;

    if (!doneN) lumaEndN = lumaAt(posN) - lumaNN * 0.5;
    if (!doneP) lumaEndP = lumaAt(posP) - lumaNN * 0.5;
    doneN = abs(lumaEndN) >= gradientScaled;
    doneP = abs(lumaEndP) >= gradientScaled;
    if (!doneN) posN -= offNP * STEP[i];
    if (!doneP) posP += offNP * STEP[i];
  }

  float dstN = horzSpan ? posM.x - posN.x : posM.y - posN.y;
  float dstP = horzSpan ? posP.x - posM.x : posP.y - posM.y;
  bool directionN = dstN < dstP;
  bool goodSpan = directionN ? (lumaEndN < 0.0) != lumaMLTZero : (lumaEndP < 0.0) != lumaMLTZero;
  float pixelOffset = min(dstN, dstP) * (-1.0 / (dstN + dstP)) + 0.5;
  float offset = max(goodSpan ? pixelOffset : 0.0, subpixF * subpixF * options.x);
  if (horzSpan) posM.y += offset * lengthSign;
  else posM.x += offset * lengthSign;

  gl_FragColor = vec4(textureLod(frame, posM, 0.0).rgb, 1.0);
}
`;

/**
 * The screen pass smoothing a finished frame's edges, the game's `FXAA_PS.ps`.
 *
 * NVIDIA's FXAA 3.11 PC Quality at preset 26, with the game's quirk of taking the centre
 * pixel's luma from its green channel. The frame is sampled as the canvas's sRGB bytes,
 * as the game samples its own target.
 */
export function fxaaMaterial(frame: Texture): ShaderMaterial {
  const { subpix, edgeThreshold, edgeThresholdMin } = FXAA_QUALITY_OPTIONS;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      frame: { value: frame },
      rcpFrame: { value: new Vector2(1, 1) },
      options: { value: new Vector3(subpix, edgeThreshold, edgeThresholdMin) },
    },
  });
}

/** Point `material` at a frame `size` pixels across. */
export function writeFxaa(material: ShaderMaterial, size: Vector2): void {
  (material.uniforms.rcpFrame.value as Vector2).set(1 / size.x, 1 / size.y);
}
