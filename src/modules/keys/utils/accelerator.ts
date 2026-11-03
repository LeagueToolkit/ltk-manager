import type { Chord } from "./chords";

/** The modifier names of a Tauri accelerator, as the chord's modifier that the app reads them as. */
const MODIFIERS: Readonly<Record<string, "Ctrl" | "Alt" | "Shift">> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
  cmdorctrl: "Ctrl",
  commandorcontrol: "Ctrl",
  super: "Ctrl",
  meta: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

/** The key names of an accelerator that a chord spells otherwise. */
const KEYS: Readonly<Record<string, string>> = {
  plus: "+",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
};

/** The order of the modifiers in a chord. */
const ORDER = ["Ctrl", "Alt", "Shift"] as const;

/**
 * Returns the chord of a Tauri accelerator such as `CmdOrCtrl+Shift+R`, or null for one without a key.
 *
 * Super and Cmd read as Ctrl, as the app reads Meta. A symbol key drops Shift, as `chordText` does.
 */
export function chordOfAccelerator(accelerator: string): Chord | null {
  const parts = accelerator
    .split(/\+(?=.)/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const held = new Set<(typeof ORDER)[number]>();
  let key: string | null = null;

  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier !== undefined) {
      held.add(modifier);
      continue;
    }

    key = KEYS[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part);
  }
  if (key === null) return null;

  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key);
  const modifiers = ORDER.filter((each) => held.has(each) && !(each === "Shift" && symbol));

  return [...modifiers, key].join("+");
}
