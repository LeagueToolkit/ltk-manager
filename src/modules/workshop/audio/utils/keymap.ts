/**
 * The audio commands of the key registry, by the short id that the audio file document, its
 * menus and its panels use.
 *
 * The key handlers resolve a press through `resolveCommand`, and the menu bar, the context menus,
 * the palette and the shortcut sheet read their keys from the registry. Per "Keys and gestures" in
 * docs/ux/AUDIO.md.
 */
import {
  chordLabel,
  chordText,
  commandAt,
  commandOf,
  COMMANDS,
  type CommandGroup,
  type CommandId,
  type KeyPress,
  type ScopeId,
  shortcutOf as registryShortcutOf,
  typesText,
} from "@/modules/keys";

export { chordLabel, chordText, type KeyPress, typesText };

/**
 * A surface that answers keys: a list of rows, a knob, or the whole document outside a text field.
 *
 * `lines` is the Voice lines view, which has no audio document around it and so also answers the
 * document keys that apply to it.
 */
export type AudioSurface = "media" | "voices" | "lines" | "document" | "knob";

/** The section of the shortcut sheet and the palette that a command is listed under. */
export type AudioCommandGroup = Extract<
  CommandGroup,
  "transport" | "navigation" | "editing" | "view" | "pointer"
>;

/** The id of one command of the audio file document. */
export type AudioCommandId =
  | "play"
  | "playAll"
  | "stop"
  | "loop"
  | "volumeDown"
  | "volumeUp"
  | "moveRow"
  | "movePage"
  | "moveEnd"
  | "extendRange"
  | "selectAll"
  | "stepRight"
  | "stepLeft"
  | "nextEvent"
  | "previousEvent"
  | "typeAhead"
  | "find"
  | "menu"
  | "viewMedia"
  | "viewEvents"
  | "toggleInspector"
  | "help"
  | "enter"
  | "reset"
  | "add"
  | "duplicate"
  | "remove"
  | "moveUp"
  | "moveDown"
  | "wrap"
  | "copy"
  | "cut"
  | "paste"
  | "save"
  | "undo"
  | "redo"
  | "knobStep"
  | "knobFine"
  | "knobCoarse"
  | "knobReset"
  | "dragReorder"
  | "dropMedia"
  | "dragEvent"
  | "middleClick"
  | "pickClick"
  | "details"
  | "rename"
  | "replaceMedia"
  | "newEvent"
  | "addSound"
  | "addRandom"
  | "addSequence"
  | "addSwitch"
  | "importWem"
  | "expandAll"
  | "collapseAll"
  | "createEvent"
  | "showInBank"
  | "showInTree"
  | "copyForSkin"
  | "addChance"
  | "removeChance"
  | "pickRandom";

/** One command and the chords that run it. */
export interface AudioBinding {
  readonly id: AudioCommandId;
  /** The chords in canonical form, as `chordText` writes them. The first is the one shown. */
  readonly keys: readonly string[];
  readonly surfaces: readonly AudioSurface[];
  readonly group: CommandGroup;
}

/** The registry scope of each surface. */
const SURFACE_SCOPES: Readonly<Record<AudioSurface, ScopeId>> = {
  media: "focus:audio.media",
  voices: "focus:audio.events",
  lines: "focus:audio.lines",
  document: "document:audio",
  knob: "focus:knob",
};

/**
 * The commands that another owner answers, which the document's menus and palette show with the
 * owner's keys: the editor's save, history and find, and the app's shortcut sheet.
 */
const BORROWED: Partial<Readonly<Record<AudioCommandId, CommandId>>> = {
  find: "editor.find",
  save: "editor.save",
  undo: "editor.undo",
  redo: "editor.redo",
  help: "app.keys",
};

/** The surfaces that a borrowed command applies on. */
const BORROWED_SURFACES: Partial<Readonly<Record<AudioCommandId, readonly AudioSurface[]>>> = {
  find: ["document"],
  save: ["document", "lines"],
  undo: ["document", "lines"],
  redo: ["document", "lines"],
  help: ["document", "lines"],
};

/** Returns the registry command of `id`. */
function registryId(id: AudioCommandId): CommandId {
  return BORROWED[id] ?? (`audio.${id}` as CommandId);
}

/** Returns the surfaces of the registry scopes of `scopes`. */
function surfacesOf(scopes: readonly ScopeId[]): AudioSurface[] {
  return (Object.entries(SURFACE_SCOPES) as [AudioSurface, ScopeId][])
    .filter(([, scope]) => scopes.includes(scope))
    .map(([surface]) => surface);
}

/** Returns the binding of `id`. */
export function bindingOf(id: AudioCommandId): AudioBinding {
  const command = commandOf(registryId(id));
  const surfaces = BORROWED_SURFACES[id] ?? surfacesOf(command.scopes);

  return { id, keys: command.keys, surfaces, group: command.group };
}

/** Every audio command of the registry, then the borrowed ones. */
export const AUDIO_KEYMAP: readonly AudioBinding[] = [
  ...COMMANDS.filter((command) => command.id.startsWith("audio.")).map((command) =>
    bindingOf(command.id.slice("audio.".length) as AudioCommandId),
  ),
  ...(Object.keys(BORROWED) as AudioCommandId[]).map(bindingOf),
];

/**
 * Returns the command that `press` runs on `surface`, or null if the surface binds no command of
 * this module to it.
 *
 * A chord that the editor or the app answers resolves to null, so the press reaches that handler.
 */
export function resolveCommand(press: KeyPress, surface: AudioSurface): AudioCommandId | null {
  const id = commandAt(press, SURFACE_SCOPES[surface]);
  if (id === null || !id.startsWith("audio.")) return null;

  return id.slice("audio.".length) as AudioCommandId;
}

/** Returns the chord that a menu item of `id` shows on its right, or undefined for none. */
export function menuShortcut(id: AudioCommandId): string | undefined {
  return shortcutOf(id) ?? undefined;
}

/** Returns the first chord of `id` as `chordLabel` writes it, or null for a command without a key. */
export function shortcutOf(id: AudioCommandId): string | null {
  const label = registryShortcutOf(registryId(id));

  return label === "" ? null : label;
}
