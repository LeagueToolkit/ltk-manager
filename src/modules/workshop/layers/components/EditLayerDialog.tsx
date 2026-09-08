import { Button, Dialog } from "@/components";
import { useAppForm } from "@/lib/form";
import type { WorkshopLayer } from "@/lib/tauri";

import { useUpdateLayerDescription } from "../api/useUpdateLayerDescription";

interface EditLayerDialogProps {
  open: boolean;
  layer: WorkshopLayer | null;
  onClose: () => void;
  projectPath: string;
}

export function EditLayerDialog({ open, layer, onClose, projectPath }: EditLayerDialogProps) {
  const updateDescription = useUpdateLayerDescription();

  const form = useAppForm({
    defaultValues: { description: layer?.description ?? "" },
    onSubmit: ({ value }) => {
      if (!layer) return;
      updateDescription.mutate(
        {
          projectPath,
          layerName: layer.name,
          description: value.description || undefined,
        },
        { onSuccess: handleClose },
      );
    },
  });

  // Reset form defaults when a different layer is selected
  if (
    layer &&
    !form.state.isTouched &&
    form.state.values.description !== (layer.description ?? "")
  ) {
    form.reset({ description: layer.description ?? "" });
  }

  function handleClose() {
    form.reset();
    onClose();
  }

  if (!layer) return null;

  return (
    <Dialog.Shell
      open={open}
      onClose={handleClose}
      title={`Edit Layer: ${layer.displayName}`}
      size="sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <Dialog.Body className="space-y-4">
          <form.AppField name="description">
            {(field) => (
              <field.TextareaField
                label="Description"
                placeholder="Optional description for this layer..."
                rows={2}
                autoFocus
              />
            )}
          </form.AppField>
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit })}>
            {({ canSubmit }) => (
              <Button
                variant="filled"
                loading={updateDescription.isPending}
                disabled={!canSubmit}
                onClick={() => form.handleSubmit()}
              >
                Save
              </Button>
            )}
          </form.Subscribe>
        </Dialog.Footer>
      </form>
    </Dialog.Shell>
  );
}
