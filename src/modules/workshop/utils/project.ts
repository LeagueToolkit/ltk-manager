import type { WorkshopProject } from "@/lib/tauri";

/**
 * A project still carrying every default the scaffold gave it.
 *
 * Display name and version are always filled in at creation, so only the fields
 * a user has to supply themselves say whether anyone has been here yet.
 */
export function isProjectUnconfigured(project: WorkshopProject): boolean {
  return (
    project.description.trim().length === 0 &&
    project.tags.length === 0 &&
    project.champions.length === 0 &&
    project.maps.length === 0 &&
    project.authors.every((author) => author.name.trim().length === 0)
  );
}
