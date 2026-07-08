import { Link } from "@tanstack/react-router";
import { ArrowLeft, EllipsisVertical, FolderOpen, Package, Play, Trash2 } from "lucide-react";
import { match } from "ts-pattern";

import { Button, IconButton, Menu, Tooltip } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { useStopPatcher } from "@/modules/patcher";

import { useProjectActions } from "../api/useProjectActions";
import { useWorkshopTestState } from "../api/useWorkshopTestState";

interface ProjectHeaderProps {
  project: WorkshopProject;
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const testState = useWorkshopTestState(project);
  const stopPatcher = useStopPatcher();
  const actions = useProjectActions(project);

  const testButton = match(testState)
    .with({ kind: "idle" }, () => (
      <Button
        variant="outline"
        size="sm"
        left={<Play className="h-4 w-4" />}
        onClick={actions.handleTestProject}
      >
        Test
      </Button>
    ))
    .with({ kind: "building-this" }, () => (
      <Button variant="outline" size="sm" loading disabled>
        Building…
      </Button>
    ))
    .with({ kind: "running-this" }, () => (
      <Button
        variant="outline"
        size="sm"
        onClick={() => stopPatcher.mutate()}
        loading={stopPatcher.isPending}
        left={
          !stopPatcher.isPending && (
            <span className="inline-flex h-2 w-2 rounded-full bg-green-500 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]" />
          )
        }
        className="border-green-500/40 bg-green-500/10 text-green-400 hover:border-green-500/60 hover:bg-green-500/20"
      >
        {stopPatcher.isPending ? "Stopping…" : "Stop Test"}
      </Button>
    ))
    .with({ kind: "building-other" }, { kind: "running-other" }, ({ otherLabel }) => (
      <Tooltip content={`Testing "${otherLabel}" — stop it first`}>
        <Button variant="outline" size="sm" disabled left={<Play className="h-4 w-4" />}>
          Test
        </Button>
      </Tooltip>
    ))
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content="Patcher is running — stop it first">
        <Button variant="outline" size="sm" disabled left={<Play className="h-4 w-4" />}>
          Test
        </Button>
      </Tooltip>
    ))
    .exhaustive();

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
        {testButton}
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
