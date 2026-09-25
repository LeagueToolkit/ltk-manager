import { expect, it } from "vitest";

import type { AssetRef, MaterialProgram, PassProgram } from "@/lib/tauri";

import { fallbackTexture } from "../materialFallback";

const MATCAP: AssetRef = { kind: "file", path: "matcap.tex" };
const DIFFUSE: AssetRef = { kind: "file", path: "diffuse.tex" };

function failedPass(textures: readonly (readonly [string, AssetRef | null])[]): PassProgram {
  return {
    pass: {
      shader: "Shaders/StaticMesh/HKG_MatCap_Translucent",
      defines: [],
      runtimeSwitches: [],
      textures: textures.map(([name, asset]) => ({
        name,
        texture: asset === null ? null : { path: name, asset },
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
    program: { kind: "failed", reason: "no permutation" },
  };
}

function program(passes: PassProgram[]): MaterialProgram {
  return {
    hash: "0x00000001",
    name: null,
    animated: false,
    kind: "staticMesh",
    passes,
    warnings: [],
  };
}

it("prefers the base colour texture over one named earlier", () => {
  const material = program([
    failedPass([
      ["MatCap_Texture", MATCAP],
      ["Diffuse_Texture", DIFFUSE],
    ]),
  ]);
  expect(fallbackTexture(material)).toBe(DIFFUSE);
});

it("takes the first texture a pass names when none carries a base colour", () => {
  const material = program([
    failedPass([["Mask", null]]),
    failedPass([["MatCap_Texture", MATCAP]]),
  ]);
  expect(fallbackTexture(material)).toBe(MATCAP);
});

it("has no fallback for a material whose passes name no texture on this machine", () => {
  expect(fallbackTexture(program([failedPass([["Diffuse_Texture", null]])]))).toBeNull();
});
