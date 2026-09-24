import { DRAG_MOTION } from "./enums";
import type { ChildSetModel, EmitterModel, SystemModel, ValueCurve } from "./model";

/** A system with nothing in it, which is what an unreadable object draws as. */
export function emptySystem(entry: string | null): SystemModel {
  return {
    entry,
    name: null,
    emitters: [],
    transform: null,
    dragMotion: DRAG_MOTION.stepped,
    buildUpTime: 0,
  };
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

/**
 * Emitter fields only the draw reads, which leave every pool, state and checkpoint of a run
 * as it was. A field missing here counts as simulated, so a new one costs a replay rather
 * than a stale checkpoint.
 */
const DRAWN_ONLY: ReadonlySet<string> = new Set<keyof EmitterModel>([
  "alphaRef",
  "backfaceCull",
  "blendMode",
  "color",
  "colorTexture",
  "customMaterial",
  "depthBias",
  "depthPushPull",
  "distortion",
  "erosion",
  "groundLayer",
  "lookupOffsets",
  "lookupScales",
  "lookupX",
  "lookupY",
  "mesh",
  "miscRenderFlags",
  "multTexture",
  "palette",
  "pass",
  "pivotUp",
  "primitiveClass",
  "primitiveName",
  "quadType",
  "reflection",
  "scale0",
  "soft",
  "stencilMode",
  "stencilRef",
  "texture",
  "uniformScale",
  "uvMode",
]);

/**
 * The two systems run the same simulation, differing at most in what the draw reads.
 *
 * A run's checkpoints stay valid across such an edit, so a seek after it restores one
 * rather than replaying from zero. Child systems are compared by the same rule.
 */
export function simulationEquals(current: SystemModel, next: SystemModel): boolean {
  if (
    current.dragMotion !== next.dragMotion ||
    current.buildUpTime !== next.buildUpTime ||
    !deepEquals(current.transform, next.transform) ||
    !addressTheSame(current.emitters, next.emitters)
  ) {
    return false;
  }

  return current.emitters.every((emitter, at) =>
    emitterSimulationEquals(emitter, next.emitters[at]),
  );
}

function emitterSimulationEquals(current: EmitterModel, next: EmitterModel): boolean {
  const fields = new Set([...Object.keys(current), ...Object.keys(next)]);
  for (const field of fields) {
    if (DRAWN_ONLY.has(field)) continue;

    const a = current[field as keyof EmitterModel];
    const b = next[field as keyof EmitterModel];
    if (field === "childSet") {
      if (!childSetSimulationEquals(current.childSet, next.childSet)) return false;
    } else if (!deepEquals(a, b)) {
      return false;
    }
  }
  return true;
}

function childSetSimulationEquals(
  current: ChildSetModel | null,
  next: ChildSetModel | null,
): boolean {
  if (current === null || next === null) return current === next;
  if (
    current.onDeath !== next.onDeath ||
    current.children.length !== next.children.length ||
    !deepEquals(current.bones, next.bones) ||
    !deepEquals(current.probability, next.probability) ||
    !deepEquals(current.inheritance, next.inheritance)
  ) {
    return false;
  }

  return current.children.every((child, at) => {
    const other = next.children[at];
    if (child === null || other === null) return child === other;
    return simulationEquals(child, other);
  });
}

/** Structural equality over the plain values, arrays and typed arrays a model is built of. */
function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    const left = a as unknown as ArrayLike<number>;
    const right = b as unknown as ArrayLike<number>;
    if (left.length !== right.length) return false;
    for (let at = 0; at < left.length; at += 1) {
      if (!Object.is(left[at], right[at])) return false;
    }
    return true;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, at) => deepEquals(value, b[at]));
  }

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
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
 * How long the last particle plays on after a stop `stoppedAt` seconds into the run.
 *
 * The longest wait for [`stopWaitSeconds`] plus the linger any emitter grants, which is what
 * a stop leaves alive, so a run that ends in a stop reaches that far past it. The system's
 * age at the stop includes its build-up.
 */
export function lingerTail(system: SystemModel, stoppedAt: number): number {
  const age = stoppedAt + system.buildUpTime;
  let tail = 0;
  for (const emitter of system.emitters) {
    if (emitter.disabled) continue;
    const wait = Math.max(stopWaitSeconds(emitter) - age, 0);
    tail = Math.max(tail, wait + lingerSeconds(emitter));
  }
  return tail;
}

/** The seconds the engine caps a linger at, past the lifetime it adds them to. */
const LINGER_GRACE = 10;

/**
 * The system age past which a stopped emitter counts as finished, which is `emitterLinger` capped.
 *
 * A complex emitter caps at its own `lifetime` plus ten seconds, uncapped for one that never
 * stops, and a simple one at ten. The age is the system's own and not the time since the
 * stop, so a stop issued past it grants no wait at all.
 */
export function stopWaitSeconds(emitter: EmitterModel): number {
  const lifetime = emitter.simple ? 0 : (emitter.lifetime ?? Infinity);
  return Math.min(lifetime + LINGER_GRACE, Math.max(emitter.emitterLinger, 0));
}

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
