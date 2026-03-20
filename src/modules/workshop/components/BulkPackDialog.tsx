import { Check, FolderOpen, Package, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button, Dialog, IconButton, Progress, RadioGroup, Tooltip } from "@/components";
import { api, type PackFormat, type PackResult } from "@/lib/tauri";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

type Phase = "configure" | "packing" | "done";

interface PackItemResult {
  displayName: string;
  outcome: { ok: true; result: PackResult } | { ok: false; error: string };
}

export function BulkPackDialog() {
  const projects = useWorkshopDialogsStore((s) => s.bulkPackProjects);
  const closeDialog = useWorkshopDialogsStore((s) => s.closeBulkPackDialog);

  const open = projects.length > 0;

  const [format, setFormat] = useState<PackFormat>("modpkg");
  const [phase, setPhase] = useState<Phase>("configure");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<PackItemResult[]>([]);
  const cancelledRef = useRef(false);

  const handleClose = useCallback(() => {
    closeDialog();
    setFormat("modpkg");
    setPhase("configure");
    setCurrentIndex(0);
    setResults([]);
    cancelledRef.current = false;
    useWorkshopSelectionStore.getState().clear();
  }, [closeDialog]);

  async function handlePack() {
    cancelledRef.current = false;
    setPhase("packing");
    setResults([]);

    const accumulated: PackItemResult[] = [];

    for (let i = 0; i < projects.length; i++) {
      if (cancelledRef.current) break;
      setCurrentIndex(i);

      const result = await api.packWorkshopProject({ projectPath: projects[i].path, format });

      const item: PackItemResult = result.ok
        ? { displayName: projects[i].displayName, outcome: { ok: true, result: result.value } }
        : {
            displayName: projects[i].displayName,
            outcome: { ok: false, error: result.error.message },
          };

      accumulated.push(item);
      setResults([...accumulated]);
    }

    setPhase("done");
  }

  function handleCancel() {
    cancelledRef.current = true;
  }

  if (!open) return null;

  const successCount = results.filter((r) => r.outcome.ok).length;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && phase !== "packing") handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg">
          <Dialog.Header>
            <Dialog.Title>Pack {projects.length} Projects</Dialog.Title>
            {phase !== "packing" && <Dialog.Close />}
          </Dialog.Header>

          <Dialog.Body>
            {phase === "configure" && (
              <div className="space-y-4">
                <div className="max-h-40 overflow-y-auto rounded-lg border border-surface-600 bg-surface-900 p-3">
                  <ul className="space-y-1 text-sm text-surface-300">
                    {projects.map((p) => (
                      <li key={p.path}>{p.displayName}</li>
                    ))}
                  </ul>
                </div>

                <RadioGroup.Root
                  value={format}
                  onValueChange={(value: unknown) => setFormat(value as PackFormat)}
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
              </div>
            )}

            {(phase === "packing" || phase === "done") && (
              <div className="space-y-4">
                {phase === "packing" && (
                  <Progress.Root
                    value={currentIndex + 1}
                    max={projects.length}
                    label={`Packing: ${projects[currentIndex]?.displayName ?? ""}`}
                    valueLabel={`${currentIndex + 1} / ${projects.length}`}
                  >
                    <Progress.Track>
                      <Progress.Indicator />
                    </Progress.Track>
                  </Progress.Root>
                )}

                {phase === "done" && (
                  <p className="text-sm text-surface-300">
                    {cancelledRef.current
                      ? `Cancelled after ${results.length} of ${projects.length} projects.`
                      : `Packed ${successCount} of ${projects.length} projects.`}
                    {successCount < results.length && ` ${results.length - successCount} failed.`}
                  </p>
                )}

                <div className="max-h-48 overflow-y-auto rounded-lg border border-surface-600 bg-surface-900 p-3">
                  <ul className="space-y-1.5 text-sm">
                    {results.map((r, i) => {
                      const { outcome } = r;
                      return (
                        <li key={i} className="flex items-center gap-2">
                          {outcome.ok ? (
                            <Check className="h-4 w-4 shrink-0 text-green-400" />
                          ) : (
                            <X className="h-4 w-4 shrink-0 text-red-400" />
                          )}
                          <span className={outcome.ok ? "flex-1 text-surface-300" : "text-red-300"}>
                            {r.displayName}
                          </span>
                          {outcome.ok && (
                            <Tooltip content="Show in Explorer">
                              <IconButton
                                icon={<FolderOpen className="h-3.5 w-3.5" />}
                                variant="ghost"
                                size="sm"
                                onClick={() => api.revealInExplorer(outcome.result.outputPath)}
                              />
                            </Tooltip>
                          )}
                          {!outcome.ok && (
                            <span className="truncate text-xs text-red-400/70">
                              — {outcome.error}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            {phase === "configure" && (
              <>
                <Button variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant="filled"
                  left={<Package className="h-4 w-4" />}
                  onClick={handlePack}
                >
                  Pack {projects.length} {projects.length === 1 ? "Project" : "Projects"}
                </Button>
              </>
            )}

            {phase === "packing" && (
              <Button variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
            )}

            {phase === "done" && (
              <Button variant="ghost" onClick={handleClose}>
                Close
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
