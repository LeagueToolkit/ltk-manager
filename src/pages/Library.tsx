import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePlatformSupport } from "@/hooks";
import { m } from "@/i18n";
import type { InstalledMod } from "@/lib/tauri";
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
  clampDrawerWidth,
  useBulkUninstallDialog,
  useFilterOptions,
  useInstalledMods,
  useLibraryActions,
  useLibraryHotkeys,
  useLibrarySelectionStore,
  useLibrarySidebarStore,
  useModFileDrop,
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

/** How far one arrow key moves the edge. */
const KEY_STEP = 16;

/**
 * The grid, with the documents drawer over its right edge once a reader opens one.
 *
 * A drawer rather than a pane on a seam: opening one asks a question about a
 * mod rather than changing the library, so the cards underneath keep the
 * positions they were being read in. Per "The drawer, and what its width does" in
 * `docs/ux/LIBRARY.md`.
 */
function LibraryBody({ mods, children }: { mods: InstalledMod[]; children: ReactNode }) {
  const open = useLibrarySidebarStore((s) => s.open);

  return (
    <div className="relative mx-2 flex min-h-0 flex-1 flex-col">
      {children}
      {open && <DocumentsDrawer mods={mods} />}
    </div>
  );
}

/** The drawer, and the edge a reader drags to decide how much it covers. */
function DocumentsDrawer({ mods }: { mods: InstalledMod[] }) {
  const width = useLibrarySidebarStore((s) => s.width);
  const setWidth = useLibrarySidebarStore((s) => s.setWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function resize(next: number) {
    setWidth(clampDrawerWidth(next, window.innerWidth));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    resize(drag.current.startWidth - (event.clientX - drag.current.startX));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resize(width + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
  }

  return (
    <div
      data-ui="DocumentsDrawer"
      style={{ width }}
      className="animate-drawer-in absolute inset-y-0 right-0 z-20 max-w-full shadow-xl"
    >
      <DocumentsSidebar mods={mods} />

      {/* Last, so the tab order is the drawer's own content before the one
          control that only changes the shape of it. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={m.library_documents_resize_action()}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeys}
        className="group/handle absolute inset-y-6 left-0 z-10 w-1.5 cursor-col-resize outline-none"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover/handle:bg-accent-500/60 group-focus-visible/handle:bg-accent-500"
        />
      </div>
    </div>
  );
}
