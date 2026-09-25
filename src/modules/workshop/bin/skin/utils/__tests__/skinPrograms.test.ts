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

import { materialReads, programsOf } from "../skinScene";

const BODY = "0x0000b0d1";
const EYES = "0x0000e1e5";
const CAPE = "0x0000ca9e";

const DIFFUSE: AssetRef = { kind: "file", path: "body.tex" };
const MASK: AssetRef = { kind: "file", path: "mask.tex" };
const CAC: AssetRef = { kind: "file", path: "DATA/Characters/Ahri/Skins/Skin3/CAC.bin" };

function preview(hash: string, missing = false, source: AssetRef | null = null): MaterialPreview {
  return {
    hash,
    name: null,
    missing,
    source,
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

describe("materialReads", () => {
  it("names each material the skin draws with once, and no missing one", () => {
    expect(materialReads(skin())).toEqual([{ source: null, hashes: [BODY, EYES] }]);
  });

  it("reads a material a linked file declares from that file, after the skin's own", () => {
    const linked: SkinModel = {
      ...skin(),
      material: preview(BODY, false, CAC),
      overrides: [
        { submesh: "Eyes", texture: null, material: preview(EYES) },
        { submesh: "Cape", texture: null, material: preview(CAPE, false, CAC) },
        { submesh: "Eyes2", texture: null, material: preview(EYES) },
      ],
    };

    expect(materialReads(linked)).toEqual([
      { source: null, hashes: [EYES] },
      { source: CAC, hashes: [BODY, CAPE] },
    ]);
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

    expect([...assets]).toEqual([[`program:${BODY}:0:Diffuse_Texture`, DIFFUSE]]);
  });

  it("keys the same texture name of two passes apart", () => {
    const programs = [
      program(BODY, [ready([["Mask_Texture", DIFFUSE]]), ready([["Mask_Texture", MASK]])]),
    ];

    const assets = programTextureAssets(programs);

    expect([...assets]).toEqual([
      [`program:${BODY}:0:Mask_Texture`, DIFFUSE],
      [`program:${BODY}:1:Mask_Texture`, MASK],
    ]);
  });
});

describe("programsOf", () => {
  const programs = [
    program(BODY, [
      ready([
        ["Diffuse_Texture", DIFFUSE],
        ["Mask_Texture", MASK],
      ]),
      ready([["Mask_Texture", MASK]]),
    ]),
    program(EYES, [failed(), ready([])]),
  ];
  const textures = new Map([
    [`program:${BODY}:0:Diffuse_Texture`, "body-texture"],
    [`program:${BODY}:1:Mask_Texture`, "mask-texture"],
  ]);

  it("draws a submesh under every pass of its material, in order", () => {
    const [first, second, ...rest] = programsOf(skin(), programs, textures, "Body");

    expect(first?.index).toBe(0);
    expect(first?.pass.textures.map((texture) => texture.name)).toEqual([
      "Diffuse_Texture",
      "Mask_Texture",
    ]);
    expect([...(first?.textures ?? [])]).toEqual([["Diffuse_Texture", "body-texture"]]);
    expect(second?.index).toBe(1);
    expect([...(second?.textures ?? [])]).toEqual([["Mask_Texture", "mask-texture"]]);
    expect(rest).toEqual([]);
  });

  it("passes over a pass that did not translate", () => {
    const eyes = programsOf(skin(), programs, textures, "eyes");

    expect(eyes.map((pass) => pass.index)).toEqual([1]);
    expect(eyes[0]?.pass.textures).toEqual([]);
  });

  it("draws nothing under a program for a submesh whose material has none", () => {
    expect(programsOf(skin(), programs, textures, "Ghost")).toEqual([]);
    expect(programsOf(skin(), [], textures, "Body")).toEqual([]);
  });
});
