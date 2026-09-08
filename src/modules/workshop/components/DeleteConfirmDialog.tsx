import { useNavigate } from "@tanstack/react-router";

import { ConfirmDialog } from "@/components";
import { useDialog } from "@/stores";

import { useDeleteProject } from "../api/useDeleteProject";
import { useDeleteProjectDialog } from "../state";

export function DeleteConfirmDialog() {
  const { isOpen, payload: project, close: closeDialog } = useDialog(useDeleteProjectDialog);
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();

  function handleConfirm() {
    if (!project) return;
    deleteProject.mutate(project.path, {
      onSuccess: () => {
        closeDialog();
        navigate({ to: "/workshop" });
      },
      onError: (err) => console.error("Failed to delete project:", err),
    });
  }

  if (!project) return null;

  return (
    <ConfirmDialog
      open={isOpen}
      onClose={closeDialog}
      title="Delete Project"
      heading={<>Are you sure you want to delete &ldquo;{project.displayName}&rdquo;?</>}
      description="This will permanently delete the project folder and all its contents. This action cannot be undone."
      confirmLabel="Delete Project"
      onConfirm={handleConfirm}
      pending={deleteProject.isPending}
      size="md"
    >
      <p className="mt-2 text-xs break-all text-surface-500">{project.path}</p>
    </ConfirmDialog>
  );
}
