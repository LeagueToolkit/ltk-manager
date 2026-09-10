/**
 * What a details row's height decides: its art, and the tier it names itself in.
 *
 * The row spans 20px to 64px, and the two things that follow it live here so a
 * height a slider lands on cannot mean one size to the row and another to the
 * virtualizer measuring it.
 */

import { EXPLORER_ROW_HEIGHTS, type ExplorerRowHeight } from "@/stores";

import { NAME_TIERS, type NameType } from "./tileName";

/** The art's margin inside the row, so a fill never meets the row above. */
const ART_INSET = 4;

/**
 * The width every row's thumbnail is asked for.
 *
 * The smallest tile size, and the tallest row still draws under it, so the list
 * adds no seventh width to the six a session asks the asset scheme for.
 */
export const ART_REQUEST_WIDTH = 64;

/** The art's box in a row of this height. */
export function artBoxFor(rowHeight: number): number {
  return rowHeight - ART_INSET;
}

/** The tier a row of this height names itself in. */
export function nameTypeForRow(rowHeight: number): NameType {
  return rowHeight < 24 ? NAME_TIERS.meta : NAME_TIERS.row;
}

/**
 * The declared height nearest what the slider landed on.
 *
 * The six heights are not evenly spaced, so no single step reaches them and
 * only them. A thumb between two takes the nearer.
 */
export function nearestRowHeight(value: number): ExplorerRowHeight {
  return EXPLORER_ROW_HEIGHTS.reduce((best, height) =>
    Math.abs(height - value) < Math.abs(best - value) ? height : best,
  );
}
