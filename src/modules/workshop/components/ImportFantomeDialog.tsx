import { useEffect } from "react";
import { z } from "zod";

import { Button, Dialog } from "@/components";
import { useAppForm } from "@/lib/form";
import { useWorkshopDialogsStore } from "@/stores";

import { useFantomeImportProgress } from "../api/useFantomeImportProgress";
import { useImportFromFantome } from "../api/useImportFromFantome";

const importSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase letters, numbers, and hyphens only")
    .refine(
      (val) => !val.startsWith("-") && !val.endsWith("-"),
      "Name cannot start or end with a hyphen",
    ),
  displayName: z.string().min(1, "Display name is required"),
});

export function ImportFantomeDialog() {
  const fantomeImport = useWorkshopDialogsStore((s) => s.fantomeImport);
  const closeDialog = useWorkshopDialogsStore((s) => s.closeFantomeImportDialog);
  const importFromFantome = useImportFromFantome();
  const progress = useFantomeImportProgress();

  const open = fantomeImport !== null;
  const peekResult = fantomeImport?.peekResult ?? null;
  const filePath = fantomeImport?.filePath ?? null;
  const isImporting =
    importFromFantome.isPending || (progress !== null && progress.stage !== "complete");

  const form = useAppForm({
    defaultValues: {
      name: peekResult?.suggestedName ?? "",
      displayName: peekResult?.name ?? "",
    },
    validators: {
      onChange: importSchema,
    },
    onSubmit: ({ value }) => {
      if (!filePath) return;
      importFromFantome.mutate(
        {
          filePath,
          name: value.name,
          displayName: value.displayName,
        },
        {
          onSuccess: () => {
            form.reset();
            closeDialog();
          },
          onError: (err) => console.error("Failed to import fantome:", err.message),
        },
      );
    },
  });

  useEffect(() => {
    if (peekResult) {
      form.reset({
        name: peekResult.suggestedName ?? "",
        displayName: peekResult.name ?? "",
      });
    }
  }, [form, filePath, peekResult]);

  function handleClose() {
    if (isImporting) return;
    form.reset();
    closeDialog();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg">
          <Dialog.Header>
            <Dialog.Title>Import from Fantome</Dialog.Title>
            {!isImporting && <Dialog.Close />}
          </Dialog.Header>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <Dialog.Body className="space-y-4" key={filePath}>
              {peekResult && (
                <div className="space-y-3 rounded-lg border border-surface-600 bg-surface-900 p-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <span className="text-surface-500">Author</span>
                      <p className="text-surface-200">{peekResult.author || "Unknown"}</p>
                    </div>
                    <div>
                      <span className="text-surface-500">Version</span>
                      <p className="text-surface-200">{peekResult.version || "Unknown"}</p>
                    </div>
                  </div>
                  {peekResult.description && (
                    <div className="text-sm">
                      <span className="text-surface-500">Description</span>
                      <p className="mt-0.5 text-surface-300">{peekResult.description}</p>
                    </div>
                  )}
                  <div className="text-sm">
                    <span className="text-surface-500">
                      WAD Files ({peekResult.wadFiles.length})
                    </span>
                    <div className="mt-1 max-h-28 overflow-y-auto rounded border border-surface-700 bg-surface-800 p-2">
                      {peekResult.wadFiles.map((wad) => (
                        <div key={wad} className="truncate font-mono text-xs text-surface-400">
                          {wad}
                        </div>
                      ))}
                      {peekResult.wadFiles.length === 0 && (
                        <p className="text-xs text-surface-500 italic">No WAD files found</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label="Project Name"
                    required
                    placeholder="my-awesome-mod"
                    description="Lowercase letters, numbers, and hyphens only. This will be the folder name."
                    disabled={isImporting}
                    transform={(value) => value.toLowerCase()}
                  />
                )}
              </form.AppField>

              <form.AppField name="displayName">
                {(field) => (
                  <field.TextField
                    label="Display Name"
                    required
                    placeholder="My Awesome Mod"
                    disabled={isImporting}
                  />
                )}
              </form.AppField>

              {progress && progress.stage !== "complete" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-surface-400">
                      {progress.stage === "extracting" && "Extracting WADs..."}
                      {progress.stage === "finalizing" && "Finalizing..."}
                      {progress.stage === "error" && "Error occurred"}
                    </span>
                    {progress.total > 0 && (
                      <span className="text-surface-500">
                        {progress.current}/{progress.total}
                      </span>
                    )}
                  </div>
                  {progress.currentWad && (
                    <p className="truncate font-mono text-xs text-surface-500">
                      {progress.currentWad}
                    </p>
                  )}
                  <div className="h-2 overflow-hidden rounded-full bg-surface-700">
                    <div
                      className="h-full rounded-full bg-accent-500 transition-all duration-300"
                      style={{
                        width:
                          progress.total > 0
                            ? `${(progress.current / progress.total) * 100}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>
              )}
            </Dialog.Body>

            <Dialog.Footer>
              <Button variant="ghost" onClick={handleClose} disabled={isImporting}>
                Cancel
              </Button>
              <form.Subscribe
                selector={(state) => ({ canSubmit: state.canSubmit, isValid: state.isValid })}
              >
                {({ canSubmit, isValid }) => (
                  <Button
                    variant="filled"
                    loading={isImporting}
                    disabled={!canSubmit || !isValid || isImporting}
                    onClick={() => form.handleSubmit()}
                  >
                    Import
                  </Button>
                )}
              </form.Subscribe>
            </Dialog.Footer>
          </form>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
