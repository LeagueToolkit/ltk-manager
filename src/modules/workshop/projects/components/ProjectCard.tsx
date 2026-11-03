import type { KeyboardEvent } from "react";

import { Checkbox } from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import { SuspectBadge } from "@/modules/diagnostics";
import { isChord } from "@/modules/keys";
import { twMerge } from "@/utils";

import { useWorkshopSelectionStore } from "../../state";
import { useWorkshopTestState } from "../../testing/api/useWorkshopTestState";
import { useProjectThumbnail } from "../api/useProjectThumbnail";
import { useProjectActions } from "../hooks/useProjectActions";
import {
  ProjectCardContextMenu,
  ProjectKebab,
  ProjectPills,
  TestingPill,
  useProjectMenuScope,
} from "./ProjectCardParts";

interface ProjectCardProps {
  project: WorkshopProject;
  onEdit: (project: WorkshopProject) => void;
  /** The grid's roving stop, so `0` on the one card the tab order reaches. */
  tabIndex: number;
}

/* Accent-500 rather than the dimmed one the pointer gets: DS-HOVER. */
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none";

export function ProjectCard({ project, onEdit, tabIndex }: ProjectCardProps) {
  const { data: thumbnailUrl } = useProjectThumbnail(project.path, project.thumbnailPath);

  const selected = useWorkshopSelectionStore((s) => s.selectedPaths.has(project.path));
  const toggle = useWorkshopSelectionStore((s) => s.toggle);
  const { scope, onContextMenu } = useProjectMenuScope(project);

  const testState = useWorkshopTestState(project);
  const actions = useProjectActions(project);

  const isPatcherActive = testState.kind !== "idle";
  const isTestingThis = testState.kind === "building-this" || testState.kind === "running-this";

  /* The kebab's popup is a descendant in the React tree, so its keys reach the
     card unless the press landed on the card itself. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isChord(event, "projects.rename") || event.target !== event.currentTarget) return;
    event.preventDefault();
    actions.handleOpenRenameDialog();
  }

  const borderClass = isTestingThis
    ? "border-success/40"
    : selected
      ? "border-accent-500/40"
      : "border-surface-600";

  const card = (
    <div
      role="button"
      tabIndex={tabIndex}
      aria-label={project.displayName}
      className={twMerge(
        "sculpted-card group relative cursor-pointer overflow-hidden rounded-xl border bg-surface-900 shadow-concave transition-[background-color,border-color] duration-150 ease-out hover:border-accent-hover hover:bg-surface-800",
        FOCUS_RING,
        borderClass,
        isPatcherActive && !isTestingThis && "opacity-50",
      )}
      onClick={() => onEdit(project)}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    />
  );

  return (
    <ProjectCardContextMenu card={card} scope={scope} project={project} onEdit={onEdit}>
      <div
        className={twMerge(
          "absolute top-0 left-0 z-10 p-2",
          isPatcherActive ? "cursor-not-allowed" : "cursor-pointer",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!isPatcherActive && e.target === e.currentTarget) toggle(project.path);
        }}
      >
        <Checkbox
          size="md"
          checked={isPatcherActive ? isTestingThis : selected}
          onCheckedChange={() => toggle(project.path)}
          disabled={isPatcherActive}
        />
      </div>

      <div className="relative aspect-video overflow-hidden rounded-t-xl bg-linear-to-br from-surface-600 to-surface-700">
        {thumbnailUrl && (
          <img src={thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        {!thumbnailUrl && (
          <div className="flex size-full items-center justify-center">
            <span className="text-4xl font-bold text-surface-400">
              {project.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="sculpted-card-details flex items-start gap-1 p-3">
        {thumbnailUrl && (
          <span aria-hidden="true" className="sculpted-card-art">
            <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3
            title={project.location === "opened" ? project.path : undefined}
            className="mb-1 truncate text-sm font-medium text-surface-100"
          >
            {project.displayName}
          </h3>
          <div className="mb-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            <ProjectPills project={project} max={3} />
            <SuspectBadge projectPath={project.path} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <span>{m.workshop_card_version_label({ version: project.version })}</span>
            <span>•</span>
            <span className="flex-1 truncate">
              {project.authors.length > 0
                ? project.authors[0].name
                : m.workshop_card_unknown_label()}
            </span>
            {isTestingThis && <TestingPill />}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <ProjectKebab project={project} onEdit={onEdit} />
        </div>
      </div>
    </ProjectCardContextMenu>
  );
}
