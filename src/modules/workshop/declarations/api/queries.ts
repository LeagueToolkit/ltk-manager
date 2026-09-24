import { queryOptions, skipToken } from "@tanstack/react-query";

import { api, type AppError, type DeclarationsLayer } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { CONTENT_SCAN_STALE_MS } from "../../shared/api/freshness";
import { DECLARATIONS_OUTLINE_ROOT } from "../../shared/api/keys";

export const declarationQueries = {
  /* Refetched on focus the way the content tree is, because the manifest is as editable
     from outside the app as the layer it sits in. A declared edit invalidates the root. */
  outline: (projectPath: string | undefined) =>
    queryOptions<DeclarationsLayer[], AppError>({
      queryKey: [...DECLARATIONS_OUTLINE_ROOT, projectPath ?? ""],
      queryFn: projectPath
        ? async () => unwrapForQuery(await api.declarations.outline(projectPath))
        : skipToken,
      refetchOnWindowFocus: true,
      staleTime: CONTENT_SCAN_STALE_MS,
    }),
} as const;
