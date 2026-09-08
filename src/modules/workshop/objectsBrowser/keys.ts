import { gameKeys } from "../gameBrowser/keys";

export const objectKeys = {
  /* Under the object searches. The invalidation of a warm or a drop refetches every
     listing with them. */
  dirs: [...gameKeys.objectSearches, "dir"] as const,
  dir: (prefix: string) => [...gameKeys.objectSearches, "dir", prefix] as const,
  find: (pattern: string, regex: boolean, cls: string | null) =>
    [...gameKeys.objectSearches, "find", pattern, regex, cls] as const,
};
