import { describe, expect, it } from "vitest";

import type { ResolvedPass, UniformBlock } from "@/lib/tauri";

import { EngineEnvironment } from "../engineEnvironment";
import type { SubmeshProgram } from "../programMaterial";
import {
  type HeldValue,
  ProgramMaterials,
  programKey,
  scatter,
  withHeld,
} from "../programMaterials";

const MATERIAL = "0x2a1f3c7d";

function member(name: string, offset: number) {
  return {
    name,
    offset,
    size: 16,
    used: true,
    scalar: "float" as const,
    rows: 1,
    columns: 4,
    elements: 0,
    rowMajor: false,
  };
}

function pass(tint: [number, number, number, number]): ResolvedPass {
  return {
    shader: "Shaders/SkinnedMesh/Diffuse",
    defines: [],
    runtimeSwitches: [],
    textures: [],
    params: [{ name: "Tint", value: tint, source: "material" }],
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
  };
}

/** A stage whose `$Globals` holds `Tint` at a different offset in each stage. */
function stage(id: number, glslName: string, offset: number) {
  const block: UniformBlock = {
    name: "$Globals",
    glslName,
    size: 32,
    members: [member("Tint", offset)],
  };
  return {
    id,
    cached: false,
    glsl: [
      `layout(std140) uniform ${glslName}`,
      "{",
      "    vec4 m[2];",
      "} G;",
      "void main() {}",
    ].join("\n"),
    sidecar: { blocks: [block], textures: [], attributes: [] },
  };
}

function program(
  tint: [number, number, number, number],
  material = MATERIAL,
  index = 0,
): SubmeshProgram {
  return {
    material,
    index,
    pass: pass(tint),
    program: {
      kind: "ready",
      defines: [],
      vertex: stage(3, "Globals_vs", 0),
      pixel: stage(7, "Globals_ps", 16),
    },
    textures: new Map(),
  };
}

function globals(material: { uniforms: Record<string, { value: unknown }> }, name: string) {
  return [...(material.uniforms[name]?.value as Float32Array)];
}

const HELD: HeldValue = { material: MATERIAL, physical: "Tint", fields: 0b0111, value: [9, 8, 7] };

describe("scatter", () => {
  /* The same cases `a_logical_value_scatters_through_its_mask_and_an_absent_value_writes_zeros`
     runs against `scatter` in crates/ltk-manager-core/src/material/pass.rs. */
  it("writes the input's components into the ones the mask selects, as the Rust scatter does", () => {
    const speed = scatter([9, 9, 9, 9], 0b0011, [1, 2, 3, 4]);

    expect(speed).toEqual([1, 2, 9, 9]);
    expect(scatter(speed, 0b1000, [5, 0, 0, 0])).toEqual([1, 2, 9, 5]);
  });

  it("covers the whole-vector masks", () => {
    expect(scatter([0, 0, 0, 0], 1, [4])).toEqual([4, 0, 0, 0]);
    expect(scatter([0, 0, 0, 0], 3, [4, 5])).toEqual([4, 5, 0, 0]);
    expect(scatter([0, 0, 0, 0], 7, [4, 5, 6])).toEqual([4, 5, 6, 0]);
    expect(scatter([0, 0, 0, 0], 15, [4, 5, 6, 7])).toEqual([4, 5, 6, 7]);
  });

  it("places a mask at a non-zero offset from the input's first component", () => {
    expect(scatter([1, 1, 1, 1], 0b0110, [8, 9])).toEqual([1, 8, 9, 1]);
  });
});

describe("withHeld", () => {
  it("scatters a held value into its physical parameter", () => {
    const held = withHeld(pass([1, 1, 1, 1]), MATERIAL, HELD);

    expect(held.params[0]?.value).toEqual([9, 8, 7, 1]);
  });

  it("leaves a pass of another material alone", () => {
    const own = pass([1, 1, 1, 1]);

    expect(withHeld(own, "0x0badf00d", HELD)).toBe(own);
  });
});

describe("ProgramMaterials", () => {
  it("keys a material by the material, the pass and both stages' permutations", () => {
    expect(programKey(program([1, 1, 1, 1]))).toBe(`${MATERIAL}|0|Shaders/SkinnedMesh/Diffuse|3|7`);
  });

  it("keeps two passes of one material and permutation apart", () => {
    const materials = new ProgramMaterials(new EngineEnvironment());

    const first = materials.acquire(program([1, 1, 1, 1], MATERIAL, 0));
    const second = materials.acquire(program([2, 2, 2, 2], MATERIAL, 1));

    expect(second).not.toBe(first);
    expect(globals(first, "Globals_ps").slice(4)).toEqual([1, 1, 1, 1]);
    expect(globals(second, "Globals_ps").slice(4)).toEqual([2, 2, 2, 2]);
  });

  it("refreshes a committed value in place rather than building the material again", () => {
    const materials = new ProgramMaterials(new EngineEnvironment());
    const first = materials.acquire(program([1, 1, 1, 1]));

    const again = materials.acquire(program([2, 3, 4, 5]));

    expect(again).toBe(first);
    expect(globals(first, "Globals_ps").slice(4)).toEqual([2, 3, 4, 5]);
  });

  it("draws a held value in every stage that declares it, and the read's value once let go", () => {
    const materials = new ProgramMaterials(new EngineEnvironment());
    const material = materials.acquire(program([1, 1, 1, 1]));

    materials.hold(HELD);
    expect(globals(material, "Globals_vs").slice(0, 4)).toEqual([9, 8, 7, 1]);
    expect(globals(material, "Globals_ps").slice(4)).toEqual([9, 8, 7, 1]);

    materials.hold(null);
    expect(globals(material, "Globals_ps").slice(4)).toEqual([1, 1, 1, 1]);
  });

  it("keeps two materials of one permutation apart", () => {
    const materials = new ProgramMaterials(new EngineEnvironment());

    const own = materials.acquire(program([1, 1, 1, 1]));
    const other = materials.acquire(program([1, 1, 1, 1], "0x0badf00d"));
    materials.hold(HELD);

    expect(other).not.toBe(own);
    expect(globals(other, "Globals_ps").slice(4)).toEqual([1, 1, 1, 1]);
  });
});
