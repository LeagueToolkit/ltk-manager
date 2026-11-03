/** The modifier and key state of a press that `chordText` reads. */
export interface KeyPress {
  readonly key: string;
  /** The physical key, which `chordText` reads for a digit and for a letter of a non-Latin layout. */
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * A key combination in canonical text: `Ctrl`, `Alt` and `Shift` in that order, then the key,
 * joined by `+`, such as `Ctrl+Shift+Z`, `Alt+ArrowDown` or `?`.
 */
export type Chord = string;

/** The keys that only modify another key and make no chord on their own. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Control",
  "Alt",
  "AltGraph",
  "Shift",
  "Meta",
  "OS",
  "CapsLock",
]);

/** The `key` values of a press that produced no character a chord can name. */
const UNREADABLE_KEYS: ReadonlySet<string> = new Set(["Dead", "Unidentified", "Process"]);

/**
 * Returns the key part of a chord for `press`, or null for a modifier or an unreadable key.
 *
 * A digit reads from `code`, so `Alt+1` holds on a layout that types `&` there. A Latin letter
 * reads from `key`, so `Ctrl+Z` is the key printed Z on any Latin layout. A letter of another
 * script falls back to `code`.
 */
function keyPart(press: KeyPress): string | null {
  const { key, code = "" } = press;
  if (MODIFIER_KEYS.has(key)) return null;

  const digit = /^Digit(\d)$/.exec(code);
  if (digit !== null) return digit[1] ?? null;
  if (/^\d$/.test(key)) return key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null && (key.length === 1 || UNREADABLE_KEYS.has(key))) return letter[1] ?? null;
  if (UNREADABLE_KEYS.has(key) || key === "") return null;

  return key === " " ? "Space" : key;
}

/** Returns `true` if `part` is a single symbol that the layout types with or without Shift. */
function isSymbol(part: string): boolean {
  return part.length === 1 && !/[A-Z0-9]/.test(part);
}

/**
 * Returns the canonical chord of `press`, or null for a press of a modifier alone.
 *
 * Meta counts as Ctrl. A symbol key drops Shift, because the layout already folds Shift into the
 * symbol: `?` is Shift and `/` on a US keyboard.
 */
export function chordText(press: KeyPress): Chord | null {
  const key = keyPart(press);
  if (key === null) return null;

  const parts: string[] = [];
  if (press.ctrlKey || press.metaKey) parts.push("Ctrl");
  if (press.altKey) parts.push("Alt");
  if (press.shiftKey && !isSymbol(key)) parts.push("Shift");
  parts.push(key);

  return parts.join("+");
}

/**
 * Returns the parts of `chord`, the modifiers then the key.
 *
 * The `+` key is a part of its own, so `Ctrl++` is `Ctrl` and `+`.
 */
export function chordParts(chord: Chord): string[] {
  return chord.split(/\+(?=.)/);
}

/** The words that a keycap shows for a key whose `KeyboardEvent.key` name is not one. */
const KEY_WORDS: Readonly<Record<string, string>> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ContextMenu: "Menu",
  Delete: "Del",
  Escape: "Esc",
};

/** Returns `chord` in the words that `Kbd` draws, such as `Alt+Down` for `Alt+ArrowDown`. */
export function chordLabel(chord: Chord): string {
  return chordParts(chord)
    .map((part) => KEY_WORDS[part] ?? part)
    .join("+");
}
