import { type CurveKey, placeTime, timeSpan } from "./valueRows";

/** The box a curve is placed in, and the room it keeps over and under its own keys. */
export interface PlotBox {
  readonly width: number;
  readonly height: number;
  /** Room over and under the keys, as a share of their span. Zero fills the box. */
  readonly margin: number;
}

/** One key of one channel, placed in the box. */
export interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

/** One curve placed in a box: a line per channel, its keys, and what each axis is labelled. */
export interface Plot {
  /** One polyline per channel, in the order the value holds them. */
  readonly lines: readonly string[];
  /** The keys of each channel, for a host that marks them. */
  readonly points: readonly (readonly PlotPoint[])[];
  /** Where each key lands on the time axis, which every channel shares. */
  readonly at: readonly number[];
  readonly first: number;
  readonly last: number;
  readonly low: number;
  readonly high: number;
}

/**
 * The keys placed in `box`, or null where there is nothing to draw.
 *
 * "The curve panel" in docs/ux/BIN_EDITOR.md. The time axis is the particle's own life
 * widened to hold every key, so a curve keyed over the middle of it reads as one and a
 * file holding times outside 0 to 1 is still plotted whole. The value axis fits every
 * channel at once, so the lines of a vector are read against each other rather than each
 * against itself.
 *
 * A curve of one key is a value that animates to nothing, and draws flat across the box
 * rather than as a mark in its corner.
 */
export function plotOf(keys: readonly CurveKey[], box: PlotBox): Plot | null {
  const channels = keys[0]?.values.length ?? 0;
  if (keys.length === 0 || channels === 0 || box.width <= 0 || box.height <= 0) return null;

  const span = timeSpan(keys.map((key) => key.time));
  const { first, last } = span;
  const held = keys.flatMap((key) => key.values);
  const lowest = Math.min(...held);
  const highest = Math.max(...held);
  const room =
    highest === lowest ? Math.abs(highest) * box.margin : (highest - lowest) * box.margin;
  const low = lowest - room;
  const high = highest + room;

  const reach = high - low;
  const at = keys.map((key) => placeTime(key.time, span) * box.width);
  const level = (value: number) =>
    reach === 0 ? box.height / 2 : box.height - ((value - low) / reach) * box.height;

  const points: PlotPoint[][] = [];
  const lines: string[] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    const drawn = keys.map((key, index) => ({
      x: at[index] ?? 0,
      y: level(key.values[channel] ?? lowest),
    }));
    points.push(drawn);
    lines.push(lineOf(drawn, box.width));
  }

  return { lines, points, at, first, last, low, high };
}

/**
 * A channel's polyline, held flat from either end of the box to its outermost key.
 *
 * A value holds its end keys outside the range they span, which is what the engine samples
 * there, so a curve keyed over the middle of a life draws as a hold, a move and a hold. A
 * single key is the whole of that: it draws flat across the box.
 */
function lineOf(points: readonly PlotPoint[], width: number): string {
  const [first] = points;
  const last = points.at(-1);
  if (first === undefined || last === undefined) return "";

  const held = [
    ...(first.x > 0 ? [{ x: 0, y: first.y }] : []),
    ...points,
    ...(last.x < width ? [{ x: width, y: last.y }] : []),
  ];
  return held.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

function round(value: number): string {
  return value.toFixed(2);
}

/** An axis number, at the two decimals a key time is written with and no trailing zeros. */
export function axisText(value: number): string {
  return String(Number(value.toFixed(2)));
}
