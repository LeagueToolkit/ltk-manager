import type { Chord } from "./chords";
import type { Guard } from "./guards";
import type { ScopeId } from "./scopes";

/** The group of the shortcut sheet that a command is listed under, inside its section. */
export type CommandGroup =
  | "general"
  | "navigation"
  | "view"
  | "editing"
  | "transport"
  | "tools"
  | "pointer";

/**
 * One command of the registry: what it is called, where it applies and which chords run it.
 *
 * The module that owns the action registers a handler for it at runtime. Per "The registry" in
 * docs/ux/KEYS.md.
 */
export interface CommandSpec {
  readonly id: string;
  /** The words of the command in the shortcut sheet and the palette. */
  readonly title: () => string;
  readonly group: CommandGroup;
  readonly scopes: readonly ScopeId[];
  /** The chords that run the command. The first is the one that a menu or a tooltip shows. */
  readonly keys: readonly Chord[];
  /** The guards that must hold for a press to run the command. */
  readonly when?: readonly Guard[];
  /**
   * The commands of a wider scope whose chords this one takes on purpose.
   *
   * A narrower scope answers first, and this list is what tells that apart from a mistake.
   */
  readonly shadows?: readonly string[];
  /**
   * Lists a command without a chord in the sheet: a pointer gesture or the type-ahead of a list.
   *
   * A command with a chord is always listed.
   */
  readonly gesture?: true;
}
