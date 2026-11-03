/**
 * The command registry: every command of the app, the scopes it applies in and its chords.
 *
 * The dispatcher, the menus, the palette, the tooltips and the shortcut sheet all read their keys
 * from here. Per "The registry" in docs/ux/KEYS.md.
 */
import { type Chord, chordLabel, chordText, type KeyPress } from "./chords";
import { APP_COMMANDS } from "./commands/app";
import { ATLAS_COMMANDS } from "./commands/atlas";
import { AUDIO_COMMANDS } from "./commands/audio";
import { EDITOR_COMMANDS } from "./commands/editor";
import { LIST_COMMANDS } from "./commands/lists";
import { MAP_COMMANDS } from "./commands/map";
import { SKIN_COMMANDS } from "./commands/skin";
import { VFX_COMMANDS } from "./commands/vfx";
import type { ScopeId } from "./scopes";
import type { CommandSpec } from "./types";

const TABLES = [
  APP_COMMANDS,
  EDITOR_COMMANDS,
  LIST_COMMANDS,
  AUDIO_COMMANDS,
  VFX_COMMANDS,
  SKIN_COMMANDS,
  MAP_COMMANDS,
  ATLAS_COMMANDS,
] as const;

/** The id of one command of the registry, such as `editor.save`. */
export type CommandId = (typeof TABLES)[number][number]["id"];

/** Every command of the registry, in the order that the sheet lists each section. */
export const COMMANDS: readonly CommandSpec[] = TABLES.flat();

const BY_ID: ReadonlyMap<string, CommandSpec> = new Map(
  COMMANDS.map((command) => [command.id, command]),
);

/** Returns the command `id`. */
export function commandOf(id: CommandId): CommandSpec {
  const command = BY_ID.get(id);
  if (command === undefined) throw new Error(`The key registry has no command "${id}"`);

  return command;
}

/** Returns the chords of `id`, the one that a menu shows first. */
export function keysOf(id: CommandId): readonly Chord[] {
  return commandOf(id).keys;
}

/** Returns the first chord of `id` in the words that a keycap shows, or undefined for none. */
export function shortcutOf(id: CommandId): string | undefined {
  const [first] = keysOf(id);

  return first === undefined ? undefined : chordLabel(first);
}

/** Returns the chords of `id` in the words of a keycap, joined for a sentence such as a tooltip. */
export function shortcutsOf(id: CommandId, separator = ", "): string {
  return keysOf(id).map(chordLabel).join(separator);
}

/** Returns `true` if `press` is one of the chords of `id`. */
export function isChord(press: KeyPress, id: CommandId): boolean {
  const chord = chordText(press);

  return chord !== null && keysOf(id).includes(chord);
}

/**
 * Returns the command of `scope` that `press` runs, or null if the scope binds none to it.
 *
 * For a widget that answers its own keys in its `onKeyDown`, so that its keys still come from the
 * registry. The widget checks its own guards.
 */
export function commandAt(press: KeyPress, scope: ScopeId): CommandId | null {
  const chord = chordText(press);
  if (chord === null) return null;

  const command = COMMANDS.find((each) => each.scopes.includes(scope) && each.keys.includes(chord));

  return (command?.id as CommandId | undefined) ?? null;
}

/** Returns the ARIA spelling of the chords of `id`, for `aria-keyshortcuts`. */
export function ariaShortcutOf(id: CommandId): string {
  return keysOf(id)
    .map((chord) => chord.replace(/^Ctrl(?=\+)/, "Control"))
    .join(" ");
}
