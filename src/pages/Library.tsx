import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useToast } from "@/components";
import { useHddWarning, usePlatformSupport } from "@/hooks";
import { api } from "@/lib/tauri";
import {
  checkModForSkinhack,
  DragDropOverlay,
  ImportProgressDialog,
  LibraryContent,
  LibraryToolbar,
  useFilteredMods,
  useFilterOptions,
  useInstalledMods,
  useLibraryActions,
  useModFileDrop,
} from "@/modules/library";
import { MigrationBanner, MigrationWizardDialog } from "@/modules/migration";
import {
  PatcherUnsupported,
  StatusBar,
  usePatcherStatus,
  useStartPatcher,
  useStopPatcher,
} from "@/modules/patcher";
import { useSaveSettings, useSettings } from "@/modules/settings";

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
  const toast = useToast();

  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const { data: patcherStatus } = usePatcherStatus();
  const startPatcher = useStartPatcher();
  const stopPatcher = useStopPatcher();
  const maybeShowHddWarning = useHddWarning();

  const isStarting = patcherStatus?.phase === "building";
  const isPatcherActive = patcherStatus?.running ?? false;

  const filterOptions = useFilterOptions(mods);
  const hasEnabledMods = mods.some((m) => m.enabled);
  const visibleMods = useFilteredMods(mods, searchQuery);

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
    // Check enabled mods for skinhacks and force-disable any flagged ones
    const enabledMods = mods.filter((m) => m.enabled);
    const flaggedMods = enabledMods.filter((m) => checkModForSkinhack(m) != null);

    for (const mod of flaggedMods) {
      await api.toggleMod(mod.id, false);
      toast.warning(
        "Skinhack Excluded",
        `"${mod.displayName}" was detected as a skinhack and won't be loaded`,
      );
    }

    // If all enabled mods were flagged, don't start the patcher
    if (flaggedMods.length >= enabledMods.length) {
      return;
    }

    await maybeShowHddWarning();

    startPatcher.mutate(
      {},
      {
        onError: (error) => {
          console.error("Failed to start patcher:", error.message);
        },
      },
    );
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
        patcher={
          patcherAvailable
            ? {
                status: patcherStatus,
                isStarting: isStarting,
                isStopping: stopPatcher.isPending,
                onStart: handleStartPatcher,
                onStop: handleStopPatcher,
              }
            : undefined
        }
        hasEnabledMods={hasEnabledMods}
        isLoading={isLoading}
        isPatcherActive={isPatcherActive}
        filterOptions={filterOptions}
        visibleMods={visibleMods}
      />
      <StatusBar />
      <LibraryContent
        mods={mods}
        searchQuery={searchQuery}
        isLoading={isLoading}
        error={error}
        folderId={folderId}
      />
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
