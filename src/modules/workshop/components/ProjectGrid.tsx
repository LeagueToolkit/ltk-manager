import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopViewStore } from "@/stores";

import { ProjectCard } from "./ProjectCard";

interface ProjectGridProps {
  projects: WorkshopProject[];
  onEdit: (project: WorkshopProject) => void;
}

export function ProjectGrid({ projects, onEdit }: ProjectGridProps) {
  const viewMode = useWorkshopViewStore((s) => s.viewMode);

  return (
    <div
      className={
        viewMode === "grid"
          ? "grid grid-cols-[repeat(auto-fill,minmax(var(--card-min-w,240px),var(--card-max-w,320px)))] justify-center gap-4"
          : "space-y-2"
      }
    >
      {projects.map((project) => (
        <ProjectCard key={project.path} project={project} viewMode={viewMode} onEdit={onEdit} />
      ))}
    </div>
  );
}
