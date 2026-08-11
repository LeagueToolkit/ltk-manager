import { type ReactNode, useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useHddWarning, usePlatformSupport } from "@/hooks";
import {
  DragDropOverlay,
  ImportProgressDialog,
  LibraryContent,
  LibraryToolbar,
  SelectionActionBar,
  useFilteredMods,
  useFilterOptions,
  useInstalledMods,
  useLibraryActions,
  useModFileDrop,
} from "@/modules/library";
import { MigrationBanner, MigrationWizardDialog } from "@/modules/migration";
import {
  PatcherEventListeners,
  PatcherUnsupported,
  useGuardedStartPatcher,
  usePatcherStatus,
  useStopPatcher,
} from "@/modules/patcher";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { useLibraryFilterStore, useLibrarySelectionStore } from "@/stores";

interface LibraryProps {
  folderId?: string;
}

export function Library({ folderId }: LibraryProps = {}) {
  const searchQuery = useLibraryFilterStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryFilterStore((state) => state.setSearchQuery);
  const [migrationOpen, setMigrationOpen] = useState(false);

  const { data: platform } = usePlatformSupport();
  const patcherAvailable = platform?.patcherAvailable ?? true;

  const { data: mods = [], isLoading, error } = useInstalledMods();
  const actions = useLibraryActions();
  const isDragOver = useModFileDrop(actions.handleBulkInstallFiles);

  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const { data: patcherStatus } = usePatcherStatus();
  const { start: guardedStart } = useGuardedStartPatcher();
  const stopPatcher = useStopPatcher();
  const maybeShowHddWarning = useHddWarning();

  const isPatcherActive = patcherStatus?.running ?? false;

  const filterOptions = useFilterOptions(mods);
  const visibleMods = useFilteredMods(mods, searchQuery);

  const setOrderedIds = useLibrarySelectionStore((s) => s.setOrderedIds);
  useEffect(() => {
    setOrderedIds(visibleMods.map((m) => m.id));
  }, [visibleMods, setOrderedIds]);

  useHotkeys("ctrl+i", () => actions.handleInstallMod(), {
    preventDefault: true,
    enabled: !isPatcherActive,
  });
  useHotkeys(
    "ctrl+p",
    () => {
      if (patcherStatus?.running) {
        handleStopPatcher();
      } else {
        handleStartPatcher();
      }
    },
    { preventDefault: true },
  );

  async function handleStartPatcher() {
    await maybeShowHddWarning();

    // Shared start path: force-disables skinhacks, then starts. Linked-bin
    // offenders surface afterwards via badges + a warning toast, not a pre-flight.
    await guardedStart({});
  }

  function handleStopPatcher() {
    stopPatcher.mutate(undefined, {
      onError: (error) => {
        console.error("Failed to stop patcher:", error.message);
      },
    });
  }

  function handleDismissMigration() {
    if (!settings) return;
    saveSettings.mutate({ ...settings, migrationDismissed: true });
  }

  return (
    <div className="relative flex h-full flex-col">
      <DragDropOverlay visible={isDragOver} />
      {settings && !settings.migrationDismissed && (
        <MigrationBanner
          onImport={() => setMigrationOpen(true)}
          onDismiss={handleDismissMigration}
        />
      )}
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
      <PatcherEventListeners />
      {/* Its own positioning context so the floating selection bar rides above
          the mod list rather than the session bar below it. */}
      <LibraryInteractionRegion visibleMods={visibleMods} patcherActive={isPatcherActive}>
        <LibraryContent
          mods={mods}
          searchQuery={searchQuery}
          isLoading={isLoading}
          error={error}
          folderId={folderId}
        />
      </LibraryInteractionRegion>
      <ImportProgressDialog
        open={actions.importDialogOpen}
        onClose={actions.handleCloseImportDialog}
        progress={actions.installProgress}
        result={actions.importResult}
      />
      <MigrationWizardDialog open={migrationOpen} onClose={() => setMigrationOpen(false)} />
    </div>
  );
}

function LibraryInteractionRegion({
  visibleMods,
  patcherActive,
  children,
}: {
  visibleMods: ReturnType<typeof useFilteredMods>;
  patcherActive: boolean;
  children: ReactNode;
}) {
  const selectMode = useLibrarySelectionStore((state) => state.selectMode);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-library-select-mode={selectMode}
      data-library-patcher-active={patcherActive}
      onPointerDownCapture={(event) => {
        if (
          (selectMode || patcherActive) &&
          (event.target as Element).closest("[data-library-sortable]")
        ) {
          event.stopPropagation();
        }
      }}
      onClickCapture={(event) => {
        if (patcherActive && (event.target as Element).closest(".mod-card")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenuCapture={(event) => {
        if (patcherActive && (event.target as Element).closest(".mod-card")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        const isDndActivation = event.key === " " || event.key === "Enter";
        if (
          (selectMode || patcherActive) &&
          isDndActivation &&
          (event.target as Element).closest("[data-library-sortable]")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
      {selectMode && <SelectionActionBar visibleMods={visibleMods} />}
    </div>
  );
}
