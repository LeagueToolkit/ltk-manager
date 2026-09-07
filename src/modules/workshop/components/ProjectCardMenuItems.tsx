import {
  CursorTextIcon,
  FolderOpenIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { match } from "ts-pattern";

import { Menu } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { useStopPatcher } from "@/modules/patcher";
import {
  type ProjectSelectionActions,
  useProjectActions,
  useProjectSelectionActions,
  useWorkshopTestState,
} from "@/modules/workshop/api";

interface ProjectCardMenuItemsProps {
  project: WorkshopProject;
  onEdit: (project: WorkshopProject) => void;
}

/**
 * Every command a project card offers, for whichever popup is asking.
 *
 * Base UI builds a menu and a context menu out of the same item, so one list
 * hangs under either root - and the kebab and the right click cannot drift into
 * offering different commands. Per "The card" in `docs/ux/WORKSHOP.md`.
 */
export function ProjectCardMenuItems({ project, onEdit }: ProjectCardMenuItemsProps) {
  const actions = useProjectActions(project);
  const testState = useWorkshopTestState(project);

  return (
    <>
      <Menu.Item
        icon={<PencilSimpleIcon weight="bold" className="h-4 w-4" />}
        onClick={() => onEdit(project)}
      >
        Edit Project
      </Menu.Item>
      <ProjectTestItem testState={testState} onTest={actions.handleTestProject} />
      <Menu.Item
        icon={<PackageIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleOpenPackDialog}
      >
        Pack
      </Menu.Item>
      <Menu.Item
        icon={<CursorTextIcon weight="bold" className="h-4 w-4" />}
        shortcut="F2"
        onClick={actions.handleOpenRenameDialog}
      >
        Rename
      </Menu.Item>
      <Menu.Item
        icon={<FolderOpenIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleOpenLocation}
      >
        Open Location
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item
        icon={<TrashIcon weight="bold" className="h-4 w-4" />}
        variant="danger"
        onClick={actions.handleOpenDeleteDialog}
      >
        Delete
      </Menu.Item>
    </>
  );
}

/** Test, Stop Test, or the reason neither is on offer. */
function ProjectTestItem({
  testState,
  onTest,
}: {
  testState: ReturnType<typeof useWorkshopTestState>;
  onTest: () => void;
}) {
  const stopPatcher = useStopPatcher();

  return match(testState)
    .with({ kind: "idle" }, () => (
      <Menu.Item icon={<PlayIcon weight="bold" className="h-4 w-4" />} onClick={onTest}>
        Test
      </Menu.Item>
    ))
    .with({ kind: "building-this" }, () => (
      <Menu.Item icon={<PlayIcon weight="bold" className="h-4 w-4" />} disabled>
        Building…
      </Menu.Item>
    ))
    .with({ kind: "running-this" }, () => (
      <Menu.Item
        icon={<PlayIcon weight="bold" className="h-4 w-4" />}
        onClick={() => stopPatcher.mutate()}
      >
        Stop Test
      </Menu.Item>
    ))
    .with(
      { kind: "building-other" },
      { kind: "running-other" },
      { kind: "building-library" },
      { kind: "running-library" },
      () => (
        <Menu.Item icon={<PlayIcon weight="bold" className="h-4 w-4" />} disabled>
          Test
        </Menu.Item>
      ),
    )
    .exhaustive();
}

/**
 * The commands a project selection carries, for whichever popup is asking.
 *
 * The selection button draws the same set. Per "Selection, and a running
 * session" in `docs/ux/WORKSHOP.md`.
 */
export function ProjectSelectionMenuItems() {
  const actions: ProjectSelectionActions = useProjectSelectionActions();
  const { count } = actions;

  return (
    <Menu.Group>
      <Menu.GroupLabel>{`${count} selected`}</Menu.GroupLabel>
      <Menu.Item
        icon={<PlayIcon weight="bold" className="h-4 w-4" />}
        disabled={!actions.canTest}
        onClick={actions.test}
      >
        Test {count}
      </Menu.Item>
      <Menu.Item icon={<PackageIcon weight="bold" className="h-4 w-4" />} onClick={actions.pack}>
        Pack {count}
      </Menu.Item>
      <Menu.Item
        icon={<TrashIcon weight="bold" className="h-4 w-4" />}
        variant="danger"
        onClick={actions.delete}
      >
        Delete {count}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<XIcon weight="bold" className="h-4 w-4" />} onClick={actions.clear}>
        Clear selection
      </Menu.Item>
    </Menu.Group>
  );
}
