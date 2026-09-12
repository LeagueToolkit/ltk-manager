import { type ReactNode, useEffect, useState } from "react";
import { Group, Panel } from "react-resizable-panels";

import { usePlatformSupport } from "@/hooks";
import type { InstalledMod } from "@/lib/tauri";
import { Seam } from "@/modules/editor";
import { PlayButton } from "@/modules/launcher";
import {
  DocumentsSidebar,
  DragDropOverlay,
  ImportProgressDialog,
  LibraryContent,
  LibraryDialogs,
  LibraryToolbar,
  ModHealthSweep,
  SelectionActionBar,
  useBulkUninstallDialog,
  useFilterOptions,
  useInstalledMods,
  useLibraryActions,
  useLibraryHotkeys,
  useLibrarySelectionStore,
  useLibrarySidebarStore,
  useModFileDrop,
  useOverlaidSidebar,
  useVisibleMods,
} from "@/modules/library";
import { PatcherUnsupported, usePatcherStatus } from "@/modules/patcher";

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
      useBulkUninstallDialog.getState().close();
    },
    [],
  );

  const isInstalling = actions.installMod.isPending || actions.bulkInstallMods.isPending;

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
        playButton={<PlayButton disabled={isInstalling} />}
      />
      <LibraryBody mods={mods}>
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900/40">
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
      </LibraryBody>
      <LibraryDialogs />
      <ImportProgressDialog
        open={actions.importDialogOpen}
        onClose={actions.handleCloseImportDialog}
        progress={actions.installProgress}
        result={actions.importResult}
      />
    </div>
  );
}

/**
 * The grid, and the documents panel beside it once a reader opens one.
 *
 * Opening reflows rather than covering, so the cards a reader was comparing
 * stay readable. Under the fold there is no room for both, and the panel floats
 * over the grid instead of squeezing it or switching itself off.
 */
function LibraryBody({ mods, children }: { mods: InstalledMod[]; children: ReactNode }) {
  const open = useLibrarySidebarStore((s) => s.open);
  const split = useLibrarySidebarStore((s) => s.split);
  const setSplit = useLibrarySidebarStore((s) => s.setSplit);
  const overlaid = useOverlaidSidebar();

  if (!open) return <div className="mx-2 flex min-h-0 flex-1 flex-col">{children}</div>;

  if (overlaid) {
    return (
      <div className="relative mx-2 flex min-h-0 flex-1 flex-col">
        {children}
        <div className="absolute inset-y-0 right-0 z-20 w-90 max-w-full shadow-xl">
          <DocumentsSidebar mods={mods} />
        </div>
      </div>
    );
  }

  return (
    <Group
      orientation="horizontal"
      defaultLayout={split ?? undefined}
      onLayoutChanged={(layout, meta) => {
        if (meta.isUserInteraction) setSplit(layout);
      }}
      className="mx-2 flex min-h-0 flex-1"
    >
      <Panel id="grid" minSize={320} className="flex min-h-0 flex-col">
        {children}
      </Panel>
      <Seam orientation="horizontal" />
      <Panel id="documents" minSize={280} defaultSize={360} className="flex min-h-0 flex-col">
        <DocumentsSidebar mods={mods} />
      </Panel>
    </Group>
  );
}
