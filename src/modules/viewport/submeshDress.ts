import {
  AdditiveBlending,
  BackSide,
  ClampToEdgeWrapping,
  type Color,
  DoubleSide,
  FrontSide,
  type MeshBasicMaterial,
  MirroredRepeatWrapping,
  NormalBlending,
  RepeatWrapping,
  type Side,
  SRGBColorSpace,
  type Texture,
  type Wrapping,
} from "three";

import type { MaterialPreview, RenderState, Wrap } from "@/lib/tauri";

/**
 * What one submesh is drawn with, in the engine's order of choosing it.
 *
 * Section 1.3 of docs/research/static-material-studio-rendering.md.
 */
export interface SubmeshDress<T = Texture> {
  /** The material's slots, and null for a submesh drawn with a texture alone. */
  readonly material: MaterialPreview | null;
  /** The texture the material's base slot names, and null for none or one not held. */
  readonly base: T | null;
  /** The submesh's own skin texture, drawn where no material names a base. */
  readonly texture: T | null;
}

/** The colours a dressed submesh falls back on. */
export interface DressColors {
  /** What a submesh no texture reaches is drawn in. */
  readonly untextured: Color;
  /** What a submesh whose material link resolves to nothing is drawn in. */
  readonly errored: Color;
}

/** Three has no border wrap, and a clamp is the nearest edge a border sits on. */
const WRAPPING: Record<Wrap, Wrapping> = {
  repeat: RepeatWrapping,
  clamp: ClampToEdgeWrapping,
  mirror: MirroredRepeatWrapping,
  border: ClampToEdgeWrapping,
};

/** The program parameters a dress can move, so a change of them compiles again. */
const PROGRAMS = new WeakMap<MeshBasicMaterial, string>();

/**
 * `material` dressed as `dress` says, and the scroll its map moves at per second.
 *
 * The slots land on a `MeshBasicMaterial` as "10.5 Three.js" of the studio doc writes
 * them onto a stock material. A tint is set in sRGB, because the engine multiplies it
 * onto the encoded texel and the decode-multiply-encode round trip lands the same place.
 */
export function dressMaterial(
  material: MeshBasicMaterial,
  { material: slots, base, texture }: SubmeshDress,
  colors: DressColors,
): readonly [number, number] | null {
  const map = mapOf(slots, base, texture);
  if (material.map !== map) material.map = map;

  if (slots === null || slots.missing) {
    material.opacity = 1;
    material.alphaTest = 0;
    material.transparent = false;
    material.blending = NormalBlending;
    material.premultipliedAlpha = false;
    material.side = DoubleSide;
    material.depthWrite = true;
    material.depthTest = true;
    if (slots !== null) material.color.copy(colors.errored);
    else if (map === null) material.color.copy(colors.untextured);
    else material.color.setRGB(1, 1, 1);
    recompileIfMoved(material);
    return null;
  }

  if (slots.tint !== null) {
    const [r, g, b] = slots.tint;
    material.color.setRGB(r ?? 1, g ?? 1, b ?? 1, SRGBColorSpace);
  } else if (map === null) material.color.copy(colors.untextured);
  else material.color.setRGB(1, 1, 1);
  material.opacity = slots.opacity ?? 1;
  material.alphaTest = slots.alphaTest ?? 0;
  applyRenderState(material, slots.renderState);
  if (base !== null && map === base) tile(base, slots);
  recompileIfMoved(material);
  return slots.uvScroll === null ? null : [slots.uvScroll[0] ?? 0, slots.uvScroll[1] ?? 0];
}

/**
 * The map a submesh draws: the material's base, or its own texture where an opaque
 * material names none, per "6.3 Defaults when a sampler is missing" of the studio note.
 */
function mapOf(
  slots: MaterialPreview | null,
  base: Texture | null,
  texture: Texture | null,
): Texture | null {
  if (slots === null) return texture;
  if (slots.missing) return null;
  if (slots.base !== null) return base;
  return slots.renderState.blending === "opaque" ? texture : null;
}

function applyRenderState(material: MeshBasicMaterial, state: RenderState): void {
  material.transparent = state.blending !== "opaque";
  material.blending = state.blending === "additive" ? AdditiveBlending : NormalBlending;
  material.premultipliedAlpha = state.premultiplied;
  material.side = sideOf(state);
  material.depthWrite = state.depthWrite;
  material.depthTest = state.depthTest;
}

/**
 * The face a pass keeps.
 *
 * Three flips its front face under the mirrored axis of world.ts on its own, so the
 * engine's default winding is `FrontSide` here. Unjudged on screen against the game.
 */
function sideOf(state: RenderState): Side {
  if (state.doubleSided) return DoubleSide;
  return state.inverted ? BackSide : FrontSide;
}

/** The base's wrap and repeat, which are the material's own and so safe to set on it. */
function tile(base: Texture, slots: MaterialPreview): void {
  const [u, v] = slots.uvRepeat ?? [1, 1];
  base.repeat.set(u ?? 1, v ?? 1);
  const wrapS =
    slots.uvRepeat === null ? WRAPPING[slots.base?.wrap[0] ?? "repeat"] : RepeatWrapping;
  const wrapT =
    slots.uvRepeat === null ? WRAPPING[slots.base?.wrap[1] ?? "repeat"] : RepeatWrapping;
  if (base.wrapS !== wrapS || base.wrapT !== wrapT) {
    base.wrapS = wrapS;
    base.wrapT = wrapT;
    /* A wrap mode is set at upload, so a change of one uploads again. */
    base.needsUpdate = true;
  }
}

/** Flag the program stale where a parameter it was compiled on has moved. */
function recompileIfMoved(material: MeshBasicMaterial): void {
  const key = [
    material.map !== null,
    material.alphaTest > 0,
    material.premultipliedAlpha,
    material.side,
  ].join(":");
  if (PROGRAMS.get(material) === key) return;
  PROGRAMS.set(material, key);
  material.needsUpdate = true;
}
