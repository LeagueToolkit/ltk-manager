import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";

import { gameQueries } from "./queries";

/**
 * How long the box waits before it asks the backend.
 *
 * The project's own rows render on the keystroke. This one crosses IPC and
 * walks the whole install, so it waits for the typing to settle.
 */
export const SEARCH_DEBOUNCE_MS = 120;

/**
 * Rank every file of the installed game against `query`.
 *
 * The previous answer stays on screen while the next one arrives, so the group
 * does not empty and refill under the cursor between keystrokes.
 */
export function useGameSearch(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const active = enabled && debounced.trim().length > 0;

  return useQuery(gameQueries.search(debounced, active));
}
