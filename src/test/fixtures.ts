import type { InstalledMod, Profile, Settings } from "@/lib/bindings";

export function createMockSettings(overrides?: Partial<Settings>): Settings {
  return {
    leaguePath: null,
    modStoragePath: null,
    workshopPath: null,
    firstRunComplete: false,
    theme: "system",
    accentColor: { preset: "blue", customHue: null },
    backdropImage: null,
    backdropBlur: null,
    libraryViewMode: "grid",
    patchTft: false,
    minimizeToTray: true,
    startInTray: false,
    migrationDismissed: false,
    reloadModsHotkey: null,
    killLeagueHotkey: null,
    killLeagueStopsPatcher: true,
    trustedDomains: ["runeforge.dev", "divineskins.gg"],
    watcherEnabled: false,
    blockScriptsWad: true,
    wadBlocklist: [],
    authorProfiles: [],
    defaultAuthorProfileId: null,
    autoRun: false,
    startInTrayUnlessUpdate: false,
    alwaysStartPatcher: false,
    ...overrides,
  };
}

export function createMockInstalledMod(overrides?: Partial<InstalledMod>): InstalledMod {
  return {
    id: "test-mod-id",
    name: "test-mod",
    displayName: "Test Mod",
    version: "1.0.0",
    description: "A test mod",
    authors: ["Test Author"],
    enabled: true,
    installedAt: "2025-01-01T00:00:00.000Z",
    layers: [{ name: "base", priority: 0, enabled: true }],
    tags: [],
    champions: [],
    maps: [],
    modDir: "/path/to/mod",
    folderId: null,
    ...overrides,
  };
}

export function createMockProfile(overrides?: Partial<Profile>): Profile {
  return {
    id: "test-profile-id",
    name: "Test Profile",
    slug: "test-profile",
    enabledMods: [],
    modOrder: [],
    layerStates: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    lastUsed: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}
