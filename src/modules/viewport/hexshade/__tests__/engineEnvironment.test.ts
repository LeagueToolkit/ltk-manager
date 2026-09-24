import {
  Matrix4,
  Object3D,
  PerspectiveCamera,
  type RawShaderMaterial,
  type Uniform,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import type { UniformBlock } from "@/lib/tauri";

import { DEFAULT_SUN } from "../../scene/utils/sunLight";
import { ambientCube, EngineEnvironment, writeRows } from "../engineEnvironment";
import { createProgramMaterial } from "../programMaterial";

const BLOCK: UniformBlock = {
  name: "PerFrameVertexCB",
  glslName: "PerFrameVertexCB_vs",
  size: 560,
  members: [],
};

describe("EngineEnvironment", () => {
  it("answers one group per block name, backed by the block's bytes", () => {
    const environment = new EngineEnvironment();

    const group = environment.group(BLOCK);
    const again = environment.group(BLOCK);
    const other = environment.group({ ...BLOCK, glslName: "PerFrameVertexCB_ps" });

    expect(again).toBe(group);
    expect(other).not.toBe(group);
    expect((group.uniforms[0] as Uniform).value).toHaveLength(140);
  });

  it("halves the clip transform's depth row into the D3D range", () => {
    const environment = new EngineEnvironment();
    const out = new Float32Array(16);

    environment.writeClip(out, 0);

    expect([...out.subarray(8, 16)]).toEqual([0, 0, 0.5, 0.5, 0, 0, 0, 1]);
  });
});

const member = (name: string, offset: number) => ({
  name,
  offset,
  size: 16,
  used: true,
  scalar: "float" as const,
  rows: 1,
  columns: 4,
  elements: 0,
  rowMajor: false,
});

const GLOBALS: UniformBlock = {
  name: "$Globals",
  glslName: "Globals_ps",
  size: 32,
  members: [member("BAKED_LIGHT_SCALE_AND_BIAS", 0), member("Tint", 16)],
};

/** A translated block of `extent` elements behind the instance `<name>_i`. */
function declared(glslName: string, element: string, extent: number): string {
  return `layout(std140) uniform ${glslName}\n{\n    ${element} m[${extent}];\n} ${glslName}_i;`;
}

/** A material of one pass whose stages declare `vertex` and `pixel` and nothing else. */
function programMaterial(
  environment: EngineEnvironment,
  vertex: readonly (readonly [UniformBlock, string])[],
  pixel: readonly (readonly [UniformBlock, string])[],
): RawShaderMaterial {
  const stage = (blocks: readonly (readonly [UniformBlock, string])[]) => ({
    id: 1,
    glsl: [...blocks.map(([, glsl]) => glsl), "void main() {}"].join("\n"),
    cached: false,
    sidecar: { blocks: blocks.map(([block]) => block), textures: [], attributes: [] },
  });
  return createProgramMaterial(
    {
      material: "0x1",
      pass: {
        shader: "Shaders/StaticMesh/DefaultEnv_Flat",
        defines: [],
        runtimeSwitches: [],
        textures: [],
        params: [{ name: "Tint", value: [1, 2, 3, 4], source: "material" }],
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
      program: { kind: "ready", defines: [], vertex: stage(vertex), pixel: stage(pixel) },
      textures: new Map(),
    },
    environment,
  );
}

describe("EngineEnvironment.draw", () => {
  it("writes the mesh's light map transform into the material's globals and flags the upload", () => {
    const environment = new EngineEnvironment();
    const material = programMaterial(
      environment,
      [],
      [[GLOBALS, declared("Globals_ps", "vec4", 2)]],
    );

    material.uniformsNeedUpdate = false;
    environment.draw(material, {
      baked: { texture: null, scale: [0.5, 0.25], bias: [0.125, 0] },
      stationary: null,
    });

    expect(material.uniformsGroups).toEqual([]);
    expect([...(material.uniforms["Globals_ps"]?.value as Float32Array)]).toEqual([
      0.5, 0.25, 0.125, 0, 1, 2, 3, 4,
    ]);
    expect(material.uniformsNeedUpdate).toBe(true);
  });
});

describe("EngineEnvironment under the uniform binding", () => {
  const INSTANCE: UniformBlock = {
    name: "VFXDynamicPerParticleInstanceCBVS",
    glslName: "VFXDynamicPerParticleInstanceCBVS_vs",
    size: 48,
    members: [],
  };
  const vertex = [
    [BLOCK, declared("PerFrameVertexCB_vs", "vec4", 6)],
    [INSTANCE, declared("VFXDynamicPerParticleInstanceCBVS_vs", "uvec4", 3)],
  ] as const;

  it("binds every buffer as an array uniform over bytes each material of the object shares", () => {
    const environment = new EngineEnvironment("uniform");

    const material = programMaterial(environment, vertex, []);
    const other = programMaterial(environment, vertex, []);

    expect(material.uniformsGroups).toEqual([]);
    expect(material.vertexShader).toContain("uniform vec4 PerFrameVertexCB_vs[6];");
    const frame = material.uniforms["PerFrameVertexCB_vs"]?.value as Float32Array;
    expect(frame).toHaveLength(24);
    expect(other.uniforms["PerFrameVertexCB_vs"]?.value.buffer).toBe(frame.buffer);
    expect(material.uniforms["VFXDynamicPerParticleInstanceCBVS_vs"]?.value).toBeInstanceOf(
      Uint32Array,
    );
  });

  it("writes a frame into the material's array uniform and flags its upload on every draw", () => {
    const environment = new EngineEnvironment("uniform");
    const material = programMaterial(environment, vertex, []);
    const renderer = { info: { render: { frame: 1 } } } as unknown as WebGLRenderer;

    environment.write(renderer, new PerspectiveCamera(), new Object3D(), 3.5);
    material.uniformsNeedUpdate = false;
    environment.draw(material);

    const frame = material.uniforms["PerFrameVertexCB_vs"]?.value as Float32Array | undefined;
    expect(frame?.[20]).toBe(3.5);
    expect(material.uniformsNeedUpdate).toBe(true);
  });

  it("writes the skin's self-illumination into every colour channel of SELF_ILLUMINATION", () => {
    const perDraw: UniformBlock = {
      name: "CharacterPerDrawPS",
      glslName: "CharacterPerDrawPS_ps",
      size: 256,
      members: [],
    };
    const environment = new EngineEnvironment("uniform");
    environment.selfIllumination = 0.5;
    const material = programMaterial(
      environment,
      [],
      [[perDraw, declared(perDraw.glslName, "vec4", 3)]],
    );
    const renderer = { info: { render: { frame: 1 } } } as unknown as WebGLRenderer;

    environment.write(renderer, new PerspectiveCamera(), new Object3D(), 0);

    const values = material.uniforms["CharacterPerDrawPS_ps"]?.value as Float32Array | undefined;
    expect(Array.from(values?.subarray(0, 4) ?? [])).toEqual([0.5, 0.5, 0.5, 0]);
    expect(values?.[9]).toBe(1);
  });
});

describe("ambientCube", () => {
  it("lights the faces by sky, ground and horizon at the sky's scale, adding the sun where it falls", () => {
    const cube = ambientCube(
      {
        ...DEFAULT_SUN,
        color: [1, 0.5, 0],
        strength: 0.5,
        sky: [0.2, 0.2, 0.2],
        ground: [0.1, 0.1, 0.1],
        horizon: [0.4, 0.4, 0.4],
        ambient: 0.5,
        total: 2,
      },
      [0, 1, 0],
    );

    expect(cube[2]).toEqual([1.2, 0.7, 0.2]);
    expect(cube[3]).toEqual([0.1, 0.1, 0.1]);
    expect(cube[0]).toEqual([0.4, 0.4, 0.4]);
  });
});

describe("writeRows", () => {
  it("lays a matrix out row by row, as a dot product against a column vector reads it", () => {
    const matrix = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    const out = new Float32Array(20);

    writeRows(out, 4, matrix);

    expect([...out.subarray(4)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});
