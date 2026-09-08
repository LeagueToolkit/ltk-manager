import { useState } from "react";

import { Button, Dialog, Field, useToast } from "@/components";
import { errorSummary } from "@/i18n";

import { useRenameProject } from "../api/useRenameProject";
import { useRenameProjectDialog } from "../state";
import { projectSlugError } from "../utils/projectSlug";

/**
 * Renames a project, over its slug rather than its display name.
 *
 * A dialog rather than an edit in place on the card, because the card shows the
 * display name and an inline edit there would rewrite a slug under a different
 * word. Per "Rename" in `docs/ux/WORKSHOP.md`.
 */
export function RenameProjectDialog() {
  const project = useRenameProjectDialog((s) => s.payload);
  const closeDialog = useRenameProjectDialog((s) => s.close);
  const renameProject = useRenameProject();
  const toast = useToast();

  const [slug, setSlug] = useState("");
  const [dirty, setDirty] = useState(false);

  /* The field is seeded from whichever project the store is holding, and the
     seed is dropped on close, so neither a second card nor a second look at the
     same one carries the last attempt's text over. */
  const [seeded, setSeeded] = useState<string | null>(null);
  if (project && seeded !== project.path) {
    setSeeded(project.path);
    setSlug(project.name);
    setDirty(false);
  }
  if (!project && seeded !== null) setSeeded(null);

  if (!project) return null;

  const error = projectSlugError(slug);
  const unchanged = slug === project.name;

  function handleSubmit() {
    if (!project || error || unchanged) return;
    renameProject.mutate(
      { projectPath: project.path, newName: slug },
      {
        onSuccess: () => {
          toast.success("Project renamed", `Now at ${slug}`);
          closeDialog();
        },
        onError: (err) => toast.error("Could not rename this project", errorSummary(err)),
      },
    );
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !renameProject.isPending && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="sm">
          <Dialog.Header>
            <Dialog.Title>Rename {project.displayName}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <Dialog.Body>
              <Field.Root>
                <Field.Label>Project slug</Field.Label>
                <Field.Control
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase());
                    setDirty(true);
                  }}
                  hasError={dirty && error !== null}
                  placeholder={project.name}
                  autoFocus
                  className="font-mono"
                />
                <Field.Description>
                  Lowercase letters, numbers and hyphens. This is the folder name on disk.
                </Field.Description>
                {dirty && error && <Field.Error>{error}</Field.Error>}
              </Field.Root>
            </Dialog.Body>

            <Dialog.Footer>
              <Button
                variant="ghost"
                type="button"
                onClick={closeDialog}
                disabled={renameProject.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={error !== null || unchanged}
                loading={renameProject.isPending}
              >
                Rename
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
