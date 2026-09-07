import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { twMerge } from "tailwind-merge";

import { Toolbar } from "@/components";
import { useSettings } from "@/modules/settings";
import {
  ImportFantomeDialog,
  ImportGitRepoDialog,
  NewProjectDialog,
  NotConfiguredState,
  ProjectProvider,
  useRecordListVisit,
  useWorkshopProjects,
  WorkshopActiveFilterChips,
  WorkshopHeader,
} from "@/modules/workshop";
import { useWorkshopDialogsStore } from "@/stores";

export const Route = createFileRoute("/workshop")({
  component: WorkshopLayout,
});

function WorkshopLayout() {
  const { data: settings } = useSettings();
  const workshopConfigured = !!settings?.workshopPath;

  if (!workshopConfigured) {
    return <NotConfiguredState />;
  }

  return <WorkshopShell />;
}

/* The header sits above the outlet, so the route resolves the project rather
   than the page under it, and provides null where there is none. */
function WorkshopShell() {
  const { projectName } = useParams({ strict: false });
  const { data: projects } = useWorkshopProjects();
  const project = projects?.find((candidate) => candidate.name === projectName) ?? null;

  const openNewProjectDialog = useWorkshopDialogsStore((s) => s.openNewProjectDialog);
  useHotkeys("ctrl+n", () => openNewProjectDialog(), { preventDefault: true });

  /* The route rather than the resolved project, which arrives a frame late and
     would record a grid the user never stood on. A document records itself. */
  const recordListVisit = useRecordListVisit();
  useEffect(() => {
    if (projectName === undefined) recordListVisit();
  }, [projectName, recordListVisit]);

  return (
    <ProjectProvider project={project}>
      <div
        data-ui="WorkshopShell"
        className={twMerge(
          "flex h-full flex-col",
          project
            ? "rounded-t-xl border border-b-0 border-surface-700/50 bg-surface-900"
            : "mx-2 rounded-xl border border-surface-700 bg-surface-900/40",
        )}
      >
        <Toolbar className="bg-surface-900">
          <WorkshopHeader />
          {!project && <WorkshopActiveFilterChips />}
        </Toolbar>

        {/* Either route draws the fold as a panel over the ground, DS-GROUND. An
            editor and its sidebar share the frame and round into the bar below
            them, where the grid is an island framed as the library frames its own. */}
        <div data-ui="WorkshopShell:fold" className={twMerge("min-h-0 flex-1 overflow-hidden")}>
          <Outlet />
        </div>
      </div>

      {/* The four ways to a project are commands the bar runs from either route,
          so what they open is mounted over both. */}
      <NewProjectDialog />
      <ImportFantomeDialog />
      <ImportGitRepoDialog />
    </ProjectProvider>
  );
}
