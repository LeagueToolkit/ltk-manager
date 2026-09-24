import { describe, expect, it } from "vitest";

import type { AssetRef, MaterialPreview, PassProgram, SkinModel, StageProgram } from "@/lib/tauri";

import {
  DEFAULT_DIFFUSE,
  DEFAULT_EMISSIVE,
  defaultProgramAssets,
  defaultProgramOf,
  drawsDefaultProgram,
  EMISSIVE_KEY,
} from "../defaultProgram";

const BODY: AssetRef = { kind: "file", path: "body.tex" };
const CAPE: AssetRef = { kind: "file", path: "cape.tex" };
const GLOW: AssetRef = { kind: "file", path: "glow.tex" };

const MATERIAL: MaterialPreview = {
  hash: "0x0000b0d1",
  name: null,
  missing: false,
  source: null,
  animated: false,
  shader: null,
  base: null,
  tint: null,
  opacity: null,
  alphaTest: null,
  uvRepeat: null,
  uvScroll: null,
  renderState: {
    blending: "opaque",
    srcFactor: "one",
    dstFactor: "zero",
    premultiplied: false,
    cutout: false,
    doubleSided: false,
    inverted: false,
    depthWrite: true,
    depthTest: true,
  },
  warnings: [],
};

function skin(over: Partial<SkinModel> = {}): SkinModel {
  return {
    mesh: null,
    skeleton: null,
    texture: { path: "body.tex", asset: BODY },
    emissiveTexture: null,
    material: null,
    overrides: [
      { submesh: "Cape", texture: { path: "cape.tex", asset: CAPE }, material: null },
      { submesh: "Eyes", texture: null, material: MATERIAL },
    ],
    hidden: [],
    scale: null,
    selfIllumination: null,
    animationGraph: null,
    idleEffects: [],
    effectSystems: [],
    ...over,
  };
}

const STAGE: StageProgram = {
  id: 0,
  glsl: "#version 300 es\nvoid main() {}\n",
  sidecar: { blocks: [], textures: [], attributes: [] },
  cached: false,
};

const LIT_UBER: PassProgram = {
  pass: {
    shader: "SkinnedMesh/LIT_UBER",
    defines: [],
    runtimeSwitches: [],
    textures: [],
    params: [],
    state: {
      blendEnable: false,
      srcColor: "one",
      dstColor: "zero",
      srcAlpha: "one",
      dstAlpha: "zero",
      cullEnable: true,
      windingToCull: "ccw",
      depthEnable: true,
      depthCompareFunc: 3,
      writeMask: 31,
    },
    schema: null,
  },
  program: { kind: "ready", defines: [], vertex: STAGE, pixel: STAGE },
};

describe("drawsDefaultProgram", () => {
  it("is true for a skin with no material and for a texture-only override", () => {
    expect(drawsDefaultProgram(skin())).toBe(true);
    expect(drawsDefaultProgram(skin({ material: MATERIAL, overrides: [] }))).toBe(false);
    expect(
      drawsDefaultProgram(
        skin({
          material: MATERIAL,
          overrides: [{ submesh: "Cape", texture: null, material: null }],
        }),
      ),
    ).toBe(true);
  });
});

describe("defaultProgramAssets", () => {
  it("keys the skin's colour texture, each texture-only override and the emissive texture", () => {
    const assets = defaultProgramAssets(
      skin({ emissiveTexture: { path: "glow.tex", asset: GLOW } }),
    );

    expect([...assets]).toEqual([
      ["base", BODY],
      ["submesh:cape", CAPE],
      [EMISSIVE_KEY, GLOW],
    ]);
  });
});

describe("defaultProgramOf", () => {
  const textures = new Map([
    ["base", "body-texture"],
    ["submesh:cape", "cape-texture"],
    [EMISSIVE_KEY, "black"],
  ]);

  it("binds the submesh's colour texture and the skin's emissive one, a material per texture", () => {
    const body = defaultProgramOf(skin(), LIT_UBER, textures, "Body");
    const cape = defaultProgramOf(skin(), LIT_UBER, textures, "cape");

    expect([...(body?.textures ?? [])]).toEqual([
      [DEFAULT_DIFFUSE, "body-texture"],
      [DEFAULT_EMISSIVE, "black"],
    ]);
    expect(cape?.textures.get(DEFAULT_DIFFUSE)).toBe("cape-texture");
    expect(cape?.material).not.toBe(body?.material);
  });

  it("draws nothing for a submesh a material covers or before the program translates", () => {
    expect(defaultProgramOf(skin(), LIT_UBER, textures, "Eyes")).toBeNull();
    expect(defaultProgramOf(skin(), null, textures, "Body")).toBeNull();
    expect(
      defaultProgramOf(
        skin(),
        { ...LIT_UBER, program: { kind: "failed", reason: "no cache" } },
        textures,
        "Body",
      ),
    ).toBeNull();
  });
});
