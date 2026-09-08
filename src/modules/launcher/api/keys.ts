export const launcherKeys = {
  all: ["launcher"] as const,
  availability: () => [...launcherKeys.all, "availability"] as const,
  session: () => [...launcherKeys.all, "session"] as const,
};
