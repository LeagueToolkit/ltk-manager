import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { getLocale, m } from "@/i18n";
import { api, type BulkInstallResult, unwrap } from "@/lib/tauri";
import { checkModForSkinhack } from "@/modules/library/utils/skinhackCheck";

import { MOD_ARCHIVE_EXTENSIONS } from "./modArchive";
import { useBulkInstallMods } from "./useBulkInstallMods";
import { useInstallMod } from "./useInstallMod";
import { useInstallProgress } from "./useInstallProgress";
import { useReorderMods } from "./useReorderMods";
import { useSetModsEnabled } from "./useSetModsEnabled";
import { useToggleMod } from "./useToggleMod";
import { useUninstallMod } from "./useUninstallMod";

export function useLibraryActions() {
  const installMod = useInstallMod();
  const bulkInstallMods = useBulkInstallMods();
  const toggleMod = useToggleMod();
  const uninstallMod = useUninstallMod();
  const reorderMods = useReorderMods();
  const { setEnabled } = useSetModsEnabled();
  const toast = useToast();

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<BulkInstallResult | null>(null);
  const { progress: installProgress, reset: resetInstallProgress } = useInstallProgress();

  async function handleImportMods() {
    const files = await open({
      multiple: true,
      filters: [
        { name: m.library_import_archives_filter_label(), extensions: [...MOD_ARCHIVE_EXTENSIONS] },
        { name: "Modpkg", extensions: ["modpkg"] },
        { name: "Fantome", extensions: ["fantome", "zip"] },
      ],
    });

    if (!files) return;

    // Normalize: open() returns string | string[] depending on multiple flag
    const filePaths = Array.isArray(files) ? files : [files];

    if (filePaths.length === 1) {
      installMod.mutate(filePaths[0], {
        onError: (error) => {
          console.error("Failed to install mod:", error);
        },
      });
    } else if (filePaths.length > 1) {
      handleBulkInstallFiles(filePaths);
    }
  }

  function handleBulkInstallFiles(filePaths: string[]) {
    if (filePaths.length === 0) return;

    if (filePaths.length === 1) {
      installMod.mutate(filePaths[0], {
        onError: (error) => {
          console.error("Failed to install mod:", error);
        },
      });
      return;
    }

    setImportResult(null);
    resetInstallProgress();
    setImportDialogOpen(true);

    bulkInstallMods.mutate(filePaths, {
      onSuccess: (result) => {
        setImportResult(result);

        // Check installed mods for skinhacks and disable any flagged ones
        for (const mod of [...result.installed, ...result.updated]) {
          const flag = checkModForSkinhack(mod);
          if (flag) {
            api.toggleMod(mod.id, false);
            toast.warning(
              m.library_install_skinhack_title(),
              m.library_install_skinhack_description({ name: mod.displayName }),
            );
          }
        }

        announceImport(result);
      },
      onError: (error) => {
        handleCloseImportDialog();
        toast.failure(m.library_import_failed_title(), error);
      },
    });
  }

  function announceImport({ installed, updated, alreadyInstalled, failed }: BulkInstallResult) {
    const changed = installed.length + updated.length;
    const summary = new Intl.ListFormat(getLocale(), { style: "short", type: "unit" }).format(
      [
        installed.length > 0 &&
          m.library_import_summary_installed_label({ count: installed.length }),
        updated.length > 0 && m.library_import_summary_updated_label({ count: updated.length }),
        alreadyInstalled.length > 0 &&
          m.library_import_summary_existing_label({ count: alreadyInstalled.length }),
        failed.length > 0 && m.library_import_summary_failed_label({ count: failed.length }),
      ].filter((part) => part !== false),
    );

    if (failed.length > 0 && changed === 0 && alreadyInstalled.length === 0) {
      toast.error(
        m.library_import_failed_title(),
        m.library_import_failed_description({ count: failed.length }),
      );
    } else if (failed.length > 0) {
      toast.warning(m.library_import_partial_title(), summary);
    } else if (changed === 0) {
      toast.info(
        m.library_import_already_installed_title(),
        m.library_import_already_installed_description({ count: alreadyInstalled.length }),
      );
    } else if (installed.length === 0) {
      toast.success(m.library_import_updated_title(), summary);
    } else {
      toast.success(m.library_import_installed_title(), summary);
    }
  }

  function handleCloseImportDialog() {
    setImportDialogOpen(false);
    setImportResult(null);
    resetInstallProgress();
  }

  function handleToggleMod(modId: string, enabled: boolean) {
    toggleMod.mutate(
      { modId, enabled },
      {
        onError: (error) => {
          console.error("Failed to toggle mod:", error);
        },
      },
    );
  }

  function handleUninstallMod(modId: string) {
    uninstallMod.mutate(modId, {
      onError: (error) => {
        console.error("Failed to uninstall mod:", error);
      },
    });
  }

  function handleReorder(modIds: string[]) {
    reorderMods.mutate(modIds);
  }

  async function handleOpenStorageDirectory() {
    try {
      const result = await api.getStorageDirectory();
      const path = unwrap(result);
      await api.revealInExplorer(path);
    } catch (error: unknown) {
      toast.failure(m.library_storage_open_failed_title(), error);
    }
  }

  return {
    installMod,
    bulkInstallMods,
    toggleMod,
    handleImportMods,
    handleBulkInstallFiles,
    handleToggleMod,
    handleSetEnabledForMods: setEnabled,
    handleUninstallMod,
    handleReorder,
    handleOpenStorageDirectory,
    importDialogOpen,
    importResult,
    installProgress,
    handleCloseImportDialog,
  };
}
