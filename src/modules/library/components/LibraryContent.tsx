import { useRef } from "react";

import type { AppError, InstalledMod } from "@/lib/tauri";
import { useLibraryContent, useReorderFolderMods, useReorderMods } from "@/modules/library/api";

import { EditMetadataDialog } from "./EditMetadataDialog";
import { FolderHeader } from "./FolderHeader";
import { LibraryContextMenu } from "./LibraryContextMenu";
import { LibraryEmptyState, LibraryErrorState, LibraryLoadingState } from "./LibraryStates";
import { ModDetailsDialog } from "./ModDetailsDialog";
import { SortableModList } from "./SortableModList";
import { gridClass, UnifiedDndGrid } from "./UnifiedDndGrid";

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
  const {
    viewMode,
    dndDisabled,
    hasSelection,
    contentView,
    detailsMod,
    setDetailsMod,
    editMod,
    setEditMod,
  } = useLibraryContent({
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
  const reorderMods = useReorderMods();
  const reorderFolderMods = useReorderFolderMods();

  /* The stagger is an entrance, so it belongs to the first list the reader is
     shown and not to every reorder after it. A replay restarts each card from
     opacity 0, which reads as the list blinking. */
  const staggeredRef = useRef(false);
  const isList =
    contentView.type === "flat" ||
    contentView.type === "folder-drilldown" ||
    contentView.type === "unified";
  const stagger = isList && !staggeredRef.current ? " stagger-enter" : "";
  if (isList) staggeredRef.current = true;

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
          onViewDetails={setDetailsMod}
          onEditMetadata={setEditMod}
          className={`${gridClass(viewMode)}${stagger}`}
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
            onViewDetails={setDetailsMod}
            onEditMetadata={setEditMod}
            className={`${gridClass(viewMode)}${stagger} mt-4`}
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
        onViewDetails={setDetailsMod}
        onEditMetadata={setEditMod}
      />
    );
  }

  /* One scroller for every state. Returning a different tree per state changed
     the element React reconciles at this position, so passing through loading,
     error or empty built a new scroller and the offset went with the old one. */
  return (
    <>
      <LibraryContextMenu>
        <div className={scrollClass}>{content()}</div>
      </LibraryContextMenu>
      <ModDetailsDialog
        open={detailsMod !== null}
        mod={detailsMod}
        onClose={() => setDetailsMod(null)}
      />
      {editMod && (
        <EditMetadataDialog
          mod={editMod}
          open={editMod !== null}
          onOpenChange={(open) => !open && setEditMod(null)}
        />
      )}
    </>
  );
}
