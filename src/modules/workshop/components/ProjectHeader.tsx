import { Link } from "@tanstack/react-router";
import { ArrowLeft, EllipsisVertical, FolderOpen, Package, Play, Trash2 } from "lucide-react";

import { Button, IconButton, Menu, Tooltip } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { usePatcherStatus } from "@/modules/patcher";

import { useProjectActions } from "../api/useProjectActions";

interface ProjectHeaderProps {
  project: WorkshopProject;
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const { data: patcherStatus } = usePatcherStatus();
  const isPatcherActive = patcherStatus?.running ?? false;
  const actions = useProjectActions(project);

  return (
    <div className="flex items-center gap-3 border-b border-surface-700 px-6 py-3">
      <Tooltip content="Back to Workshop">
        <Link to="/workshop">
          <IconButton
            icon={<ArrowLeft className="h-4 w-4" />}
            variant="ghost"
            size="sm"
            aria-label="Back to Workshop"
          />
        </Link>
      </Tooltip>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-surface-100">{project.displayName}</h1>
          <span className="shrink-0 rounded-full bg-surface-700 px-2 py-0.5 text-xs text-surface-400">
            v{project.version}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          left={<Play className="h-4 w-4" />}
          onClick={actions.handleTestProject}
          disabled={isPatcherActive}
        >
          Test
        </Button>
        <Button
          variant="outline"
          size="sm"
          left={<Package className="h-4 w-4" />}
          onClick={actions.handleOpenPackDialog}
        >
          Pack
        </Button>
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton
                icon={<EllipsisVertical className="h-4 w-4" />}
                variant="ghost"
                size="sm"
              />
            }
          />
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup>
                <Menu.Item
                  icon={<FolderOpen className="h-4 w-4" />}
                  onClick={actions.handleOpenLocation}
                >
                  Open Location
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item
                  icon={<Trash2 className="h-4 w-4" />}
                  variant="danger"
                  onClick={actions.handleOpenDeleteDialog}
                >
                  Delete
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}
