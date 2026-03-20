import { Trash2 } from "lucide-react";

import { Button, Dialog } from "@/components";
import type { WorkshopLayer } from "@/lib/tauri";

interface DeleteLayerDialogProps {
  open: boolean;
  layer: WorkshopLayer | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending?: boolean;
}

export function DeleteLayerDialog({
  open,
  layer,
  onClose,
  onConfirm,
  isPending,
}: DeleteLayerDialogProps) {
  if (!layer) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="sm">
          <Dialog.Header>
            <Dialog.Title>Delete Layer</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body>
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <h3 className="font-medium text-red-300">
                  Delete layer &ldquo;{layer.name}&rdquo;?
                </h3>
                <p className="mt-1 text-sm text-surface-400">
                  This will remove the layer and delete its content directory. This action cannot be
                  undone.
                </p>
              </div>
            </div>
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={onConfirm}
              loading={isPending}
              className="bg-red-600 hover:bg-red-500"
            >
              Delete Layer
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
