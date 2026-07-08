export const settingsKeys = {
  all: ["settings"] as const,
  settings: () => [...settingsKeys.all, "current"] as const,
  setupRequired: () => [...settingsKeys.all, "setupRequired"] as const,
  appInfo: () => [...settingsKeys.all, "appInfo"] as const,
  availableWads: () => [...settingsKeys.all, "availableWads"] as const,
  leagueRunAsAdmin: () => [...settingsKeys.all, "leagueRunAsAdmin"] as const,
  thirdPartyLicenses: () => [...settingsKeys.all, "thirdPartyLicenses"] as const,
};
