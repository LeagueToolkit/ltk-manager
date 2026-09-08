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

/** One `VfxProbabilityTableData` per channel of the family, each slot a nullable pointer. */
const TABLES = nameHash("probabilityTables");

/** A table's own two lists, and the one value it holds instead of them. */
const KEY_TIMES = nameHash("keyTimes");
const KEY_VALUES = nameHash("keyValues");
const SINGLE = nameHash("singleValue");

/** What a table with no keys is worth, which the schema writes as the field's default. */
const SINGLE_DEFAULT = 1;

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

/** One key of a curve: when it lands, and what each channel is worth there. */
export interface CurveKey {
  readonly time: number;
  /** One per channel: one for a scalar, two or three for a vector, four for a colour. */
  readonly values: readonly number[];
}

/**
 * One channel's probability table, as the file holds it.
 *
 * What the game samples from one is not documented anywhere the reversing covers, so a
 * surface draws the lists and claims nothing about them.
 */
export interface ProbabilityTable {
  /** Which channel of the family the slot belongs to, in the list's own order. */
  readonly channel: number;
  /** The table's `singleValue`, which is what it is worth where it holds no keys. */
  readonly single: number;
  /** The table's own keys, one value each. Empty where it holds only `singleValue`. */
  readonly keys: readonly CurveKey[];
}

/**
 * What a surface reads a curve for.
 *
 * A colour band is the keys of a colour and of nothing else, which is what every surface
 * drawing a row already pays for. A sparkline is every family's keys, two more read levels
 * that only a surface drawing a handful of rows at a time can afford. The dock reads one
 * row at a time, so it can afford the probability tables' three levels on top.
 */
export type CurveRead = "bands" | "sparklines" | "dock";

/** What a value-family row draws after its class, as far as the read has answered. */
export interface ValueMark {
  readonly family: ValueFamily;
  /** The row's `constantValue`. Null until the first level answers. */
  readonly constant: BinValue | null;
  /** The curve's keys, in its own order. Empty until the read asks for them. */
  readonly keys: readonly CurveKey[];
  /** The curve's probability tables, which only a dock read asks for. */
  readonly tables: readonly ProbabilityTable[];
  /** The row's `dynamics` points at a curve, so the constant is not the whole value. */
  readonly curve: boolean;
}

const NO_KEYS: readonly CurveKey[] = [];
const NO_PAGES: ReadonlyMap<string, BinRows> = new Map();

/** The first level: every family row in view, whose children are its constant and its curve. */
export function constantRequests(rows: readonly BinRow[]): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const row of rows) {
    if (row.value.type !== "struct" || !FAMILY.has(row.value.classHash)) continue;
    wanted.push({ key: rowKey(row), rows: row.value.len });
  }
  return wanted;
}

/** The second level: the curve of every row whose first level answered one and `read` wants. */
export function dynamicsRequests(
  rows: readonly BinRow[],
  constants: ReadonlyMap<string, BinRows>,
  read: CurveRead,
): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const row of rows) {
    const family = valueFamily(row.value);
    if (family === null) continue;
    if (read === "bands" && family !== "color") continue;
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

/** The fourth level: the table list of every curve, which a dock read alone asks for. */
export function tableRequests(
  dynamics: ReadonlyMap<string, BinRows>,
  read: CurveRead,
): ReadRequest[] {
  if (read !== "dock") return [];
  const wanted: ReadRequest[] = [];
  for (const page of dynamics.values()) {
    const list = under(page, TABLES);
    if (list?.value.type !== "container" || list.value.len === 0) continue;
    wanted.push({ key: `${list.entry}:${list.path}`, rows: list.value.len });
  }
  return wanted;
}

/** The fifth level: each table the slots point at. A null slot is a channel with none. */
export function tableFieldRequests(tables: ReadonlyMap<string, BinRows>): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const page of tables.values()) {
    for (const slot of page.rows) {
      if (slot.value.type !== "struct" || slot.value.len === 0) continue;
      wanted.push({ key: `${slot.entry}:${slot.path}`, rows: slot.value.len });
    }
  }
  return wanted;
}

/** The sixth level: the two lists of every table the level above answered for. */
export function tableKeyRequests(fields: ReadonlyMap<string, BinRows>): ReadRequest[] {
  const wanted: ReadRequest[] = [];
  for (const page of fields.values()) {
    for (const field of [KEY_TIMES, KEY_VALUES]) {
      const list = under(page, field);
      if (list?.value.type !== "container" || list.value.len === 0) continue;
      wanted.push({ key: `${list.entry}:${list.path}`, rows: list.value.len });
    }
  }
  return wanted;
}

/**
 * What every level of the projected read answered, by the key each page sits under.
 *
 * The last three are a dock read's alone, so a caller that asked for bands or sparklines
 * leaves them out and every row it drew reads its tables as empty.
 */
export interface CurvePages {
  readonly constants: ReadonlyMap<string, BinRows>;
  readonly dynamics: ReadonlyMap<string, BinRows>;
  readonly stops: ReadonlyMap<string, BinRows>;
  readonly tables?: ReadonlyMap<string, BinRows>;
  readonly tableFields?: ReadonlyMap<string, BinRows>;
  readonly tableKeys?: ReadonlyMap<string, BinRows>;
}

/** What every family row in `rows` draws, out of the levels the read answered. */
export function valueMarks(
  rows: readonly BinRow[],
  pages: CurvePages,
): ReadonlyMap<string, ValueMark> {
  const marks = new Map<string, ValueMark>();
  for (const row of rows) {
    const family = valueFamily(row.value);
    if (family === null) continue;
    const key = rowKey(row);
    const page = pages.constants.get(key);
    const curve = under(page, DYNAMICS);
    const curvePage =
      curve === null ? undefined : pages.dynamics.get(`${curve.entry}:${curve.path}`);
    marks.set(key, {
      family,
      constant: under(page, CONSTANT)?.value ?? null,
      keys: curveKeys(curvePage, pages.stops),
      tables: probabilityTables(curvePage, pages),
      curve: curve?.value.type === "struct",
    });
  }
  return marks;
}

/** The row `page` holds under `field`, or null where it holds none. */
function under(page: BinRows | undefined, field: string): BinRow | null {
  return page?.rows.find((row) => fieldHash(row.path) === field) ?? null;
}

/** The rows of the list `page` holds under `field`, as the level below answered them. */
function listRows(
  page: BinRows | undefined,
  field: string,
  answered: ReadonlyMap<string, BinRows>,
): readonly BinRow[] {
  const row = under(page, field);
  if (row === null) return [];
  return answered.get(`${row.entry}:${row.path}`)?.rows ?? [];
}

/**
 * The keys of the curve `curvePage` holds.
 *
 * The two lists are written in step, so a key is one index of each, and a list longer
 * than the other contributes nothing past where they agree.
 */
function curveKeys(
  curvePage: BinRows | undefined,
  stops: ReadonlyMap<string, BinRows>,
): CurveKey[] {
  const times = listRows(curvePage, TIMES, stops);
  const values = listRows(curvePage, VALUES, stops);

  const out: CurveKey[] = [];
  for (let at = 0; at < Math.min(times.length, values.length); at += 1) {
    const time = times[at]?.value;
    const held = components(values[at]?.value);
    if (time?.type !== "float" || time.value === null || held === null) continue;
    out.push({ time: time.value, values: held });
  }
  return out;
}

/**
 * The probability table of every channel the curve writes one for.
 *
 * The list carries one slot per channel and the slots are nullable, so a channel is the
 * slot's own index and a null one contributes no table rather than shifting the rest.
 */
function probabilityTables(curvePage: BinRows | undefined, pages: CurvePages): ProbabilityTable[] {
  const list = under(curvePage, TABLES);
  if (list === null) return [];
  const slots = (pages.tables ?? NO_PAGES).get(`${list.entry}:${list.path}`)?.rows ?? [];

  const out: ProbabilityTable[] = [];
  for (const [channel, slot] of slots.entries()) {
    if (slot.value.type !== "struct") continue;
    const fields = (pages.tableFields ?? NO_PAGES).get(`${slot.entry}:${slot.path}`);
    const single = under(fields, SINGLE)?.value;
    out.push({
      channel,
      single: single?.type === "float" ? (single.value ?? SINGLE_DEFAULT) : SINGLE_DEFAULT,
      keys: tableKeys(fields, pages.tableKeys ?? NO_PAGES),
    });
  }
  return out;
}

/** One table's keys, which are one float against one time rather than a channel set. */
function tableKeys(
  fields: BinRows | undefined,
  answered: ReadonlyMap<string, BinRows>,
): CurveKey[] {
  const times = listRows(fields, KEY_TIMES, answered);
  const values = listRows(fields, KEY_VALUES, answered);

  const out: CurveKey[] = [];
  for (let at = 0; at < Math.min(times.length, values.length); at += 1) {
    const time = times[at]?.value;
    const held = values[at]?.value;
    if (time?.type !== "float" || time.value === null) continue;
    if (held?.type !== "float" || held.value === null) continue;
    out.push({ time: time.value, values: [held.value] });
  }
  return out;
}

/** A key's value as its channels, or null for one JSON could not carry whole. */
function components(value: BinValue | undefined): number[] | null {
  if (value?.type === "float") return value.value === null ? null : [value.value];
  if (value?.type !== "vector") return null;
  const held = value.values.filter((component) => component !== null);
  return held.length === value.values.length ? held : null;
}

/** The keys of a colour as the stops its band paints, which is four channels each. */
export function colorStops(keys: readonly CurveKey[]): ColorStop[] {
  const out: ColorStop[] = [];
  for (const key of keys) {
    const [r, g, b, a] = key.values;
    if (r === undefined || g === undefined || b === undefined || a === undefined) continue;
    out.push({ time: key.time, rgba: [r, g, b, a] });
  }
  return out;
}

/** The keys a row draws as a sparkline, which a colour has none of because its band draws them. */
export function sparkKeys(mark: ValueMark | undefined): readonly CurveKey[] {
  if (mark === undefined || mark.family === "color") return NO_KEYS;
  return mark.keys;
}

/** The window a curve is drawn over, in the shares of a particle's life its times are. */
export interface TimeSpan {
  readonly first: number;
  readonly last: number;
}

/** The particle's own life, which a curve with no key outside it is read against. */
const LIFE: TimeSpan = { first: 0, last: 1 };

/**
 * The window `times` are drawn over: the particle's life, widened to hold every key.
 *
 * A key time is a share of that life, so 0 to 1 is the reading a modder wants and a
 * ramp keyed over the middle of it has to look like one. A file holds times outside
 * that range, and those widen the window rather than being clipped out of it.
 */
export function timeSpan(times: readonly number[]): TimeSpan {
  if (times.length === 0) return LIFE;
  return { first: Math.min(LIFE.first, ...times), last: Math.max(LIFE.last, ...times) };
}

/** Where `time` lands in `span`, as a share of it from 0 to 1. */
export function placeTime(time: number, span: TimeSpan): number {
  const width = span.last - span.first;
  return width === 0 ? 0 : (time - span.first) / width;
}

/**
 * A `vec4` as its four channels, or null for any other value.
 *
 * A component is null where the float is one JSON does not carry, and a colour missing
 * a channel is one nothing can paint.
 */
export function channels(value: BinValue | null | undefined): ColorStop["rgba"] | null {
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
 * The stops as a CSS gradient, each at its own time in the window they span.
 *
 * The outermost colours hold flat to the ends of the window, which is the value the
 * engine samples outside the keyed range. A curve whose stops share one time draws the
 * last of them.
 */
export function gradientCss(stops: readonly ColorStop[]): string {
  const [only] = stops;
  if (only === undefined) return "";
  if (stops.length === 1) {
    const css = colorCss(only.rgba);
    return `linear-gradient(to right, ${css}, ${css})`;
  }

  const span = timeSpan(stops.map((stop) => stop.time));
  const placed = stops.map((stop) => {
    const at = placeTime(stop.time, span) * 100;
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
