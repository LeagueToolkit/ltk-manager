import { TrashIcon } from "@phosphor-icons/react";

import { ConfirmDialog } from "@/components";
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
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Delete Layer"
      heading={<>Delete layer &ldquo;{layer.displayName}&rdquo;?</>}
      description="This will remove the layer and delete its content directory. This action cannot be undone."
      confirmLabel="Delete Layer"
      onConfirm={onConfirm}
      pending={isPending}
      icon={<TrashIcon className="h-5 w-5" weight="bold" />}
      size="sm"
    />
  );
}
