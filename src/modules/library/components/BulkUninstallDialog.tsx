import { WarningIcon } from "@phosphor-icons/react";

import { Button, Dialog, useToast } from "@/components";
import { useBulkUninstallMods } from "@/modules/library/api";

import { useBulkUninstallDialog, useLibrarySelectionStore } from "../state";

const PREVIEW_LIMIT = 5;

/**
 * The confirmation a bulk uninstall is asked through, and the run behind it.
 *
 * The mods are the store's own list rather than the live selection, because the
 * optimistic cache update empties that selection mid-run and would blank the
 * preview under the reader.
 */
export function BulkUninstallDialog() {
  const mods = useBulkUninstallDialog((s) => s.payload) ?? [];
  const close = useBulkUninstallDialog((s) => s.close);
  const open = useBulkUninstallDialog((s) => s.isOpen);
  const clearSelection = useLibrarySelectionStore((s) => s.clear);
  const setSelection = useLibrarySelectionStore((s) => s.setSelection);
  const bulkUninstall = useBulkUninstallMods();
  const toast = useToast();

  const isPending = bulkUninstall.isPending;
  const count = mods.length;

  function onClose() {
    if (isPending) return;
    close();
  }

  /* The failures stay picked, so the reader keeps the set they still have to
     deal with and can press again over exactly that. */
  async function onConfirm() {
    const ids = mods.map((m) => m.id);
    if (ids.length === 0) return;

    try {
      const result = await bulkUninstall.mutateAsync(ids);
      close();

      if (result.failed.length === 0) {
        toast.success(
          "Mods uninstalled",
          `${result.succeeded.length} mod${result.succeeded.length === 1 ? "" : "s"} removed`,
        );
        clearSelection();
        return;
      }

      if (result.succeeded.length === 0) {
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
      setSelection(result.failed.map((f) => f.id));
    } catch (error: unknown) {
      toast.error("Uninstall failed", error instanceof Error ? error.message : String(error));
    }
  }

  const preview = mods.slice(0, PREVIEW_LIMIT);
  const overflow = Math.max(0, count - PREVIEW_LIMIT);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay>
          <Dialog.Header>
            <Dialog.Title>
              Uninstall {count} mod{count === 1 ? "" : "s"}?
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body>
            <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
              <WarningIcon weight="bold" className="mt-0.5 h-5 w-5 shrink-0 text-danger-text" />
              <div className="min-w-0">
                <h3 className="font-medium text-danger-text">
                  This will permanently delete the selected mod files from disk.
                </h3>
                <p className="mt-1 text-sm text-surface-400">
                  You&rsquo;ll need to re-import them from their original archives to use them
                  again.
                </p>
                <p className="mt-2 text-xs text-surface-500">This action cannot be undone.</p>
              </div>
            </div>

            {preview.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium tracking-wide text-surface-400 uppercase">
                  To be removed
                </p>
                <ul className="space-y-1 text-sm text-surface-200">
                  {preview.map((mod) => (
                    <li key={mod.id} className="truncate">
                      • {mod.displayName}
                    </li>
                  ))}
                </ul>
                {overflow > 0 && (
                  <p className="mt-2 text-xs text-surface-500">
                    + {overflow} more mod{overflow === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} loading={isPending}>
              Uninstall {count} mod{count === 1 ? "" : "s"}
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
