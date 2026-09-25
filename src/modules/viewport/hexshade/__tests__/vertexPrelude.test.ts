import { describe, expect, it } from "vitest";

import { splicePixelProgram, spliceVertexProgram, type VertexPrelude } from "../vertexPrelude";

/** A translated stage with the declarations of `quad_vs` and a body that reads them. */
const STAGE = `#version 300 es

invariant gl_Position;

layout(location = 0) in vec3 a_POSITION;
layout(location = 1) in vec4 a_COLOR;
layout(location = 2) in vec3 a_TEXCOORD;
layout(location = 3) in vec2 a_TEXCOORD1;
out vec4 v_TEXCOORD;

void main()
{
    gl_Position = vec4(a_POSITION, 1.0);
    v_TEXCOORD = a_COLOR + vec4(a_TEXCOORD, a_TEXCOORD1.x);
}
`;

const PRELUDE: VertexPrelude = {
  source: `in vec3 center;

void enginePrelude()
{
    engine_POSITION = vec4(center, 1.0);
    engine_TEXCOORD = vec4(1.0, 2.0, 3.0, 4.0);
    engine_NORMAL = vec4(0.0, 1.0, 0.0, 0.0);
}
`,
  inputs: ["a_POSITION", "a_TEXCOORD", "a_NORMAL"],
};

describe("spliceVertexProgram", () => {
  it("turns each engine input into a global the prelude writes in its declared type", () => {
    const spliced = spliceVertexProgram(STAGE, PRELUDE);

    expect(spliced).not.toMatch(/\bin vec3 a_POSITION;/);
    expect(spliced).toContain("vec3 a_POSITION = vec3(vec4(0.0, 0.0, 0.0, 0.0));");
    expect(spliced).toContain("a_POSITION = vec3(engine_POSITION);");
    expect(spliced).toContain("a_TEXCOORD = vec3(engine_TEXCOORD);");
    expect(spliced).toContain("vec4 engine_POSITION;");
  });

  it("runs the translated main after the prelude, under another name", () => {
    const spliced = spliceVertexProgram(STAGE, PRELUDE);
    const main = spliced.slice(spliced.lastIndexOf("void main()"));

    expect(spliced).toContain("void hexshade_main()");
    expect(spliced.match(/void main\(\)/g)).toHaveLength(1);
    expect(main.indexOf("enginePrelude();")).toBeLessThan(main.indexOf("a_POSITION ="));
    expect(main.indexOf("a_POSITION =")).toBeLessThan(main.indexOf("hexshade_main();"));
  });

  it("gives an input the prelude leaves alone what an absent stream reads", () => {
    const spliced = spliceVertexProgram(STAGE, PRELUDE);

    expect(spliced).toContain("vec4 a_COLOR = vec4(vec4(1.0, 1.0, 1.0, 1.0));");
    expect(spliced).toContain("vec2 a_TEXCOORD1 = vec2(vec4(0.0, 0.0, 0.0, 0.0));");
    expect(spliced).not.toContain("a_COLOR = vec4(engine_");
  });

  it("writes no input the stage does not declare", () => {
    const spliced = spliceVertexProgram(STAGE, PRELUDE);

    expect(spliced).not.toContain("a_NORMAL");
  });

  it("declares the prelude's inputs as the attributes the geometry feeds", () => {
    const spliced = spliceVertexProgram(STAGE, PRELUDE);

    expect(spliced).toContain("in vec3 center;");
    expect(spliced.indexOf("#version 300 es")).toBe(0);
  });
});

/** A translated stage reading an inlined `$Globals` of three registers. */
const GLOBALS_STAGE = `#version 300 es

uniform vec4 Globals_vs[3];
uniform uvec4 Frame_vs[2];

layout(location = 0) in vec3 a_POSITION;
out vec4 v_TEXCOORD;

void main()
{
    gl_Position = vec4(a_POSITION, 1.0) * Globals_vs[0u].x;
    v_TEXCOORD = Globals_vs[2u] + uintBitsToFloat(Frame_vs[1u]);
}
`;

const MEMBERS_PRELUDE: VertexPrelude = {
  ...PRELUDE,
  members: { kColorFactor: 1, uvRows: 2, lookup: 1, drive: 1 },
};

describe("spliceVertexProgram with members", () => {
  it("reads the stage's block through a copy the prelude's member overwrites", () => {
    const spliced = spliceVertexProgram(GLOBALS_STAGE, MEMBERS_PRELUDE, {
      vertex: [{ member: "kColorFactor", array: "Globals_vs", offset: 32, size: 16 }],
      pixel: [],
    });
    const main = spliced.slice(spliced.lastIndexOf("void main()"));

    expect(spliced).toContain("uniform vec4 Globals_vs[3];");
    expect(spliced).toContain("vec4 hexshade_Globals_vs[3];");
    expect(spliced).toContain("hexshade_Globals_vs[0u].x");
    expect(spliced).toContain("v_TEXCOORD = hexshade_Globals_vs[2u]");
    expect(spliced).toContain("vec4 engine_kColorFactor[1];");
    expect(main).toContain("hexshade_Globals_vs = Globals_vs;");
    expect(main).toContain("hexshade_Globals_vs[2] = engine_kColorFactor[0];");
    expect(main.indexOf("enginePrelude();")).toBeLessThan(main.indexOf("hexshade_Globals_vs[2]"));
  });

  it("writes a member narrower than a register into its components alone", () => {
    const spliced = spliceVertexProgram(GLOBALS_STAGE, MEMBERS_PRELUDE, {
      vertex: [{ member: "lookup", array: "Globals_vs", offset: 4, size: 8 }],
      pixel: [],
    });

    expect(spliced).toContain("hexshade_Globals_vs[0].yz = engine_lookup[0].xy;");
  });

  it("writes each register of a wider member, and none past what the stage declares", () => {
    const spliced = spliceVertexProgram(GLOBALS_STAGE, MEMBERS_PRELUDE, {
      vertex: [{ member: "uvRows", array: "Globals_vs", offset: 32, size: 48 }],
      pixel: [],
    });

    expect(spliced).toContain("hexshade_Globals_vs[2] = engine_uvRows[0];");
    expect(spliced).not.toContain("hexshade_Globals_vs[3] =");
  });

  it("keeps an integer-declared block's bits", () => {
    const spliced = spliceVertexProgram(GLOBALS_STAGE, MEMBERS_PRELUDE, {
      vertex: [{ member: "drive", array: "Frame_vs", offset: 16, size: 16 }],
      pixel: [],
    });

    expect(spliced).toContain("uvec4 hexshade_Frame_vs[2];");
    expect(spliced).toContain("hexshade_Frame_vs[1] = floatBitsToUint(engine_drive[0]);");
  });

  it("hands a member the pixel stage reads to it through a flat output", () => {
    const spliced = spliceVertexProgram(GLOBALS_STAGE, MEMBERS_PRELUDE, {
      vertex: [],
      pixel: [{ member: "drive", array: "Globals_ps", offset: 64, size: 16 }],
    });
    const main = spliced.slice(spliced.lastIndexOf("void main()"));

    expect(spliced).toContain("flat out vec4 hexshade_drive_0;");
    expect(main).toContain("hexshade_drive_0 = engine_drive[0];");
    expect(spliced).not.toContain("hexshade_Globals_vs");
  });
});

const PIXEL_STAGE = `#version 300 es
precision highp float;
precision highp int;

uniform vec4 Globals_ps[6];

layout(location = 0) out vec4 SV_Target;

void main()
{
    SV_Target = Globals_ps[4u] * Globals_ps[5u].x;
}
`;

describe("splicePixelProgram", () => {
  it("reads each member the vertex stage hands over from its flat input", () => {
    const spliced = splicePixelProgram(PIXEL_STAGE, [
      { member: "drive", array: "Globals_ps", offset: 64, size: 16 },
      { member: "lookup", array: "Globals_ps", offset: 84, size: 8 },
    ]);
    const main = spliced.slice(spliced.lastIndexOf("void main()"));

    expect(spliced).toContain("flat in vec4 hexshade_drive_0;");
    expect(spliced).toContain("flat in vec4 hexshade_lookup_0;");
    expect(spliced).toContain("SV_Target = hexshade_Globals_ps[4u] * hexshade_Globals_ps[5u].x;");
    expect(main).toContain("hexshade_Globals_ps = Globals_ps;");
    expect(main).toContain("hexshade_Globals_ps[4] = hexshade_drive_0;");
    expect(main).toContain("hexshade_Globals_ps[5].yz = hexshade_lookup_0.xy;");
    expect(main.indexOf("hexshade_Globals_ps[5]")).toBeLessThan(main.indexOf("hexshade_main();"));
  });

  it("leaves a stage no member reaches as it is", () => {
    expect(splicePixelProgram(PIXEL_STAGE, [])).toBe(PIXEL_STAGE);
  });
});
