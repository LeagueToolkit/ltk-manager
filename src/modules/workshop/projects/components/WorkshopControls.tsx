import {
  CaretDownIcon,
  FileZipIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GridFourIcon,
  ListIcon,
  PackageIcon,
  PlusIcon,
} from "@phosphor-icons/react";

import {
  ButtonGroup,
  IconButton,
  Kbd,
  Menu,
  SegmentedControl,
  type SegmentedOption,
  Separator,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import { ViewOptionsPopover } from "@/modules/library";

import { RecentProjectMenuItems } from "../../folders/components/RecentProjectMenuItems";
import { useOpenFolder } from "../../folders/hooks/useOpenFolder";
import { useProjectImports } from "../../imports/hooks/useProjectImports";
import {
  useNewProjectDialog,
  useSetWorkshopViewMode,
  useWorkshopViewMode,
  type ViewMode,
} from "../../state";
import { WorkshopSelectionButton } from "./WorkshopSelectionButton";

/* What the header's slots hold while no project is open. Each is one slot, so a
   route change refills the row rather than redrawing it. */

function viewOptions(): SegmentedOption<ViewMode>[] {
  return [
    {
      value: "grid",
      label: <GridFourIcon weight="bold" className="h-4 w-4" />,
      name: m.workshop_controls_grid_view_label(),
    },
    {
      value: "list",
      label: <ListIcon weight="bold" className="h-4 w-4" />,
      name: m.workshop_controls_list_view_label(),
    },
  ];
}

/** The view slot without a project: which selection, which shape. */
export function WorkshopViewControls() {
  const viewMode = useWorkshopViewMode();
  const setViewMode = useSetWorkshopViewMode();

  return (
    <>
      {/* Stays through a run: its Test is what ends the session it started. */}
      <WorkshopSelectionButton />

      <SegmentedControl
        options={viewOptions()}
        value={viewMode}
        onChange={setViewMode}
        action={<ViewOptionsPopover />}
      />
    </>
  );
}

/**
 * The action slot without a project, which is what puts one there.
 *
 * One control rather than two. A project is either blank or something somebody
 * else packed, so the button takes the first and its caret holds the other
 * three - which is the shape the selection button beside it already uses. This
 * row carries a selection, a filter and a view control before it reaches the
 * actions, and every route in here carries its name in the palette.
 */
export function WorkshopActions() {
  const openNewProjectDialog = useNewProjectDialog((s) => s.open);
  const imports = useProjectImports();
  const openFolder = useOpenFolder();

  return (
    <>
      <Separator orientation="vertical" />

      <ButtonGroup>
        <Tooltip
          content={
            <>
              {m.workshop_controls_new_project_label()} <Kbd shortcut="Ctrl+N" />
            </>
          }
        >
          <IconButton
            icon={<PlusIcon weight="bold" className="h-4 w-4" />}
            variant="filled"
            size="sm"
            onClick={openNewProjectDialog}
            aria-label={m.workshop_controls_new_project_label()}
          />
        </Tooltip>

        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton
                icon={<CaretDownIcon weight="bold" className="h-3.5 w-3.5" />}
                variant="filled"
                size="sm"
                loading={imports.pending || openFolder.pending}
                aria-label={m.workshop_controls_more_label()}
                /* A filled half carries no border to share, so the seam is the
                   groove its own pressed state is drawn in. */
                className="w-auto border-l border-accent-700 px-1"
              />
            }
          />
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup className="w-72">
                <Menu.Item
                  icon={<FolderOpenIcon weight="bold" className="h-4 w-4" />}
                  shortcut="Ctrl+O"
                  onClick={openFolder.pick}
                >
                  {m.workshop_folder_open_action()}
                </Menu.Item>
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>{m.workshop_controls_import_label()}</Menu.GroupLabel>
                  <Menu.Item
                    icon={<FileZipIcon weight="bold" className="h-4 w-4" />}
                    onClick={imports.fromFantome}
                  >
                    {m.workshop_controls_from_fantome_action()}
                  </Menu.Item>
                  <Menu.Item
                    icon={<PackageIcon weight="bold" className="h-4 w-4" />}
                    onClick={imports.fromModpkg}
                  >
                    {m.workshop_controls_from_modpkg_action()}
                  </Menu.Item>
                  <Menu.Item
                    icon={<GitBranchIcon weight="bold" className="h-4 w-4" />}
                    onClick={imports.fromGitRepo}
                  >
                    {m.workshop_controls_from_git_action()}
                  </Menu.Item>
                </Menu.Group>
                <RecentProjectMenuItems />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </ButtonGroup>
    </>
  );
}
