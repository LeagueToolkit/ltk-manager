import type { BinRow } from "@/lib/tauri";

import { fieldHash } from "./binRows";
import { drawnAtBirth, drawSummary, randomDraw, rerollsEveryFrame } from "./randomDraw";
import type { ValueMark } from "./valueRows";

/**
 * What a rail segment says about its row, which is when the row's table is rolled.
 *
 * `roll` is the one draw every birth field of a particle shares. `flicker` is a table the
 * engine re-rolls every frame, which is a roll of its own rather than a share of that one.
 */
export type RailMark = "roll" | "flicker";

/**
 * The segment `row` carries, or null for a row no rail reaches.
 *
 * "The roll rail says when a value is rolled" in docs/ux/BIN_EDITOR.md. A
 * randomized field that is neither is left to its own chip, because the rail says when a
 * value is drawn rather than that it is random at all.
 */
export function railMark(row: BinRow, mark: ValueMark | undefined): RailMark | null {
  const draw = randomDraw(mark);
  const summary = draw === null ? null : drawSummary(draw);
  if (summary === null) return null;
  if (summary.kind !== "broken" && rerollsEveryFrame(fieldHash(row.path))) return "flicker";
  return drawnAtBirth(row.name) ? "roll" : null;
}
