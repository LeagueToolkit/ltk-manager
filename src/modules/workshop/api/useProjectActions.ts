import { useCallback, useMemo } from "react";

import { api, type WorkshopProject } from "@/lib/tauri";

import { useDeleteProjectDialog, usePackDialog, useRenameProjectDialog } from "../state";
import { useTestProjects } from "./useTestProject";

/**
 * The actions that apply to a whole project, wherever one is offered.
 *
 * Every handler and the object holding them keep their identity across a
 * render, so a caller that memoizes on this hook - the command palette builds
 * its rows from it - is not rebuilt by an unrelated repaint.
 */
export function useProjectActions(project: WorkshopProject | undefined) {
  const testProjects = useTestProjects();
  const openPackDialog = usePackDialog((s) => s.open);
  const openDeleteDialog = useDeleteProjectDialog((s) => s.open);
  const openRenameDialog = useRenameProjectDialog((s) => s.open);

  const testMutate = testProjects.mutate;
  const handleTestProject = useCallback(() => {
    if (!project) return;
    testMutate(
      { projects: [{ path: project.path, displayName: project.displayName }] },
      { onError: (err) => console.error("Failed to test project:", err) },
    );
  }, [project, testMutate]);

  const handleOpenPackDialog = useCallback(() => {
    if (project) openPackDialog(project);
  }, [openPackDialog, project]);

  const handleOpenDeleteDialog = useCallback(() => {
    if (project) openDeleteDialog(project);
  }, [openDeleteDialog, project]);

  const handleOpenRenameDialog = useCallback(() => {
    if (project) openRenameDialog(project);
  }, [openRenameDialog, project]);

  const handleOpenLocation = useCallback(async () => {
    if (!project) return;
    try {
      await api.revealInExplorer(project.path);
    } catch (error) {
      console.error("Failed to open location:", error);
    }
  }, [project]);

  const isTesting = testProjects.isPending;
  return useMemo(
    () => ({
      isTesting,
      handleTestProject,
      handleOpenPackDialog,
      handleOpenDeleteDialog,
      handleOpenRenameDialog,
      handleOpenLocation,
    }),
    [
      isTesting,
      handleTestProject,
      handleOpenPackDialog,
      handleOpenDeleteDialog,
      handleOpenRenameDialog,
      handleOpenLocation,
    ],
  );
}
