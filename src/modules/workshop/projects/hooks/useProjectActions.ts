import { useCallback, useMemo } from "react";

import { api, type WorkshopProject } from "@/lib/tauri";

import { usePackProjects } from "../../packing/api/usePackProjects";
import { useDeleteProjectDialog, useIsPacking, useRenameProjectDialog } from "../../state";
import { useTestProjects } from "../../testing/api/useTestProject";

/**
 * The actions that apply to a whole project, wherever one is offered.
 *
 * Every handler and the object holding them keep their identity across a
 * render, so a caller that memoizes on this hook - the command palette builds
 * its rows from it - is not rebuilt by an unrelated repaint.
 */
export function useProjectActions(project: WorkshopProject | undefined) {
  const testProjects = useTestProjects();
  const packProjects = usePackProjects();
  const isPacking = useIsPacking(project?.path ?? "");
  const openDeleteDialog = useDeleteProjectDialog((s) => s.open);
  const openRenameDialog = useRenameProjectDialog((s) => s.open);

  const testMutate = testProjects.mutate;
  const handleTestProject = useCallback(() => {
    if (!project) return;
    testMutate(
      { projects: [project] },
      { onError: (err) => console.error("Failed to test project:", err) },
    );
  }, [project, testMutate]);

  const handleTestOverProfile = useCallback(() => {
    if (!project) return;
    testMutate(
      { projects: [project], includeProfile: true },
      { onError: (err) => console.error("Failed to test project:", err) },
    );
  }, [project, testMutate]);

  const handlePack = useCallback(() => {
    if (project) void packProjects([project]);
  }, [packProjects, project]);

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
      isPacking,
      handleTestProject,
      handleTestOverProfile,
      handlePack,
      handleOpenDeleteDialog,
      handleOpenRenameDialog,
      handleOpenLocation,
    }),
    [
      isTesting,
      isPacking,
      handleTestProject,
      handleTestOverProfile,
      handlePack,
      handleOpenDeleteDialog,
      handleOpenRenameDialog,
      handleOpenLocation,
    ],
  );
}
