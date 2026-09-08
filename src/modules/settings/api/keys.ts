export const settingsKeys = {
  all: ["settings"] as const,
  settings: () => [...settingsKeys.all, "current"] as const,
  defaults: () => [...settingsKeys.all, "defaults"] as const,
  setupRequired: () => [...settingsKeys.all, "setupRequired"] as const,
  appInfo: () => [...settingsKeys.all, "appInfo"] as const,
  availableWads: () => [...settingsKeys.all, "availableWads"] as const,
  leagueRunAsAdmin: () => [...settingsKeys.all, "leagueRunAsAdmin"] as const,
  hashtableCache: () => [...settingsKeys.all, "hashtableCache"] as const,
  hashtableUpdates: () => [...settingsKeys.all, "hashtableUpdates"] as const,
  leaguePathValid: (path: string) => [...settingsKeys.all, "leaguePathValid", path] as const,
  thirdPartyLicenses: () => [...settingsKeys.all, "thirdPartyLicenses"] as const,
};
