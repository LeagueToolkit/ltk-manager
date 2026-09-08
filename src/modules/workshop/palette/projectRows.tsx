import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { WorkshopProject } from "@/lib/tauri";

import { projectQueries } from "../api/queries";
import { useWorkshopProjects } from "../api/useWorkshopProjects";
import { buildCandidate } from "./candidate";
import type { PaletteCandidate } from "./types";

const NO_AUTHOR = "Unknown author";

/**
 * One project as a row.
 *
 * Per "The sources" in `docs/ux/WORKSHOP.md`.
 */
export function projectRow(project: WorkshopProject, thumbnailUrl?: string): PaletteCandidate {
  const authors = project.authors.map((author) => author.name).join(", ");

  return buildCandidate({
    id: `project:${project.name}`,
    source: "projects",
    name: project.displayName,
    path: authors.length > 0 ? authors : NO_AUTHOR,
    trailing: `v${project.version}`,
    keywords: project.name.toLowerCase(),
    icon: <ProjectGlyph project={project} thumbnailUrl={thumbnailUrl} />,
    target: { kind: "project", name: project.name },
  });
}

/**
 * Every project of the workshop, newest first.
 *
 * The listing an empty box draws answers "where was I", so it is by recency
 * rather than by the grid's own sort - which is the user's, is by name until
 * they change it, and is already on screen behind the bar. A term reranks the
 * rows, so this order only decides the listing.
 */
export function useProjectRows(): readonly PaletteCandidate[] {
  const { data: projects } = useWorkshopProjects();

  /* The grid has already run these and they never go stale, so on the workshop's
     own surface the rows draw their thumbnails without a round trip. */
  const thumbnails = useQueries({
    queries: (projects ?? []).map((project) =>
      projectQueries.thumbnail(project.path, project.thumbnailPath),
    ),
    combine: (results) => results.map((result) => result.data),
  });

  return useMemo(() => {
    if (!projects) return [];

    return projects
      .map((project, at) => ({ project, thumbnailUrl: thumbnails[at] }))
      .sort((a, b) => byNewest(a.project, b.project))
      .map(({ project, thumbnailUrl }) => projectRow(project, thumbnailUrl));
  }, [projects, thumbnails]);
}

function byNewest(a: WorkshopProject, b: WorkshopProject): number {
  return Date.parse(b.lastModified) - Date.parse(a.lastModified);
}

/** What a project row runs, and what the filter's one remaining match runs. */
export function useOpenProject(): (name: string) => void {
  const navigate = useNavigate();

  return useCallback(
    (name: string) =>
      void navigate({ to: "/workshop/$projectName", params: { projectName: name } }),
    [navigate],
  );
}

interface ProjectGlyphProps {
  project: WorkshopProject;
  thumbnailUrl?: string;
}

/* The card's plate at the size of an icon, so a row of projects reads in the
   same rhythm as a row of files. A project with no thumbnail falls back to its
   initial, which is what the card does. */
function ProjectGlyph({ project, thumbnailUrl }: ProjectGlyphProps) {
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt="" className="h-4 w-4 rounded-sm object-cover" />;
  }

  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-linear-to-br from-surface-600 to-surface-700 text-meta leading-none font-medium text-surface-300">
      {project.displayName.charAt(0).toUpperCase()}
    </span>
  );
}
