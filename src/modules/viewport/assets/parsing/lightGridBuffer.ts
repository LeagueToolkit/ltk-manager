/**
 * The ambient buffer the `ltk-asset` scheme answers `?as=lightgrid` with.
 *
 * The layout is `crates/ltk-manager-core/src/preview/light_grid.rs`'s module doc, and this
 * is the other half of it.
 */

import { AXIS_SIGN } from "../../shared/utils/space";
import { BufferError, BufferReader } from "../utils/bufferReader";

/** `LTKL`, the word a light grid buffer opens with. */
const MAGIC = 0x4c4b544c;

/** The layouts this build reads. */
const VERSIONS: readonly number[] = [1];

/** The faces of one cell's ambient cube: +X, -X, +Y, -Y, +Z, -Z in the engine's space. */
export const CUBE_FACES = 6;

/** A map's baked ambient, one cube per cell of a grid over its ground. */
export interface LightGrid {
  /** Cells along the engine's X. */
  readonly width: number;
  /** Cells along the engine's Z. */
  readonly height: number;
  /** World units the grid covers along X, from the origin. */
  readonly extentX: number;
  /** World units the grid covers along Z, from the origin. */
  readonly extentZ: number;
  /** What every face is multiplied by, `LIGHTGRID_SCALE.x`. */
  readonly scale: number;
  /** `lightGridCharacterFullBrightIntensity`, `LIGHTGRID_SCALE.y`. */
  readonly fullBright: number;
  /** `r g b a` per face, six faces per cell, cell `x + z * width`. */
  readonly cells: Uint8Array;
}

/**
 * One light grid out of the bytes the scheme answered.
 *
 * # Throws
 *
 * [`BufferError`] where the bytes are not a light grid buffer this build reads, or hold
 * fewer cells than the header counts.
 */
export function readLightGridBuffer(bytes: ArrayBuffer): LightGrid {
  const reader = new BufferReader(bytes);
  reader.header(MAGIC, VERSIONS, "light grid");
  const width = reader.u32();
  const height = reader.u32();
  const extentX = reader.f32();
  const extentZ = reader.f32();
  const scale = reader.f32();
  const fullBright = reader.f32();
  if (width === 0 || height === 0) throw new BufferError("A light grid has no cells");
  const cells = reader.bytes(width * height * CUBE_FACES * 4);
  if (!reader.done) throw new BufferError("A light grid buffer runs past its cells");
  return { width, height, extentX, extentZ, scale, fullBright, cells };
}

/**
 * The cell the game lights a character at `x`, `z` in the engine's space with.
 *
 * The nearest cell, clamped to the grid, as `LightGridManager::GetGridAndCell` picks it.
 * There is no filtering between cells.
 */
export function cellAt(grid: LightGrid, x: number, z: number): number {
  const column = clamp(Math.trunc((x * grid.width) / grid.extentX), grid.width - 1);
  const row = clamp(Math.trunc((z * grid.height) / grid.extentZ), grid.height - 1);
  return column + row * grid.width;
}

/**
 * The linear colour of each face of `cell`, three floats per face, scaled as the game
 * uploads it.
 */
export function cubeOf(grid: LightGrid, cell: number, into: Float32Array): Float32Array {
  const at = cell * CUBE_FACES * 4;
  const unit = grid.scale / 255;
  for (let face = 0; face < CUBE_FACES; face += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      into[face * 3 + channel] = grid.cells[at + face * 4 + channel] * unit;
    }
  }
  return into;
}

/**
 * The cube of the cell under `x`, `z` in the scene's space, with its faces in the scene's
 * space too: across the mirrored axis the engine's +X face is the scene's -X.
 */
export function sceneCubeAt(grid: LightGrid, x: number, z: number, into: Float32Array): number {
  const cell = cellAt(grid, x * AXIS_SIGN[0], z * AXIS_SIGN[2]);
  cubeOf(grid, cell, into);
  if (AXIS_SIGN[0] < 0) {
    for (let channel = 0; channel < 3; channel += 1) {
      const positive = into[channel];
      into[channel] = into[3 + channel];
      into[3 + channel] = positive;
    }
  }
  return cell;
}

function clamp(value: number, max: number): number {
  return value <= 0 ? 0 : value > max ? max : value;
}
