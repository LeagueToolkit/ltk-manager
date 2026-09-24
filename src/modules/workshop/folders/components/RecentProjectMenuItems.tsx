import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";

import { Menu } from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";

import { ProjectGlyph } from "../../palette/components/projectRows";
import { useRevealPalette } from "../../palette/state/paletteReveal";
import { useProjectThumbnail } from "../../projects/api/useProjectThumbnail";
import { useRecentProjects } from "../hooks/useRecentProjects";
import { since } from "../utils/since";

/** How many recent projects the menu lists before the palette takes over. */
const RECENT_IN_MENU = 5;

/**
 * The recently opened projects, as a group of a menu, one line each.
 *
 * Per "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function RecentProjectMenuItems() {
  const revealPalette = useRevealPalette();
  const recent = useRecentProjects(RECENT_IN_MENU);

  if (recent.length === 0) return null;

  return (
    <>
      <Menu.Separator />
      <Menu.Group>
        <Menu.GroupLabel>{m.workshop_folder_recent_label()}</Menu.GroupLabel>
        {recent.map((project) => (
          <RecentProjectItem key={project.id} project={project} />
        ))}
        <Menu.Item
          icon={<MagnifyingGlassIcon className="h-4 w-4" />}
          shortcut="Ctrl+R"
          onClick={() => revealPalette("projects")}
          className="text-surface-400"
        >
          {m.workshop_folder_recent_more_action()}
        </Menu.Item>
      </Menu.Group>
    </>
  );
}

/* The thumbnail rather than a glyph in the icon slot, which would dim it to the slot's opacity. */
function RecentProjectItem({ project }: { project: WorkshopProject }) {
  const navigate = useNavigate();
  const { data: thumbnailUrl } = useProjectThumbnail(project.path, project.thumbnailPath);

  return (
    <Menu.Item
      title={project.path}
      onClick={() =>
        void navigate({ to: "/workshop/$projectId", params: { projectId: project.id } })
      }
    >
      <span className="flex items-center gap-2">
        <ProjectGlyph project={project} thumbnailUrl={thumbnailUrl} />
        <span className="max-w-40 truncate">{project.displayName}</span>
        {project.lastOpened && (
          <span className="ml-auto shrink-0 pl-3 text-meta text-surface-500 tabular-nums">
            {since(project.lastOpened)}
          </span>
        )}
      </span>
    </Menu.Item>
  );
}
