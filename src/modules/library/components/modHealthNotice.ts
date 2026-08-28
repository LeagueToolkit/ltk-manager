/*
 * The tone and the title a health sweep's finding is announced in, shared by
 * the status bar item and the drawer it opens.
 */

export interface SweepTone {
  wash: string;
  /** The edge a washed section of the drawer draws itself with. */
  edge: string;
  /** The badge behind the glyph that names the finding. */
  chip: string;
  /**
   * The status bar cell, as the status hue's own `duotone` Button.
   *
   * Every state carries its own counterpart of the `duotone` variant it
   * overrides, or twMerge leaves the variant's accent standing.
   */
  cell: string;
  /**
   * The cell while the drawer it opened is still showing.
   *
   * It holds the pressed tint and takes the hover a step past it, so the one
   * control does not go quieter under the pointer than it sits at rest.
   */
  held: string;
}

const WARNING: SweepTone = {
  wash: "bg-warning/12",
  edge: "border-warning/35",
  chip: "text-warning-text",
  cell: "bg-warning/15 text-warning-text hover:bg-warning/25 active:bg-warning/35 border border-warning/35",
  held: "bg-warning/35 hover:bg-warning/45",
};

const DANGER: SweepTone = {
  wash: "bg-danger/12",
  edge: "border-danger/35",
  chip: "text-danger-text",
  cell: "bg-danger/15 text-danger-text hover:bg-danger/25 active:bg-danger/35 border border-danger/35",
  held: "bg-danger/35 hover:bg-danger/45",
};

/** Warning while a repair can still reach the library, danger once none can. */
export function toneOf(repairable: number): SweepTone {
  return repairable > 0 ? WARNING : DANGER;
}

/**
 * The drawer's title, which is the same in every state the drawer has.
 *
 * What varies is whether a repair can reach any of it, and the line underneath
 * is where that is said - a title that answered it too would say it twice.
 */
export const HEADLINE = "Detected issues with mods";
