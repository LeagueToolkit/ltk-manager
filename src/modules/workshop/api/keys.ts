export const workshopKeys = {
  all: ["workshop"] as const,
  projects: () => [...workshopKeys.all, "projects"] as const,
  project: (path: string) => [...workshopKeys.projects(), path] as const,
  validation: (path: string) => [...workshopKeys.project(path), "validation"] as const,
  thumbnail: (path: string, thumbnailPath?: string | null) =>
    [...workshopKeys.project(path), "thumbnail", thumbnailPath] as const,
  layerInfo: (path: string) => [...workshopKeys.project(path), "layerInfo"] as const,
  /* The names join into one segment: an array segment makes the key sensitive
     to the order the caller happened to hold them in. */
  layerInfoFor: (path: string, layerNames: readonly string[]) =>
    [...workshopKeys.layerInfo(path), JSON.stringify([...layerNames].sort())] as const,
  contentTree: (path: string) => [...workshopKeys.project(path), "contentTree"] as const,
  problems: (path: string) => [...workshopKeys.project(path), "problems"] as const,
  ignoreRules: (path: string, at: string | null) =>
    [...workshopKeys.project(path), "ignoreRules", at] as const,
  recommendedIgnoreRules: () => [...workshopKeys.all, "recommendedIgnoreRules"] as const,
  stringKeySearch: (query: string) => [...workshopKeys.all, "stringKeySearch", query] as const,
  stringValues: (keys: readonly string[]) => [...workshopKeys.all, "stringValues", keys] as const,
  gameExtractPlan: (targets: readonly unknown[] | null) =>
    [...workshopKeys.all, "gameExtractPlan", targets] as const,
};
