import { invoke } from "@tauri-apps/api/core";
import { Check, CircleAlert, FolderOpen, Package, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button, Dialog, RadioGroup } from "@/components";
import type { PackResult } from "@/lib/tauri";
import { useWorkshopDialogsStore } from "@/stores";

import { usePackProject } from "../api/usePackProject";
import { useValidateProject } from "../api/useValidateProject";

export function PackDialog() {
  const project = useWorkshopDialogsStore((s) => s.packProject);
  const closeDialog = useWorkshopDialogsStore((s) => s.closePackDialog);

  const open = project !== null;

  const packProject = usePackProject();
  const { data: validation, isLoading: validationLoading } = useValidateProject(
    project?.path ?? "",
    open,
  );

  const [format, setFormat] = useState<"modpkg" | "fantome">("modpkg");
  const [packResult, setPackResult] = useState<PackResult | null>(null);

  function handlePack() {
    if (!project) return;
    packProject.mutate(
      { projectPath: project.path, format },
      {
        onSuccess: setPackResult,
        onError: (err) => console.error("Failed to pack project:", err.message),
      },
    );
  }

  function handleClose() {
    closeDialog();
    setPackResult(null);
  }

  if (!project) return null;

  const hasErrors = validation && validation.errors.length > 0;
  const hasWarnings = validation && validation.warnings.length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg">
          <Dialog.Header>
            <Dialog.Title>Pack {project.displayName}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body>
            {packResult ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-4 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                    <Check className="h-8 w-8 text-green-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-surface-100">Package Created</h3>
                  <p className="mt-2 text-sm font-medium text-surface-200">{packResult.fileName}</p>
                  <p className="mt-1 max-w-sm text-xs break-all text-surface-400">
                    {packResult.outputPath}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {validationLoading ? (
                  <div className="flex items-center gap-2 text-surface-400">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
                    Validating project...
                  </div>
                ) : validation ? (
                  <div className="space-y-3">
                    {hasErrors && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-red-400">
                          <CircleAlert className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            {validation.errors.length} error{validation.errors.length !== 1 && "s"}
                          </span>
                        </div>
                        <ul className="space-y-1 pl-6 text-sm text-red-300">
                          {validation.errors.map((error, i) => (
                            <li key={i}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {hasWarnings && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-yellow-400">
                          <TriangleAlert className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            {validation.warnings.length} warning
                            {validation.warnings.length !== 1 && "s"}
                          </span>
                        </div>
                        <ul className="space-y-1 pl-6 text-sm text-yellow-300">
                          {validation.warnings.map((warning, i) => (
                            <li key={i}>• {warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {validation.valid && !hasWarnings && (
                      <div className="flex items-center gap-2 text-green-400">
                        <Check className="h-4 w-4" />
                        <span className="text-sm">Project is valid</span>
                      </div>
                    )}
                  </div>
                ) : null}

                <RadioGroup.Root
                  value={format}
                  onValueChange={(value: unknown) => setFormat(value as "modpkg" | "fantome")}
                >
                  <RadioGroup.Label>Output Format</RadioGroup.Label>
                  <RadioGroup.Options>
                    <RadioGroup.Card
                      value="modpkg"
                      title=".modpkg"
                      description="Full support for layers and metadata"
                    />
                    <RadioGroup.Card
                      value="fantome"
                      title=".fantome"
                      description="Legacy format (base layer only)"
                    />
                  </RadioGroup.Options>
                </RadioGroup.Root>

                {format === "fantome" && project.layers.length > 1 && (
                  <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                    <div className="text-yellow-300">
                      This project has {project.layers.length} layers, but Fantome format only
                      supports the base layer. Other layers will not be included.
                    </div>
                  </div>
                )}
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            {packResult ? (
              <>
                <Button variant="ghost" onClick={handleClose}>
                  Close
                </Button>
                <Button
                  variant="filled"
                  left={<FolderOpen className="h-4 w-4" />}
                  onClick={async () => {
                    try {
                      await invoke("reveal_in_explorer", { path: packResult.outputPath });
                    } catch (error) {
                      console.error("Failed to open folder:", error);
                    }
                  }}
                >
                  Show in Explorer
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant="filled"
                  left={<Package className="h-4 w-4" />}
                  onClick={handlePack}
                  loading={packProject.isPending}
                  disabled={hasErrors || validationLoading}
                >
                  {packProject.isPending ? "Packing..." : "Pack"}
                </Button>
              </>
            )}
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
