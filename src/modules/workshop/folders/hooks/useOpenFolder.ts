import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useMemo } from "react";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type AppError, type OpenedProjectFolder, type WorkshopProject } from "@/lib/tauri";

import { workshopKeys } from "../../shared/api/keys";
import { useForgetProjectFolder, useOpenProjectFolder } from "../api/projectFolders";
import { useAddFoldersDialog, useConvertFolderDialog } from "../state/dialogs";

/** The Open folder flow, from a picker or from a path something else supplied. */
export interface OpenFolder {
  /** Pick a folder and open it. */
  readonly pick: () => void;
  /** Open the folder at `path`: a project opens, anything else raises the dialog it needs. */
  readonly openPath: (path: string) => Promise<void>;
  readonly pending: boolean;
}

/**
 * Open any folder as a project.
 *
 * Per "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function useOpenFolder(): OpenFolder {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { toast, error } = useToast();

  const openFolder = useOpenProjectFolder();
  const forgetFolder = useForgetProjectFolder();
  const openConvertDialog = useConvertFolderDialog((s) => s.open);
  const openBatchDialog = useAddFoldersDialog((s) => s.open);

  const openMutate = openFolder.mutateAsync;
  const forget = forgetFolder.mutate;

  const openProject = useCallback(
    async (path: string) => {
      const listed = client.getQueryData<OpenedProjectFolder[]>(workshopKeys.openedFolders());
      const project: WorkshopProject = await openMutate(path);
      const added =
        project.location === "opened" && !listed?.some((folder) => folder.id === project.id);

      void navigate({ to: "/workshop/$projectId", params: { projectId: project.id } });
      if (!added) return;

      toast({
        title: m.workshop_folder_opened_title({ name: project.displayName }),
        description: m.workshop_folder_opened_description(),
        type: "success",
        action: {
          label: m.workshop_folder_undo_action(),
          onClick: () => {
            forget(project.path);
            void navigate({ to: "/workshop" });
          },
        },
      });
    },
    [client, forget, navigate, openMutate, toast],
  );

  const openPath = useCallback(
    async (path: string) => {
      const inspection = await api.projectFolders.inspect(path);
      if (!inspection.ok) {
        error(m.workshop_folder_failed_title(), errorSummary(inspection.error));
        return;
      }

      try {
        await match(inspection.value)
          .with({ kind: "missing" }, async () => error(m.workshop_folder_gone_title(), path))
          .with({ kind: "project" }, ({ project }) => openProject(project.path))
          .with({ kind: "fantome" }, { kind: "plain" }, async (value) =>
            openConvertDialog({ path, inspection: value }),
          )
          .with({ kind: "parent" }, async ({ projects, fantome }) =>
            openBatchDialog({ path, projects, fantome }),
          )
          .exhaustive();
      } catch (cause) {
        error(m.workshop_folder_failed_title(), errorSummary(cause as AppError));
      }
    },
    [error, openBatchDialog, openConvertDialog, openProject],
  );

  const pick = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;

    await openPath(picked);
  }, [openPath]);

  return useMemo(
    () => ({ pick: () => void pick(), openPath, pending: openFolder.isPending }),
    [openFolder.isPending, openPath, pick],
  );
}
