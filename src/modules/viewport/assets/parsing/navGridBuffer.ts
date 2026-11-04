/**
 * Reads the navigation grid buffers that the `ltk-asset` scheme answers `?as=navgrid` with, and
 * looks up cells and heights in a grid.
 *
 * The layouts are section 4 of `docs/plans/navgrid-guides.md`, and the rules of `applyOverlays`
 * and the lookups are those of `ltk_navgrid` 0.1.0 (ADR-0079). Every block is a view over the
 * received bytes, and the format's four-byte alignment keeps each view valid.
 */

import { BufferError, BufferReader } from "../utils/bufferReader";

/** `LTKN`, the word that a grid buffer opens with. */
const GRID_MAGIC = 0x4e4b544c;

/** `LTKO`, the word that an overlay buffer opens with. */
const OVERLAY_MAGIC = 0x4f4b544c;

/** The layouts that this build reads, for both buffers. */
const VERSIONS: readonly number[] = [1];

/** The `kind` word of an `LTKO` buffer. */
const OVERLAY_KIND = { flags: 1, regions: 2 } as const;

/** The region tag groups of a grid. */
export const REGION_TAG_GROUP_COUNT = 8;

/** The tags of one region tag group, selected by a 4-bit index. */
export const REGION_TAGS_PER_GROUP = 16;

/** A navigation grid without its pathfinding record and hint grid, in the engine's space. */
export interface NavGrid {
  /** Cells along world `x`. */
  readonly xCells: number;
  /** Cells along world `z`. */
  readonly yCells: number;
  /** World units of one cell edge. */
  readonly cellSize: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Height samples along world `x`. */
  readonly xSamples: number;
  /** Height samples along world `z`. */
  readonly ySamples: number;
  /** World units between two samples along `x`. */
  readonly xSpacing: number;
  /** World units between two samples along `z`. */
  readonly ySpacing: number;
  /** FNV-1 of each group name, 0 for an unused group. */
  readonly groupNames: Uint32Array;
  /** FNV-1 of each tag name, [`REGION_TAGS_PER_GROUP`] per group, group-major. */
  readonly tagNames: Uint32Array;
  /** The flag word of each cell, cell `x + y * xCells`. */
  readonly flags: Uint16Array;
  /** The region tag word of each cell, a 4-bit tag index per group from the low bits up. */
  readonly regionTags: Uint32Array;
  /** The height of each cell. */
  readonly heights: Float32Array;
  /** The height of sample `i + j * xSamples`, at `min.x + i * xSpacing`, `min.z + j * ySpacing`. */
  readonly samples: Float32Array;
}

/** One rectangle of an overlay, with its first cell at `x`, `y`. */
export interface NavGridOverlayRect<Values extends Uint16Array | Uint32Array> {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The values in row-major order, `width * height` in a decoded buffer. */
  readonly values: Values;
}

/** The rectangles of a `.ngrid_overlay` file, of flag words, or of a `.rg_overlay` file, of region tag words. */
export type NavGridOverlay =
  | { readonly kind: "flags"; readonly rects: readonly NavGridOverlayRect<Uint16Array>[] }
  | { readonly kind: "regions"; readonly rects: readonly NavGridOverlayRect<Uint32Array>[] };

/** The content of one `navgrid` buffer, which is a grid or an overlay by its magic. */
export type NavGridFile =
  | { readonly kind: "grid"; readonly grid: NavGrid }
  | { readonly kind: "overlay"; readonly overlay: NavGridOverlay };

/**
 * Reads an `LTKN` buffer.
 *
 * # Throws
 *
 * [`BufferError`] if the bytes are not an `LTKN` buffer of a version that this build reads, or
 * if their length differs from the length that the header counts.
 */
export function readNavGridBuffer(bytes: ArrayBuffer): NavGrid {
  const reader = new BufferReader(bytes);
  reader.header(GRID_MAGIC, VERSIONS, "navigation grid");

  const xCells = reader.u32();
  const yCells = reader.u32();
  const cellSize = reader.f32();
  const min = readVec3(reader);
  const max = readVec3(reader);
  const xSamples = reader.u32();
  const ySamples = reader.u32();
  const xSpacing = reader.f32();
  const ySpacing = reader.f32();
  const groupNames = reader.wordView(REGION_TAG_GROUP_COUNT);
  const tagNames = reader.wordView(REGION_TAG_GROUP_COUNT * REGION_TAGS_PER_GROUP);

  const cells = xCells * yCells;
  const flags = shortView(reader, cells);
  const regionTags = reader.wordView(cells);
  const heights = reader.floatView(cells);
  const samples = reader.floatView(xSamples * ySamples);
  if (!reader.done) {
    throw new BufferError("A navigation grid buffer runs past its samples");
  }

  return {
    xCells,
    yCells,
    cellSize,
    min,
    max,
    xSamples,
    ySamples,
    xSpacing,
    ySpacing,
    groupNames,
    tagNames,
    flags,
    regionTags,
    heights,
    samples,
  };
}

/**
 * Reads an `LTKO` buffer.
 *
 * # Throws
 *
 * [`BufferError`] if the bytes are not an `LTKO` buffer of a version and a kind that this build
 * reads, or if their length differs from the length that the rectangles count.
 */
export function readNavGridOverlayBuffer(bytes: ArrayBuffer): NavGridOverlay {
  const reader = new BufferReader(bytes);
  reader.header(OVERLAY_MAGIC, VERSIONS, "navigation grid overlay");

  const kind = reader.u32();
  const count = reader.u32();
  let overlay: NavGridOverlay;
  if (kind === OVERLAY_KIND.flags) {
    overlay = {
      kind: "flags",
      rects: readRects(reader, count, (values) => shortView(reader, values)),
    };
  } else if (kind === OVERLAY_KIND.regions) {
    overlay = {
      kind: "regions",
      rects: readRects(reader, count, (values) => reader.wordView(values)),
    };
  } else {
    throw new BufferError(
      `A navigation grid overlay buffer of kind ${kind} is not one this build reads`,
    );
  }

  if (!reader.done) {
    throw new BufferError("A navigation grid overlay buffer runs past its rectangles");
  }

  return overlay;
}

/**
 * Reads an `LTKN` or an `LTKO` buffer, selected by its magic.
 *
 * # Throws
 *
 * [`BufferError`] if the bytes are neither, or if [`readNavGridBuffer`] or
 * [`readNavGridOverlayBuffer`] fails on them.
 */
export function readNavGridFile(bytes: ArrayBuffer): NavGridFile {
  const magic = bytes.byteLength < 4 ? 0 : new DataView(bytes).getUint32(0, true);
  if (magic === GRID_MAGIC) {
    return { kind: "grid", grid: readNavGridBuffer(bytes) };
  }
  if (magic === OVERLAY_MAGIC) {
    return { kind: "overlay", overlay: readNavGridOverlayBuffer(bytes) };
  }

  throw new BufferError(`Not a navigation grid or overlay buffer: 0x${magic.toString(16)}`);
}

/**
 * Returns a grid with `overlays` written over the flags and region tags of `base`, in order.
 *
 * The result copies `flags` and `regionTags` and shares the other arrays with `base`. Each value
 * replaces the whole word of its cell, and a value whose cell is outside the grid is skipped. A
 * rectangle applies only its complete rows of `width` values, up to `height` rows, so a zero
 * width applies nothing.
 */
export function applyOverlays(base: NavGrid, overlays: readonly NavGridOverlay[]): NavGrid {
  const flags = base.flags.slice();
  const regionTags = base.regionTags.slice();

  for (const overlay of overlays) {
    const target = overlay.kind === "flags" ? flags : regionTags;
    for (const rect of overlay.rects) {
      applyRect(base, target, rect);
    }
  }

  return { ...base, flags, regionTags };
}

/** Returns the index of cell `x`, `y` in the cell arrays, or null if the cell is outside the grid. */
export function cellIndex(grid: NavGrid, x: number, y: number): number | null {
  const inside =
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < grid.xCells &&
    y < grid.yCells;
  return inside ? x + y * grid.xCells : null;
}

/** Returns the `x`, `y` of the cell at `index`, or null if `index` is outside the cells. */
export function cellCoords(grid: NavGrid, index: number): [number, number] | null {
  if (!Number.isInteger(index) || index < 0 || index >= grid.xCells * grid.yCells) {
    return null;
  }

  return [index % grid.xCells, Math.floor(index / grid.xCells)];
}

/**
 * Returns the `x`, `y` of the cell that contains world `x`, `z`, or null if the position is
 * outside the grid or not a number.
 *
 * The math is in double precision and `ltk_navgrid` computes in `f32`, so a position within
 * `f32` rounding of a cell edge can resolve to the neighbor cell.
 */
export function cellAt(grid: NavGrid, x: number, z: number): [number, number] | null {
  const column = cellAlong(x - grid.min[0], grid.cellSize, grid.xCells);
  const row = cellAlong(z - grid.min[2], grid.cellSize, grid.yCells);
  if (column === null || row === null) {
    return null;
  }

  return [column, row];
}

/**
 * Returns the world position of the center of cell `x`, `y`, at the cell height. Returns null if
 * the cell is outside the grid.
 */
export function cellCenter(grid: NavGrid, x: number, y: number): [number, number, number] | null {
  const index = cellIndex(grid, x, y);
  if (index === null) {
    return null;
  }

  return [
    grid.min[0] + (x + 0.5) * grid.cellSize,
    grid.heights[index],
    grid.min[2] + (y + 0.5) * grid.cellSize,
  ];
}

/**
 * Returns the height at world `x`, `z`, interpolated between the four samples around it.
 *
 * Returns null if the position is outside the samples or not a number. The samples span from
 * `min.x` to `min.x + (xSamples - 1) * xSpacing` along `x`, and the same along `z`, both ends
 * included.
 */
export function sampledHeightAt(grid: NavGrid, x: number, z: number): number | null {
  const alongX = sampleSpan(x - grid.min[0], grid.xSpacing, grid.xSamples);
  const alongZ = sampleSpan(z - grid.min[2], grid.ySpacing, grid.ySamples);
  if (alongX === null || alongZ === null) {
    return null;
  }

  const [x0, x1, tx] = alongX;
  const [z0, z1, tz] = alongZ;
  const height = (column: number, row: number) => grid.samples[column + row * grid.xSamples];
  const near = lerp(height(x0, z0), height(x1, z0), tx);
  const far = lerp(height(x0, z1), height(x1, z1), tx);
  return lerp(near, far, tz);
}

/** Returns the 4-bit tag index of region tag group `group` in the region tag word of `cell`. */
export function regionTagIndex(grid: NavGrid, cell: number, group: number): number {
  return (grid.regionTags[cell] >>> (4 * group)) & 0xf;
}

/**
 * Reads `count` 16-bit values as a view, and the 2 bytes of padding after an odd count.
 *
 * The block is read through `wordView`, which checks that it starts on a four-byte boundary.
 */
function shortView(reader: BufferReader, count: number): Uint16Array {
  const words = reader.wordView(Math.ceil(count / 2));
  return new Uint16Array(words.buffer, words.byteOffset, count);
}

function readVec3(reader: BufferReader): [number, number, number] {
  return [reader.f32(), reader.f32(), reader.f32()];
}

function readRects<Values extends Uint16Array | Uint32Array>(
  reader: BufferReader,
  count: number,
  readValues: (count: number) => Values,
): NavGridOverlayRect<Values>[] {
  const rects: NavGridOverlayRect<Values>[] = [];
  for (let rect = 0; rect < count; rect += 1) {
    const x = reader.i32();
    const y = reader.i32();
    const width = reader.u32();
    const height = reader.u32();
    rects.push({ x, y, width, height, values: readValues(width * height) });
  }
  return rects;
}

/** Writes the values of `rect` into `target` at the cells inside `grid`. */
function applyRect(
  grid: NavGrid,
  target: Uint16Array | Uint32Array,
  rect: NavGridOverlayRect<Uint16Array | Uint32Array>,
): void {
  const { x, y, width, values } = rect;
  if (width === 0) {
    return;
  }

  const rows = Math.min(rect.height, Math.floor(values.length / width));
  const firstColumn = Math.max(0, -x);
  const endColumn = Math.min(width, grid.xCells - x);
  const firstRow = Math.max(0, -y);
  const endRow = Math.min(rows, grid.yCells - y);

  for (let row = firstRow; row < endRow; row += 1) {
    const cellRow = (y + row) * grid.xCells;
    for (let column = firstColumn; column < endColumn; column += 1) {
      target[cellRow + x + column] = values[row * width + column];
    }
  }
}

/** Returns the cell along one axis that contains `offset`, or null outside `count` cells. */
function cellAlong(offset: number, cellSize: number, count: number): number | null {
  const cell = Math.floor(offset / cellSize);
  // `cell >= 0` is false for NaN.
  return cell >= 0 && cell < count ? cell : null;
}

/**
 * Returns the two samples along one axis around `offset` and the weight of the second, or null
 * if `offset` is outside the samples.
 */
function sampleSpan(
  offset: number,
  spacing: number,
  count: number,
): [number, number, number] | null {
  const last = count - 1;
  const position = offset / spacing;
  // The negated range check is true for NaN.
  if (count === 0 || !(position >= 0 && position <= last)) {
    return null;
  }

  const first = Math.min(Math.floor(position), last);
  const second = Math.min(first + 1, last);
  return [first, second, position - first];
}

function lerp(from: number, to: number, weight: number): number {
  return from + (to - from) * weight;
}
