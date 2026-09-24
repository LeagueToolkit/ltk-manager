import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, type AppError, type ClassDocs } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

export const classDocsKeys = {
  sync: () => ["class-docs", "sync"] as const,
  class: (classHash: string, revision: number | null) =>
    ["class-docs", classHash, revision] as const,
};

/** Queries for the meta wiki's documentation, read from the backend's cache. */
export const classDocsQueries = {
  /* Refreshes the backend's cache once per session, per "The wiki's prose" in
     docs/ux/BIN_EDITOR.md. Returns the revision that class queries are keyed on, so a copy
     installed mid-session is fetched again. */
  sync: () =>
    queryOptions<number, AppError>({
      queryKey: classDocsKeys.sync(),
      queryFn: async () => unwrapForQuery(await api.bin.syncMetaDocs()),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    }),
  /* Null when neither the class nor any of its bases is documented. */
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
 * The wiki's documentation for one class and the fields declared on it and its bases.
 *
 * Reads the cached copy immediately, and again when the session's refresh installs a newer
 * one. The previous result stays displayed until then.
 */
export function useClassDocs(classHash: string | null) {
  const { data: revision = null } = useQuery(classDocsQueries.sync());

  return useQuery({
    ...classDocsQueries.forClass(classHash, revision),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === classHash ? previous : undefined,
  });
}
