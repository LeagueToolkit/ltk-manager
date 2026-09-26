import {
  CursorTextIcon,
  FolderOpenIcon,
  LinkBreakIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { match } from "ts-pattern";

import { Menu } from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import { useStopPatcher } from "@/modules/patcher";
import {
  type ProjectSelectionActions,
  useProjectActions,
  useProjectSelectionActions,
  useWorkshopTestState,
} from "@/modules/workshop/api";
import { usePatcherSessionStore } from "@/stores";

import { useForgetProjectFolder } from "../../folders/api/projectFolders";

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
  const forgetFolder = useForgetProjectFolder();
  const testing = testState.kind === "building-this" || testState.kind === "running-this";

  return (
    <>
      <Menu.Item
        icon={<PencilSimpleIcon weight="bold" className="h-4 w-4" />}
        onClick={() => onEdit(project)}
      >
        {m.workshop_card_edit_action()}
      </Menu.Item>
      <ProjectTestItem testState={testState} onTest={actions.handleTestProject} />
      <Menu.Item
        icon={<PackageIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleOpenPackDialog}
      >
        {m.workshop_pack_action()}
      </Menu.Item>
      <Menu.Item
        icon={<CursorTextIcon weight="bold" className="h-4 w-4" />}
        shortcut="F2"
        onClick={actions.handleOpenRenameDialog}
      >
        {m.workshop_card_rename_action()}
      </Menu.Item>
      <Menu.Item
        icon={<FolderOpenIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleOpenLocation}
      >
        {m.workshop_card_open_location_action()}
      </Menu.Item>
      <Menu.Separator />
      {project.location === "opened" && (
        <Menu.Item
          icon={<LinkBreakIcon weight="bold" className="h-4 w-4" />}
          disabled={testing}
          onClick={() => forgetFolder.mutate(project.path)}
        >
          {m.workshop_folder_forget_action()}
        </Menu.Item>
      )}
      <Menu.Item
        icon={<TrashIcon weight="bold" className="h-4 w-4" />}
        variant="danger"
        onClick={actions.handleOpenDeleteDialog}
      >
        {m.workshop_tree_delete_action()}
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
  const stopping = usePatcherSessionStore((s) => s.stopping);

  return match(testState)
    .with({ kind: "idle" }, () => (
      <Menu.Item icon={<PlayIcon weight="bold" className="h-4 w-4" />} onClick={onTest}>
        {m.workshop_card_test_action()}
      </Menu.Item>
    ))
    .with({ kind: "building-this" }, () => (
      <Menu.Item icon={<PlayIcon weight="bold" className="h-4 w-4" />} disabled>
        {m.workshop_card_building_label()}
      </Menu.Item>
    ))
    .with({ kind: "running-this" }, () => (
      <Menu.Item
        icon={<PlayIcon weight="bold" className="h-4 w-4" />}
        disabled={stopping}
        onClick={() => stopPatcher.mutate()}
      >
        {stopping ? m.workshop_card_stopping_label() : m.workshop_card_stop_test_action()}
      </Menu.Item>
    ))
    .with(
      { kind: "building-other" },
      { kind: "running-other" },
      { kind: "building-library" },
      { kind: "running-library" },
      () => (
        <Menu.Item icon={<PlayIcon weight="bold" className="h-4 w-4" />} disabled>
          {m.workshop_card_test_action()}
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
      <Menu.GroupLabel>{m.workshop_card_selection_count_label({ count })}</Menu.GroupLabel>
      <Menu.Item
        icon={<PlayIcon weight="bold" className="h-4 w-4" />}
        disabled={!actions.canTest}
        onClick={actions.test}
      >
        {m.workshop_card_selection_test_action({ count })}
      </Menu.Item>
      <Menu.Item icon={<PackageIcon weight="bold" className="h-4 w-4" />} onClick={actions.pack}>
        {m.workshop_card_selection_pack_action({ count })}
      </Menu.Item>
      <Menu.Item
        icon={<TrashIcon weight="bold" className="h-4 w-4" />}
        variant="danger"
        onClick={actions.delete}
      >
        {m.workshop_card_selection_delete_action({ count })}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<XIcon weight="bold" className="h-4 w-4" />} onClick={actions.clear}>
        {m.workshop_card_selection_clear_action()}
      </Menu.Item>
    </Menu.Group>
  );
}
