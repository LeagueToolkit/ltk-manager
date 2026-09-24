import {
  AlwaysDepth,
  BackSide,
  ClampToEdgeWrapping,
  CubeTexture,
  CustomBlending,
  Data3DTexture,
  DataArrayTexture,
  DataTexture,
  type DepthModes,
  DoubleSide,
  DstColorFactor,
  EqualDepth,
  FrontSide,
  GLSL3,
  GreaterDepth,
  GreaterEqualDepth,
  type IUniform,
  LessDepth,
  type Material,
  type MinificationTextureFilter,
  LessEqualDepth,
  LinearFilter,
  LinearMipmapLinearFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapNearestFilter,
  NeverDepth,
  NoBlending,
  NotEqualDepth,
  OneFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  RawShaderMaterial,
  RedIntegerFormat,
  RepeatWrapping,
  type Side,
  SrcAlphaFactor,
  SrcColorFactor,
  type Texture,
  UnsignedIntType,
  type Wrapping,
  ZeroFactor,
} from "three";

import type {
  BlendFactor,
  PassState,
  PassTexture,
  ProgramRead,
  ResolvedPass,
  Sidecar,
  StageProgram,
  TextureDimension,
  UniformBlock,
  Wrap,
} from "@/lib/tauri";

import type { EngineEnvironment } from "./engineEnvironment";

/** A pass whose two stages translated. */
export type ReadyProgram = Extract<ProgramRead, { kind: "ready" }>;

/** What one submesh draws with under the game's own shader. */
export interface SubmeshProgram<T = Texture> {
  /** The material's path hash, which a value held in its inspector is addressed by. */
  readonly material: string;
  readonly pass: ResolvedPass;
  readonly program: ReadyProgram;
  /** The textures the pass names that this machine holds, by the shader texture's name. */
  readonly textures: ReadonlyMap<string, T>;
}

/** The suffix every material texture carries in the bytecode. */
const MATERIAL_TEXTURE = "__TX";

/** The suffix an engine-filled texture carries, which the environment binds neutral. */
const SHARED_TEXTURE = "_SharedTexture";

/** The block the material's own parameters and switches are packed into. */
const GLOBALS = "$Globals";

/** What a vertex input reads where the geometry carries no stream for it. */
const ABSENT_ATTRIBUTES: Record<string, number[]> = {
  a_COLOR: [1, 1, 1, 1],
  a_TEXCOORD5: [0, 0],
  a_TEXCOORD6: [0, 0, 0, 0],
  a_TEXCOORD7: [0, 0],
};

/** The prefix a runtime switch's `$Globals` member carries. */
const SWITCH = "switch_";

/**
 * The `$Globals` members the engine fills rather than the material, section 3.2. A map's
 * vertices are stored in the world, so its world matrix is the identity.
 */
const IDENTITY_MEMBERS: ReadonlySet<string> = new Set(["WORLD_MATRIX", "WORLD_MATRIX_INV"]);

/** What a shared sampler's name says of it: `Clamp_No_Mip`, `Wrap_No_Mip`, `CharacterWrap`. */
const SHARED_CLAMP = "Clamp";
const SHARED_WRAP = "Wrap";
const SHARED_NO_MIP = "No_Mip";

const FLOAT_BYTES = 4;
const VEC4_FLOATS = 4;

/** The `writeMask` bit that writes depth, and the four that write colour. */
const WRITE_DEPTH = 16;
const WRITE_COLOR = 15;

const BLEND_FACTORS = {
  zero: ZeroFactor,
  one: OneFactor,
  srcColor: SrcColorFactor,
  oneMinusSrcColor: OneMinusSrcColorFactor,
  dstColor: DstColorFactor,
  oneMinusDstColor: OneMinusDstColorFactor,
  srcAlpha: SrcAlphaFactor,
  oneMinusSrcAlpha: OneMinusSrcAlphaFactor,
} as const satisfies Record<BlendFactor, number>;

/**
 * `depthCompareFunc` as three's depth modes, the D3D comparison enum less one, which is
 * what the class default of 3 being less-or-equal says. Inferred from that one value.
 */
const DEPTH_MODES: readonly DepthModes[] = [
  NeverDepth,
  LessDepth,
  EqualDepth,
  LessEqualDepth,
  GreaterDepth,
  NotEqualDepth,
  GreaterEqualDepth,
  AlwaysDepth,
];

/** Three has no border wrap, and a clamp is the nearest edge a border sits on. */
const WRAPPING: Record<Wrap, Wrapping> = {
  repeat: RepeatWrapping,
  clamp: ClampToEdgeWrapping,
  mirror: MirroredRepeatWrapping,
  border: ClampToEdgeWrapping,
};

/**
 * `program` as a material three draws, bound to `environment`'s buffers.
 *
 * The GLSL carries a `#version` line, and three writes that line itself. Every engine
 * block of either stage reads the environment's bytes through its `BufferBinding`. The
 * material's `$Globals` is a plain `vec4` array uniform under either binding, packed
 * from its parameters and runtime switches at the sidecar's offsets. Each combined
 * sampler is bound to the texture of its name. A texture this machine does not have is
 * a neutral grey, and an engine shared texture is transparent black, which the remap
 * ramp leaves unchanged.
 */
export function createProgramMaterial(
  program: SubmeshProgram,
  environment: EngineEnvironment,
): RawShaderMaterial {
  const { pass, program: ready } = program;
  const vertex = inlinedStage(ready.vertex, environment);
  const pixel = inlinedStage(ready.pixel, environment);
  const material = new RawShaderMaterial({
    name: pass.shader ?? "",
    glslVersion: GLSL3,
    vertexShader: withoutVersion(vertex.source),
    fragmentShader: withoutVersion(pixel.source),
  });
  /* GL feeds an input the geometry lacks as (0, 0, 0, 1), which draws a shader reading a
     vertex colour black. A white colour and a zero coordinate are what an absent stream
     means. */
  material.defaultAttributeValues = { ...material.defaultAttributeValues, ...ABSENT_ATTRIBUTES };

  const members = new Map<string, GlobalsMember[]>();
  const samplers = new Map<string, string[]>();
  const uniforms: Record<string, IUniform> = material.uniforms;
  const stages: readonly (readonly [Sidecar, ReadonlyMap<string, InlinedBlock>])[] = [
    [ready.vertex.sidecar, vertex.blocks],
    [ready.pixel.sidecar, pixel.blocks],
  ];
  material.uniformsGroups = stages.flatMap(([sidecar, inlined]) => {
    for (const binding of sidecar.textures) {
      const held = samplers.get(binding.name) ?? [];
      held.push(...binding.samplers.map((sampler) => sampler.glslName));
      samplers.set(binding.name, held);
    }
    return sidecar.blocks.flatMap((block) => {
      const declared = inlined.get(block.glslName);
      if (block.name !== GLOBALS) {
        if (environment.binding === "group") return [environment.group(block)];
        if (declared !== undefined) {
          uniforms[block.glslName] = { value: environment.array(block, declared) };
        }
        return [];
      }

      /* The length the stage declares, without the unused tail the translation cuts.
         GL takes exactly the array's length. */
      const data = new Float32Array((declared?.extent ?? 0) * VEC4_FLOATS);
      data.set(globalsData(block, pass).subarray(0, data.length));
      uniforms[block.glslName] = { value: data };
      for (const member of block.members) {
        const held = members.get(member.name) ?? [];
        held.push({ block: block.glslName, offset: member.offset / FLOAT_BYTES });
        members.set(member.name, held);
      }
      return [];
    });
  });
  GLOBALS_OF.set(material, { members, samplers });
  bindProgramTextures(material, program);
  applyPassState(material, pass.state);
  return material;
}

/** Where a draw can write over what a program material packed into `$Globals`. */
export interface ProgramGlobals {
  /** Where each member sits in each stage's block that declares it, by the engine's name. */
  readonly members: ReadonlyMap<string, readonly GlobalsMember[]>;
  /** The combined samplers of each texture, by the bytecode's texture name. */
  readonly samplers: ReadonlyMap<string, readonly string[]>;
}

/** Where one `$Globals` member sits: the uniform holding its stage's block, and floats in. */
export interface GlobalsMember {
  readonly block: string;
  readonly offset: number;
}

const GLOBALS_OF = new WeakMap<Material, ProgramGlobals>();

/** What `material` packed into `$Globals`, and none for a stock material. */
export function programGlobals(material: Material): ProgramGlobals | undefined {
  return GLOBALS_OF.get(material);
}

/**
 * Every sampler of `material` bound to the texture `program` holds for it, which lands
 * a texture that arrived after the material was made.
 */
export function bindProgramTextures(material: RawShaderMaterial, program: SubmeshProgram): void {
  const uniforms: Record<string, IUniform> = material.uniforms;
  for (const sidecar of [program.program.vertex.sidecar, program.program.pixel.sidecar]) {
    for (const binding of sidecar.textures) {
      const texture = textureFor(binding.name, binding.dimension, program);
      for (const sampler of binding.samplers) {
        const held = uniforms[sampler.glslName];
        if (held === undefined) uniforms[sampler.glslName] = { value: texture };
        else held.value = texture;
      }
    }
  }
}

/**
 * The texture the bytecode's `name` samples, per section 2.4's suffix rules.
 *
 * A sampler of another shape than the loaded picture, an array or a cube, takes the
 * neutral of its own shape, since a sampler bound to a texture of another target draws
 * nothing at all.
 */
function textureFor(
  name: string,
  dimension: TextureDimension,
  { pass, textures }: SubmeshProgram,
): Texture {
  if (name.endsWith(SHARED_TEXTURE)) return neutral(dimension, BLACK);
  const own = name.endsWith(MATERIAL_TEXTURE) ? name.slice(0, -MATERIAL_TEXTURE.length) : name;
  const texture = textures.get(own);
  if (texture === undefined || dimension !== "texture2d") return neutral(dimension, GREY);
  const declared = pass.textures.find((each) => each.name === own);
  if (declared !== undefined) applySampler(texture, declared);
  return texture;
}

/**
 * `texture` sampled as the pass says.
 *
 * A shared sampler is known by its name alone, `Clamp` and `Wrap` saying the address
 * and `No_Mip` the filter. A texture two passes sample differently takes the last
 * pass's state, which no shipped material has been seen to do.
 */
function applySampler(texture: Texture, declared: PassTexture): void {
  const { sampler } = declared;
  let wrapS = WRAPPING[sampler.wrap[0]];
  let wrapT = WRAPPING[sampler.wrap[1]];
  let minFilter: MinificationTextureFilter = sampler.filterMin
    ? LinearMipmapLinearFilter
    : NearestMipmapNearestFilter;
  const magFilter = sampler.filterMag ? LinearFilter : NearestFilter;
  if (sampler.shared !== null) {
    if (sampler.shared.includes(SHARED_CLAMP)) wrapS = wrapT = ClampToEdgeWrapping;
    else if (sampler.shared.includes(SHARED_WRAP)) wrapS = wrapT = RepeatWrapping;
    if (sampler.shared.includes(SHARED_NO_MIP)) minFilter = LinearFilter;
  }
  if (
    texture.wrapS === wrapS &&
    texture.wrapT === wrapT &&
    texture.minFilter === minFilter &&
    texture.magFilter === magFilter
  ) {
    return;
  }
  texture.wrapS = wrapS;
  texture.wrapT = wrapT;
  texture.minFilter = minFilter;
  texture.magFilter = magFilter;
  /* Sampler state is set at upload, so a change of it uploads again. */
  texture.needsUpdate = true;
}

/**
 * The bytes of `block` with every parameter and runtime switch of `pass` at its member's
 * offset, and zero for a member the pass does not name.
 */
export function globalsData(block: UniformBlock, pass: ResolvedPass): Float32Array {
  const data = new Float32Array(block.size / FLOAT_BYTES);
  const values = new Map(pass.params.map((param) => [param.name, param.value]));
  for (const member of block.members) {
    if (IDENTITY_MEMBERS.has(member.name)) {
      writeIdentityRows(data, member.offset / FLOAT_BYTES, member.size / FLOAT_BYTES);
      continue;
    }
    const value = values.get(member.name) ?? switchValue(member.name, pass);
    if (value === undefined) continue;
    const floats = Math.min(value.length, member.size / FLOAT_BYTES);
    for (let at = 0; at < floats; at += 1) {
      data[member.offset / FLOAT_BYTES + at] = value[at] ?? 0;
    }
  }
  return data;
}

/**
 * `material`'s `$Globals` packed again from `pass`, which lands a committed or a held value
 * without building the material again. The environment writes its own members over this
 * before the next draw.
 */
export function writeProgramGlobals(
  material: RawShaderMaterial,
  program: SubmeshProgram,
  pass: ResolvedPass,
): void {
  const uniforms: Record<string, IUniform> = material.uniforms;
  for (const stage of [program.program.vertex, program.program.pixel]) {
    for (const block of stage.sidecar.blocks) {
      if (block.name !== GLOBALS) continue;
      const data = uniforms[block.glslName]?.value;
      if (!(data instanceof Float32Array)) continue;
      data.set(globalsData(block, pass).subarray(0, data.length));
    }
  }
  material.uniformsNeedUpdate = true;
}

/** The rows of the identity a `float4x4` or `float4x3` member holds, `floats` of them. */
function writeIdentityRows(data: Float32Array, at: number, floats: number): void {
  for (let row = 0; row < Math.min(4, floats / 4); row += 1) {
    data[at + row * 4 + row] = 1;
  }
}

function switchValue(member: string, pass: ResolvedPass): readonly number[] | undefined {
  if (!member.startsWith(SWITCH)) return undefined;
  const name = member.slice(SWITCH.length);
  const found = pass.runtimeSwitches.find((each) => each.name === name);
  if (found === undefined) return undefined;
  return [found.on ? 1 : 0, 0, 0, 0];
}

/** `material` set to draw the way `state` says the pass does, with the rule-1 defaults. */
export function applyPassState(material: RawShaderMaterial, state: PassState): void {
  material.transparent = state.blendEnable;
  material.blending = state.blendEnable ? CustomBlending : NoBlending;
  material.blendSrc = BLEND_FACTORS[state.srcColor];
  material.blendDst = BLEND_FACTORS[state.dstColor];
  material.blendSrcAlpha = BLEND_FACTORS[state.srcAlpha];
  material.blendDstAlpha = BLEND_FACTORS[state.dstAlpha];
  material.side = sideOf(state);
  material.depthTest = state.depthEnable;
  material.depthFunc = DEPTH_MODES[state.depthCompareFunc] ?? LessEqualDepth;
  material.depthWrite = (state.writeMask & WRITE_DEPTH) !== 0;
  material.colorWrite = (state.writeMask & WRITE_COLOR) !== 0;
}

/**
 * The face a pass keeps.
 *
 * Three flips its front face under the mirrored axis of world.ts on its own, so the
 * engine's default winding is `FrontSide` here, as `sideOf` of renderState.ts has it.
 */
export function sideOf(state: PassState): Side {
  if (!state.cullEnable) return DoubleSide;
  return state.windingToCull === "ccw" ? FrontSide : BackSide;
}

/** `source` without the `#version` line three writes itself. */
export function withoutVersion(source: string): string {
  return source.replace(/^#version[^\n]*\n/, "");
}

/** A block that a stage reads as an array uniform of the block's GLSL name. */
export interface InlinedBlock {
  readonly element: "vec4" | "ivec4" | "uvec4";
  /** The array's length. The translation cuts it after the last element the stage reads. */
  readonly extent: number;
}

/** A translated stage's source with its inlined blocks, and each inlined block by GLSL name. */
export interface InlinedStage {
  readonly source: string;
  readonly blocks: ReadonlyMap<string, InlinedBlock>;
}

/**
 * `source` with each block in `names` declared as an array uniform of the block's GLSL
 * name, and every read of the block through that array.
 *
 * The translation declares every buffer as one std140 block of `vec4 m[N]` behind an
 * instance name. An array uniform of the same `N` reads at the same indices. A block the
 * stage does not declare is not in the answer.
 */
export function blocksAsUniforms(source: string, names: ReadonlySet<string>): InlinedStage {
  const blocks = new Map<string, InlinedBlock>();
  let inlined = source;
  for (const [whole, name = "", element = "", extent = "", instance = ""] of source.matchAll(
    BLOCK,
  )) {
    if (!names.has(name)) continue;

    inlined = inlined
      .replace(whole, `uniform ${element} ${name}[${extent}];`)
      .replace(new RegExp(`\\b${instance}\\.m\\[`, "g"), `${name}[`);
    blocks.set(name, { element: element as InlinedBlock["element"], extent: Number(extent) });
  }
  return { source: inlined, blocks };
}

/** `stage` with `$Globals` inlined, and every other block as well under the `uniform` binding. */
function inlinedStage(stage: StageProgram, environment: EngineEnvironment): InlinedStage {
  const names = stage.sidecar.blocks
    .filter((block) => block.name === GLOBALS || environment.binding === "uniform")
    .map((block) => block.glslName);
  return blocksAsUniforms(stage.glsl, new Set(names));
}

/** A translated block: its GLSL name, element type, extent and instance. */
const BLOCK = /layout\(std140\) uniform (\w+)\n\{\n\s+([iu]?vec4) m\[(\d+)\];\n\} (\w+);/g;

/** An opaque mid-grey, drawn for a material texture nothing holds. */
const GREY: readonly [number, number, number, number] = [128, 128, 128, 255];

/** Transparent black, which a remap ramp of alpha zero leaves colour alone. */
const BLACK: readonly [number, number, number, number] = [0, 0, 0, 0];

const neutrals = new Map<string, Texture>();

/** One transparent black texel, bound where an asset has no mask texture. */
export function blackTexel(): Texture {
  return neutral("texture2d", BLACK);
}

/** One texel of `rgba` in the shape `dimension` samples, made once per shape and colour. */
function neutral(
  dimension: TextureDimension,
  rgba: readonly [number, number, number, number],
): Texture {
  const key = `${dimension}:${rgba.join(",")}`;
  const found = neutrals.get(key);
  if (found !== undefined) return found;
  const made = texel(dimension, rgba);
  made.needsUpdate = true;
  neutrals.set(key, made);
  return made;
}

function texel(
  dimension: TextureDimension,
  rgba: readonly [number, number, number, number],
): Texture {
  const bytes = new Uint8Array(rgba);
  switch (dimension) {
    case "texture2dArray":
      return new DataArrayTexture(bytes, 1, 1, 1);
    case "cubeArray":
      return new DataArrayTexture(
        new Uint8Array([...rgba, ...rgba, ...rgba, ...rgba, ...rgba, ...rgba]),
        1,
        1,
        6,
      );
    case "texture3d":
      return new Data3DTexture(bytes, 1, 1, 1);
    case "cube": {
      const face = () => {
        const held = new DataTexture(bytes, 1, 1);
        held.needsUpdate = true;
        return held;
      };
      return new CubeTexture([face(), face(), face(), face(), face(), face()]);
    }
    case "buffer": {
      const held = new DataTexture(new Uint32Array([0]), 1, 1, RedIntegerFormat, UnsignedIntType);
      held.magFilter = NearestFilter;
      held.minFilter = NearestFilter;
      return held;
    }
    default:
      return new DataTexture(bytes, 1, 1);
  }
}
