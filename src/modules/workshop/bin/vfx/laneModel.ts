import type { LoopRange } from "../../state";
import { type ChildBirth, childPath } from "./children";
import { compareDrawOrder } from "./drawKind";
import type { EmitterModel, SystemModel } from "./model";
import { lingerSeconds, peak, systemSpan } from "./systemModel";

/** What one lane's bar spans, in seconds of the run's phase, "The timeline" in docs/ux/BIN_EDITOR.md. */
export interface LaneBar {
  /** Where the emission window opens. */
  readonly start: number;
  /** Where the emission window closes, and null for an emitter that never stops. */
  readonly end: number | null;
  /** Seconds past the window the longest particle lives, the peak of `particleLifetime`. */
  readonly tail: number;
  /** Seconds past the tail the linger grants. */
  readonly linger: number;
}

/** The bar of one emitter. */
export function laneBar(emitter: EmitterModel): LaneBar {
  const start = emitter.timeBeforeFirstEmission;
  return {
    start,
    end: emitter.lifetime === null ? null : start + emitter.lifetime,
    tail: peak(emitter.particleLifetime),
    linger: lingerSeconds(emitter),
  };
}

/** The emitters in the order the lanes list them, which is the engine's draw order. */
export function laneOrder(system: SystemModel): readonly EmitterModel[] {
  return [...system.emitters].sort(compareDrawOrder);
}

/** The emitters whose name holds `filter`, case-insensitively, and every emitter for none. */
export function matchingLanes(
  emitters: readonly EmitterModel[],
  filter: string,
): readonly EmitterModel[] {
  const wanted = filter.trim().toLowerCase();
  if (wanted === "") return emitters;
  return emitters.filter((emitter) => emitter.name.toLowerCase().includes(wanted));
}

/** `held` with every lane of `lanes` in it where `member`, and out of it where not. */
export function painted(
  held: ReadonlySet<number>,
  lanes: readonly number[],
  member: boolean,
): ReadonlySet<number> {
  const next = new Set(held);
  for (const lane of lanes) {
    if (member) next.add(lane);
    else next.delete(lane);
  }
  return next;
}

/** The lanes of `order` from `from` to `to`, both included, or `to` alone where `from` is gone. */
export function laneSpan(order: readonly number[], from: number, to: number): number[] {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** The hidden set that shows `lane` alone, or none where it already stands alone. */
export function shownAlone(
  held: ReadonlySet<number>,
  lane: number,
  every: readonly number[],
): ReadonlySet<number> {
  const others = every.filter((each) => each !== lane);
  const alone = !held.has(lane) && others.every((each) => held.has(each));
  return alone ? new Set() : new Set(others);
}

/** The solo set of `lane` alone, or none where it is already soloed alone. */
export function soloAlone(held: ReadonlySet<number>, lane: number): ReadonlySet<number> {
  return held.size === 1 && held.has(lane) ? new Set() : new Set([lane]);
}

/** The seconds the ruler spans, from `from` at its left edge to `to` at its right. */
export interface TimeWindow {
  readonly from: number;
  readonly to: number;
}

/** The narrowest window a zoom reaches, in seconds. */
const LEAST_WINDOW = 0.25;

/** How far past the run's span the window reaches, so an endless bar has an edge to run to. */
const PAST_SPAN = 1.05;

/** The window fitted to one run, which is what the timeline opens on. */
export function fitted(span: number): TimeWindow {
  return { from: 0, to: Math.max(span * PAST_SPAN, LEAST_WINDOW) };
}

/** `window` scaled by `factor` about `at`, held inside the run's reach. */
export function zoomed(window: TimeWindow, at: number, factor: number, span: number): TimeWindow {
  const limit = fitted(span).to;
  const held = window.to - window.from;
  const width = Math.min(Math.max(held * factor, LEAST_WINDOW), limit);
  const from = at - (at - window.from) * (width / held);
  return { from: clamp(from, 0, limit - width), to: clamp(from, 0, limit - width) + width };
}

/** `window` moved by `seconds`, held inside the run's reach. */
export function panned(window: TimeWindow, seconds: number, span: number): TimeWindow {
  const limit = fitted(span).to;
  const width = window.to - window.from;
  const from = clamp(window.from + seconds, 0, Math.max(limit - width, 0));
  return { from, to: from + width };
}

/** The steps a ruler ticks at, in seconds. */
const TICK_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];

/** Seconds between ticks: the finest round step at least `least` pixels apart over `width`. */
export function tickStep(window: TimeWindow, width: number, least = 56): number {
  const perPixel = (window.to - window.from) / Math.max(width, 1);
  return TICK_STEPS.find((step) => step / perPixel >= least) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

/** Every tick of `window`, from the first round step inside it. */
export function ticks(window: TimeWindow, width: number): readonly number[] {
  const step = tickStep(window, width);
  const out: number[] = [];
  for (let at = Math.ceil(window.from / step) * step; at <= window.to + 1e-9; at += step) {
    out.push(Number(at.toFixed(6)));
  }
  return out;
}

/** How many pieces a labelled step is cut into by its minor ticks, a second into quarters. */
const MINOR_CUTS: ReadonlyMap<number, number> = new Map([
  [1, 4],
  [2, 4],
  [15, 3],
  [30, 3],
  [60, 4],
]);

/** Every unlabelled tick between the labelled ones of `window`. */
export function minorTicks(window: TimeWindow, width: number): readonly number[] {
  const step = tickStep(window, width);
  const minor = step / (MINOR_CUTS.get(step) ?? 5);
  const out: number[] = [];
  for (let at = Math.ceil(window.from / minor); at * minor <= window.to + 1e-9; at += 1) {
    const time = Number((at * minor).toFixed(6));
    if (Math.abs(time / step - Math.round(time / step)) > 1e-6) out.push(time);
  }
  return out;
}

/** Where `time` falls across `width` pixels of `window`. */
export function xOf(window: TimeWindow, width: number, time: number): number {
  return ((time - window.from) / (window.to - window.from)) * width;
}

/** The time `x` pixels into `width` pixels of `window` stands at. */
export function timeAt(window: TimeWindow, width: number, x: number): number {
  return window.from + (x / Math.max(width, 1)) * (window.to - window.from);
}

/** What a press on the ruler holds: the loop's in, its out, the band between, or open ruler. */
export type LoopGrip = "in" | "out" | "band" | "ruler";

/** How near an edge of the loop a press grips it, in pixels, which is half its handle's width. */
export const LOOP_GRIP = 4;

/** The shortest loop an edge drags to, one frame at 60 Hz. */
const LEAST_LOOP = 1 / 60;

/** What a press `x` pixels into `width` pixels of `window` grips of `loop`. */
export function gripAt(
  loop: LoopRange | null,
  window: TimeWindow,
  width: number,
  x: number,
): LoopGrip {
  if (loop === null) return "ruler";
  const from = xOf(window, width, loop.from);
  const to = xOf(window, width, loop.to);
  const nearIn = Math.abs(x - from);
  const nearOut = Math.abs(x - to);
  if (Math.min(nearIn, nearOut) <= LOOP_GRIP) return nearOut < nearIn ? "out" : "in";
  if (x > from && x < to) return "band";
  return "ruler";
}

/** `held` with the part `grip` names moved by `moved` seconds, inside `0` to `span`. */
export function draggedLoop(
  grip: Exclude<LoopGrip, "ruler">,
  held: LoopRange,
  moved: number,
  span: number,
): LoopRange {
  if (grip === "in")
    return { from: clamp(held.from + moved, 0, held.to - LEAST_LOOP), to: held.to };
  if (grip === "out") {
    return { from: held.from, to: clamp(held.to + moved, held.from + LEAST_LOOP, span) };
  }
  const width = held.to - held.from;
  const from = clamp(held.from + moved, 0, span - width);
  return { from, to: from + width };
}

/** One child definition's emitter, nested under the emitter whose particles carry it. */
export interface ChildLane {
  /** The child definition's path under the opened system, `3.0` for the first child of emitter 3. */
  readonly path: string;
  readonly slot: number;
  readonly system: SystemModel;
  readonly emitter: EmitterModel;
}

/** The lanes nested under `parent`: one per emitter of each child its set names. */
export function childLanes(parent: EmitterModel): readonly ChildLane[] {
  const set = parent.childSet;
  if (set === null) return [];
  return set.children.flatMap((child, slot) => {
    if (child === null) return [];
    const path = childPath("", parent.index, slot);
    return child.emitters.map((emitter) => ({ path, slot, system: child, emitter }));
  });
}

/** How many spawns one child lane draws bars for, past which the rest go undrawn. */
const MOST_CHILD_BARS = 200;

/**
 * The bars a child lane draws: one per spawn this pass, each the child emitter's own bar
 * stood at the spawn.
 *
 * `passStart` is the driver's clock at the pass's opening, which turns a spawn's `bornAt`
 * into the run's phase. An emitter that never stops runs to the end of the child system's
 * span.
 */
export function childBars(
  births: readonly ChildBirth[],
  lane: ChildLane,
  passStart: number,
): readonly LaneBar[] {
  const bar = laneBar(lane.emitter);
  const span = systemSpan(lane.system);
  const out: LaneBar[] = [];
  for (const birth of births) {
    if (birth.path !== lane.path) continue;
    const at = birth.bornAt - passStart;
    out.push({
      ...bar,
      start: at + bar.start,
      end: bar.end === null ? at + span : at + bar.end,
    });
    if (out.length >= MOST_CHILD_BARS) break;
  }
  return out;
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), Math.max(most, least));
}
