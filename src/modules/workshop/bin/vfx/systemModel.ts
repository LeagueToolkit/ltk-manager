import { DRAG_MOTION } from "./enums";
import type { EmitterModel, SystemModel, ValueCurve } from "./model";

/** A system with nothing in it, which is what an unreadable object draws as. */
export function emptySystem(entry: string | null): SystemModel {
  return { entry, name: null, emitters: [], transform: null, dragMotion: DRAG_MOTION.stepped };
}

/**
 * The two lists address the same emitters, index for index.
 *
 * A pool's `emitter` column is a position in the concatenated list, so an index means the
 * same emitter only while its list, its place in that list and its name all hold.
 */
export function addressTheSame(
  held: readonly EmitterModel[],
  next: readonly EmitterModel[],
): boolean {
  if (held.length !== next.length) return false;

  return held.every(
    (own, at) =>
      own.simple === next[at].simple &&
      own.listIndex === next[at].listIndex &&
      own.name === next[at].name,
  );
}

/** How long an emitter that never stops is scrubbed over, in seconds. */
const ENDLESS_SPAN = 5;

/** The narrowest and widest window a scrub spans, in seconds. */
const SPAN_RANGE = { least: 1, most: 60 };

/**
 * How long the system takes to play out, which is the window the scrub spans.
 *
 * An emitter with no `lifetime` emits for as long as the system is alive, so it
 * contributes a fixed window rather than an unbounded one.
 */
export function systemSpan(system: SystemModel): number {
  let span = SPAN_RANGE.least;
  for (const emitter of system.emitters) {
    if (emitter.disabled) continue;
    const emitting = emitter.lifetime ?? ENDLESS_SPAN;
    span = Math.max(
      span,
      emitter.timeBeforeFirstEmission + emitting + peak(emitter.particleLifetime),
    );
  }
  return Math.min(span, SPAN_RANGE.most);
}

/**
 * How long the last particle plays on after the system is stopped, in seconds.
 *
 * The longest linger any emitter grants, which is what a stop leaves alive, so a run that
 * ends in a stop reaches that far past it.
 */
export function lingerTail(system: SystemModel): number {
  let tail = 0;
  for (const emitter of system.emitters) {
    if (!emitter.disabled) tail = Math.max(tail, lingerSeconds(emitter));
  }
  return tail;
}

/** The seconds the engine caps a linger at, past the particle lifetime it adds them to. */
const LINGER_GRACE = 10;

/**
 * How long a finished emitter's particles are given, which is `particleLinger` capped.
 *
 * A complex emitter caps at the particle lifetime plus ten seconds and a simple one at
 * ten. The cap is also what an unset sentinel resolves to.
 */
export function lingerSeconds(emitter: EmitterModel): number {
  const lifetime = emitter.simple ? 0 : (emitter.particleLifetime.constant[0] ?? 0);
  return Math.min(lifetime + LINGER_GRACE, Math.max(emitter.particleLinger, 0));
}

/** The largest value a curve reaches, over its constant and every key of it. */
export function peak(value: ValueCurve): number {
  let most = Math.max(...value.constant, 0);
  for (const key of value.keys) most = Math.max(most, ...key.values);
  return most;
}

/**
 * What `rotation0` is multiplied by, being authored per `1 / 60` second.
 *
 * `rotation0` alone. The UV rates are the same value classes and carry no scale, and
 * nothing else in the engine reads this constant.
 */
export const ROTATION_RATE = 60;
