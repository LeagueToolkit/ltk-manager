import {
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  PackageIcon,
  PlayIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { match } from "ts-pattern";

import { Button, ButtonGroup, IconButton, Menu, Tooltip } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { useStopPatcher } from "@/modules/patcher";

import { useProjectActions } from "../api/useProjectActions";
import { useWorkshopTestState } from "../api/useWorkshopTestState";

interface ProjectActionsProps {
  project: WorkshopProject;
}

/* Each segment draws its own edge in its own hue, so the group has no neutral rule
   cutting across a colored fill. */
const testClass =
  "border border-success/30 bg-success/15 text-success-text hover:border-success/45 hover:bg-success/25 active:bg-success/35";
const packClass =
  "border border-info/30 bg-info/15 text-info-text hover:border-info/45 hover:bg-info/25 active:bg-info/35";

/* A test in progress carries its state in the edge rather than the fill, so it reads apart
   from the idle tint at a glance without the solid fill shouting over the header. */
const runningClass =
  "border border-success bg-success/25 text-success-text hover:bg-success/35 active:bg-success/45";

/** The overflow owns no action of its own, so it keeps the neutral edge. */
const menuClass = "border border-surface-600";

/** Test, pack and the overflow menu, joined into one control in the project header. */
export function ProjectActions({ project }: ProjectActionsProps) {
  const testState = useWorkshopTestState(project);
  const stopPatcher = useStopPatcher();
  const actions = useProjectActions(project);

  const testButton = match(testState)
    .with({ kind: "idle" }, () => (
      <Button
        variant="ghost"
        size="sm"
        compact
        left={<PlayIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleTestProject}
        className={testClass}
      >
        Test
      </Button>
    ))
    .with({ kind: "building-this" }, () => (
      <Button variant="ghost" size="sm" compact loading disabled className={testClass}>
        Building…
      </Button>
    ))
    .with({ kind: "running-this" }, () => (
      <Button
        variant="ghost"
        size="sm"
        compact
        onClick={() => stopPatcher.mutate()}
        loading={stopPatcher.isPending}
        left={
          !stopPatcher.isPending && (
            <span className="inline-flex h-2 w-2 rounded-full bg-success shadow-[0_0_6px_2px] shadow-success/60" />
          )
        }
        className={runningClass}
      >
        {stopPatcher.isPending ? "Stopping…" : "Stop Test"}
      </Button>
    ))
    .with({ kind: "building-other" }, { kind: "running-other" }, ({ otherLabel }) => (
      <Tooltip content={`Testing "${otherLabel}" - stop it first`}>
        <Button
          variant="ghost"
          size="sm"
          compact
          disabled
          left={<PlayIcon weight="bold" className="h-4 w-4" />}
          className={testClass}
        >
          Test
        </Button>
      </Tooltip>
    ))
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content="Patcher is running - stop it first">
        <Button
          variant="ghost"
          size="sm"
          compact
          disabled
          left={<PlayIcon weight="bold" className="h-4 w-4" />}
          className={testClass}
        >
          Test
        </Button>
      </Tooltip>
    ))
    .exhaustive();

  return (
    <ButtonGroup className="shrink-0">
      {testButton}

      <Button
        variant="ghost"
        size="sm"
        compact
        left={<PackageIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleOpenPackDialog}
        className={packClass}
      >
        Pack
      </Button>

      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              compact
              aria-label="Project actions"
              className={menuClass}
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup>
              <Menu.Item
                icon={<FolderOpenIcon className="h-4 w-4" />}
                onClick={actions.handleOpenLocation}
              >
                Open Location
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                icon={<TrashIcon className="h-4 w-4" />}
                variant="danger"
                onClick={actions.handleOpenDeleteDialog}
              >
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}
