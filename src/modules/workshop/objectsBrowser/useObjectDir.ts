import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import type { ObjectDir, ObjectDirListing } from "@/lib/tauri";

import { objectTreeQueries } from "./queries";

export { objectKeys } from "./keys";

const EMPTY_LISTING: ObjectDirListing = { prefixes: [], objects: [] };

/**
 * One prefix of the object tree, `""` for the root, in the slot the index is in.
 *
 * An answer the build has not given asks again each second until it lands.
 */
export function useObjectDir(prefix: string) {
  return useQuery(objectTreeQueries.dir(prefix));
}

/**
 * The listing of every expanded prefix, null where one is on its way.
 *
 * `prefixes` must be referentially stable across renders, or the combined map
 * loses its memoization and the whole tree rebuilds.
 */
export function useObjectDirs(
  prefixes: readonly string[],
): ReadonlyMap<string, ObjectDirListing | null> {
  const combine = useCallback(
    (results: ReadonlyArray<{ data?: ObjectDir; isError: boolean }>) => {
      const byPrefix = new Map<string, ObjectDirListing | null>();
      prefixes.forEach((prefix, index) => {
        const result = results[index];
        /* A prefix the index no longer holds - a rebuild under an expansion the
           store kept - reads as empty rather than as a row that spins forever. */
        if (result?.isError) {
          byPrefix.set(prefix, EMPTY_LISTING);
          return;
        }
        byPrefix.set(prefix, result?.data?.status === "ready" ? result.data : null);
      });
      return byPrefix;
    },
    [prefixes],
  );

  return useQueries({ queries: prefixes.map((prefix) => objectTreeQueries.dir(prefix)), combine });
}
