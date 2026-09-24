import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, type AppError, type ClassDocs } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

export const classDocsKeys = {
  sync: () => ["class-docs", "sync"] as const,
  class: (classHash: string, revision: number | null) =>
    ["class-docs", classHash, revision] as const,
};

/** The meta wiki's prose, read out of the cache the backend keeps. */
export const classDocsQueries = {
  /* The session's one request to the wiki, which the backend throttles across sessions
     too, per "The wiki's prose" in docs/ux/BIN_EDITOR.md. Answers the revision a class
     read is keyed on, so a copy that lands mid-session is read again. */
  sync: () =>
    queryOptions<number, AppError>({
      queryKey: classDocsKeys.sync(),
      queryFn: async () => unwrapForQuery(await api.bin.syncMetaDocs()),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    }),
  /* Null for a class with nothing documented along its bases. */
  forClass: (classHash: string | null, revision: number | null) =>
    queryOptions<ClassDocs | null, AppError>({
      queryKey: classDocsKeys.class(classHash ?? "", revision),
      queryFn: async () => unwrapForQuery(await api.bin.classDocs(classHash ?? "")),
      enabled: classHash !== null,
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    }),
} as const;

/**
 * The wiki's prose for one class and the fields it and its bases declare.
 *
 * Reads the cached copy at once and again when the session's refresh lands, keeping the
 * copy it has on screen until then.
 */
export function useClassDocs(classHash: string | null) {
  const { data: revision = null } = useQuery(classDocsQueries.sync());

  return useQuery({
    ...classDocsQueries.forClass(classHash, revision),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === classHash ? previous : undefined,
  });
}
