import { m } from "@/i18n";

import { chordOfAccelerator } from "./accelerator";
import type { Chord } from "./chords";
import { RESERVED_CHORDS, type ReservedChord } from "./conflicts";
import { COMMANDS } from "./registry";
import type { CommandSpec } from "./types";

/** The settings fields that hold the OS-global hotkeys, as Tauri accelerators. */
export interface OsHotkeySettings {
  readonly reloadModsHotkey?: string | null;
  readonly killLeagueHotkey?: string | null;
}

/** One OS-global hotkey that the user has set. */
export interface OsHotkey {
  readonly title: string;
  readonly chord: Chord;
}

/** Returns the OS-global hotkeys of `settings` as chords. A cleared or unreadable one is left out. */
export function osHotkeys(settings: OsHotkeySettings): OsHotkey[] {
  const entries = [
    { title: m.keys_os_reload_mods_label(), accelerator: settings.reloadModsHotkey },
    { title: m.keys_os_kill_league_label(), accelerator: settings.killLeagueHotkey },
  ];

  return entries.flatMap(({ title, accelerator }) => {
    const chord = accelerator == null ? null : chordOfAccelerator(accelerator);

    return chord === null ? [] : [{ title, chord }];
  });
}

/** Returns the reserved chords and the OS-global hotkeys of `settings`, which no binding takes. */
export function reservedChords(settings: OsHotkeySettings): ReservedChord[] {
  return [
    ...RESERVED_CHORDS,
    ...osHotkeys(settings).map(({ title, chord }) => ({ chord, owner: title })),
  ];
}

/**
 * Returns the command that already runs on the chord of `accelerator`, or null if none does.
 *
 * An OS-global hotkey takes its chord from the whole system, so it would shadow that command
 * while the app has focus.
 */
export function commandTakenBy(
  accelerator: string,
  commands: readonly CommandSpec[] = COMMANDS,
): CommandSpec | null {
  const chord = chordOfAccelerator(accelerator);
  if (chord === null) return null;

  return commands.find((command) => command.keys.includes(chord)) ?? null;
}
