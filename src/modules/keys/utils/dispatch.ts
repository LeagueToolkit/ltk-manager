import { type Chord, chordText } from "./chords";
import { guardsHold } from "./guards";
import { scopeDepth, type ScopeId } from "./scopes";
import type { CommandSpec } from "./types";

/**
 * Runs a command for a press. Returns `false` if it did not take the press, which then goes on
 * to a wider scope and keeps its default action.
 */
export type KeyHandler = (event: KeyboardEvent) => boolean | void;

/** One mounted instance of a scope: where it listens and what it answers. */
export interface ScopeEntry {
  readonly scope: ScopeId;
  /** The element that a press must come from, or null for the whole page. */
  readonly element: () => Element | null | undefined;
  readonly enabled: () => boolean;
  readonly handler: (command: string) => KeyHandler | undefined;
  /** The mount order, so the newer of two instances of one scope answers first. */
  readonly serial: number;
}

/** Returns `true` if `entry` is enabled and contains `target`. */
function reaches(entry: ScopeEntry, target: Node | null): boolean {
  if (!entry.enabled()) return false;

  const element = entry.element();
  if (element === undefined) return true;
  if (element === null || target === null) return false;

  return element.contains(target);
}

/** Returns the element of `entry`, or null for an entry of the whole page. */
function elementOf(entry: ScopeEntry): Element | null {
  return entry.element() ?? null;
}

/**
 * Orders the active entries narrowest first: the deeper scope, then the element that lies inside
 * the other, then the newer mount.
 */
function narrowestFirst(a: ScopeEntry, b: ScopeEntry): number {
  const depth = scopeDepth(b.scope) - scopeDepth(a.scope);
  if (depth !== 0) return depth;

  const aElement = elementOf(a);
  const bElement = elementOf(b);
  if (aElement !== null && bElement !== null && aElement !== bElement) {
    if (bElement.contains(aElement)) return -1;
    if (aElement.contains(bElement)) return 1;
  }

  return b.serial - a.serial;
}

/** Returns the entries that a press on `target` reaches, narrowest first. */
export function activeEntries(entries: Iterable<ScopeEntry>, target: Node | null): ScopeEntry[] {
  return [...entries].filter((entry) => reaches(entry, target)).sort(narrowestFirst);
}

/** The commands of each scope by chord, built once from the registry. */
export type ChordIndex = ReadonlyMap<ScopeId, ReadonlyMap<Chord, readonly CommandSpec[]>>;

/** Returns the commands of `commands` by scope and chord. */
export function indexChords(commands: readonly CommandSpec[]): ChordIndex {
  const index = new Map<ScopeId, Map<Chord, CommandSpec[]>>();
  for (const command of commands) {
    for (const scope of command.scopes) {
      const byChord = index.get(scope) ?? new Map<Chord, CommandSpec[]>();
      index.set(scope, byChord);
      for (const chord of command.keys) {
        byChord.set(chord, [...(byChord.get(chord) ?? []), command]);
      }
    }
  }

  return index;
}

/**
 * Runs the command that `event` reaches and returns its id, or null if no command took it.
 *
 * Walks the active entries narrowest first. The first command on the press's chord whose guards
 * hold and whose entry has a handler runs, and a handler that returns `false` passes the press
 * on. A taken press has its default action prevented.
 */
export function dispatchPress(
  event: KeyboardEvent,
  entries: Iterable<ScopeEntry>,
  index: ChordIndex,
): string | null {
  const chord = chordText(event);
  if (chord === null) return null;

  const target = event.target instanceof Node ? event.target : null;
  const active = activeEntries(entries, target);
  const scopes = new Set(active.map((entry) => entry.scope));

  for (const entry of active) {
    for (const command of index.get(entry.scope)?.get(chord) ?? []) {
      const handler = entry.handler(command.id);
      if (handler === undefined || !guardsHold(command.when ?? [], { event, scopes })) continue;
      if (handler(event) === false) continue;

      event.preventDefault();
      return command.id;
    }
  }

  return null;
}
