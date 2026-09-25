import { describe, expect, it } from "vitest";

import type { UniformBlock } from "@/lib/tauri";
import { EngineEnvironment } from "@/modules/viewport";

import { QUAD_TYPE, UV_MODE } from "../../../engine/model/enums";
import type { EmitterModel } from "../../../engine/model/model";
import { emitterOf, flat } from "../../../engine/simulation/__tests__/emitterFixture";
import { NO_SAMPLERS } from "../../hooks/useVfxTextures";
import { quadOrientation } from "../materials";
import { quadDraw } from "../particleDraws";
import {
  customParticleMaterial,
  drawsProgram,
  particleParams,
  particleShaderOf,
} from "../particleProgram";
import { layersOf } from "../uniforms";

const ASSET = { path: "fixture.dds", asset: null };

const EROSION = {
  map: null,
  addressMode: 0,
  mixer: flat(0, 0, 0, 1),
  drive: flat(0.5),
  lingerDrive: null,
  driveSource: 0,
  featherIn: 0.25,
  featherOut: 0.5,
  sliceWidth: 0.2,
} as EmitterModel["erosion"];

const PALETTE = {
  texture: ASSET,
  count: 4,
  selector: flat(1),
  scrollU: flat(0),
  scrollV: flat(0),
  mix: flat(1, 0, 0, 0),
  addressMode: 2,
} as EmitterModel["palette"];

function emitter(over: Partial<EmitterModel>): EmitterModel {
  return emitterOf(0, over);
}

describe("particleShaderOf", () => {
  it("draws a plain camera quad through the quad pair with no define", () => {
    expect(particleShaderOf(emitter({}))).toEqual({ shader: "quad", defines: [] });
  });

  it("sets a define for each block the emitter carries", () => {
    const pair = particleShaderOf(
      emitter({
        alphaRef: 0.5,
        erosion: EROSION,
        multUv: emitterOf(0).uv,
        palette: PALETTE,
        soft: { beginIn: 0, deltaIn: 1, beginOut: 0, deltaOut: 0 },
      }),
    );

    expect(pair).toEqual({
      shader: "quad",
      defines: ["ALPHA_TEST", "ALPHA_EROSION", "MULT_PASS", "PALETTIZE_TEXTURES", "SOFT_PARTICLES"],
    });
  });

  it("gives a quad a separate file for each uv mode in place of a define", () => {
    expect(particleShaderOf(emitter({ uvMode: UV_MODE.lockAlpha }))).toEqual({
      shader: "quadFixedAlphaUv",
      defines: [],
    });
    expect(particleShaderOf(emitter({ uvMode: UV_MODE.screenSpace }))).toEqual({
      shader: "quadScreenSpaceUv",
      defines: [],
    });
  });

  it("borrows the mesh pair for a reflective quad, without a mesh emitter's defines", () => {
    const reflection = {} as EmitterModel["reflection"];

    expect(particleShaderOf(emitter({ reflection, uvMode: UV_MODE.localSpace }))).toEqual({
      shader: "mesh",
      defines: ["REFLECTIVE"],
    });
  });

  it("draws a mesh through the mesh pair with its uv mode and vertex colours", () => {
    const mesh = {} as EmitterModel["mesh"];

    expect(
      particleShaderOf(emitter({ quadType: QUAD_TYPE.mesh, mesh, uvMode: UV_MODE.localSpaceMult })),
    ).toEqual({ shader: "mesh", defines: ["LOCAL_SPACE_UV", "USE_VERTEX_COLORS"] });
    expect(particleShaderOf(emitter({ quadType: QUAD_TYPE.attachedMesh }))).toEqual({
      shader: "attachedMesh",
      defines: ["USE_VERTEX_COLORS"],
    });
  });

  it("draws a distorting emitter through the distortion pair of its kind, on the alpha test alone", () => {
    const distortion = { strength: 0.1 } as EmitterModel["distortion"];
    const mesh = {} as EmitterModel["mesh"];

    expect(particleShaderOf(emitter({ distortion, alphaRef: 0.2, erosion: EROSION }))).toEqual({
      shader: "distortion",
      defines: ["ALPHA_TEST"],
    });
    expect(particleShaderOf(emitter({ distortion, quadType: QUAD_TYPE.mesh, mesh }))).toEqual({
      shader: "distortionMesh",
      defines: [],
    });
    expect(particleShaderOf(emitter({ distortion, quadType: QUAD_TYPE.attachedMesh }))).toEqual({
      shader: "distortionAttachedMesh",
      defines: [],
    });
  });
});

describe("drawsProgram", () => {
  const mesh = emitter({ quadType: QUAD_TYPE.mesh, mesh: {} as EmitterModel["mesh"] });
  const attached = emitter({ quadType: QUAD_TYPE.attachedMesh });
  const warping = emitter({ distortion: {} as EmitterModel["distortion"] });

  it("draws each pair on the path whose geometry feeds it", () => {
    expect(drawsProgram(emitter({}), particleShaderOf(emitter({})), "quad")).toBe(true);
    expect(drawsProgram(warping, particleShaderOf(warping), "quad")).toBe(true);
    expect(drawsProgram(mesh, particleShaderOf(mesh), "mesh")).toBe(true);
    expect(drawsProgram(attached, particleShaderOf(attached), "attached")).toBe(true);
    expect(drawsProgram(mesh, particleShaderOf(mesh), "quad")).toBe(false);
    expect(drawsProgram(emitter({}), particleShaderOf(emitter({})), "mesh")).toBe(false);
  });

  it("leaves a custom material and a palette without rows to the hand-written draw", () => {
    const custom = emitter({
      customMaterial: { missing: false } as EmitterModel["customMaterial"],
    });
    const rowless = emitter({ palette: { ...PALETTE, count: 0 } as EmitterModel["palette"] });

    for (const each of [custom, rowless]) {
      expect(drawsProgram(each, particleShaderOf(each), "quad")).toBe(false);
    }
  });

  it("leaves a quad whose uv mode takes another file to the hand-written quad", () => {
    const locked = emitter({ uvMode: UV_MODE.lockAlpha });

    expect(drawsProgram(locked, particleShaderOf(locked), "quad")).toBe(false);
  });
});

describe("particleParams", () => {
  it("packs the identity book, the alpha reference, the erosion and the palette row", () => {
    const erosive = emitter({ alphaRef: 0.25, erosion: EROSION, palette: PALETTE });
    const layers = layersOf(
      erosive,
      { ...NO_SAMPLERS, palette: {} as never },
      {
        ramp: true,
        sheen: false,
        fade: true,
      },
    );

    const params = new Map(
      particleParams(erosive, layers).map((param) => [param.name, param.value]),
    );

    expect(params.get("TEXTURE_INFO")).toEqual([1, 1, 1, 0]);
    expect(params.get("AlphaTestReferenceValue")).toEqual([0.25, 0, 0, 0]);
    expect(params.get("cAlphaErosionParams")).toEqual([0, 0.2, 4, 2]);
    expect(params.get("cAlphaErosionTextureMixer")).toEqual([0, 0, 0, 1]);
    expect(params.get("cPaletteSelectMain")).toEqual([0.375, 0, 0, 0]);
    expect(params.get("cPaletteSrcMixerMain")).toEqual([1, 0, 0, 0]);
    expect(params.get("kColorFactor")).toEqual([1, 1, 1, 1]);
  });

  it("packs a distortion's power", () => {
    const warping = emitter({ distortion: { strength: 0.07 } as EmitterModel["distortion"] });
    const layers = layersOf(warping, NO_SAMPLERS, { ramp: true, sheen: true, fade: true });

    const params = new Map(
      particleParams(warping, layers).map((param) => [param.name, param.value]),
    );

    expect(params.get("DistortionPower")?.[0]).toBeCloseTo(0.07);
  });
});

describe("customParticleMaterial", () => {
  const member = (name: string, offset: number) => ({
    name,
    offset,
    size: 4,
    used: true,
    scalar: "float" as const,
    rows: 1,
    columns: 1,
    elements: 0,
    rowMajor: false,
  });
  const GLOBALS: UniformBlock = {
    name: "$Globals",
    glslName: "Globals_ps",
    size: 32,
    members: [member("switch_GLOW", 0), member("switch_EDGE", 4), member("Alpha", 16)],
  };
  const stage = (blocks: readonly UniformBlock[], glsl: string) => ({
    id: 1,
    glsl,
    cached: false,
    sidecar: { blocks: [...blocks], textures: [], attributes: [] },
  });

  it("writes each runtime switch of the pass into its switch float, behind the quad prelude", () => {
    const emitter = emitterOf(0);
    const material = customParticleMaterial(
      {
        material: "0x1",
        index: 0,
        pass: {
          shader: "Shaders/Particles/Glow",
          defines: [],
          runtimeSwitches: [
            { name: "GLOW", on: true },
            { name: "EDGE", on: false },
          ],
          textures: [],
          params: [{ name: "Alpha", value: [0.5, 0, 0, 0], source: "material" }],
          state: {
            blendEnable: true,
            srcColor: "srcAlpha",
            dstColor: "oneMinusSrcAlpha",
            srcAlpha: "one",
            dstAlpha: "zero",
            cullEnable: false,
            windingToCull: "ccw",
            depthEnable: true,
            depthCompareFunc: 3,
            writeMask: 15,
          },
          schema: null,
        },
        program: {
          kind: "ready",
          defines: [],
          vertex: stage([], "void main() {}"),
          pixel: stage(
            [GLOBALS],
            "layout(std140) uniform Globals_ps\n{\n    vec4 m[2];\n} Globals_ps_i;\nvoid main() {}",
          ),
        },
        textures: new Map(),
      },
      emitter,
      quadDraw(quadOrientation(emitter)),
      new EngineEnvironment("uniform"),
    );

    const values = material.uniforms["Globals_ps"]?.value as Float32Array;
    expect([...values]).toEqual([1, 0, 0, 0, 0.5, 0, 0, 0]);
    expect(material.transparent).toBe(true);
    expect(material.defines).toHaveProperty("BILLBOARD");
    expect(material.vertexShader).toContain("hexshade_main();");
  });
});
