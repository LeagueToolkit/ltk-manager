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
    reorderDisabled,
    selectMode,
    contentView,
    detailsMod,
    setDetailsMod,
    editMod,
    setEditMod,
  } = useLibraryContent({
    mods,
    searchQuery,
    isLoading,
    hasError: error !== null,
    folderId,
  });
  const reorderMods = useReorderMods();
  const reorderFolderMods = useReorderFolderMods();

  // Extra bottom padding in select mode so the floating action bar never covers the last row.
  const scrollClass = selectMode
    ? "flex-1 overflow-auto px-6 pt-6 pb-28"
    : "flex-1 overflow-auto p-6";

  if (contentView.type === "loading") {
    return (
      <div className="flex-1 overflow-auto p-6">
        <LibraryLoadingState />
      </div>
    );
  }

  if (contentView.type === "error") {
    return (
      <div className="flex-1 overflow-auto p-6">
        <LibraryErrorState error={error!} />
      </div>
    );
  }

  if (contentView.type === "empty") {
    return (
      <div className="flex-1 overflow-auto p-6">
        <LibraryEmptyState hasSearch={contentView.hasSearch} hasFilters={contentView.hasFilters} />
      </div>
    );
  }

  if (contentView.type === "flat") {
    return (
      <>
        <LibraryContextMenu>
          <div className={scrollClass}>
            <SortableModList
              mods={contentView.mods}
              viewMode={viewMode}
              onReorder={(modIds) => reorderMods.mutate(modIds)}
              disabled={dndDisabled}
              onViewDetails={setDetailsMod}
              onEditMetadata={setEditMod}
              className={`${gridClass(viewMode)} stagger-enter`}
            />
          </div>
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

  if (contentView.type === "folder-drilldown") {
    return (
      <>
        <LibraryContextMenu>
          <div className={scrollClass}>
            <FolderHeader folder={contentView.folder} mods={contentView.mods} />
            <SortableModList
              mods={contentView.mods}
              viewMode={viewMode}
              onReorder={(modIds) =>
                reorderFolderMods.mutate({ folderId: contentView.folder.id, modIds })
              }
              disabled={dndDisabled}
              reorderDisabled={reorderDisabled}
              onViewDetails={setDetailsMod}
              onEditMetadata={setEditMod}
              className={`${gridClass(viewMode)} stagger-enter mt-4`}
              folderId={contentView.folder.id}
            />
          </div>
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

  return (
    <>
      <LibraryContextMenu>
        <div className={scrollClass}>
          <UnifiedDndGrid
            folders={contentView.folders}
            rootMods={contentView.rootMods}
            modsByFolder={contentView.modsByFolder}
            viewMode={viewMode}
            dndDisabled={dndDisabled}
            reorderDisabled={reorderDisabled}
            onReorder={(modIds) => reorderMods.mutate(modIds)}
            onViewDetails={setDetailsMod}
            onEditMetadata={setEditMod}
          />
        </div>
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
