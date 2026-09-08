export const patcherKeys = {
  all: ["patcher"] as const,
  status: () => [...patcherKeys.all, "status"] as const,
};
