/* The install only changes when Riot patches it, so a listing stays good for
   a long stretch of a session. */
export const GAME_STALE_MS = 15 * 60_000;

/** How often an answer the object index build has not given asks again. */
export const BUILDING_POLL_MS = 1000;

export const gameKeys = {
  wads: ["game-wads"] as const,
  wad: (wadName: string) => ["game-wad", wadName] as const,
  index: ["game-index"] as const,
  dirs: ["game-dir"] as const,
  dir: (path: string) => ["game-dir", path] as const,
  search: (query: string) => ["game-search", query] as const,
  objectSearches: ["object-search"] as const,
  objectSearch: (query: string) => ["object-search", query] as const,
  /* Under the searches, so the invalidation that follows a warm or a drop
     refetches this answer with them. */
  declaredObjects: (objectHashes: readonly string[]) =>
    ["object-search", "declared", objectHashes] as const,
  find: (pattern: string, regex: boolean) => ["game-find", pattern, regex] as const,
};
