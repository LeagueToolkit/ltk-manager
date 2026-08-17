import { Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { Button, Checkbox, IconButton, Tooltip, useToast } from "@/components";
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
  const addMany = useLibrarySelectionStore((s) => s.addMany);
  const removeMany = useLibrarySelectionStore((s) => s.removeMany);
  const setSelection = useLibrarySelectionStore((s) => s.setSelection);
  const clear = useLibrarySelectionStore((s) => s.clear);
  const exitSelectMode = useLibrarySelectionStore((s) => s.exitSelectMode);

  const { data: patcherStatus } = usePatcherStatus();
  const patcherRunning = patcherStatus?.running ?? false;

  const bulkUninstall = useBulkUninstallMods();
  const toast = useToast();

  const { data: allMods = [] } = useInstalledMods();

  const [dialogOpen, setDialogOpen] = useState(false);
  // Snapshot of the mods to uninstall, frozen at confirm-dialog open so the optimistic
  // cache update (which empties the live selection mid-mutation) can't blank the preview.
  const [pendingMods, setPendingMods] = useState<InstalledMod[]>([]);

  const selectedMods = useMemo(
    () => allMods.filter((m) => selectedIds.has(m.id)),
    [allMods, selectedIds],
  );
  const selectedCount = selectedMods.length;

  const visibleIds = useMemo(() => visibleMods.map((m) => m.id), [visibleMods]);
  const visibleSelectedCount = useMemo(
    () => visibleMods.reduce((n, m) => n + (selectedIds.has(m.id) ? 1 : 0), 0),
    [visibleMods, selectedIds],
  );
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const hiddenCount = selectedCount - visibleSelectedCount;

  function handleOpenDialog() {
    if (selectedCount === 0) return;
    setPendingMods(selectedMods);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    if (bulkUninstall.isPending) return;
    setDialogOpen(false);
  }

  useHotkeys("escape", () => exitSelectMode(), { enabled: !dialogOpen }, [dialogOpen]);
  useHotkeys(
    "ctrl+a, meta+a",
    (e) => {
      e.preventDefault();
      addMany(visibleIds);
    },
    { enabled: !dialogOpen, preventDefault: true },
    [dialogOpen, visibleIds],
  );

  async function handleConfirmUninstall() {
    const ids = pendingMods.map((m) => m.id);
    if (ids.length === 0) return;

    try {
      const result = await bulkUninstall.mutateAsync(ids);
      setDialogOpen(false);

      if (result.failed.length === 0) {
        toast.success(
          "Mods uninstalled",
          `${result.succeeded.length} mod${result.succeeded.length === 1 ? "" : "s"} removed`,
        );
        exitSelectMode();
      } else if (result.succeeded.length === 0) {
        toast.error(
          "Uninstall failed",
          `All ${result.failed.length} mod${result.failed.length === 1 ? "" : "s"} failed to uninstall`,
        );
        setSelection(result.failed.map((f) => f.id));
      } else {
        toast.warning(
          "Uninstall completed with errors",
          `${result.succeeded.length} removed, ${result.failed.length} failed`,
        );
        setSelection(result.failed.map((f) => f.id));
      }
    } catch (error: unknown) {
      toast.error("Uninstall failed", error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-6">
        <div className="pointer-events-auto flex max-w-full animate-slide-up flex-wrap items-center gap-1 rounded-xl border border-surface-700 bg-surface-800/95 p-1.5 shadow-glass backdrop-blur-md">
          <Tooltip content="Exit select mode (Esc)">
            <IconButton
              icon={<X className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              onClick={exitSelectMode}
              disabled={bulkUninstall.isPending}
              aria-label="Exit select mode"
            />
          </Tooltip>

          <span className="px-2 text-sm whitespace-nowrap text-surface-200">
            <span className="font-semibold text-accent-400">{selectedCount}</span> selected
            {hiddenCount > 0 && (
              <span className="ml-1 text-surface-500">· {hiddenCount} hidden</span>
            )}
          </span>

          <div className="mx-1 h-6 w-px bg-surface-700" />

          <Checkbox
            size="sm"
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected}
            disabled={visibleIds.length === 0}
            onCheckedChange={(checked) => (checked ? addMany(visibleIds) : removeMany(visibleIds))}
            label={`Select all visible (${visibleIds.length})`}
            className="items-center rounded-lg px-2 py-1.5 whitespace-nowrap transition-colors hover:bg-surface-700"
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={selectedCount === 0 || bulkUninstall.isPending}
          >
            Clear
          </Button>

          <div className="mx-1 h-6 w-px bg-surface-700" />

          <Button
            variant="danger"
            size="sm"
            onClick={handleOpenDialog}
            loading={bulkUninstall.isPending}
            disabled={selectedCount === 0 || patcherRunning}
            left={<Trash2 className="h-4 w-4" />}
          >
            Uninstall{selectedCount > 0 ? ` ${selectedCount}` : ""} mod
            {selectedCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <BulkUninstallDialog
        open={dialogOpen}
        mods={pendingMods}
        isPending={bulkUninstall.isPending}
        onClose={handleCloseDialog}
        onConfirm={handleConfirmUninstall}
      />
    </>
  );
}
