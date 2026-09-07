import type { CurveKey } from "./valueRows";

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
 * "The curve panel" in docs/ux/BIN_EDITOR.md. The time axis fits the curve's own first and
 * last key, because a file holds key times outside the 0 to 1 both of Riot's editors plot.
 * The value axis fits every channel at once, so the lines of a vector are read against each
 * other rather than each against itself.
 *
 * A curve of one key is a value that animates to nothing, and draws flat across the box
 * rather than as a mark in its corner.
 */
export function plotOf(keys: readonly CurveKey[], box: PlotBox): Plot | null {
  const channels = keys[0]?.values.length ?? 0;
  if (keys.length === 0 || channels === 0 || box.width <= 0 || box.height <= 0) return null;

  const times = keys.map((key) => key.time);
  const first = Math.min(...times);
  const last = Math.max(...times);
  const held = keys.flatMap((key) => key.values);
  const lowest = Math.min(...held);
  const highest = Math.max(...held);
  const room =
    highest === lowest ? Math.abs(highest) * box.margin : (highest - lowest) * box.margin;
  const low = lowest - room;
  const high = highest + room;

  const seconds = last - first;
  const span = high - low;
  const at = keys.map((key, index) => {
    if (seconds > 0) return ((key.time - first) / seconds) * box.width;
    return keys.length === 1 ? 0 : (index / (keys.length - 1)) * box.width;
  });
  const level = (value: number) =>
    span === 0 ? box.height / 2 : box.height - ((value - low) / span) * box.height;

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

/** A channel's polyline, which a single key draws flat across the box it was placed in. */
function lineOf(points: readonly PlotPoint[], width: number): string {
  const [only] = points;
  if (points.length === 1 && only !== undefined) {
    return `${round(0)},${round(only.y)} ${round(width)},${round(only.y)}`;
  }
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

function round(value: number): string {
  return value.toFixed(2);
}
