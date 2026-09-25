import { useQuery } from "@tanstack/react-query";
import { use, useMemo } from "react";

import type { SearchPreference } from "@/lib/tauri";

import { useProjectContentTree } from "../../../content/api/useProjectContentTree";
import { gameQueries } from "../../../gameBrowser/api/queries";
import { useGamePathSearch } from "../../../gameBrowser/api/useGamePathSearch";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { LinkAssetContext } from "../../links/hooks/useLinkTargets";
import { chunkPath } from "../../links/utils/linkDecision";
import type { PathField } from "../utils/pathField";
import {
  archiveOf,
  folderOf,
  openingGroups,
  type PathGroup,
  projectFiles,
  searchGroups,
} from "../utils/pathSuggestions";

const NO_GROUPS: readonly PathGroup[] = [];

/** What a path field's list shows for its draft. */
export interface PathSuggestions {
  readonly groups: readonly PathGroup[];
  /** Game files that matched the query but are not in the game group. */
  readonly more: number;
  /** The game search for the current query has not returned yet. */
  readonly searching: boolean;
}

interface PathSuggestionsOptions {
  field: PathField;
  /** The field's current value. */
  value: string;
  /** The typed search, or null while the draft is untouched or cleared. */
  query: string | null;
  /** The list is open. The game is searched only while it is open. */
  open: boolean;
}

/**
 * The project's files and the game's for one path field, per "A path field" in
 * docs/ux/BIN_EDITOR.md.
 *
 * The project matches on the frontend, which already has its tree, and the game in
 * Rust, which has the index.
 */
export function usePathSuggestions({
  field,
  value,
  query,
  open,
}: PathSuggestionsOptions): PathSuggestions {
  const project = useOptionalProjectContext();
  const asset = use(LinkAssetContext);
  const tree = useProjectContentTree(open ? project?.path : undefined);
  const files = useMemo(() => (tree.data ? projectFiles(tree.data) : []), [tree.data]);

  const preference = useMemo<SearchPreference>(
    () => ({ extensions: [...field.extensions], archive: archiveOf(asset) }),
    [field.extensions, asset],
  );
  const search = useGamePathSearch(query ?? "", preference, open && query !== null);

  const folder = folderOf(chunkPath(value));
  const listing = useQuery({
    ...gameQueries.dir(folder ?? ""),
    enabled: open && query === null && folder !== null,
  });

  const groups = useMemo(() => {
    if (!open) return NO_GROUPS;
    if (query === null) {
      return openingGroups(files, value, field.extensions, listing.data?.files ?? []);
    }

    return searchGroups(files, query, value, field.extensions, search.data?.hits ?? []);
  }, [open, query, files, value, field.extensions, listing.data, search.data]);

  const more = query !== null && search.data ? search.data.total - search.data.hits.length : 0;

  return { groups, more, searching: query !== null && search.isFetching };
}
