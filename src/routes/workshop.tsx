import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { ChromeGround, PageInset } from "@/components";
import { useKeys } from "@/modules/keys";
import { RuneforgeDialogs } from "@/modules/runeforge";
import {
  ProjectProvider,
  RouteSandboxProvider,
  useNewProjectDialog,
  useOpenFolder,
  useRecordListVisit,
  useWorkshopProjects,
  WorkshopActiveFilterChips,
  WorkshopDialogs,
  WorkshopHeader,
} from "@/modules/workshop";

/** What both routes render into: the editor's own islands under a project, one inset panel over the grid. */
function Fold({ project, children }: { project: boolean; children: ReactNode }) {
  if (!project) {
    return <PageInset data-ui="WorkshopShell:fold">{children}</PageInset>;
  }

  return (
    <div data-ui="WorkshopShell:fold" className="min-h-0 flex-1 overflow-hidden">
      {children}
    </div>
  );
}

export const Route = createFileRoute("/workshop")({
  component: WorkshopLayout,
});

function WorkshopLayout() {
  return <WorkshopShell />;
}

/* The header is mounted above the outlet, so the route resolves the project rather
   than the page under it, and provides null where there is none. */
function WorkshopShell() {
  const { projectId } = useParams({ strict: false });
  const { data: projects } = useWorkshopProjects();
  const project = projects?.find((candidate) => candidate.id === projectId) ?? null;

  const openNewProjectDialog = useNewProjectDialog((s) => s.open);
  const openFolder = useOpenFolder();
  useKeys("workshop", {
    "workshop.newProject": () => openNewProjectDialog(),
    "workshop.openFolder": () => void openFolder.pick(),
  });

  /* The route rather than the resolved project, which arrives a frame late and
     would record a grid the user never stood on. A document records itself. */
  const recordListVisit = useRecordListVisit();
  useEffect(() => {
    if (projectId === undefined) recordListVisit();
  }, [projectId, recordListVisit]);

  return (
    <ProjectProvider project={project}>
      <RouteSandboxProvider project={project?.path ?? null}>
        <div
          data-ui="WorkshopShell"
          /* DS-GROUND: the islands under either route and the frame around them share the ground. */
          className="flex h-full flex-col bg-surface-950"
        >
          <ChromeGround />
          <WorkshopHeader />
          {!project && <WorkshopActiveFilterChips />}

          <Fold project={projectId !== undefined}>
            <Outlet />
          </Fold>
        </div>

        <WorkshopDialogs />
        <RuneforgeDialogs />
      </RouteSandboxProvider>
    </ProjectProvider>
  );
}
