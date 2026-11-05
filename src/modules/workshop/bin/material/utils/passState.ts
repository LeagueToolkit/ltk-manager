import type { BlendFactor, LeafValue, PassState, Winding } from "@/lib/tauri";

import { nameHash } from "../../shared/utils/binHash";

/** The render-state fields of a `StaticMaterialPassDef`, by hash. */
export const PASS_FIELD = {
  shader: nameHash("shader"),
  blendEnable: nameHash("blendEnable"),
  srcColor: nameHash("srcColorBlendFactor"),
  dstColor: nameHash("dstColorBlendFactor"),
  srcAlpha: nameHash("srcAlphaBlendFactor"),
  dstAlpha: nameHash("dstAlphaBlendFactor"),
  cullEnable: nameHash("cullEnable"),
  windingToCull: nameHash("windingToCull"),
  depthEnable: nameHash("depthEnable"),
  writeMask: nameHash("writeMask"),
} as const;

/** The factors on the wire, as `BlendFactor::of` in `material.rs` reads them. */
const FACTOR: Record<BlendFactor, number> = {
  zero: 0,
  one: 1,
  srcColor: 2,
  oneMinusSrcColor: 3,
  dstColor: 4,
  oneMinusDstColor: 5,
  srcAlpha: 6,
  oneMinusSrcAlpha: 7,
};

/** `writeMask`'s depth bit. Bits 1, 2, 4 and 8 are the colour channels. */
export const DEPTH_WRITE = 16;

/** The blends a pass is set to in one pick, each a source and a destination factor. */
export const BLENDS = {
  opaque: null,
  alpha: ["srcAlpha", "oneMinusSrcAlpha"],
  additive: ["srcAlpha", "one"],
  premultiplied: ["one", "oneMinusSrcAlpha"],
  multiply: ["dstColor", "zero"],
} as const satisfies Record<string, readonly [BlendFactor, BlendFactor] | null>;

export type Blend = keyof typeof BLENDS;

/** The blend a pass state reads as, or null for a pair of factors no pick writes. */
export function blendOf(state: PassState): Blend | null {
  if (!state.blendEnable) return "opaque";
  for (const [blend, factors] of Object.entries(BLENDS)) {
    if (factors !== null && factors[0] === state.srcColor && factors[1] === state.dstColor) {
      return blend as Blend;
    }
  }
  return null;
}

/** The fields a blend pick writes. Alpha takes the colour's factors. */
export function blendFields(blend: Blend): [string, LeafValue][] {
  const factors = BLENDS[blend];
  if (factors === null) return [[PASS_FIELD.blendEnable, { type: "bool", value: false }]];

  const [source, destination] = factors.map((factor) => integer(FACTOR[factor]));
  return [
    [PASS_FIELD.blendEnable, { type: "bool", value: true }],
    [PASS_FIELD.srcColor, source!],
    [PASS_FIELD.dstColor, destination!],
    [PASS_FIELD.srcAlpha, source!],
    [PASS_FIELD.dstAlpha, destination!],
  ];
}

/** The faces a pass culls. */
export type Cull = "back" | "front" | "none";

/**
 * The faces a pass state culls. `windingToCull` names the winding culled: counter-clockwise, the
 * class default, is the back face, and clockwise the front, which an inverted hull culls.
 */
export function cullOf(state: PassState): Cull {
  if (!state.cullEnable) return "none";
  return state.windingToCull === "ccw" ? "back" : "front";
}

const WINDING: Record<Winding, number> = { cw: 0, ccw: 1 };

/** The fields a cull pick writes. */
export function cullFields(cull: Cull): [string, LeafValue][] {
  if (cull === "none") return [[PASS_FIELD.cullEnable, { type: "bool", value: false }]];
  return [
    [PASS_FIELD.cullEnable, { type: "bool", value: true }],
    [PASS_FIELD.windingToCull, integer(WINDING[cull === "back" ? "ccw" : "cw"])],
  ];
}

/** The `writeMask` that writes depth or not, keeping the colour channels as they are. */
export function depthWriteFields(state: PassState, on: boolean): [string, LeafValue][] {
  const mask = on ? state.writeMask | DEPTH_WRITE : state.writeMask & ~DEPTH_WRITE;
  return [[PASS_FIELD.writeMask, integer(mask)]];
}

function integer(value: number): LeafValue {
  return { type: "integer", text: String(value) };
}
