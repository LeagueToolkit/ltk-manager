/**
 * Colors the cells of a navigation grid by terrain or by one region group.
 *
 * The rule is section 3.5 of `docs/plans/navgrid-guides.md`. The input types are the fields of
 * `MapNavGridModel` that the rule reads, in the shape of the generated bindings.
 */

import { type NavGrid, REGION_TAGS_PER_GROUP, regionTagIndex } from "./navGridBuffer";

/** A color as `r g b a` bytes. */
export type Rgba = readonly [number, number, number, number];

/** A terrain tag of a `NavGridConfig`, which matches a cell that has all of its `flags` bits. */
export interface NavTerrainTag {
  readonly name: string;
  readonly flags: number;
  readonly color: Rgba;
}

/** A region tag of a `NavGridConfig`. */
export interface NavRegionTag {
  readonly name: string;
  /** FNV-1 of the lowercased name, as the grid stores it. */
  readonly nameHash: number;
  readonly color: Rgba;
}

/** A region tag group of a `NavGridConfig`. */
export interface NavRegionGroup {
  readonly name: string;
  /** FNV-1 of the lowercased name, as the grid stores it. */
  readonly nameHash: number;
  readonly gameplay: boolean;
  readonly tags: readonly NavRegionTag[];
}

/** The colors of a `NavGridConfig`. */
export interface NavGridColorConfig {
  readonly terrainTags: readonly NavTerrainTag[];
  readonly regionGroups: readonly NavRegionGroup[];
  /** The color of a cell that no tag matches. */
  readonly errorColor: Rgba;
}

/** What the cells are colored by. */
export type NavGridColorMode =
  | { readonly kind: "terrain" }
  | { readonly kind: "region"; readonly group: NavRegionGroup };

/**
 * Returns the terrain tag that colors a cell of flag word `word`, or null if no tag matches.
 *
 * Of the tags whose `flags` bits are all set in `word`, the tag with the most bits wins, and of
 * two with the same count the earlier one wins. Bits of `word` that no tag has are ignored.
 */
export function terrainTagOf(tags: readonly NavTerrainTag[], word: number): NavTerrainTag | null {
  let best: NavTerrainTag | null = null;
  let bestBits = -1;

  for (const tag of tags) {
    if ((word & tag.flags) !== tag.flags) {
      continue;
    }

    const bits = bitCount(tag.flags);
    if (bits > bestBits) {
      best = tag;
      bestBits = bits;
    }
  }

  return best;
}

/**
 * Returns the index of the region tag group of `grid` that `group` names, or null if the grid has
 * no group of that name.
 */
export function gridGroupOf(grid: NavGrid, group: NavRegionGroup): number | null {
  const index = grid.groupNames.indexOf(group.nameHash);
  return index === -1 ? null : index;
}

/**
 * Returns the tag of `group` that colors `cell`, or null if the cell's grid tag in that group has
 * no config tag of the same name, or if the grid has no group of that name.
 */
export function regionTagOf(
  grid: NavGrid,
  group: NavRegionGroup,
  cell: number,
): NavRegionTag | null {
  const gridGroup = gridGroupOf(grid, group);
  if (gridGroup === null) {
    return null;
  }

  return configTagOf(grid, group, gridGroup, regionTagIndex(grid, cell, gridGroup));
}

/**
 * Writes the color of each cell of `grid` under `mode` into `into`, one `r g b a` texel per cell
 * in cell order. `alpha` is the alpha byte of every texel.
 *
 * The rule runs once per distinct flag word or tag index.
 *
 * # Throws
 *
 * `RangeError` if `into` is not 4 bytes per cell long.
 */
export function writeCellColors(
  grid: NavGrid,
  config: NavGridColorConfig,
  mode: NavGridColorMode,
  alpha: number,
  into: Uint8Array,
): void {
  const cells = grid.xCells * grid.yCells;
  if (into.length !== cells * 4) {
    throw new RangeError(`A cell color array of ${into.length} bytes does not hold ${cells} cells`);
  }

  if (mode.kind === "terrain") {
    writeTerrainColors(grid, config, alpha, into);
  } else {
    writeRegionColors(grid, config, mode.group, alpha, into);
  }
}

function writeTerrainColors(
  grid: NavGrid,
  config: NavGridColorConfig,
  alpha: number,
  into: Uint8Array,
): void {
  const colors = new Map<number, Rgba>();

  for (let cell = 0; cell < grid.flags.length; cell += 1) {
    const word = grid.flags[cell];
    let color = colors.get(word);
    if (color === undefined) {
      color = terrainTagOf(config.terrainTags, word)?.color ?? config.errorColor;
      colors.set(word, color);
    }

    writeTexel(into, cell, color, alpha);
  }
}

function writeRegionColors(
  grid: NavGrid,
  config: NavGridColorConfig,
  group: NavRegionGroup,
  alpha: number,
  into: Uint8Array,
): void {
  const gridGroup = gridGroupOf(grid, group);
  if (gridGroup === null) {
    for (let cell = 0; cell < grid.regionTags.length; cell += 1) {
      writeTexel(into, cell, config.errorColor, alpha);
    }

    return;
  }

  const colors = Array.from(
    { length: REGION_TAGS_PER_GROUP },
    (_, index) => configTagOf(grid, group, gridGroup, index)?.color ?? config.errorColor,
  );

  for (let cell = 0; cell < grid.regionTags.length; cell += 1) {
    writeTexel(into, cell, colors[regionTagIndex(grid, cell, gridGroup)], alpha);
  }
}

/** Returns the tag of `group` whose name hash equals the grid's tag `index` of `gridGroup`. */
function configTagOf(
  grid: NavGrid,
  group: NavRegionGroup,
  gridGroup: number,
  index: number,
): NavRegionTag | null {
  const name = grid.tagNames[gridGroup * REGION_TAGS_PER_GROUP + index];
  return group.tags.find((tag) => tag.nameHash === name) ?? null;
}

function writeTexel(into: Uint8Array, cell: number, color: Rgba, alpha: number): void {
  const at = cell * 4;
  into[at] = color[0];
  into[at + 1] = color[1];
  into[at + 2] = color[2];
  into[at + 3] = alpha;
}

function bitCount(word: number): number {
  let bits = 0;
  for (let rest = word; rest !== 0; rest &= rest - 1) {
    bits += 1;
  }
  return bits;
}
