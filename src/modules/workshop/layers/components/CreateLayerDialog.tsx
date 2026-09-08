import { FolderClosed } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { Button, Dialog, Field } from "@/components";
import { useAppForm } from "@/lib/form";
import { toSlug } from "@/utils";

const createLayerSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  name: z
    .string()
    .min(1, "Layer slug is required")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only")
    .refine(
      (val) => !val.startsWith("-") && !val.endsWith("-"),
      "Slug cannot start or end with a hyphen",
    ),
  description: z.string(),
});

interface CreateLayerDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, displayName: string, description: string) => void;
  isPending?: boolean;
  existingNames: string[];
}

export function CreateLayerDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  existingNames,
}: CreateLayerDialogProps) {
  const slugManuallyEdited = useRef(false);

  const form = useAppForm({
    defaultValues: { displayName: "", name: "", description: "" },
    validators: {
      onChange: createLayerSchema,
    },
    onSubmit: ({ value }) => {
      onSubmit(value.name, value.displayName, value.description);
    },
  });

  function handleClose() {
    form.reset();
    slugManuallyEdited.current = false;
    onClose();
  }

  return (
    <Dialog.Shell open={open} onClose={handleClose} title="New Layer" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <Dialog.Body className="space-y-4">
          <form.AppField
            name="displayName"
            listeners={{
              onChange: ({ value }) => {
                if (!slugManuallyEdited.current) {
                  form.setFieldValue("name", toSlug(value));
                }
              },
            }}
          >
            {(field) => (
              <field.TextField
                label="Display Name"
                required
                placeholder="High Res Textures"
                autoFocus
              />
            )}
          </form.AppField>

          <form.AppField
            name="name"
            validators={{
              onChange: ({ value }) => {
                if (existingNames.includes(value)) {
                  return "A layer with this slug already exists";
                }
                return undefined;
              },
            }}
            listeners={{
              onChange: ({ value }) => {
                const derived = toSlug(form.getFieldValue("displayName"));
                if (value !== derived) {
                  slugManuallyEdited.current = true;
                }
              },
            }}
          >
            {(field) => (
              <Field.Root>
                <Field.Label>
                  <span className="text-xs text-surface-400">
                    Layer Slug{" "}
                    <span className="font-normal text-surface-500">(folder name on disk)</span>
                  </span>
                </Field.Label>
                <Field.Control
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value.toLowerCase());
                  }}
                  onBlur={field.handleBlur}
                  hasError={field.state.meta.errors.length > 0}
                  placeholder="high-res-textures"
                  className="font-mono text-sm text-surface-300"
                />
                <Field.Description>
                  <span className="flex items-start gap-1.5 text-xs">
                    <FolderClosed className="mt-0.5 h-3 w-3 shrink-0 text-surface-500" />
                    <span>
                      Saved to disk as{" "}
                      <code className="rounded bg-surface-800 px-1 py-0.5 font-mono text-[0.6875rem] text-surface-300">
                        content/{field.state.value || "layer-slug"}
                      </code>
                      . Lowercase letters, numbers, and hyphens only.
                    </span>
                  </span>
                </Field.Description>
                {field.state.meta.errors.length > 0 && (
                  <Field.Error>{field.state.meta.errors.join(", ")}</Field.Error>
                )}
              </Field.Root>
            )}
          </form.AppField>

          <form.AppField name="description">
            {(field) => (
              <field.TextareaField
                label="Description"
                placeholder="Optional description for this layer..."
                rows={2}
              />
            )}
          </form.AppField>
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <form.Subscribe
            selector={(state) => ({ canSubmit: state.canSubmit, isValid: state.isValid })}
          >
            {({ canSubmit, isValid }) => (
              <Button
                variant="filled"
                loading={isPending}
                disabled={!canSubmit || !isValid}
                onClick={() => form.handleSubmit()}
              >
                Create Layer
              </Button>
            )}
          </form.Subscribe>
        </Dialog.Footer>
      </form>
    </Dialog.Shell>
  );
}
