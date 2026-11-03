import {
  chordParts,
  type CommandId,
  isChord,
  type KeyPress,
  keysOf,
  shortcutOf,
} from "@/modules/keys";

/** The registry command of each key of the particle shell, by the name its handlers and menus use. */
const VFX_COMMANDS = {
  play: "vfx.play",
  stepBack: "vfx.stepBack",
  stepForward: "vfx.stepForward",
  jumpBack: "vfx.jumpBack",
  jumpForward: "vfx.jumpForward",
  restart: "vfx.restart",
  end: "vfx.end",
  loop: "vfx.loop",
  fit: "vfx.fit",
  solo: "vfx.solo",
  mute: "vfx.mute",
  slower: "vfx.slower",
  faster: "vfx.faster",
  markerAdd: "vfx.markerAdd",
  copy: "vfx.copy",
  duplicate: "vfx.duplicate",
  paste: "vfx.paste",
  remove: "vfx.remove",
  selectAll: "vfx.selectAll",
  selectNone: "vfx.selectNone",
  quickAdd: "vfx.quickAdd",
  systemPrevious: "vfx.systemPrevious",
  systemNext: "vfx.systemNext",
  curveKeyDelete: "vfx.curveKeyDelete",
} as const satisfies Readonly<Record<string, CommandId>>;

export type VfxKey = keyof typeof VFX_COMMANDS;

/** The keys that `RunKeys` answers. */
export type RunKey =
  | "play"
  | "stepBack"
  | "stepForward"
  | "jumpBack"
  | "jumpForward"
  | "restart"
  | "end"
  | "loop"
  | "fit"
  | "solo"
  | "mute"
  | "slower"
  | "faster"
  | "markerAdd";

/** Returns the registry command of the key `name`. */
export function vfxCommand(name: VfxKey): CommandId {
  return VFX_COMMANDS[name];
}

/** Returns the text that a menu item shows for the key `name`. */
export function vfxShortcut(name: VfxKey): string {
  return shortcutOf(VFX_COMMANDS[name]);
}

/** Returns `true` if `press` is a chord of the key `name`. */
export function pressedKey(press: KeyPress, name: VfxKey): boolean {
  return isChord(press, VFX_COMMANDS[name]);
}

/** Returns the event fields of the first chord of `name`, for a command that runs what the key runs. */
export function keyEventOf(name: VfxKey): KeyboardEventInit {
  const parts = chordParts(keysOf(VFX_COMMANDS[name])[0] ?? "");
  const key = parts.at(-1) ?? "";

  return {
    key: key === "Space" ? " " : key,
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    bubbles: true,
    cancelable: true,
  };
}
