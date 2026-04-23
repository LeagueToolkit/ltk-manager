import { CheckSquare, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, useToast } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import { useBulkUninstallMods, useInstalledMods } from "@/modules/library/api";
import { usePatcherStatus } from "@/modules/patcher";
import { useLibrarySelectionStore } from "@/stores";

import { BulkUninstallDialog } from "./BulkUninstallDialog";

interface SelectionActionBarProps {
  visibleMods: InstalledMod[];
}

export function SelectionActionBar({ visibleMods }: SelectionActionBarProps) {
  const selectedIds = useLibrarySelectionStore((s) => s.selectedIds);
  const selectAll = useLibrarySelectionStore((s) => s.selectAll);
  const clear = useLibrarySelectionStore((s) => s.clear);
  const exitSelectMode = useLibrarySelectionStore((s) => s.exitSelectMode);

  const { data: patcherStatus } = usePatcherStatus();
  const patcherRunning = patcherStatus?.running ?? false;

  const bulkUninstall = useBulkUninstallMods();
  const toast = useToast();

  const { data: allMods = [] } = useInstalledMods();

  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedMods = useMemo(
    () => allMods.filter((m) => selectedIds.has(m.id)),
    [allMods, selectedIds],
  );
  const selectedCount = selectedIds.size;

  const visibleIds = useMemo(() => visibleMods.map((m) => m.id), [visibleMods]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function handleSelectAllVisible() {
    const union = new Set(selectedIds);
    for (const id of visibleIds) union.add(id);
    selectAll([...union]);
  }

  function handleClear() {
    clear();
  }

  function handleOpenDialog() {
    if (selectedCount === 0) return;
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    if (bulkUninstall.isPending) return;
    setDialogOpen(false);
  }

  async function handleConfirmUninstall() {
    const ids = [...selectedIds];
    try {
      const result = await bulkUninstall.mutateAsync(ids);
      setDialogOpen(false);

      if (result.failed.length === 0) {
        toast.success(
          "Mods uninstalled",
          `${result.succeeded.length} mod${result.succeeded.length === 1 ? "" : "s"} removed`,
        );
      } else if (result.succeeded.length === 0) {
        toast.error(
          "Uninstall failed",
          `All ${result.failed.length} mod${result.failed.length === 1 ? "" : "s"} failed to uninstall`,
        );
      } else {
        toast.warning(
          "Uninstall completed with errors",
          `${result.succeeded.length} removed, ${result.failed.length} failed`,
        );
      }

      exitSelectMode();
    } catch (error: unknown) {
      toast.error("Uninstall failed", error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-t border-surface-600 bg-surface-800/70 px-4 py-2">
        <span className="text-sm text-surface-200">
          <span className="font-semibold text-accent-400">{selectedCount}</span> selected
        </span>

        <div className="h-5 w-px bg-surface-600" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSelectAllVisible}
          disabled={visibleIds.length === 0 || allVisibleSelected}
          left={<CheckSquare className="h-4 w-4" />}
        >
          Select all visible ({visibleIds.length})
        </Button>

        <Button variant="ghost" size="sm" onClick={handleClear} disabled={selectedCount === 0}>
          Clear
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="filled"
            size="sm"
            onClick={handleOpenDialog}
            loading={bulkUninstall.isPending}
            disabled={selectedCount === 0 || patcherRunning}
            left={<Trash2 className="h-4 w-4" />}
            className="bg-red-600 hover:bg-red-500"
          >
            Uninstall {selectedCount > 0 ? selectedCount : ""} mod{selectedCount === 1 ? "" : "s"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={exitSelectMode}
            disabled={bulkUninstall.isPending}
            left={<X className="h-4 w-4" />}
          >
            Exit
          </Button>
        </div>
      </div>

      <BulkUninstallDialog
        open={dialogOpen}
        mods={selectedMods}
        isPending={bulkUninstall.isPending}
        onClose={handleCloseDialog}
        onConfirm={handleConfirmUninstall}
      />
    </>
  );
}
