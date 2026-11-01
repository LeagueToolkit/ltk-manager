import { useMemo } from "react";

import type { WorkshopProject } from "@/lib/tauri";

import { usePackProjects } from "../../packing/api/usePackProjects";
import { useBulkDeleteDialog, useWorkshopSelectionStore } from "../../state";
import { useTestProjects } from "../../testing/api/useTestProject";
import { useWorkshopTestState } from "../../testing/api/useWorkshopTestState";
import { useFilteredProjects } from "./useFilteredProjects";

/** What a selection of projects can be asked to do, for whichever surface is asking. */
export interface ProjectSelectionActions {
  projects: WorkshopProject[];
  count: number;
  test: () => void;
  testOverProfile: () => void;
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
 * The list's footer and a selected card's right click both hang off this, so
 * the two ways into a bulk action cannot drift. Per "Selection, and a running
 * session" in `docs/ux/WORKSHOP.md`.
 */
export function useProjectSelectionActions(): ProjectSelectionActions {
  const selectedPaths = useWorkshopSelectionStore((s) => s.selectedPaths);
  const clear = useWorkshopSelectionStore((s) => s.clear);
  const packProjects = usePackProjects();
  const openBulkDeleteDialog = useBulkDeleteDialog((s) => s.open);

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
        { projects },
        { onError: (err) => console.error("Failed to test projects:", err) },
      );
      clear();
    },
    testOverProfile: () => {
      if (count === 0) return;
      testProjects.mutate(
        { projects, includeProfile: true },
        { onError: (err) => console.error("Failed to test projects:", err) },
      );
      clear();
    },
    pack: () => {
      if (count === 0) return;
      void packProjects(projects);
      clear();
    },
    delete: () => count > 0 && openBulkDeleteDialog(projects),
    clear,
    canTest: count > 0 && testState.kind === "idle",
    testPending: testProjects.isPending,
  };
}
