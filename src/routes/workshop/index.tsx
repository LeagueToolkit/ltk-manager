import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";

import type { WorkshopProject } from "@/lib/tauri";
import {
  ErrorState,
  LoadingState,
  NoProjectsState,
  NoSearchResultsState,
  ProjectGrid,
  useFilteredProjects,
  useHasActiveWorkshopFilters,
  useWorkshopProjects,
  useWorkshopSearchQuery,
  useWorkshopSelectionStore,
  useWorkshopTestState,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/")({
  component: WorkshopIndex,
});

function WorkshopIndex() {
  const navigate = useNavigate();
  const { isLoading, error } = useWorkshopProjects();
  const searchQuery = useWorkshopSearchQuery();
  const filteredProjects = useFilteredProjects();
  const hasActiveFilters = useHasActiveWorkshopFilters();

  const selectAll = useWorkshopSelectionStore((s) => s.selectAll);

  /* Gated with the button it doubles for, or the key would rewrite a selection
     a running session was started over. */
  const testState = useWorkshopTestState();
  useHotkeys("ctrl+a", () => selectAll(filteredProjects.map((p) => p.path)), {
    preventDefault: true,
    enabled: testState.kind === "idle",
  });

  function handleEditProject(project: WorkshopProject) {
    navigate({ to: "/workshop/$projectName", params: { projectName: project.name } });
  }

  function renderContent() {
    if (isLoading) return <LoadingState />;
    if (error) return <ErrorState error={error} />;
    if (filteredProjects.length === 0) {
      if (searchQuery || hasActiveFilters) return <NoSearchResultsState />;
      return <NoProjectsState />;
    }
    return <ProjectGrid projects={filteredProjects} onEdit={handleEditProject} />;
  }

  return <div className="h-full overflow-auto p-6">{renderContent()}</div>;
}
