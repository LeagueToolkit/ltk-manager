import type { CharacterInking, InkingSide } from "@/lib/tauri";

export const settingsKeys = {
  all: ["settings"] as const,
  settings: () => [...settingsKeys.all, "current"] as const,
  defaults: () => [...settingsKeys.all, "defaults"] as const,
  setupRequired: () => [...settingsKeys.all, "setupRequired"] as const,
  appInfo: () => [...settingsKeys.all, "appInfo"] as const,
  availableWads: () => [...settingsKeys.all, "availableWads"] as const,
  forcibleMapSkins: (leaguePath: string) =>
    [...settingsKeys.all, "forcibleMapSkins", leaguePath] as const,
  mapDecorations: (leaguePath: string) =>
    [...settingsKeys.all, "mapDecorations", leaguePath] as const,
  inkingMaps: (leaguePath: string) => [...settingsKeys.all, "inkingMaps", leaguePath] as const,
  inkingPreview: (champion: string) => [...settingsKeys.all, "inkingPreview", champion] as const,
  inkingOutline: (settings: CharacterInking, side: InkingSide) =>
    [...settingsKeys.all, "inkingOutline", settings, side] as const,
  leagueRunAsAdmin: () => [...settingsKeys.all, "leagueRunAsAdmin"] as const,
  hashtableCache: () => [...settingsKeys.all, "hashtableCache"] as const,
  hashtableUpdates: () => [...settingsKeys.all, "hashtableUpdates"] as const,
  leaguePathValid: (path: string) => [...settingsKeys.all, "leaguePathValid", path] as const,
  thirdPartyLicenses: () => [...settingsKeys.all, "thirdPartyLicenses"] as const,
  telemetryIdentity: () => [...settingsKeys.all, "telemetryIdentity"] as const,
  dataUsage: () => [...settingsKeys.all, "dataUsage"] as const,
  ffmpegDetect: () => [...settingsKeys.all, "ffmpegDetect"] as const,
};
