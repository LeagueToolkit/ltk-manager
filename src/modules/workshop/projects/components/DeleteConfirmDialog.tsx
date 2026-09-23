import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Code, ConfirmDialog, Field } from "@/components";
import { m, Marked } from "@/i18n";
import { useDialog } from "@/stores";

import { useDeleteProjectDialog } from "../../state";
import { useDeleteProject } from "../api/useDeleteProject";

/**
 * The confirmation before a project folder is deleted from disk.
 *
 * A project opened from outside the workshop folder asks for its name typed
 * out, per "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function DeleteConfirmDialog() {
  const { isOpen, payload: project, close: closeDialog } = useDialog(useDeleteProjectDialog);
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");

  function handleClose() {
    setTyped("");
    closeDialog();
  }

  function handleConfirm() {
    if (!project) return;
    deleteProject.mutate(project.path, {
      onSuccess: () => {
        handleClose();
        navigate({ to: "/workshop" });
      },
      onError: (err) => console.error("Failed to delete project:", err),
    });
  }

  if (!project) return null;

  const opened = project.location === "opened";

  return (
    <ConfirmDialog
      open={isOpen}
      onClose={handleClose}
      title={m.workshop_delete_title()}
      heading={m.workshop_delete_heading({ name: project.displayName })}
      description={
        opened ? m.workshop_folder_delete_opened_description() : m.workshop_delete_description()
      }
      confirmLabel={m.workshop_delete_action()}
      onConfirm={handleConfirm}
      confirmDisabled={opened && typed !== project.name}
      pending={deleteProject.isPending}
      size="md"
    >
      <p className="mt-2 text-xs break-all text-surface-500 select-text">{project.path}</p>
      {opened && (
        <Field.Root className="mt-3 flex flex-col gap-1.5">
          <Field.Label className="text-xs text-surface-300">
            <Marked text={m.workshop_folder_delete_typed_label({ name: project.name })}>
              {(literal) => <Code>{literal}</Code>}
            </Marked>
          </Field.Label>
          <Field.Control
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono select-text"
          />
        </Field.Root>
      )}
    </ConfirmDialog>
  );
}
