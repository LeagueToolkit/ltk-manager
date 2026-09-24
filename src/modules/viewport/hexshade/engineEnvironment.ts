import {
  type Camera,
  DataTexture,
  type IUniform,
  type Material,
  Matrix4,
  type Object3D,
  type RawShaderMaterial,
  type SkinnedMesh,
  type Texture,
  Uniform,
  UniformsGroup,
  Vector3,
  type WebGLRenderer,
} from "three";

import type { UniformBlock } from "@/lib/tauri";

import {
  CUBE_FACES as GRID_FACES,
  type LightGrid,
  sceneCubeAt,
} from "../assets/parsing/lightGridBuffer";
import { DEFAULT_SUN, type SunColor, type SunLight } from "../scene/utils/sunLight";
import { AXIS_SIGN } from "../shared/utils/space";
import { type InlinedBlock, programGlobals } from "./programMaterial";

/**
 * How a program material reads the environment's buffers.
 *
 * `group` binds each buffer through one `UniformsGroup` that every material of the object
 * shares. A group takes one renderer binding point until it is disposed. A WebGL2 context
 * on ANGLE has 24 binding points. `uniform` declares each buffer as an array uniform of
 * the material over the same bytes, and takes no binding point.
 */
export type BufferBinding = "group" | "uniform";

/**
 * The engine's constant buffers for the program materials of one object, written once per
 * frame.
 *
 * Every buffer but `$Globals` has one layout in every shipped blob. Each is one
 * `Float32Array` of the buffer's bytes, which every material of the object reads through
 * its `BufferBinding`. A member is written at the byte offset section 3.2 of
 * docs/research/static-material-studio-rendering.md lists. A buffer the studio has no
 * value for stays zero. The matrices are written as the rows the shader's `dp4` reads.
 * The clip transform is D3D's, and the translated shader maps its `z` to GL's.
 *
 * A skinned mesh's `BONES` carry the object's transform, and its clip transform is the
 * camera's alone. A static mesh's shader multiplies by a `WORLD_MATRIX` the material packs
 * as the identity. Its clip transform carries the object's, and the camera is stated in
 * the object's space.
 *
 * `$Globals` is an array uniform of each material under either binding. It carries what
 * changes per draw for one of hundreds of materials, and three uploads a group once per
 * frame.
 */
export class EngineEnvironment {
  /** The sun the pixel buffer states, which a map's own replaces. */
  light: SunLight = DEFAULT_SUN;
  /** The map's baked ambient, which lights a character in place of the sun where it holds one. */
  grid: LightGrid | null = null;
  /** The skin's `selfIllumination`, written to each colour channel of `SELF_ILLUMINATION`. */
  selfIllumination = 0;

  private readonly buffers = new Map<string, BlockBuffer>();
  private readonly clip = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly identity = new Matrix4();
  private readonly eye = new Vector3();
  private frame = -1;

  constructor(readonly binding: BufferBinding = "group") {}

  /** The group `block` binds through, one per block name for the object's life. */
  group(block: UniformBlock): UniformsGroup {
    const buffer = this.bufferOf(block);
    if (buffer.group === null) {
      buffer.group = new UniformsGroup().setName(block.glslName);
      buffer.group.add(new Uniform(buffer.data));
    }
    return buffer.group;
  }

  /**
   * The bytes of `block` as a typed array of the elements a stage declares it with.
   *
   * The array is a view of the environment's bytes, not a copy. Every material that reads
   * the block reads each write.
   */
  array(
    block: UniformBlock,
    { element, extent }: InlinedBlock,
  ): Float32Array | Int32Array | Uint32Array {
    const { data } = this.bufferOf(block);
    const length = Math.min(extent * VEC4_FLOATS, data.length);

    /* The shader converts an integer element to a float with `uintBitsToFloat`. An
       integer view keeps the bits of each float unconverted. */
    if (element === "uvec4") return new Uint32Array(data.buffer, data.byteOffset, length);
    if (element === "ivec4") return new Int32Array(data.buffer, data.byteOffset, length);
    return data.subarray(0, length);
  }

  /**
   * The light maps of the mesh about to draw written over `material`'s `$Globals` and
   * bound to its samplers.
   *
   * A light map and its scale and bias belong to the mesh. `$Globals` and the samplers
   * belong to the material, which every mesh of it shares. Three uploads a material's
   * uniforms again only when `uniformsNeedUpdate` is set, and a change of either sets it.
   * Under the `uniform` binding the buffers are material uniforms as well, and every draw
   * sets it.
   */
  draw(material: Material, lights: MeshLights | null = null): void {
    const globals = programGlobals(material);
    if (globals === undefined) return;
    const program = material as RawShaderMaterial;
    const uniforms: Record<string, IUniform> = program.uniforms;
    if (this.binding === "uniform") program.uniformsNeedUpdate = true;

    for (const [channel, member, texture] of LIGHT_CHANNELS) {
      const light = lights?.[channel] ?? null;
      for (const at of globals.members.get(member) ?? []) {
        const block = uniforms[at.block]?.value;
        if (!(block instanceof Float32Array)) continue;
        const scale = light?.scale ?? UNIT_SCALE;
        const bias = light?.bias ?? NO_BIAS;
        if (
          block[at.offset] !== scale[0] ||
          block[at.offset + 1] !== scale[1] ||
          block[at.offset + 2] !== bias[0] ||
          block[at.offset + 3] !== bias[1]
        ) {
          block[at.offset] = scale[0];
          block[at.offset + 1] = scale[1];
          block[at.offset + 2] = bias[0];
          block[at.offset + 3] = bias[1];
          program.uniformsNeedUpdate = true;
        }
      }
      const samplers = globals.samplers.get(texture);
      if (samplers === undefined) continue;
      const value = light?.texture ?? unlit();
      for (const sampler of samplers) {
        const uniform = uniforms[sampler];
        if (uniform === undefined || uniform.value === value) continue;
        uniform.value = value;
        program.uniformsNeedUpdate = true;
      }
    }
  }

  /** Every buffer written for `object` as `camera` sees it, once per frame. */
  write(renderer: WebGLRenderer, camera: Camera, object: Object3D, time: number): void {
    if (renderer.info.render.frame === this.frame) return;
    this.frame = renderer.info.render.frame;
    this.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    if (!isSkinned(object)) {
      this.clip.multiply(object.matrixWorld);
      this.eye.applyMatrix4(this.inverse.copy(object.matrixWorld).invert());
    }
    for (const { data, base } of this.buffers.values()) {
      const write = WRITERS[base];
      if (write !== undefined) write(data, this, camera, object, time);
    }
  }

  dispose(): void {
    for (const { group } of this.buffers.values()) group?.dispose();
    this.buffers.clear();
  }

  /** The rows of the clip transform with a D3D depth range. */
  writeClip(out: Float32Array, at: number): void {
    writeRows(out, at, this.clip);
    /* GL clips z in [-w, w] and D3D in [0, w], and the translated shader undoes exactly
       this halving with `2z - w`, so the bytes it reads are the ones the game wrote. */
    for (let column = 0; column < 4; column += 1) {
      const z = at + 2 * 4 + column;
      const w = at + 3 * 4 + column;
      out[z] = ((out[z] ?? 0) + (out[w] ?? 0)) / 2;
    }
  }

  writeEye(out: Float32Array, at: number): void {
    writeVector(out, at, this.eye.x, this.eye.y, this.eye.z);
  }

  writeIdentity(out: Float32Array, at: number): void {
    writeRows(out, at, this.identity);
  }

  /** The environment's buffer for `block`, created on the block's first bind. */
  private bufferOf(block: UniformBlock): BlockBuffer {
    const found = this.buffers.get(block.glslName);
    if (found !== undefined) return found;

    const made: BlockBuffer = {
      group: null,
      data: new Float32Array(block.size / FLOAT_BYTES),
      base: block.name,
    };
    this.buffers.set(block.glslName, made);
    return made;
  }
}

interface BlockBuffer {
  /** The group the block binds through, and null under the `uniform` binding. */
  group: UniformsGroup | null;
  readonly data: Float32Array;
  /** The engine's name for the block, which says what to write into it. */
  readonly base: string;
}

/** The light maps one mesh is lit by, each with the transform its `uv1` reads through. */
export interface MeshLights {
  readonly baked: MeshLight | null;
  readonly stationary: MeshLight | null;
}

/** One light map of a mesh, and null for one this machine holds no texture for yet. */
export interface MeshLight {
  readonly texture: Texture | null;
  readonly scale: readonly [number, number];
  readonly bias: readonly [number, number];
}

/** Each light channel, the `$Globals` member its transform lands in and its texture. */
const LIGHT_CHANNELS: readonly (readonly [keyof MeshLights, string, string])[] = [
  ["baked", "BAKED_LIGHT_SCALE_AND_BIAS", "BAKED_LIGHT__TX"],
  ["stationary", "STATIONARY_LIGHT_SCALE_AND_BIAS", "STATIONARY_LIGHT__TX"],
];

let white: DataTexture | null = null;

/**
 * A one-texel white, drawn for a light map nothing holds, so a lit shader on a mesh
 * without one reads the map's light map scale alone.
 */
function unlit(): DataTexture {
  if (white === null) {
    white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
  }
  return white;
}

type Writer = (
  out: Float32Array,
  environment: EngineEnvironment,
  camera: Camera,
  object: Object3D,
  time: number,
) => void;

const FLOAT_BYTES = 4;
const VEC4_FLOATS = 4;

/** The light map transform of a mesh without one, reading its `uv1` as it is. */
const UNIT_SCALE: readonly [number, number] = [1, 1];
const NO_BIAS: readonly [number, number] = [0, 0];

/**
 * `ENV_FOG_START_END_SCALE_EMISSIVE_REMAP.xy`, the heights the map's fog runs between.
 *
 * A flat shader fogs a texel by `saturate((y - end) / (start - end))` and a start equal
 * to the end divides by zero, which the clamp lands on full fog. A start one unit above
 * an end far below any map leaves every texel out of the fog.
 */
const FOG_START = -100_000;
const FOG_END = -100_001;

/** The Rift's sun intensity plus its sky scale, for a light saved without its total. */
const DEFAULT_TOTAL = 2;

/** How many bones `BonesCB` holds, `float4x3[256]`. */
const BONES = 256;

/** The rows a bone's `float4x3` takes, three `float4`s. */
const BONE_ROWS = 3;

/** The faces of the ambient cube in the order `LIGHTGRID_COLORS` holds them. */
const CUBE_FACES: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function isSkinned(object: Object3D): object is SkinnedMesh {
  return (object as SkinnedMesh).isSkinnedMesh === true;
}

/**
 * The sun's direction in `object`'s space, toward the sun.
 *
 * A map is stated in the engine's space, which is its own. A character's bones stand in
 * the world across the mirrored axis of world.ts, so the direction crosses it too.
 */
function sunDirectionFor(light: SunLight, object: Object3D): readonly [number, number, number] {
  const [x, y, z] = light.direction;
  if (!isSkinned(object)) return [x, y, z];
  return [x * AXIS_SIGN[0], y * AXIS_SIGN[1], z * AXIS_SIGN[2]];
}

/**
 * The ambient cube of `LIGHTGRID_COLORS`, `+X -X +Y -Y +Z -Z`, which the vertex shader
 * weighs by the squared normal into `COLOR0` and the pixel shader scales by
 * `LIGHTGRID_SCALE.x`, for a map that bakes no light grid.
 *
 * As `MapLightingInfo::SetupLighting` builds it: the sky lights the face up, the ground
 * the face down and the horizon the four sides, all at the sky's scale, and the sun adds
 * its light by how squarely a face meets it. The game divides the cube by its brightest
 * channel and scales it back by the same, which is this cube unscaled.
 */
export function ambientCube(
  light: SunLight,
  direction: readonly [number, number, number],
): readonly SunColor[] {
  const { color, strength, sky, ground, ambient, total = DEFAULT_TOTAL } = light;
  const horizon = light.horizon ?? sky;
  const skyScale = ambient * total;
  const sunScale = strength * total;
  return CUBE_FACES.map((face) => {
    const base = face[1] > 0 ? sky : face[1] < 0 ? ground : horizon;
    const facing = Math.max(
      face[0] * direction[0] + face[1] * direction[1] + face[2] * direction[2],
      0,
    );
    const lit = (channel: number) =>
      (base[channel] ?? 0) * skyScale + (color[channel] ?? 0) * sunScale * facing;
    return [lit(0), lit(1), lit(2)];
  });
}

const gridColours = new Float32Array(GRID_FACES * 3);
const gridCentre = new Vector3();

/**
 * The cube of the grid cell under the middle of `object`'s bounds, as the game picks it
 * for a character, with no filtering between cells.
 */
function gridCube(grid: LightGrid, object: Object3D): readonly SunColor[] {
  const geometry = (object as Partial<SkinnedMesh>).geometry;
  if (geometry === undefined) gridCentre.setFromMatrixPosition(object.matrixWorld);
  else {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    geometry.boundingBox?.getCenter(gridCentre).applyMatrix4(object.matrixWorld);
  }
  sceneCubeAt(grid, gridCentre.x, gridCentre.z, gridColours);
  return Array.from({ length: GRID_FACES }, (_, face) => [
    gridColours[face * 3] ?? 0,
    gridColours[face * 3 + 1] ?? 0,
    gridColours[face * 3 + 2] ?? 0,
  ]);
}

/** Each buffer's writer, at the member offsets of section 3.2, in floats. */
const WRITERS: Record<string, Writer> = {
  PerFrameVertexCB: (out, environment, camera, object, time) => {
    const [x, y, z] = sunDirectionFor(environment.light, object);
    environment.writeClip(out, 0);
    environment.writeEye(out, 16);
    out[20] = time;
    environment.writeClip(out, 28);
    writeRows(out, 96, camera.matrixWorldInverse);
    writeRows(out, 112, camera.matrixWorld);
    writeVector(out, 132, x, y, z);
  },
  /* A static mesh's shader lights a texel by `SHADOW_COLOR` plus its complement where
     the sun reaches. The shadow colour is the sky's light at the map's own scale and the
     complement is what the sun's light adds over it, so a sunlit texel reads at the
     sun's light and a shadowed one at the sky's. On the Rift both are one, which is the
     brightness the map reads right at on screen. Inferred from the shipped pixel shaders
     and that judgement, not traced. */
  PerFramePixelCB: (out, environment, camera, object, time) => {
    const { color, strength, sky, ambient, total = DEFAULT_TOTAL, fog = null } = environment.light;
    const direction = sunDirectionFor(environment.light, object);
    const sun = color.map((channel) => channel * strength * total);
    const shadow = sky.map((channel) => channel * ambient * total);
    const complement = sun.map((channel, at) => Math.max(channel - (shadow[at] ?? 0), 0));
    environment.writeEye(out, 0);
    out[4] = time;
    writeVector(out, 12, shadow[0] ?? 0, shadow[1] ?? 0, shadow[2] ?? 0);
    out[15] = 1;
    writeVector(out, 16, complement[0] ?? 0, complement[1] ?? 0, complement[2] ?? 0);
    out[19] = 1;
    writeVector(out, 24, sun[0] ?? 0, sun[1] ?? 0, sun[2] ?? 0);
    out[27] = 1;
    writeVector(out, 29, direction[0], direction[1], direction[2]);
    out[32] = environment.light.lightMap ?? 1;
    if (fog === null) {
      writeVector(out, 33, sky[0], sky[1], sky[2]);
      writeVector(out, 36, sky[0], sky[1], sky[2]);
      out[40] = FOG_START;
      out[41] = FOG_END;
      out[42] = 0;
      out[43] = 0;
    } else {
      writeVector(out, 33, fog.color[0], fog.color[1], fog.color[2]);
      writeVector(out, 36, fog.alternate[0], fog.alternate[1], fog.alternate[2]);
      out[40] = fog.start;
      out[41] = fog.end;
      out[42] = 1;
      out[43] = fog.emissiveRemap;
    }
    writeRows(out, 68, camera.matrixWorldInverse);
    writeRows(out, 104, camera.matrixWorld);
  },
  CharacterPerDrawVertexCB: (out, environment, _camera, object) => {
    environment.writeIdentity(out, 0);
    const cube =
      environment.grid === null
        ? ambientCube(environment.light, sunDirectionFor(environment.light, object))
        : gridCube(environment.grid, object);
    cube.forEach(([r, g, b], face) => {
      writeVector(out, 16 + face * 4, r, g, b);
      out[16 + face * 4 + 3] = 1;
    });
    environment.writeIdentity(out, 44);
  },
  CharacterPerDrawPS: (out, environment) => {
    const { selfIllumination } = environment;
    writeVector(out, 0, selfIllumination, selfIllumination, selfIllumination);
    /* `kGrassFade.w` multiplies every fragment's alpha, so anything but one draws nothing. */
    out[7] = 1;
    /* `LIGHTGRID_SCALE`: the grid's own scale is already in its cube. */
    out[8] = 1;
    out[9] = environment.grid?.fullBright ?? 1;
    environment.writeIdentity(out, 16);
    environment.writeIdentity(out, 32);
  },
  BonesCB: (out, _environment, _camera, object) => {
    if (!isSkinned(object)) return;
    /* The skeleton's matrices are the bones' world transforms over their inverse binds,
       which is the world every vertex lands in, so `mWorld` above is the identity. */
    const bones = object.skeleton.boneMatrices;
    if (bones === null) return;
    const count = Math.min(BONES, bones.length / 16);
    for (let bone = 0; bone < count; bone += 1) {
      const from = bone * 16;
      const to = bone * BONE_ROWS * 4;
      for (let row = 0; row < BONE_ROWS; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          out[to + row * 4 + column] = bones[from + row + column * 4] ?? 0;
        }
      }
    }
  },
};

/** `matrix` as the four rows a `dp4` against a column vector reads, at `at` floats. */
export function writeRows(out: Float32Array, at: number, matrix: Matrix4): void {
  const e = matrix.elements;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      out[at + row * 4 + column] = e[row + column * 4] ?? 0;
    }
  }
}

function writeVector(out: Float32Array, at: number, x: number, y: number, z: number): void {
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
}
