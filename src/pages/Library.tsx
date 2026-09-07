import { useEffect, useState } from "react";

import { usePlatformSupport } from "@/hooks";
import {
  BulkUninstallDialog,
  DragDropOverlay,
  ImportProgressDialog,
  LibraryContent,
  LibraryToolbar,
  ModHealthSweep,
  SelectionActionBar,
  useFilterOptions,
  useInstalledMods,
  useLibraryActions,
  useLibraryHotkeys,
  useModFileDrop,
  useVisibleMods,
} from "@/modules/library";
import { PatcherUnsupported, usePatcherStatus } from "@/modules/patcher";
import { useLibraryDialogsStore, useLibrarySelectionStore } from "@/stores";

interface LibraryProps {
  folderId?: string;
}

export function Library({ folderId }: LibraryProps = {}) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: platform } = usePlatformSupport();
  const patcherAvailable = platform?.patcherAvailable ?? true;

  const { data: mods = [], isLoading, error } = useInstalledMods();
  const actions = useLibraryActions();
  const isDragOver = useModFileDrop(actions.handleBulkInstallFiles);
  useLibraryHotkeys(actions.handleImportMods);

  const { data: patcherStatus } = usePatcherStatus();
  const isPatcherActive = patcherStatus?.running ?? false;

  const filterOptions = useFilterOptions(mods);
  const visibleMods = useVisibleMods(mods, searchQuery, folderId);

  const hasSelection = useLibrarySelectionStore((s) => s.selectedIds.size > 0);
  const setOrderedIds = useLibrarySelectionStore((s) => s.setOrderedIds);
  useEffect(() => {
    setOrderedIds(visibleMods.map((m) => m.id));
  }, [visibleMods, setOrderedIds]);

  /* A selection carried off this page would let Uninstall N act on mods the
     reader can no longer see, and a confirmation left standing would come back
     over a list that has moved on. */
  useEffect(
    () => () => {
      useLibrarySelectionStore.getState().clear();
      useLibraryDialogsStore.getState().closeBulkUninstallDialog();
    },
    [],
  );

  return (
    <div className="relative flex h-full flex-col">
      <DragDropOverlay visible={isDragOver} />
      {!patcherAvailable && (
        <div className="px-4 pt-3">
          <PatcherUnsupported />
        </div>
      )}
      <LibraryToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        actions={actions}
        isLoading={isLoading}
        isPatcherActive={isPatcherActive}
        filterOptions={filterOptions}
        visibleMods={visibleMods}
      />
      <div className="relative mx-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900/40">
        <LibraryContent
          mods={mods}
          searchQuery={searchQuery}
          isLoading={isLoading}
          error={error}
          folderId={folderId}
        />
        {hasSelection && <SelectionActionBar visibleMods={visibleMods} />}
        <ModHealthSweep />
      </div>
      <BulkUninstallDialog />
      <ImportProgressDialog
        open={actions.importDialogOpen}
        onClose={actions.handleCloseImportDialog}
        progress={actions.installProgress}
        result={actions.importResult}
      />
    </div>
  );
}
