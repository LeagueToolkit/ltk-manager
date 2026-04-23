import { TriangleAlert } from "lucide-react";

import { Button, Dialog } from "@/components";
import type { InstalledMod } from "@/lib/tauri";

interface BulkUninstallDialogProps {
  open: boolean;
  mods: InstalledMod[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const PREVIEW_LIMIT = 5;

export function BulkUninstallDialog({
  open,
  mods,
  isPending,
  onClose,
  onConfirm,
}: BulkUninstallDialogProps) {
  const count = mods.length;
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
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="min-w-0">
                <h3 className="font-medium text-red-300">
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
            <Button
              variant="filled"
              onClick={onConfirm}
              loading={isPending}
              className="bg-red-600 hover:bg-red-500"
            >
              Uninstall {count} mod{count === 1 ? "" : "s"}
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
