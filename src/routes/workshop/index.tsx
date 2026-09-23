import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";

import type { WorkshopProject } from "@/lib/tauri";
import { useSettings } from "@/modules/settings";
import {
  ErrorState,
  LoadingState,
  MissingProjects,
  NoProjectsState,
  NoSearchResultsState,
  ProjectGrid,
  useFilteredProjects,
  useFolderDrop,
  useHasActiveWorkshopFilters,
  useOpenFolder,
  useWorkshopProjects,
  useWorkshopSearchQuery,
  useWorkshopSelectionStore,
  useWorkshopTestState,
  WorkshopStartPage,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/")({
  component: WorkshopIndex,
});

function WorkshopIndex() {
  const navigate = useNavigate();
  const { data: projects, isLoading, error } = useWorkshopProjects();
  const { data: settings } = useSettings();
  const openFolder = useOpenFolder();
  const searchQuery = useWorkshopSearchQuery();
  const filteredProjects = useFilteredProjects();
  const hasActiveFilters = useHasActiveWorkshopFilters();

  const selectAll = useWorkshopSelectionStore((s) => s.selectAll);

  /* Gated with the button it doubles for, or the key would rewrite a selection
     a running session was started over. */
  const testState = useWorkshopTestState();
  useFolderDrop((path) => void openFolder.openPath(path), testState.kind === "idle");

  useHotkeys("ctrl+a", () => selectAll(filteredProjects.map((p) => p.path)), {
    preventDefault: true,
    enabled: testState.kind === "idle",
  });

  function handleEditProject(project: WorkshopProject) {
    navigate({ to: "/workshop/$projectId", params: { projectId: project.id } });
  }

  function renderContent() {
    if (isLoading) return <LoadingState />;
    if (error) return <ErrorState error={error} />;
    if (!settings?.workshopPath && projects?.length === 0) return <WorkshopStartPage />;
    if (filteredProjects.length === 0) {
      if (searchQuery || hasActiveFilters) return <NoSearchResultsState />;
      return (
        <>
          <NoProjectsState />
          <MissingProjects />
        </>
      );
    }
    return (
      <>
        <ProjectGrid projects={filteredProjects} onEdit={handleEditProject} />
        <MissingProjects />
      </>
    );
  }

  return <div className="h-full overflow-auto p-6">{renderContent()}</div>;
}
