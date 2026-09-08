import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import {
  ContentBrowser,
  ExtractDialog,
  ExtractRunner,
  LoadingState,
  useEditorPersistence,
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
    <>
      {/* The editor holds one project, so another one is a fresh editor and
          not this one re-pointed. The route reuses this component across a
          change of param, and document ids repeat between projects, so
          without the key a pane carries its scroll and focus over. */}
      <HydratedContentBrowser key={project.path} project={project} />

      <ExtractDialog />
      <ExtractRunner />
    </>
  );
}

/* The editor mounts only once its state is hydrated from `.ltk/editor.json`.
   Any earlier and ContentBrowser's bootstrap opens its defaults into an empty
   store, which the arriving hydration then overwrites. */
function HydratedContentBrowser({ project }: { project: WorkshopProject }) {
  const ready = useEditorPersistence(project.path);

  if (!ready) return <LoadingState />;
  return <ContentBrowser project={project} />;
}
