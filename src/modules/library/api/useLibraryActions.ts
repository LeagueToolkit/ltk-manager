import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { useToast } from "@/components";
import { api, type BulkInstallResult, type InstalledMod, unwrap } from "@/lib/tauri";
import { checkModForSkinhack } from "@/modules/library/utils/skinhackCheck";

import { useBulkInstallMods } from "./useBulkInstallMods";
import { useInstallMod } from "./useInstallMod";
import { useInstallProgress } from "./useInstallProgress";
import { useReorderMods } from "./useReorderMods";
import { useToggleMod } from "./useToggleMod";
import { useUninstallMod } from "./useUninstallMod";

export function useLibraryActions() {
  const installMod = useInstallMod();
  const bulkInstallMods = useBulkInstallMods();
  const toggleMod = useToggleMod();
  const uninstallMod = useUninstallMod();
  const reorderMods = useReorderMods();
  const toast = useToast();

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<BulkInstallResult | null>(null);
  const { progress: installProgress, reset: resetInstallProgress } = useInstallProgress();

  async function handleInstallMod() {
    const files = await open({
      multiple: true,
      filters: [{ name: "Mod Package", extensions: ["modpkg", "fantome"] }],
    });

    if (!files) return;

    // Normalize: open() returns string | string[] depending on multiple flag
    const filePaths = Array.isArray(files) ? files : [files];

    if (filePaths.length === 1) {
      installMod.mutate(filePaths[0], {
        onError: (error) => {
          console.error("Failed to install mod:", error.message);
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
          console.error("Failed to install mod:", error.message);
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
        for (const mod of result.installed) {
          const flag = checkModForSkinhack(mod);
          if (flag) {
            api.toggleMod(mod.id, false);
            toast.warning("Skinhack Detected", `Skinhack detected in "${mod.displayName}"`);
          }
        }

        if (result.failed.length === 0) {
          toast.success(
            "Mods installed",
            `${result.installed.length} mod${result.installed.length !== 1 ? "s" : ""} installed successfully`,
          );
        } else if (result.installed.length === 0) {
          toast.error("Import failed", `All ${result.failed.length} files failed to import`);
        } else {
          toast.warning(
            "Import completed with errors",
            `${result.installed.length} installed, ${result.failed.length} failed`,
          );
        }
      },
      onError: (error) => {
        handleCloseImportDialog();
        toast.error("Import failed", error.message);
      },
    });
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
          console.error("Failed to toggle mod:", error.message);
        },
      },
    );
  }

  function handleSetEnabledForMods(mods: InstalledMod[], enabled: boolean) {
    const targets = mods.filter((m) => m.enabled !== enabled);
    if (targets.length === 0) return;

    for (const mod of targets) {
      toggleMod.mutate(
        { modId: mod.id, enabled },
        {
          onError: (error) => {
            console.error("Failed to toggle mod:", error.message);
          },
        },
      );
    }
  }

  function handleUninstallMod(modId: string) {
    uninstallMod.mutate(modId, {
      onError: (error) => {
        console.error("Failed to uninstall mod:", error.message);
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
      toast.error(
        "Failed to open directory",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    installMod,
    bulkInstallMods,
    toggleMod,
    handleInstallMod,
    handleBulkInstallFiles,
    handleToggleMod,
    handleSetEnabledForMods,
    handleUninstallMod,
    handleReorder,
    handleOpenStorageDirectory,
    importDialogOpen,
    importResult,
    installProgress,
    handleCloseImportDialog,
  };
}
