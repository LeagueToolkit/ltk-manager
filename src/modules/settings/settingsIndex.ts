import type { SettingKey } from "./settingKey";
import { DEFAULT_SETTINGS_TAB, isSettingsTab, type SettingsTab } from "./tabs";

/** One addressable setting: what a link names it, what it reads, what it says. */
export interface SettingEntry {
  /**
   * Stable and public, namespaced by the tab it is drawn on.
   *
   * `?focus=` carries this and the gear's menu copies it, so it outlives every
   * rewrite of the title beside it. The namespace is what lets a link resolve a
   * tab before the row it points at has mounted.
   */
  readonly id: string;
  readonly key: SettingKey;
  /** The row's label. The row reads it from here rather than repeating it. */
  readonly title: string;
  /** Ids this setting answered to before it moved. Seeded empty. */
  readonly aliases?: readonly string[];
}

/* Literal, so the two exported types below are the closed sets the rest of the
   module relies on rather than plain strings. */
const INDEX = [
  { id: "general.leaguePath", key: "leaguePath", title: "Installation path" },
  { id: "general.launchMode", key: "launchMode", title: "Launcher flow" },
  {
    id: "general.hideRiotClientOnLaunch",
    key: "hideRiotClientOnLaunch",
    title: "Hide Riot Client on Game start",
  },
  {
    id: "general.stopPatcherOnSessionEnd",
    key: "stopPatcherOnSessionEnd",
    title: "Stop the patcher when the game ends",
  },
  { id: "general.autoRun", key: "autoRun", title: "Auto run" },
  {
    id: "general.startInTrayUnlessUpdate",
    key: "startInTrayUnlessUpdate",
    title: "Start in tray unless update available",
  },
  {
    id: "general.alwaysStartPatcher",
    key: "alwaysStartPatcher",
    title: "Always start patcher at launch",
  },
  { id: "general.minimizeToTray", key: "minimizeToTray", title: "Minimize to system tray" },
  { id: "general.startInTray", key: "startInTray", title: "Start minimized to tray" },

  { id: "library.modStoragePath", key: "modStoragePath", title: "Storage location" },
  { id: "library.retainModArchives", key: "retainModArchives", title: "Keep mod archives" },
  {
    id: "library.autoCategorizationEnabled",
    key: "autoCategorizationEnabled",
    title: "Automatically categorize mods",
  },
  { id: "library.watcherEnabled", key: "watcherEnabled", title: "Watch for external changes" },
  { id: "library.trustedDomains", key: "trustedDomains", title: "Trusted mod providers" },

  { id: "workshop.workshopPath", key: "workshopPath", title: "Workshop directory" },
  { id: "workshop.tabOpenMode", key: "layout.tabOpenMode", title: "Opening a file" },
  { id: "workshop.searchGame", key: "layout.searchGame", title: "Search the game" },
  {
    id: "workshop.forwardLookingMeta",
    key: "layout.forwardLookingMeta",
    title: "Lints for the coming patch",
  },

  { id: "patching.patchTft", key: "patchTft", title: "Patch TFT files" },
  { id: "patching.elevateInjector", key: "elevateInjector", title: "Run injector elevated" },
  {
    id: "patching.verbosePatcherLogging",
    key: "verbosePatcherLogging",
    title: "Verbose patcher logging",
  },
  { id: "patching.blockScriptsWad", key: "blockScriptsWad", title: "Block Scripts.wad.client" },
  {
    id: "patching.linkedBinCheckEnabled",
    key: "linkedBinCheckEnabled",
    title: "Warn about missing dependencies",
  },
  {
    id: "patching.enforceSkinhackScan",
    key: "enforceSkinhackScan",
    title: "Enforce anti-skinhack scan",
  },
  { id: "patching.fullWadScan", key: "fullWadScan", title: "Scan every WAD up front" },
  {
    id: "patching.disableCrashReporting",
    key: "disableCrashReporting",
    title: "Disable crash reporting",
  },
  { id: "patching.readGameLog", key: "readGameLog", title: "Allow reading game logs" },
  { id: "patching.keepIncidents", key: "keepIncidents", title: "Keep incidents" },
  {
    id: "patching.applyStringOverridesToAllLocales",
    key: "applyStringOverridesToAllLocales",
    title: "Apply string overrides to all locales",
  },
  { id: "patching.wadBlocklist", key: "wadBlocklist", title: "WAD blocklist" },

  { id: "hotkeys.reloadModsHotkey", key: "reloadModsHotkey", title: "Hot reload mods" },
  { id: "hotkeys.killLeagueHotkey", key: "killLeagueHotkey", title: "Kill League" },
  {
    id: "hotkeys.killLeagueStopsPatcher",
    key: "killLeagueStopsPatcher",
    title: "Kill League stops patcher",
  },

  { id: "appearance.theme", key: "theme", title: "Theme" },
  { id: "appearance.accentColor", key: "accentColor", title: "Accent color" },
  { id: "appearance.surfaceTint", key: "display.surfaceTint", title: "Surface tint" },
  { id: "appearance.cornerStyle", key: "display.cornerStyle", title: "Corners" },
  { id: "appearance.zoomLevel", key: "display.zoomLevel", title: "Zoom level" },
  { id: "appearance.sansFont", key: "display.sansFont", title: "Interface font" },
  { id: "appearance.monoFont", key: "display.monoFont", title: "Code font" },
  { id: "appearance.reduceMotion", key: "display.reduceMotion", title: "Reduce motion" },
  { id: "appearance.scrollMode", key: "display.scrollMode", title: "Scrolling" },
  { id: "appearance.scrollbarSize", key: "display.scrollbarSize", title: "Scrollbars" },
  { id: "appearance.backdropImage", key: "backdropImage", title: "Background image" },
  { id: "appearance.backdropBlur", key: "backdropBlur", title: "Blur" },
] as const satisfies readonly SettingEntry[];

/** The public id of an addressable setting. */
export type SettingId = (typeof INDEX)[number]["id"];

/** A `SettingKey` the index carries, which is the only kind a row may declare. */
export type IndexedSettingKey = (typeof INDEX)[number]["key"];

/**
 * Every setting a link, a search or the gear's menu can name.
 *
 * The order is the order a reader walks the tabs, then the cards, then the rows
 * inside them, so the table reads as the surface it describes. A row absent here
 * is a row nothing can address - which is why `SettingRow` will not take a key
 * the table does not carry.
 */
export const SETTINGS_INDEX: readonly SettingEntry[] = INDEX;

const BY_KEY = Object.fromEntries(SETTINGS_INDEX.map((entry) => [entry.key, entry])) as Record<
  IndexedSettingKey,
  SettingEntry
>;

const BY_ID = new Map<string, SettingEntry>(
  SETTINGS_INDEX.flatMap((entry) => [entry.id, ...(entry.aliases ?? [])].map((id) => [id, entry])),
);

/** The entry for a key a row declared, which the index carries by construction. */
export function settingEntry(key: IndexedSettingKey): SettingEntry {
  return BY_KEY[key];
}

/** The entry a public id or a retired alias names, or undefined for neither. */
export function settingById(id: string): SettingEntry | undefined {
  return BY_ID.get(id);
}

/**
 * The tab a `?focus=` value opens, whatever it names.
 *
 * The namespace answers before the panel holding the target has mounted, which
 * is what lets one param carry both halves of a link. A group id resolves the
 * same way, because it is namespaced too. Anything else lands on the default
 * tab rather than on a blank page.
 */
export function settingFocusTab(focus: string): SettingsTab {
  const [namespace] = (settingById(focus)?.id ?? focus).split(".");
  return isSettingsTab(namespace) ? namespace : DEFAULT_SETTINGS_TAB;
}

/** Declared in `tauri.conf.json`, and registered by the installer. */
const DEEP_LINK_SCHEME = "ltk";

/**
 * A link that opens the app on one setting, for pasting where it is clicked.
 *
 * It carries the public id and nothing else, so the tab it lands on is settled
 * by [`settingFocusTab`] on the way in rather than written into the link.
 */
export function settingLink(id: string): string {
  return `${DEEP_LINK_SCHEME}://settings?focus=${encodeURIComponent(id)}`;
}
