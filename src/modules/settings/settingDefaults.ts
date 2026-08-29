import { MONO_FACES, SANS_FACES } from "@/lib/fonts";
import type { Settings } from "@/lib/tauri";
import type { AppearanceKey, ProjectEditorKey } from "@/stores";

import { LTK_PRESET } from "./api";
import type { SettingKey } from "./settingKey";

/** Reads a key from whichever store owns it. */
export function settingValue(
  key: SettingKey,
  settings: Settings,
  display: Record<AppearanceKey, unknown>,
  layout: Record<ProjectEditorKey, unknown>,
): unknown {
  if (key.startsWith("display.")) return display[key.slice(8) as AppearanceKey];
  if (key.startsWith("layout.")) return layout[key.slice(7) as ProjectEditorKey];
  return settings[key as keyof Settings];
}

/**
 * Folds the one value whose default is not equality.
 *
 * An unset accent preset is the brand preset, so the two spellings of the same
 * choice must not read as a change.
 */
export function normalizeSetting(key: SettingKey, value: unknown): unknown {
  if (key !== "accentColor") return value;
  const accent = value as Settings["accentColor"] | null | undefined;
  return { preset: accent?.preset ?? LTK_PRESET, customHue: accent?.customHue ?? null };
}

/** Whether a key still holds what a fresh install shows. */
export function isSettingDefault(key: SettingKey, current: unknown, fresh: unknown): boolean {
  return (
    JSON.stringify(normalizeSetting(key, current)) === JSON.stringify(normalizeSetting(key, fresh))
  );
}

/**
 * How a key's default reads, for the menu line that says what a reset puts back.
 *
 * A key with no entry is addressable and never reset, which is how the two
 * paths, the two lists and the author profiles keep their data by construction
 * rather than by a second flag. `SettingKey` is deliberately not exhaustive
 * here - `Partial` is the mechanism, not an oversight.
 */
export function settingFormat(key: SettingKey): ((value: unknown) => string) | undefined {
  return SETTING_FORMAT[key];
}

type SettingFormat = (value: unknown) => string;

const onOff: SettingFormat = (value) => (value ? "On" : "Off");
const percent: SettingFormat = (value) => `${String(value)}%`;
const plain: SettingFormat = (value) => String(value);

/** Reads a value that means "nothing chosen" when it is absent. */
function optional(empty: string, inner: SettingFormat): SettingFormat {
  return (value) => (value == null ? empty : inner(value));
}

function titleCase(value: unknown): string {
  const spaced = String(value)
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function faceLabel(faces: Record<string, { label: string }>): SettingFormat {
  return (value) => faces[String(value)]?.label ?? titleCase(value);
}

const accentName: SettingFormat = (value) => {
  const preset = (normalizeSetting("accentColor", value) as { preset: string }).preset;
  return preset === LTK_PRESET ? "LTK" : titleCase(preset);
};

const SETTING_FORMAT: Partial<Record<SettingKey, SettingFormat>> = {
  autoRun: onOff,
  startInTrayUnlessUpdate: onOff,
  alwaysStartPatcher: onOff,
  minimizeToTray: onOff,
  startInTray: onOff,
  launchMode: titleCase,
  hideRiotClientOnLaunch: onOff,
  stopPatcherOnSessionEnd: onOff,
  killLeagueStopsPatcher: onOff,
  killLeagueHotkey: optional("None", plain),
  reloadModsHotkey: optional("None", plain),

  retainModArchives: onOff,
  autoCategorizationEnabled: onOff,
  watcherEnabled: onOff,

  applyStringOverridesToAllLocales: onOff,

  patchTft: onOff,
  elevateInjector: onOff,
  blockScriptsWad: onOff,
  enforceSkinhackScan: onOff,
  linkedBinCheckEnabled: onOff,
  fullWadScan: onOff,
  verbosePatcherLogging: onOff,
  readGameLog: onOff,
  disableCrashReporting: onOff,
  keepIncidents: plain,

  theme: titleCase,
  accentColor: accentName,
  backdropImage: optional("None", plain),
  backdropBlur: optional("None", (value) => `${String(value)}px`),
  "display.zoomLevel": percent,
  "display.surfaceTint": percent,
  "display.cornerStyle": titleCase,
  "display.sansFont": faceLabel(SANS_FACES),
  "display.monoFont": faceLabel(MONO_FACES),
  "display.reduceMotion": titleCase,
  "display.scrollMode": titleCase,
  "display.scrollbarSize": titleCase,

  "layout.tabOpenMode": titleCase,
  "layout.searchGame": onOff,
  "layout.forwardLookingMeta": onOff,
};
