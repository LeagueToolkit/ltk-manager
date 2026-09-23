import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { Toolbar } from "@/components";
import {
  ProjectProvider,
  useNewProjectDialog,
  useOpenFolder,
  useRecordListVisit,
  useWorkshopProjects,
  WorkshopActiveFilterChips,
  WorkshopDialogs,
  WorkshopHeader,
} from "@/modules/workshop";
import { twMerge } from "@/utils";

export const Route = createFileRoute("/workshop")({
  component: WorkshopLayout,
});

function WorkshopLayout() {
  return <WorkshopShell />;
}

/* The header sits above the outlet, so the route resolves the project rather
   than the page under it, and provides null where there is none. */
function WorkshopShell() {
  const { projectId } = useParams({ strict: false });
  const { data: projects } = useWorkshopProjects();
  const project = projects?.find((candidate) => candidate.id === projectId) ?? null;

  const openNewProjectDialog = useNewProjectDialog((s) => s.open);
  useHotkeys("ctrl+n", () => openNewProjectDialog(), { preventDefault: true });

  const openFolder = useOpenFolder();
  useHotkeys("ctrl+o", openFolder.pick, { preventDefault: true }, [openFolder.pick]);

  /* The route rather than the resolved project, which arrives a frame late and
     would record a grid the user never stood on. A document records itself. */
  const recordListVisit = useRecordListVisit();
  useEffect(() => {
    if (projectId === undefined) recordListVisit();
  }, [projectId, recordListVisit]);

  return (
    <ProjectProvider project={project}>
      <div
        data-ui="WorkshopShell"
        className={twMerge(
          "flex h-full flex-col",
          projectId !== undefined
            ? "border border-b-0 border-surface-700/50 bg-surface-900"
            : "bg-surface-900 shadow-pressed",
        )}
      >
        <Toolbar
          className={twMerge("bg-surface-900", projectId === undefined && "bg-transparent pt-2")}
        >
          <WorkshopHeader />
          {!project && <WorkshopActiveFilterChips />}
        </Toolbar>

        <div data-ui="WorkshopShell:fold" className={twMerge("min-h-0 flex-1 overflow-hidden")}>
          <Outlet />
        </div>
      </div>

      <WorkshopDialogs />
    </ProjectProvider>
  );
}
