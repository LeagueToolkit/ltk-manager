import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { Button } from "@/components";
import { m } from "@/i18n";
import { api, type WorkshopProject } from "@/lib/tauri";
import {
  ContentBrowser,
  ExtractDialog,
  ExtractRunner,
  LoadingState,
  useEditorPersistence,
  useRequestedDocument,
  useWorkshopProjects,
  workshopKeys,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectId")({
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();

  const { data: projects, isLoading } = useWorkshopProjects();
  const project = projects?.find((candidate) => candidate.id === projectId);

  if (isLoading) {
    return <LoadingState />;
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-surface-400">
          {m.workshop_project_not_found_description({ projectId })}
        </p>
        <Link to="/workshop">
          <Button variant="outline" left={<ArrowLeftIcon className="h-4 w-4" />}>
            {m.workshop_project_back_action()}
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
  useRecordOpened(project.path);
  useRequestedDocument(project.path, ready);

  if (!ready) return <LoadingState />;
  return <ContentBrowser project={project} />;
}

/* Written into the cached list rather than refetched, so opening a project
   reorders the recent lists without reading every project's config again. */
function useRecordOpened(projectPath: string) {
  const client = useQueryClient();

  useEffect(() => {
    void api.projectFolders.recordOpened(projectPath);

    const now = new Date().toISOString();
    client.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (projects) =>
      projects?.map((project) =>
        project.path === projectPath ? { ...project, lastOpened: now } : project,
      ),
    );
  }, [client, projectPath]);
}
