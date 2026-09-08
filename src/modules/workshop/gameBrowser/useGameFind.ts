import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";

import { gameQueries } from "./queries";

/**
 * How long the box waits before it asks the backend.
 *
 * Longer than the palette's 120ms, because a full search hands back every hit
 * rather than a ranked page, so a keystroke costs more to answer.
 */
export const FIND_DEBOUNCE_MS = 200;

/**
 * Every file of the installed game matching `pattern`, in tree order.
 *
 * `regex` reads the pattern as a regular expression, and either way the match
 * is case-insensitive.
 */
export function useGameFind(pattern: string, regex: boolean) {
  const debounced = useDebouncedValue(pattern, FIND_DEBOUNCE_MS);

  return useQuery(gameQueries.find(debounced, regex, debounced.length > 0));
}
