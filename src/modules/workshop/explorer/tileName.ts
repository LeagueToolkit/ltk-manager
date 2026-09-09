/**
 * How a tile sets its name, and how much of one it has room for.
 *
 * The tile spans 64px to 256px, and no single type tier reads well across that:
 * the tier that suits the smallest tile is lost on the largest. So the name
 * steps up the scale with the tile, and everything the grid needs to compute a
 * row's height from that choice lives here beside it.
 */

/** Lines a name wraps to before it is cut, which is what Windows gives one. */
export const NAME_LINES = 3;

/** One tier, as the tile draws it and the grid measures it. */
export interface NameType {
  /** The tier's utility, which carries its own size and leading. */
  readonly className: string;
  /** That leading in px, which the grid multiplies into a row's height. */
  readonly line: number;
  /** Rough advance at that size, which sets the character budget. */
  readonly char: number;
}

/** The type ladder every explorer view names an item on. */
export const NAME_TIERS = {
  fine: { className: "text-fine", line: 13, char: 5.1 },
  meta: { className: "text-meta", line: 14, char: 5.6 },
  row: { className: "text-row", line: 16, char: 6.1 },
} as const satisfies Readonly<Record<string, NameType>>;

/** The widest tile each tier serves, smallest first. */
const TIERS: ReadonlyArray<readonly [number, NameType]> = [
  [96, NAME_TIERS.fine],
  [160, NAME_TIERS.meta],
];

/** The tier a tile of this width names itself in. */
export function nameTypeFor(width: number): NameType {
  for (const [upTo, type] of TIERS) {
    if (width <= upTo) return type;
  }
  return NAME_TIERS.row;
}

/** The tile's horizontal padding, which the name does not get to use. */
const NAME_INSET = 12;

/**
 * The name a tile has room for, cut in the middle where it has not.
 *
 * A game file differs from its neighbour at the end of the name, so both halves
 * are worth keeping and the cut goes between them. A longer name is cut to the
 * lines the tile reserves rather than clipped, which would drop the end that
 * tells two files apart.
 */
export function fitName(name: string, width: number, type: NameType): string {
  const perLine = Math.max(6, Math.floor((width - NAME_INSET) / type.char));
  const budget = perLine * NAME_LINES;
  if (name.length <= budget) return name;

  const head = Math.ceil((budget - 1) / 2);
  const tail = budget - 1 - head;
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}
