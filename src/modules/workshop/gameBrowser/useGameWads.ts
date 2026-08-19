import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type GameWadSummary } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

/* The install only changes when Riot patches it, so a listing stays good for
   a long stretch of a session. */
export const GAME_STALE_MS = 15 * 60_000;

export const gameKeys = {
  wads: ["game-wads"] as const,
  wad: (wadName: string) => ["game-wad", wadName] as const,
  index: ["game-index"] as const,
  dirs: ["game-dir"] as const,
  dir: (path: string) => ["game-dir", path] as const,
};

/** Every WAD archive of the installed game. Errors when no League path is set. */
export function useGameWads() {
  return useQuery<GameWadSummary[], AppError>({
    queryKey: gameKeys.wads,
    queryFn: queryFn(api.getGameWads),
    staleTime: GAME_STALE_MS,
  });
}
