import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useHddWarning, usePlatformSupport } from "@/hooks";
import {
  DragDropOverlay,
  ImportProgressDialog,
  LibraryContent,
  LibraryToolbar,
  ModHealthSweep,
  SelectionActionBar,
  useFilteredMods,
  useFilterOptions,
  useInstalledMods,
  useLibraryActions,
  useModFileDrop,
} from "@/modules/library";
import { MigrationBanner, MigrationWizardDialog } from "@/modules/migration";
import {
  PatcherUnsupported,
  useGuardedStartPatcher,
  usePatcherStatus,
  useStopPatcher,
} from "@/modules/patcher";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { useLibrarySelectionStore } from "@/stores";

interface LibraryProps {
  folderId?: string;
}

export function Library({ folderId }: LibraryProps = {}) {
  const [searchQuery, setSearchQuery] = useState("");
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

  const selectMode = useLibrarySelectionStore((s) => s.selectMode);
  const setOrderedIds = useLibrarySelectionStore((s) => s.setOrderedIds);
  useEffect(() => {
    setOrderedIds(visibleMods.map((m) => m.id));
  }, [visibleMods, setOrderedIds]);

  useHotkeys("ctrl+i", () => actions.handleImportMods(), {
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
      <div className="relative mx-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900/40">
        <LibraryContent
          mods={mods}
          searchQuery={searchQuery}
          isLoading={isLoading}
          error={error}
          folderId={folderId}
        />
        {selectMode && <SelectionActionBar visibleMods={visibleMods} />}
        <ModHealthSweep />
      </div>
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
