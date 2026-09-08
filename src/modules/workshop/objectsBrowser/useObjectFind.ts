import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";

import { FIND_DEBOUNCE_MS } from "../gameBrowser/useGameFind";
import { splitClassTerm } from "../palette/classTerm";
import { objectTreeQueries } from "./queries";

/**
 * Every object of the install matching the box, in path order.
 *
 * The `class:` term comes off the pattern the way the palette reads it and crosses
 * as its own argument.
 */
export function useObjectFind(input: string, regex: boolean) {
  const debounced = useDebouncedValue(input, FIND_DEBOUNCE_MS);
  const term = splitClassTerm(debounced);
  const pattern = term === null ? debounced.trim() : term.rest;
  const cls = term === null ? null : term.value;
  const active = pattern.length > 0 || cls !== null;

  return useQuery(objectTreeQueries.find(pattern, regex, cls, active));
}
