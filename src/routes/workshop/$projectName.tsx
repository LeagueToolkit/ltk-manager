import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Button, Toolbar } from "@/components";
import {
  ContentBrowser,
  DeleteConfirmDialog,
  LoadingState,
  PackDialog,
  ProjectHeader,
  ProjectProvider,
  useWorkshopProjects,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectName")({
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectName } = Route.useParams();

  const { data: projects, isLoading } = useWorkshopProjects();
  const project = projects?.find((candidate) => candidate.name === projectName);

  if (isLoading) {
    return <LoadingState />;
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-surface-400">Project not found: {projectName}</p>
        <Link to="/workshop">
          <Button variant="outline" left={<ArrowLeftIcon className="h-4 w-4" />}>
            Back to Workshop
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <ProjectProvider project={project}>
      <div data-ui="ProjectDetail" className="flex h-full flex-col">
        <Toolbar className="border-surface-700/50">
          <ProjectHeader project={project} />
        </Toolbar>

        {/* The fold is one surface, so the editor and its sidebar share a frame and
            round together against the ground: DS-GROUND. */}
        <div
          data-ui="ProjectDetail:fold"
          className="min-h-0 flex-1 overflow-hidden rounded-t-xl border border-b-0 border-surface-700/50 bg-surface-900"
        >
          <ContentBrowser project={project} />
        </div>
      </div>

      <PackDialog />
      <DeleteConfirmDialog />
    </ProjectProvider>
  );
}
