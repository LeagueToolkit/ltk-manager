import { describe, expect, it } from "vitest";

import type {
  AssetRef,
  MaterialPreview,
  MaterialProgram,
  PassProgram,
  SkinModel,
  StageProgram,
} from "@/lib/tauri";
import { programTextureAssets } from "@/modules/viewport";

import { materialHashes, programOf } from "../skinScene";

const BODY = "0x0000b0d1";
const EYES = "0x0000e1e5";

const DIFFUSE: AssetRef = { kind: "file", path: "body.tex" };
const MASK: AssetRef = { kind: "file", path: "mask.tex" };

function preview(hash: string, missing = false): MaterialPreview {
  return {
    hash,
    name: null,
    missing,
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
}

function skin(): SkinModel {
  return {
    mesh: null,
    skeleton: null,
    texture: null,
    emissiveTexture: null,
    material: preview(BODY),
    overrides: [
      { submesh: "Eyes", texture: null, material: preview(EYES) },
      { submesh: "Ghost", texture: null, material: preview("0x0000dead", true) },
    ],
    hidden: [],
    scale: null,
    selfIllumination: null,
    animationGraph: null,
    idleEffects: [],
    effectSystems: [],
  };
}

const STAGE: StageProgram = {
  id: 3,
  glsl: "#version 300 es\nvoid main() {}\n",
  sidecar: { blocks: [], textures: [], attributes: [] },
  cached: false,
};

function ready(textures: readonly (readonly [string, AssetRef | null])[]): PassProgram {
  return {
    pass: {
      shader: "Shaders/SkinnedMesh/Diffuse_Bloom",
      defines: [],
      runtimeSwitches: [],
      textures: textures.map(([name, asset]) => ({
        name,
        texture: asset === null ? null : { path: asset.kind === "file" ? asset.path : "", asset },
        source: "material",
        sampler: {
          shared: null,
          wrap: ["repeat", "repeat", "repeat"],
          filterMin: true,
          filterMag: true,
        },
      })),
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
}

function failed(): PassProgram {
  return { ...ready([]), program: { kind: "failed", reason: "no cache" } };
}

function program(hash: string, passes: PassProgram[]): MaterialProgram {
  return { hash, name: null, animated: false, kind: "skinnedMesh", passes, warnings: [] };
}

describe("materialHashes", () => {
  it("names each material the skin draws with once, and no missing one", () => {
    expect(materialHashes(skin())).toEqual([BODY, EYES]);
  });
});

describe("programTextureAssets", () => {
  it("keys every held texture of every ready pass by material and name", () => {
    const programs = [
      program(BODY, [
        ready([
          ["Diffuse_Texture", DIFFUSE],
          ["Mask_Texture", null],
        ]),
      ]),
      program(EYES, [failed()]),
      null,
    ];

    const assets = programTextureAssets(programs);

    expect([...assets]).toEqual([[`program:${BODY}:Diffuse_Texture`, DIFFUSE]]);
  });
});

describe("programOf", () => {
  const programs = [
    program(BODY, [
      ready([
        ["Diffuse_Texture", DIFFUSE],
        ["Mask_Texture", MASK],
      ]),
    ]),
    program(EYES, [failed(), ready([])]),
  ];
  const textures = new Map([[`program:${BODY}:Diffuse_Texture`, "body-texture"]]);

  it("draws a submesh under its material's first pass that translated", () => {
    const body = programOf(skin(), programs, textures, "Body");
    const eyes = programOf(skin(), programs, textures, "eyes");

    expect(body?.pass.textures.map((texture) => texture.name)).toEqual([
      "Diffuse_Texture",
      "Mask_Texture",
    ]);
    expect([...(body?.textures ?? [])]).toEqual([["Diffuse_Texture", "body-texture"]]);
    expect(eyes?.program.kind).toBe("ready");
    expect(eyes?.pass.textures).toEqual([]);
  });

  it("draws nothing under a program for a submesh whose material has none", () => {
    expect(programOf(skin(), programs, textures, "Ghost")).toBeNull();
    expect(programOf(skin(), [], textures, "Body")).toBeNull();
  });
});
