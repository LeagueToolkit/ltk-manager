import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button, NavTabs } from "@/components";
import {
  DeleteConfirmDialog,
  LoadingState,
  PackDialog,
  ProjectHeader,
  ProjectProvider,
  useWorkshopProjects,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectName")({
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { projectName } = Route.useParams();

  const { data: projects, isLoading } = useWorkshopProjects();
  const project = projects?.find((p) => p.name === projectName);

  if (isLoading) {
    return <LoadingState />;
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-surface-400">Project not found: {projectName}</p>
        <Link to="/workshop">
          <Button variant="outline" left={<ArrowLeft className="h-4 w-4" />}>
            Back to Workshop
          </Button>
        </Link>
      </div>
    );
  }

  const tabs = [
    { to: "/workshop/$projectName", params: { projectName }, label: "Overview", exact: true },
    { to: "/workshop/$projectName/strings", params: { projectName }, label: "Strings" },
    { to: "/workshop/$projectName/layers", params: { projectName }, label: "Layers" },
  ];

  return (
    <ProjectProvider project={project}>
      <div className="flex h-full flex-col">
        <ProjectHeader project={project} />

        <NavTabs tabs={tabs} />

        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </div>

      <PackDialog />
      <DeleteConfirmDialog />
    </ProjectProvider>
  );
}
