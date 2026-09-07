import type { BinRow, BinRows, BinValue } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { fieldHash, rowKey } from "./binRows";
import type { ReadRequest } from "./useBinRead";

/** How a value class draws its constant. "A value family on its row" in docs/ux/BIN_EDITOR.md. */
export type ValueFamily = "color" | "scalar" | "vector";

/** The classes whose collapsed row draws its constant, by class hash. */
const FAMILY: ReadonlyMap<string, ValueFamily> = new Map([
  [nameHash("ValueColor"), "color" as const],
  [nameHash("ValueFloat"), "scalar" as const],
  [nameHash("ValueVector2"), "vector" as const],
  [nameHash("ValueVector3"), "vector" as const],
]);

/** The value every class of the family holds under one field hash. */
const CONSTANT = nameHash("constantValue");

/** The curve, which is a pointer and is null on a value that does not animate. */
const DYNAMICS = nameHash("dynamics");

/** The dynamics' two lists: when a stop lands, and the value there. */
const TIMES = nameHash("times");
const VALUES = nameHash("values");

/** The family a row's value belongs to, or null for every other value. */
export function valueFamily(value: BinValue): ValueFamily | null {
  if (value.type !== "struct") return null;
  return FAMILY.get(value.classHash) ?? null;
}

/** One stop of a colour's dynamics: when it lands, and the channels there, each 0 to 1. */
export interface ColorStop {
  readonly time: number;
  readonly rgba: readonly [number, number, number, number];
}

/** What a value-family row draws after its class, as far as the read has answered. */
export interface ValueMark {
  readonly family: ValueFamily;
  /** The row's `constantValue`. Null until the first level answers. */
  readonly constant: BinValue | null;
  /** A colour's stops, in the dynamics' own order. Empty where it has none. */
  readonly stops: readonly ColorStop[];
  /** The row's `dynamics` points at a curve, so the constant is not the whole value. */
  readonly curve: boolean;
}

/** The first level: every family row in view, whose children are its constant and its curve. */
export function constantRequests(rows: readonly BinRow[]): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const row of rows) {
    if (row.value.type !== "struct" || !FAMILY.has(row.value.classHash)) continue;
    wanted.push({ key: rowKey(row), rows: row.value.len });
  }
  return wanted;
}

/** The second level: the curve of every colour row whose first level answered one. */
export function dynamicsRequests(
  rows: readonly BinRow[],
  constants: ReadonlyMap<string, BinRows>,
): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const row of rows) {
    if (valueFamily(row.value) !== "color") continue;
    const curve = under(constants.get(rowKey(row)), DYNAMICS);
    if (curve?.value.type !== "struct" || curve.value.len === 0) continue;
    wanted.push({ key: `${curve.entry}:${curve.path}`, rows: curve.value.len });
  }
  return wanted;
}

/** The third level: the two lists of every curve the second level answered for. */
export function stopRequests(dynamics: ReadonlyMap<string, BinRows>): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const page of dynamics.values()) {
    for (const field of [TIMES, VALUES]) {
      const list = under(page, field);
      if (list?.value.type !== "container" || list.value.len === 0) continue;
      wanted.push({ key: `${list.entry}:${list.path}`, rows: list.value.len });
    }
  }
  return wanted;
}

/** What every family row in `rows` draws, out of the three levels the read answered. */
export function valueMarks(
  rows: readonly BinRow[],
  constants: ReadonlyMap<string, BinRows>,
  dynamics: ReadonlyMap<string, BinRows>,
  stops: ReadonlyMap<string, BinRows>,
): ReadonlyMap<string, ValueMark> {
  const marks = new Map<string, ValueMark>();
  for (const row of rows) {
    const family = valueFamily(row.value);
    if (family === null) continue;
    const key = rowKey(row);
    const page = constants.get(key);
    marks.set(key, {
      family,
      constant: under(page, CONSTANT)?.value ?? null,
      stops: family === "color" ? colorStops(page, dynamics, stops) : [],
      curve: under(page, DYNAMICS)?.value.type === "struct",
    });
  }
  return marks;
}

/** The row `page` holds under `field`, or null where it holds none. */
function under(page: BinRows | undefined, field: string): BinRow | null {
  return page?.rows.find((row) => fieldHash(row.path) === field) ?? null;
}

/** The rows of the list `page` holds under `field`, as the third level answered them. */
function list(
  page: BinRows | undefined,
  field: string,
  stops: ReadonlyMap<string, BinRows>,
): readonly BinRow[] {
  const row = under(page, field);
  if (row === null) return [];
  return stops.get(`${row.entry}:${row.path}`)?.rows ?? [];
}

/**
 * The stops of the colour whose first level is `page`.
 *
 * The two lists are written in step, so a stop is one index of each, and a list longer
 * than the other contributes nothing past where they agree.
 */
function colorStops(
  page: BinRows | undefined,
  dynamics: ReadonlyMap<string, BinRows>,
  stops: ReadonlyMap<string, BinRows>,
): ColorStop[] {
  const curve = under(page, DYNAMICS);
  if (curve === null) return [];
  const curvePage = dynamics.get(`${curve.entry}:${curve.path}`);
  const times = list(curvePage, TIMES, stops);
  const values = list(curvePage, VALUES, stops);

  const out: ColorStop[] = [];
  for (let at = 0; at < Math.min(times.length, values.length); at += 1) {
    const time = times[at]?.value;
    const rgba = channels(values[at]?.value);
    if (time?.type !== "float" || time.value === null || rgba === null) continue;
    out.push({ time: time.value, rgba });
  }
  return out;
}

/**
 * A `vec4` as its four channels, or null for any other value.
 *
 * A component is null where the float is one JSON does not carry, and a colour missing
 * a channel is one nothing can paint.
 */
export function channels(value: BinValue | undefined): ColorStop["rgba"] | null {
  if (value?.type !== "vector" || value.values.length !== 4) return null;
  const held = value.values.filter((component) => component !== null);
  if (held.length !== 4) return null;
  return [held[0] ?? 0, held[1] ?? 0, held[2] ?? 0, held[3] ?? 0];
}

/**
 * The constant a value-family row draws, as the one string Copy value takes.
 *
 * Null until the read lands, so the row offers no copy of a value it is not drawing.
 */
export function markText(mark: ValueMark | undefined): string | null {
  if (mark?.constant == null) return null;
  if (mark.family === "color") {
    const rgba = channels(mark.constant);
    return rgba === null ? null : colorHex(rgba);
  }
  if (mark.constant.type === "float") return String(mark.constant.value);
  if (mark.constant.type === "vector") return mark.constant.values.join(", ");
  return null;
}

/** A colour as Copy value takes it, the channels rounded to bytes. */
export function colorHex(rgba: ColorStop["rgba"]): string {
  return `#${rgba.map(hexByte).join("")}`;
}

/** The CSS a channel set paints with, the alpha kept as a fraction. */
export function colorCss(rgba: ColorStop["rgba"]): string {
  const [r, g, b, a] = rgba;
  return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${clamp(a)})`;
}

/**
 * The stops as a CSS gradient, each at its share of the curve's own span.
 *
 * The span rather than the times, because a curve runs over whatever seconds its
 * emitter lives and a strip of fixed width shows the shape rather than the clock. A
 * curve whose stops share one time draws the last of them.
 */
export function gradientCss(stops: readonly ColorStop[]): string {
  const [only] = stops;
  if (only === undefined) return "";
  if (stops.length === 1) {
    const css = colorCss(only.rgba);
    return `linear-gradient(to right, ${css}, ${css})`;
  }

  const times = stops.map((stop) => stop.time);
  const first = Math.min(...times);
  const span = Math.max(...times) - first;
  const placed = stops.map((stop) => {
    const at = span === 0 ? 0 : ((stop.time - first) / span) * 100;
    return `${colorCss(stop.rgba)} ${at.toFixed(2)}%`;
  });
  return `linear-gradient(to right, ${placed.join(", ")})`;
}

function hexByte(channel: number): string {
  return byte(channel).toString(16).padStart(2, "0").toUpperCase();
}

function byte(channel: number): number {
  return Math.round(clamp(channel) * 255);
}

function clamp(channel: number): number {
  return Math.min(Math.max(channel, 0), 1);
}
