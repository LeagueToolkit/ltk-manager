import { useMemo } from "react";

import type { AppError, InstalledMod } from "@/lib/tauri";
import {
  ModThumbnails,
  useLibraryContent,
  useReorderFolderMods,
  useReorderMods,
} from "@/modules/library/api";

import { FolderHeader } from "./FolderHeader";
import { LibraryContextMenu } from "./LibraryContextMenu";
import { LibraryEmptyState, LibraryErrorState, LibraryLoadingState } from "./LibraryStates";
import { SortableModList } from "./SortableModList";
import { UnifiedDndGrid } from "./UnifiedDndGrid";

interface LibraryContentProps {
  mods: InstalledMod[];
  searchQuery: string;
  isLoading: boolean;
  error: AppError | null;
  folderId?: string;
}

export function LibraryContent({
  mods,
  searchQuery,
  isLoading,
  error,
  folderId,
}: LibraryContentProps) {
  const { viewMode, dndDisabled, hasSelection, contentView } = useLibraryContent({
    mods,
    searchQuery,
    isLoading,
    /* A refetch that fails behind a library the reader already has is not worth
       replacing that library with. Every write to the index re-invalidates the
       library queries, so a state answering on `error` alone is one failed
       background refetch away from throwing the list out. */
    hasError: error !== null && mods.length === 0,
    folderId,
  });
  const modIds = useMemo(() => mods.map((mod) => mod.id), [mods]);
  const reorderMods = useReorderMods();
  const reorderFolderMods = useReorderFolderMods();

  // Extra bottom padding while the bar is up, so it never covers the last row.
  const scrollClass = hasSelection
    ? "flex-1 overflow-auto px-6 pt-6 pb-28"
    : "flex-1 overflow-auto p-6";

  function content() {
    if (contentView.type === "loading") return <LibraryLoadingState />;

    if (contentView.type === "error") return <LibraryErrorState error={error!} />;

    if (contentView.type === "empty") {
      return (
        <LibraryEmptyState hasSearch={contentView.hasSearch} hasFilters={contentView.hasFilters} />
      );
    }

    if (contentView.type === "flat") {
      return (
        <SortableModList
          mods={contentView.mods}
          viewMode={viewMode}
          onReorder={(ids) => reorderMods.mutate(ids)}
          disabled={dndDisabled}
        />
      );
    }

    if (contentView.type === "folder-drilldown") {
      return (
        <>
          <FolderHeader folder={contentView.folder} mods={contentView.mods} />
          <SortableModList
            mods={contentView.mods}
            viewMode={viewMode}
            onReorder={(ids) =>
              reorderFolderMods.mutate({ folderId: contentView.folder.id, modIds: ids })
            }
            disabled={dndDisabled}
            className="mt-4"
            folderId={contentView.folder.id}
          />
        </>
      );
    }

    return (
      <UnifiedDndGrid
        folders={contentView.folders}
        rootMods={contentView.rootMods}
        modsByFolder={contentView.modsByFolder}
        viewMode={viewMode}
        dndDisabled={dndDisabled}
        onReorder={(ids) => reorderMods.mutate(ids)}
      />
    );
  }

  /* One scroller for every state. Returning a different tree per state changed
     the element React reconciles at this position, so passing through loading,
     error or empty built a new scroller and the offset went with the old one. */
  return (
    <LibraryContextMenu>
      <div className={scrollClass}>
        <ModThumbnails modIds={modIds}>{content()}</ModThumbnails>
      </div>
    </LibraryContextMenu>
  );
}
