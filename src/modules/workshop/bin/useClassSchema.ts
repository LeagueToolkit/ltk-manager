import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, type AppError, type ClassSchema } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

export const classSchemaKeys = {
  class: (classHash: string) => ["class-schema", classHash] as const,
};

/** What the meta schema says a class holds at the install's build. */
export const classSchemaQueries = {
  /* Null for a class the schema does not describe. Held for the session, per "The
     class card" in docs/ux/BIN_EDITOR.md. A null hash is a caller with no class in
     hand, or one drawing a surface that does not show the schema. */
  forClass: (classHash: string | null) =>
    queryOptions<ClassSchema | null, AppError>({
      queryKey: classSchemaKeys.class(classHash ?? ""),
      queryFn: async () => unwrapForQuery(await api.classSchema(classHash ?? "")),
      enabled: classHash !== null,
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    }),
} as const;

/** One class's fields and their declared kinds at the install's build. */
export function useClassSchema(classHash: string | null) {
  return useQuery(classSchemaQueries.forClass(classHash));
}
