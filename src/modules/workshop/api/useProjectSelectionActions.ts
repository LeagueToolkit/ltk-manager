import { useMemo } from "react";

import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

import { useFilteredProjects } from "./useFilteredProjects";
import { useTestProjects } from "./useTestProject";
import { useWorkshopTestState } from "./useWorkshopTestState";

/** What a selection of projects can be asked to do, for whichever surface is asking. */
export interface ProjectSelectionActions {
  projects: WorkshopProject[];
  count: number;
  test: () => void;
  pack: () => void;
  delete: () => void;
  clear: () => void;
  /** False while a session is up, which owns the files it was started over. */
  canTest: boolean;
  testPending: boolean;
}

/**
 * The four commands a project selection carries, bound to what is picked.
 *
 * The selection button and a selected card's right click both hang off this, so
 * the two ways into a bulk action cannot drift. Per "Selection, and a running
 * session" in `docs/ux/WORKSHOP.md`.
 */
export function useProjectSelectionActions(): ProjectSelectionActions {
  const selectedPaths = useWorkshopSelectionStore((s) => s.selectedPaths);
  const clear = useWorkshopSelectionStore((s) => s.clear);
  const openBulkPackDialog = useWorkshopDialogsStore((s) => s.openBulkPackDialog);
  const openBulkDeleteDialog = useWorkshopDialogsStore((s) => s.openBulkDeleteDialog);

  const filteredProjects = useFilteredProjects();
  const testProjects = useTestProjects();
  const testState = useWorkshopTestState();

  const projects = useMemo(
    () => filteredProjects.filter((p) => selectedPaths.has(p.path)),
    [filteredProjects, selectedPaths],
  );
  const count = projects.length;

  return {
    projects,
    count,
    /* The picks are spent by the press rather than by the run landing. A popup
       that closes as it is pressed takes any completion callback down with it. */
    test: () => {
      if (count === 0) return;
      testProjects.mutate(
        { projects: projects.map((p) => ({ path: p.path, displayName: p.displayName })) },
        { onError: (err) => console.error("Failed to test projects:", err) },
      );
      clear();
    },
    pack: () => count > 0 && openBulkPackDialog(projects),
    delete: () => count > 0 && openBulkDeleteDialog(projects),
    clear,
    canTest: count > 0 && testState.kind === "idle",
    testPending: testProjects.isPending,
  };
}
