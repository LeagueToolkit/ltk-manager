import { nameHash } from "./binHash";
import type { ColorStop, ProbabilityTable, ValueFamily, ValueMark, ValueRange } from "./valueRows";
import { tableValue } from "./vfx/sampleCurve";

/** The widest gap between two key times that still reads as one step, in chance. */
const STEP_WIDTH = 0.01;

/** How near 0 or 1 a key time sits to count as on it, the engine's own edge tolerance. */
const EDGE = 1e-6;

/** The even shares of the chance a drag on a lane is searched over. */
const CHANCE_STEPS = 1000;

/** Significant digits a bound keeps, past which a product of two `f32`s reads as noise. */
const BOUND_DIGITS = 6;

/**
 * What one channel's table does to a birth. "The random spread" in docs/ux/BIN_EDITOR.md.
 *
 * `fixed` multiplies by 1, `always` by one other number, and the next three are the random
 * ones. `dead` is random over a base of 0, and `broken` is a set the engine cannot read.
 */
export type DrawShape = "fixed" | "always" | "uniform" | "split" | "custom" | "dead" | "broken";

/** One channel of a random value, as its lane or its readout row reads it. */
export interface ChannelDraw {
  readonly channel: number;
  readonly shape: DrawShape;
  /** The channel's table, null for a slot the file leaves null. */
  readonly table: ProbabilityTable | null;
  /** What the channel is worth before the draw, null where it animates. */
  readonly base: number | null;
  /** The ranges the table multiplies by: two for a split, one otherwise. */
  readonly factors: readonly ValueRange[];
  /** The same ranges times the base, null where the base animates. */
  readonly results: readonly ValueRange[] | null;
}

/** Every channel of a value that carries probability tables. */
export interface RandomDraw {
  readonly family: ValueFamily;
  readonly channels: readonly ChannelDraw[];
  /** A slot is null beside a table, or a table's lists disagree. */
  readonly broken: boolean;
}

const RANDOM: ReadonlySet<DrawShape> = new Set(["uniform", "split", "custom"]);

/** The channel's draw varies from particle to particle. */
export function isRandom(shape: DrawShape): boolean {
  return RANDOM.has(shape);
}

/**
 * The draw of every channel of `mark`, or null for a value with no tables or none read yet.
 *
 * A set is whole or absent, so a null slot beside a table is a channel the engine
 * dereferences and crashes on.
 */
export function randomDraw(mark: ValueMark | undefined): RandomDraw | null {
  if (mark?.slots === undefined || mark.tables.length === 0) return null;
  const channels = Array.from({ length: channelWidth(mark) }, (_, channel) =>
    channelDraw(mark, channel),
  );
  return {
    family: mark.family,
    channels,
    broken: channels.some((each) => each.shape === "broken"),
  };
}

function channelDraw(mark: ValueMark, channel: number): ChannelDraw {
  const table = mark.tables.find((each) => each.channel === channel) ?? null;
  const base = channelBase(mark, channel);
  if (table === null || table.mismatched === true) {
    return { channel, shape: "broken", table, base, factors: [], results: null };
  }

  const shape = tableShape(table);
  const factors = factorRanges(table, shape);
  return {
    channel,
    shape: base === 0 && shape !== "fixed" ? "dead" : shape,
    table,
    base,
    factors,
    results: base === null ? null : factors.map((range) => scaled(range, base)),
  };
}

/** How many channels the value holds, off its constant, its keys or its tables. */
function channelWidth(mark: ValueMark): number {
  if (mark.family === "scalar") return 1;
  const constant = mark.constant?.type === "vector" ? mark.constant.values.length : 0;
  const keyed = mark.keys[0]?.values.length ?? 0;
  const tabled = Math.max(...mark.tables.map((each) => each.channel + 1));
  return Math.max(constant, keyed) || tabled;
}

/** What `channel` is worth before the draw: its keys where they hold one level, else the constant. */
function channelBase(mark: ValueMark, channel: number): number | null {
  if (mark.keys.length > 0) {
    const levels = mark.keys.map((key) => key.values[channel]);
    const [first] = levels;
    if (first === undefined || levels.some((level) => level !== first)) return null;
    return first;
  }
  const constant = mark.constant;
  if (constant?.type === "float") return channel === 0 ? constant.value : null;
  if (constant?.type === "vector") return constant.values[channel] ?? null;
  return null;
}

/** Which shape one table draws, before the base it multiplies is known. */
export function tableShape(table: ProbabilityTable): Exclude<DrawShape, "dead" | "broken"> {
  const { keys } = table;
  const levels = keys.map((key) => key.values[0] ?? table.single);
  const [first = table.single] = levels;
  if (levels.every((level) => level === first)) return first === 1 ? "fixed" : "always";

  const [low, high] = keys;
  if (keys.length === 2 && Math.abs(low.time) <= EDGE && Math.abs(high.time - 1) <= EDGE) {
    return "uniform";
  }
  return stepAt(table) === null ? "custom" : "split";
}

/**
 * The index of the key a split steps up to, or null for a table that is not a split.
 *
 * A split is one jump of `STEP_WIDTH` or less inside the chance, which is how the files
 * write a random sign with a gap around 0.
 */
function stepAt(table: ProbabilityTable): number | null {
  const { keys } = table;
  const steps: number[] = [];
  for (let at = 1; at < keys.length; at += 1) {
    const before = keys[at - 1];
    const after = keys[at];
    const width = after.time - before.time;
    if (width < 0 || width > STEP_WIDTH || before.time <= 0 || after.time >= 1) continue;
    if (before.values[0] !== after.values[0]) steps.push(at);
  }
  return steps.length === 1 ? steps[0] : null;
}

function factorRanges(table: ProbabilityTable, shape: DrawShape): ValueRange[] {
  const step = shape === "split" ? stepAt(table) : null;
  if (step === null) return [reachOver(table, 0, 1)];
  return [
    reachOver(table, 0, table.keys[step - 1].time),
    reachOver(table, table.keys[step].time, 1),
  ];
}

/** The least and the most `table` is worth over draws from `from` to `to`, flat past its keys. */
function reachOver(table: ProbabilityTable, from: number, to: number): ValueRange {
  const inner = table.keys.filter((key) => key.time > from && key.time < to);
  const worth = [
    tableValue(table, from),
    tableValue(table, to),
    ...inner.map((key) => key.values[0] ?? table.single),
  ];
  return { least: bound(Math.min(...worth)), most: bound(Math.max(...worth)) };
}

/** `range` times `base`, which a negative base turns over. */
function scaled(range: ValueRange, base: number): ValueRange {
  const reach = spread(base, range);
  return { least: bound(reach.least), most: bound(reach.most) };
}

function bound(value: number): number {
  return Number(value.toPrecision(BOUND_DIGITS));
}

/** What a row's chip says of a value's draw. */
export type DrawSummary =
  | { readonly kind: "broken" }
  | { readonly kind: "one"; readonly draw: ChannelDraw }
  | { readonly kind: "linked"; readonly channels: readonly number[]; readonly draw: ChannelDraw }
  | { readonly kind: "several"; readonly count: number };

/**
 * The one line a row carries for `draw`, or null where nothing in it is random.
 *
 * Channels drawing one table over one base are linked, which is how a uniform scale is
 * written, and are named together rather than counted.
 */
export function drawSummary(draw: RandomDraw): DrawSummary | null {
  if (draw.broken) return { kind: "broken" };
  const random = draw.channels.filter((each) => isRandom(each.shape));
  const [first] = random;
  if (first === undefined) return null;
  if (random.length === 1) return { kind: "one", draw: first };
  if (random.every((each) => sameDraw(each, first))) {
    return { kind: "linked", channels: random.map((each) => each.channel), draw: first };
  }
  return { kind: "several", count: random.length };
}

function sameDraw(a: ChannelDraw, b: ChannelDraw): boolean {
  if (a.base !== b.base || a.table === null || b.table === null) return false;
  if (a.table.single !== b.table.single || a.table.keys.length !== b.table.keys.length) {
    return false;
  }
  return a.table.keys.every((key, at) => {
    const other = b.table?.keys[at];
    return other !== undefined && key.time === other.time && key.values[0] === other.values[0];
  });
}

/** The span a channel's draws land in: its results where the base holds still, else its factors. */
export function drawSpan(channel: ChannelDraw): ValueRange | null {
  const ranges = channel.results ?? channel.factors;
  if (ranges.length === 0) return null;
  return {
    least: Math.min(...ranges.map((range) => range.least)),
    most: Math.max(...ranges.map((range) => range.most)),
  };
}

/**
 * How often each of `bins` even shares of `domain` is drawn, when the table multiplies `level`.
 *
 * Solved rather than counted: a table is linear between its keys, so each stretch of the
 * chance spreads its share evenly over the values it runs through, and a flat stretch lands
 * whole in one bin as the spike it is. The fullest bin reads 1.
 */
export function valueDensity(
  channel: ChannelDraw,
  level: number,
  domain: ValueRange,
  bins: number,
): number[] {
  const mass = new Array<number>(bins).fill(0);
  const width = (domain.most - domain.least) / bins;
  const { table } = channel;
  if (table === null || bins === 0 || width <= 0) return mass;

  const binOf = (value: number) =>
    Math.min(Math.max(Math.floor((value - domain.least) / width), 0), bins - 1);
  for (const [from, to] of stretches(table)) {
    const share = to.chance - from.chance;
    const ends = [from.factor * level, to.factor * level];
    const low = Math.min(...ends);
    const high = Math.max(...ends);
    if (high - low <= 0) {
      mass[binOf(low)] += share;
      continue;
    }
    for (let bin = binOf(low); bin <= binOf(high); bin += 1) {
      const start = domain.least + bin * width;
      const covered = Math.min(high, start + width) - Math.max(low, start);
      if (covered > 0) mass[bin] += (share * covered) / (high - low);
    }
  }
  const most = Math.max(...mass);
  return mass.map((each) => (most === 0 ? 0 : each / most));
}

/** One point of a table: a chance and the factor it reads there. */
interface ChancePoint {
  readonly chance: number;
  readonly factor: number;
}

/** The table's linear stretches over the chance, 0 to 1, a key outside it cut off. */
function stretches(table: ProbabilityTable): [ChancePoint, ChancePoint][] {
  const chances = [
    0,
    ...table.keys.map((key) => key.time).filter((time) => time > 0 && time < 1),
    1,
  ];
  const points = chances.map((chance) => ({ chance, factor: tableValue(table, chance) }));
  return points.slice(1).map((to, at) => [points[at], to]);
}

/** The chance at which the channel draws nearest `value`, which a drag on its lane asks for. */
export function chanceNear(channel: ChannelDraw, value: number): number {
  let best = 0;
  let nearest = Infinity;
  for (let step = 0; step <= CHANCE_STEPS; step += 1) {
    const chance = step / CHANCE_STEPS;
    const off = Math.abs(drawAt(channel, chance) - value);
    if (off < nearest) {
      nearest = off;
      best = chance;
    }
  }
  return best;
}

/** The values a split never draws, between its two ranges, or null for a draw with no gap. */
export function drawGap(channel: ChannelDraw): ValueRange | null {
  const ranges = [...(channel.results ?? channel.factors)].sort((a, b) => a.least - b.least);
  const [first, second] = ranges;
  if (first === undefined || second === undefined || second.least <= first.most) return null;
  return { least: first.most, most: second.least };
}

/** Something in the draw is worth a spread: a random channel, or a set the game cannot read. */
export function drawsSpread(draw: RandomDraw | null): draw is RandomDraw {
  return (
    draw !== null && draw.channels.some((each) => isRandom(each.shape) || each.shape === "broken")
  );
}

/** Every channel's base holds still, so the draw reads as lanes rather than over time. */
export function drawsFlat(draw: RandomDraw): boolean {
  return draw.channels.every((each) => each.base !== null);
}

/** What the channel draws at `chance`: the result where the base holds still, else the factor. */
export function drawAt(channel: ChannelDraw, chance: number): number {
  if (channel.table === null) return 0;
  const factor = tableValue(channel.table, chance);
  return channel.results === null ? factor : factor * (channel.base ?? 1);
}

/** What the channel's table multiplies by at `chance`, and 1 for a slot holding none. */
export function factorAt(channel: ChannelDraw | undefined, chance: number): number {
  if (channel?.table == null) return 1;
  return tableValue(channel.table, chance);
}

/** `value` times each end of `range`, least first, which a sign in either turns over. */
export function spread(value: number, range: ValueRange): ValueRange {
  const ends = [value * range.least, value * range.most];
  return { least: Math.min(...ends), most: Math.max(...ends) };
}

/**
 * A colour's stops as a particle rolling `chance` sees them, each channel times its table.
 *
 * One chance serves every channel, so a ramp at one chance is a particle the effect can
 * really draw, where each channel at its own least would not be.
 */
export function stopsAt(
  stops: readonly ColorStop[],
  draw: RandomDraw,
  chance: number,
): ColorStop[] {
  return stops.map((stop) => {
    const [r, g, b, a] = stop.rgba.map(
      (level, channel) => level * factorAt(draw.channels[channel], chance),
    );
    return { time: stop.time, rgba: [r ?? 0, g ?? 0, b ?? 0, a ?? 1] };
  });
}

/** A key the draw never reaches, because the chance runs from 0 to 1 and it sits outside. */
export function neverRolled(time: number): boolean {
  return time < 0 || time > 1;
}

/** The one field drawn at birth whose name does not say so. */
const LIFETIME = "particleLifetime";

/** A field of the emitter the birth draws, the one roll's reach: every `birth` field and the lifetime. */
export function drawnAtBirth(name: string): boolean {
  return name === LIFETIME || name.toLowerCase().startsWith("birth");
}

/**
 * The per-frame fields a table re-rolls every frame and every channel, by field hash.
 *
 * Only these two are attested.
 */
const REROLLED: ReadonlySet<string> = new Set([nameHash("Color"), nameHash("scale0")]);

/** A random table on `field` re-rolls every frame, so its particle flickers. */
export function rerollsEveryFrame(field: string | null): boolean {
  return field !== null && REROLLED.has(field);
}
