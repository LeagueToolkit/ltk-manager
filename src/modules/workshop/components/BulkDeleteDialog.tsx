import { useQueryClient } from "@tanstack/react-query";
import { Check, TriangleAlert, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button, Dialog, Progress } from "@/components";
import { api } from "@/lib/tauri";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

import { workshopKeys } from "../api/keys";

type Phase = "confirm" | "deleting" | "done";

interface DeleteItemResult {
  displayName: string;
  outcome: { ok: true } | { ok: false; error: string };
}

export function BulkDeleteDialog() {
  const projects = useWorkshopDialogsStore((s) => s.bulkDeleteProjects);
  const closeDialog = useWorkshopDialogsStore((s) => s.closeBulkDeleteDialog);
  const queryClient = useQueryClient();

  const open = projects.length > 0;

  const [phase, setPhase] = useState<Phase>("confirm");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<DeleteItemResult[]>([]);
  const cancelledRef = useRef(false);

  const handleClose = useCallback(() => {
    if (phase !== "confirm") {
      queryClient.invalidateQueries({ queryKey: workshopKeys.projects() });
    }
    closeDialog();
    setPhase("confirm");
    setCurrentIndex(0);
    setResults([]);
    cancelledRef.current = false;
    useWorkshopSelectionStore.getState().clear();
  }, [closeDialog, queryClient, phase]);

  async function handleDelete() {
    cancelledRef.current = false;
    setPhase("deleting");
    setResults([]);

    const accumulated: DeleteItemResult[] = [];

    for (let i = 0; i < projects.length; i++) {
      if (cancelledRef.current) break;
      setCurrentIndex(i);

      const result = await api.deleteWorkshopProject(projects[i].path);

      const item: DeleteItemResult = result.ok
        ? { displayName: projects[i].displayName, outcome: { ok: true } }
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
        if (!isOpen && phase !== "deleting") handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg">
          <Dialog.Header>
            <Dialog.Title>Delete {projects.length} Projects</Dialog.Title>
            {phase !== "deleting" && <Dialog.Close />}
          </Dialog.Header>

          <Dialog.Body>
            {phase === "confirm" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                  <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                  <div>
                    <h3 className="font-medium text-red-300">
                      Are you sure you want to delete {projects.length} projects?
                    </h3>
                    <p className="mt-1 text-sm text-surface-400">
                      This will permanently delete all project folders and their contents. This
                      action cannot be undone.
                    </p>
                  </div>
                </div>

                <div className="max-h-40 overflow-y-auto rounded-lg border border-surface-600 bg-surface-900 p-3">
                  <ul className="space-y-1.5 text-sm">
                    {projects.map((p) => (
                      <li key={p.path}>
                        <span className="text-surface-300">{p.displayName}</span>
                        <span className="ml-2 text-xs break-all text-surface-500">{p.path}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {(phase === "deleting" || phase === "done") && (
              <div className="space-y-4">
                {phase === "deleting" && (
                  <Progress.Root
                    value={currentIndex + 1}
                    max={projects.length}
                    label={`Deleting: ${projects[currentIndex]?.displayName ?? ""}`}
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
                      : `Deleted ${successCount} of ${projects.length} projects.`}
                    {successCount < results.length && ` ${results.length - successCount} failed.`}
                  </p>
                )}

                <div className="max-h-48 overflow-y-auto rounded-lg border border-surface-600 bg-surface-900 p-3">
                  <ul className="space-y-1.5 text-sm">
                    {results.map((r, i) => (
                      <li key={i} className="flex items-center gap-2">
                        {r.outcome.ok ? (
                          <Check className="h-4 w-4 shrink-0 text-green-400" />
                        ) : (
                          <X className="h-4 w-4 shrink-0 text-red-400" />
                        )}
                        <span className={r.outcome.ok ? "text-surface-300" : "text-red-300"}>
                          {r.displayName}
                        </span>
                        {!r.outcome.ok && (
                          <span className="truncate text-xs text-red-400/70">
                            — {r.outcome.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            {phase === "confirm" && (
              <>
                <Button variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant="filled"
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-500"
                >
                  Delete {projects.length} {projects.length === 1 ? "Project" : "Projects"}
                </Button>
              </>
            )}

            {phase === "deleting" && (
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
