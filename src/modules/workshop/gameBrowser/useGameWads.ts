import { useQuery } from "@tanstack/react-query";

import { gameQueries } from "./queries";

/** Every WAD archive of the installed game. Errors when no League path is set. */
export function useGameWads() {
  return useQuery(gameQueries.wads());
}
