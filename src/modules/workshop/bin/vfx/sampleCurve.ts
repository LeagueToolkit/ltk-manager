import type { CurveKey, ProbabilityTable } from "../valueRows";
import type { ValueCurve } from "./model";

/**
 * What `value` is worth at `t01`: its keys where it has them, and its constant otherwise.
 *
 * `t01` is already a share of whichever lifetime drives the curve, and the caller is
 * where it is normalized and clamped, because only the caller knows the denominator.
 * A time outside the keyed range reads the nearest key flat, which is what the engine
 * draws past both ends of a curve.
 */
export function sampleCurve(value: ValueCurve, t01: number): readonly number[] {
  if (value.keys.length === 0) return value.constant;
  return keysAt(value.keys, t01);
}

/** What `keys` are worth at `t01`, one number per channel, and none for no keys. */
export function keysAt(keys: readonly CurveKey[], t01: number): number[] {
  if (keys.length === 0) return [];
  const out = new Array<number>(keys[0].values.length).fill(0);
  blendInto(keys, t01, out, 0);
  return out;
}

/**
 * `sampleCurve` written into `out` from `at`, one slot per channel the curve holds.
 *
 * A channel past the end of `out` is dropped, and a channel `out` holds that the curve
 * does not reach keeps whatever the caller left there.
 */
export function sampleCurveInto(
  value: ValueCurve,
  t01: number,
  out: Float32Array,
  at: number,
): void {
  const { keys } = value;
  if (keys.length === 0) {
    const width = Math.min(value.constant.length, out.length - at);
    for (let channel = 0; channel < width; channel += 1)
      out[at + channel] = value.constant[channel];
    return;
  }
  blendInto(keys, t01, out, at);
}

/** The keys blended at `t01`, written channel by channel from `at`. */
function blendInto(
  keys: readonly CurveKey[],
  t01: number,
  out: number[] | Float32Array,
  at: number,
): void {
  const under = lowerKey(keys, t01);
  const lo = keys[Math.max(under, 0)];
  const hi = keys[under + 1];
  const span = hi === undefined ? 0 : hi.time - lo.time;
  const into = Math.min(lo.values.length, out.length - at);

  for (let channel = 0; channel < into; channel += 1) {
    const from = lo.values[channel];
    if (hi === undefined || span <= 0) {
      out[at + channel] = from;
      continue;
    }
    const to = hi.values[channel] ?? from;
    out[at + channel] = from + (to - from) * ((t01 - lo.time) / span);
  }
}

/**
 * `sampleCurve` for a birth value: each channel's probability table at `chance`, multiplied in.
 *
 * The factor multiplies the sampled value and never replaces or adds to it, and one
 * chance serves every channel and every birth value of a particle. A table is the value
 * against the probability, so a table of `1` to `360` is a uniform angle and one key
 * alone a fixed multiplier.
 */
export function drawCurve(value: ValueCurve, t01: number, chance: number): number[] {
  const out = [...sampleCurve(value, t01)];
  for (const table of value.tables) {
    if (table.channel < out.length) out[table.channel] *= tableValue(table, chance);
  }
  return out;
}

/** `drawCurve` written into `out` from `at`, one slot per channel the curve holds. */
export function drawCurveInto(
  value: ValueCurve,
  t01: number,
  chance: number,
  out: Float32Array,
  at: number,
): void {
  const drawn = drawCurve(value, t01, chance);
  const width = Math.min(drawn.length, out.length - at);
  for (let channel = 0; channel < width; channel += 1) out[at + channel] = drawn[channel];
}

/**
 * What a table is worth at the unit draw `u`: its keys read flat past both ends.
 *
 * No keys is the single value, and otherwise the two keys around `u` are blended.
 */
export function tableValue(table: ProbabilityTable, u: number): number {
  const { keys } = table;
  if (keys.length === 0) return table.single;

  const under = lowerKey(keys, u);
  const lo = keys[Math.max(under, 0)];
  const hi = keys[under + 1];
  const from = lo.values[0] ?? table.single;
  if (hi === undefined || under < 0) return from;

  const span = hi.time - lo.time;
  const to = hi.values[0] ?? from;
  return span > 0 ? from + (to - from) * ((u - lo.time) / span) : from;
}

/** The last key at or before `t01`, and -1 where every key lands after it. */
function lowerKey(keys: readonly CurveKey[], t01: number): number {
  let under = -1;
  for (let at = 0; at < keys.length; at += 1) {
    if (keys[at].time > t01) break;
    under = at;
  }
  return under;
}
