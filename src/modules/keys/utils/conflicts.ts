import type { Chord } from "./chords";
import { guardFact, type GuardName } from "./guards";
import { isWithin, onOnePath, type ScopeId } from "./scopes";
import type { CommandSpec } from "./types";

/** A chord that no binding takes, because the webview or the OS answers it first. */
export interface ReservedChord {
  readonly chord: Chord;
  /** What answers the chord, for the test's failure message. */
  readonly owner: string;
}

/** The chords that the webview, the window or the devtools answer. */
export const RESERVED_CHORDS: readonly ReservedChord[] = [
  { chord: "Ctrl+Shift+I", owner: "devtools" },
  { chord: "F12", owner: "devtools" },
  { chord: "Alt+F4", owner: "the window" },
  { chord: "F5", owner: "webview reload" },
  { chord: "Ctrl+R", owner: "webview reload" },
  { chord: "Ctrl+Shift+R", owner: "webview reload" },
];

/** Two commands that one press could reach, or a command on a reserved chord. */
export interface Conflict {
  readonly chord: Chord;
  readonly command: string;
  /** The other command, or the owner of a reserved chord. */
  readonly with: string;
}

/** Returns the facts that a binding in `scope` holds by being active, such as `project`. */
function impliedFacts(scope: ScopeId): Partial<Record<GuardName, boolean>> {
  return isWithin(scope, "project") ? { project: true } : {};
}

/** Returns the facts that `command` requires in `scope`: its guards and what the scope implies. */
function requiredFacts(command: CommandSpec, scope: ScopeId): Map<GuardName, boolean> {
  const facts = new Map(Object.entries(impliedFacts(scope)) as [GuardName, boolean][]);
  for (const guard of command.when ?? []) {
    const { name, holds } = guardFact(guard);
    facts.set(name, holds);
  }

  return facts;
}

/** Returns `true` if no press can satisfy the guards of both `a` in `aScope` and `b` in `bScope`. */
function exclusive(a: CommandSpec, aScope: ScopeId, b: CommandSpec, bScope: ScopeId): boolean {
  const aFacts = requiredFacts(a, aScope);
  const bFacts = requiredFacts(b, bScope);

  return [...aFacts].some(([name, holds]) => bFacts.has(name) && bFacts.get(name) !== holds);
}

/** Returns `true` if the narrower of `a` and `b` declares that it shadows the other on purpose. */
function shadowed(a: CommandSpec, aScope: ScopeId, b: CommandSpec, bScope: ScopeId): boolean {
  if (aScope === bScope) return false;

  const [narrow, wide] = isWithin(aScope, bScope) ? [a, b] : [b, a];

  return narrow.shadows?.includes(wide.id) === true;
}

/** Returns `true` if one press can reach both `a` and `b` on `chord`. */
function overlap(a: CommandSpec, b: CommandSpec): boolean {
  return a.scopes.some((aScope) =>
    b.scopes.some(
      (bScope) =>
        onOnePath(aScope, bScope) &&
        !exclusive(a, aScope, b, bScope) &&
        !shadowed(a, aScope, b, bScope),
    ),
  );
}

/**
 * Returns every conflict of `commands`: two commands that one press could reach, and a command
 * on a chord of `reserved`.
 *
 * A narrower scope takes a chord from a wider one only when it lists the wider command in
 * `shadows`.
 */
export function findConflicts(
  commands: readonly CommandSpec[],
  reserved: readonly ReservedChord[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const [index, command] of commands.entries()) {
    for (const chord of command.keys) {
      const owner = reserved.find((each) => each.chord === chord);
      if (owner !== undefined) conflicts.push({ chord, command: command.id, with: owner.owner });

      for (const other of commands.slice(index + 1)) {
        if (other.keys.includes(chord) && overlap(command, other)) {
          conflicts.push({ chord, command: command.id, with: other.id });
        }
      }
    }
  }

  return conflicts;
}

/** Returns the commands of `commands` that take `chord`, in any scope. */
export function commandsOnChord(
  chord: Chord,
  commands: readonly CommandSpec[],
): readonly CommandSpec[] {
  return commands.filter((command) => command.keys.includes(chord));
}
