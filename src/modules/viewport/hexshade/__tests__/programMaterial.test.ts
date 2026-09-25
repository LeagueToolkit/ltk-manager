import {
  BackSide,
  CustomBlending,
  DoubleSide,
  FrontSide,
  GreaterDepth,
  LessEqualDepth,
  NoBlending,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  RawShaderMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import type { PassState, ResolvedPass, UniformBlock } from "@/lib/tauri";

import { EngineEnvironment } from "../engineEnvironment";
import {
  applyPassState,
  blocksAsUniforms,
  createProgramMaterial,
  globalsData,
  sideOf,
  withoutVersion,
} from "../programMaterial";

const OPAQUE: PassState = {
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
};

function pass(over: Partial<ResolvedPass> = {}): ResolvedPass {
  return {
    shader: "Shaders/SkinnedMesh/Diffuse_Bloom",
    defines: [],
    runtimeSwitches: [],
    textures: [],
    params: [],
    state: OPAQUE,
    schema: null,
    ...over,
  };
}

function member(name: string, offset: number, size: number): UniformBlock["members"][number] {
  return {
    name,
    offset,
    size,
    used: true,
    scalar: "float",
    rows: 1,
    columns: size / 4,
    elements: 0,
    rowMajor: false,
  };
}

describe("globalsData", () => {
  it("writes each parameter at its member's offset and a switch as one float", () => {
    const block: UniformBlock = {
      name: "$Globals",
      glslName: "Globals_ps",
      size: 48,
      members: [
        member("TintColor", 0, 16),
        member("Bloom_Intensity", 16, 4),
        member("switch_GLOW", 20, 4),
        member("Unset", 32, 12),
      ],
    };
    const data = globalsData(
      block,
      pass({
        params: [
          { name: "TintColor", value: [1, 0.5, 0.25, 1], source: "material" },
          { name: "Bloom_Intensity", value: [2, 9, 9, 9], source: "material" },
        ],
        runtimeSwitches: [{ name: "GLOW", on: true }],
      }),
    );

    expect([...data]).toEqual([1, 0.5, 0.25, 1, 2, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("reads a component the wire wrote as null as zero", () => {
    const block: UniformBlock = {
      name: "$Globals",
      glslName: "Globals_ps",
      size: 16,
      members: [member("Tint", 0, 12)],
    };
    const data = globalsData(
      block,
      pass({ params: [{ name: "Tint", value: [1, null, 3, 4], source: "material" }] }),
    );

    expect([...data]).toEqual([1, 0, 3, 0]);
  });
});

describe("applyPassState", () => {
  it("draws an opaque pass with no blend and the rule-1 defaults", () => {
    const material = new RawShaderMaterial();

    applyPassState(material, OPAQUE);

    expect(material.blending).toBe(NoBlending);
    expect(material.transparent).toBe(false);
    expect(material.side).toBe(FrontSide);
    expect(material.depthFunc).toBe(LessEqualDepth);
    expect(material.depthWrite).toBe(true);
    expect(material.colorWrite).toBe(true);
  });

  it("draws a blended pass through its own factors without writing depth", () => {
    const material = new RawShaderMaterial();

    applyPassState(material, {
      ...OPAQUE,
      blendEnable: true,
      srcColor: "srcAlpha",
      dstColor: "oneMinusSrcAlpha",
      srcAlpha: "one",
      dstAlpha: "oneMinusSrcAlpha",
      cullEnable: false,
      depthCompareFunc: 4,
      writeMask: 15,
    });

    expect(material.blending).toBe(CustomBlending);
    expect(material.transparent).toBe(true);
    expect(material.blendSrc).toBe(SrcAlphaFactor);
    expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect(material.side).toBe(DoubleSide);
    expect(material.depthFunc).toBe(GreaterDepth);
    expect(material.depthWrite).toBe(false);
  });
});

describe("sideOf", () => {
  it("keeps the back face for a pass culling the clockwise winding", () => {
    expect(sideOf({ ...OPAQUE, windingToCull: "cw" })).toBe(BackSide);
  });
});

describe("blocksAsUniforms", () => {
  const source = [
    "layout(std140) uniform Globals_ps",
    "{",
    "    vec4 m[3];",
    "} Globals_i;",
    "",
    "layout(std140) uniform PerFramePixelCB_ps",
    "{",
    "    uvec4 m[30];",
    "} PerFramePixelCB_i;",
    "",
    "void main() { float a = Globals_i.m[0u].x + PerFramePixelCB_i.m[1u].y; }",
  ].join("\n");

  it("declares a named block as an array uniform of its name and reads through it", () => {
    expect(blocksAsUniforms(source, new Set(["Globals_ps"]))).toEqual({
      source: [
        "uniform vec4 Globals_ps[3];",
        "",
        "layout(std140) uniform PerFramePixelCB_ps",
        "{",
        "    uvec4 m[30];",
        "} PerFramePixelCB_i;",
        "",
        "void main() { float a = Globals_ps[0u].x + PerFramePixelCB_i.m[1u].y; }",
      ].join("\n"),
      blocks: new Map([["Globals_ps", { element: "vec4", extent: 3 }]]),
    });
  });

  it("inlines every named block with the block's element type", () => {
    const inlined = blocksAsUniforms(source, new Set(["Globals_ps", "PerFramePixelCB_ps"]));

    expect(inlined.source).toContain("uniform uvec4 PerFramePixelCB_ps[30];");
    expect(inlined.source).toContain("Globals_ps[0u].x + PerFramePixelCB_ps[1u].y");
    expect(inlined.blocks.get("PerFramePixelCB_ps")).toEqual({ element: "uvec4", extent: 30 });
  });

  it("reads through an instance whose name ends another's without touching the longer one", () => {
    const nested = [
      "layout(std140) uniform CB_ps",
      "{",
      "    vec4 m[1];",
      "} CB_i;",
      "layout(std140) uniform DrawCB_ps",
      "{",
      "    vec4 m[1];",
      "} DrawCB_i;",
      "void main() { float a = CB_i.m[0u].x + DrawCB_i.m[0u].x; }",
    ].join("\n");

    expect(blocksAsUniforms(nested, new Set(["CB_ps"])).source).toContain(
      "CB_ps[0u].x + DrawCB_i.m[0u].x",
    );
  });

  it("leaves a stage without the block alone", () => {
    expect(blocksAsUniforms("void main() {}", new Set(["Globals_ps"]))).toEqual({
      source: "void main() {}",
      blocks: new Map(),
    });
  });
});

describe("withoutVersion", () => {
  it("drops the version line and nothing else", () => {
    expect(withoutVersion("#version 300 es\nprecision highp float;\n")).toBe(
      "precision highp float;\n",
    );
    expect(withoutVersion("void main() {}\n")).toBe("void main() {}\n");
  });
});

/** A translated stage declaring `blocks` as std140 `vec4` arrays, with `body` as its main. */
function stageOf(blocks: readonly UniformBlock[], declarations: string, body: string) {
  const glsl = [
    "#version 300 es",
    ...blocks.map(
      (block) =>
        `layout(std140) uniform ${block.glslName}\n{\n    vec4 m[${block.size / 16}];\n} ${block.glslName}_i;`,
    ),
    declarations,
    `void main()\n{\n${body}\n}`,
  ].join("\n");
  return {
    id: 1,
    glsl,
    cached: false,
    sidecar: { blocks: [...blocks], textures: [], attributes: [] },
  };
}

function programOf(vertex: ReturnType<typeof stageOf>, pixel: ReturnType<typeof stageOf>) {
  return {
    material: "0x1",
    index: 0,
    pass: pass(),
    program: { kind: "ready" as const, defines: [], vertex, pixel },
    textures: new Map(),
  };
}

describe("createProgramMaterial with a prelude's members", () => {
  const vertexGlobals: UniformBlock = {
    name: "$Globals",
    glslName: "Globals_vs",
    size: 32,
    members: [member("PARTICLE_DEPTH_PUSH_PULL", 0, 4), member("kColorFactor", 16, 16)],
  };
  const pixelGlobals: UniformBlock = {
    name: "$Globals",
    glslName: "Globals_ps",
    size: 32,
    members: [
      member("AlphaTestReferenceValue", 0, 4),
      member("COLOR_LOOKUP_UV", 4, 8),
      member("cAlphaErosionParams", 16, 16),
    ],
  };
  const vertex = stageOf(
    [vertexGlobals],
    "layout(location = 0) in vec3 a_POSITION;",
    "    gl_Position = vec4(a_POSITION, 1.0) * Globals_i.m[1u] * Globals_i.m[0u].x;",
  );
  const pixel = stageOf(
    [pixelGlobals],
    "layout(location = 0) out vec4 SV_Target;",
    "    SV_Target = Globals_i.m[1u] + Globals_i.m[0u];",
  );
  const prelude = {
    source: "void enginePrelude() {}",
    inputs: ["a_POSITION"],
    members: { kColorFactor: 1, COLOR_LOOKUP_UV: 1, cAlphaErosionParams: 1, mWorld: 4 },
  };
  const made = () =>
    createProgramMaterial(programOf(vertex, pixel), new EngineEnvironment("uniform"), prelude);

  it("writes a member over the vertex stage's copy of its block", () => {
    const material = made();

    expect(material.vertexShader).toContain("if (at == 1) value = engine_kColorFactor[0];");
    expect(material.vertexShader).not.toContain("if (at == 0)");
    expect(material.vertexShader).not.toContain("= engine_mWorld[0];");
  });

  it("hands each member the pixel stage declares through a flat varying", () => {
    const material = made();

    expect(material.vertexShader).toContain("flat out vec4 hexshade_COLOR_LOOKUP_UV_0;");
    expect(material.vertexShader).toContain("flat out vec4 hexshade_cAlphaErosionParams_0;");
    expect(material.fragmentShader).toContain(
      "if (at == 0) value.yz = hexshade_COLOR_LOOKUP_UV_0.xy;",
    );
    expect(material.fragmentShader).toContain(
      "if (at == 1) value = hexshade_cAlphaErosionParams_0;",
    );
  });
});

describe("createProgramMaterial with the back buffer copy", () => {
  it("samples the copy the way up the engine reads it", () => {
    const vertex = stageOf([], "", "    gl_Position = vec4(0.0);");
    const pixel = stageOf(
      [],
      [
        "uniform highp sampler2D SAMPLER_BACK_BUFFER_COPY_SharedTexture;",
        "layout(location = 0) out vec4 SV_Target;",
      ].join("\n"),
      "    SV_Target = texture(SAMPLER_BACK_BUFFER_COPY_SharedTexture, vec2(0.25, 0.75)).xyzx;",
    );

    const material = createProgramMaterial(
      programOf(vertex, pixel),
      new EngineEnvironment("uniform"),
    );

    expect(material.fragmentShader).toContain(
      "SV_Target = hexshade_screenCopy(vec2(0.25, 0.75)).xyzx;",
    );
    expect(material.fragmentShader).toContain(
      "texture(SAMPLER_BACK_BUFFER_COPY_SharedTexture, vec2(at.x, 1.0 - at.y))",
    );
  });

  it("turns a read at a level of detail over too", () => {
    const vertex = stageOf([], "", "    gl_Position = vec4(0.0);");
    const pixel = stageOf(
      [],
      [
        "uniform highp sampler2D SAMPLER_BACK_BUFFER_COPY_SharedTexture;",
        "layout(location = 0) out vec4 SV_Target;",
      ].join("\n"),
      "    SV_Target = textureLod(SAMPLER_BACK_BUFFER_COPY_SharedTexture, vec2(0.25, 0.75), 0.0);",
    );

    const material = createProgramMaterial(
      programOf(vertex, pixel),
      new EngineEnvironment("uniform"),
    );

    expect(material.fragmentShader).toContain(
      "SV_Target = hexshade_screenCopyLod(vec2(0.25, 0.75), 0.0);",
    );
    expect(material.fragmentShader).toContain(
      "textureLod(SAMPLER_BACK_BUFFER_COPY_SharedTexture, vec2(at.x, 1.0 - at.y), lod)",
    );
  });
});
