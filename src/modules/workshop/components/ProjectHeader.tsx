import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { IconButton, Tooltip } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";

import { ContentLayoutPopover } from "./ContentLayoutPopover";
import { ProjectActions } from "./ProjectActions";

interface ProjectHeaderProps {
  project: WorkshopProject;
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  return (
    <div data-ui="ProjectHeader" className="flex items-center gap-3 px-4 pt-2.5 pb-1.5">
      <Tooltip content="Back to Workshop">
        <Link to="/workshop">
          <IconButton
            icon={<ArrowLeftIcon className="h-4 w-4" />}
            variant="ghost"
            size="sm"
            aria-label="Back to Workshop"
          />
        </Link>
      </Tooltip>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-lg font-semibold text-surface-100">{project.displayName}</h1>
        <span className="shrink-0 rounded-full bg-surface-700 px-2 py-0.5 text-xs text-surface-400">
          v{project.version}
        </span>
      </div>

      {/* Layout is view-level, so it sits here once rather than in every leaf's tab strip. */}
      <ContentLayoutPopover />

      <ProjectActions project={project} />
    </div>
  );
}
