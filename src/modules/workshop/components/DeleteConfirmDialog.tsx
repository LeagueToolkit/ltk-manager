import { useNavigate } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

import { Button, Dialog } from "@/components";
import { useWorkshopDialogsStore } from "@/stores";

import { useDeleteProject } from "../api/useDeleteProject";

export function DeleteConfirmDialog() {
  const project = useWorkshopDialogsStore((s) => s.deleteProject);
  const closeDialog = useWorkshopDialogsStore((s) => s.closeDeleteDialog);
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();

  const open = project !== null;

  function handleConfirm() {
    if (!project) return;
    deleteProject.mutate(project.path, {
      onSuccess: () => {
        closeDialog();
        navigate({ to: "/workshop" });
      },
      onError: (err) => console.error("Failed to delete project:", err.message),
    });
  }

  if (!project) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay>
          <Dialog.Header>
            <Dialog.Title>Delete Project</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body>
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <h3 className="font-medium text-red-300">
                  Are you sure you want to delete &ldquo;{project.displayName}&rdquo;?
                </h3>
                <p className="mt-1 text-sm text-surface-400">
                  This will permanently delete the project folder and all its contents. This action
                  cannot be undone.
                </p>
                <p className="mt-2 text-xs break-all text-surface-500">{project.path}</p>
              </div>
            </div>
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={handleConfirm}
              loading={deleteProject.isPending}
              className="bg-red-600 hover:bg-red-500"
            >
              Delete Project
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
