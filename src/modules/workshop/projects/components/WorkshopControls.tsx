import {
  CaretDownIcon,
  FileZipIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GridFourIcon,
  MapTrifoldIcon,
  PackageIcon,
  PlusIcon,
  TableIcon,
} from "@phosphor-icons/react";

import {
  ArrangedTableOptions,
  Button,
  ButtonGroup,
  IconButton,
  Kbd,
  Menu,
  SegmentedControl,
  type SegmentedOption,
} from "@/components";
import { m } from "@/i18n";
import { shortcutOf } from "@/modules/keys";
import { ViewOptionsPopover } from "@/modules/library";

import { RecentProjectMenuItems } from "../../folders/components/RecentProjectMenuItems";
import { useOpenFolder } from "../../folders/hooks/useOpenFolder";
import { useProjectImports } from "../../imports/hooks/useProjectImports";
import {
  useNewMapProjectDialog,
  useNewProjectDialog,
  useProjectTableStore,
  useSetWorkshopViewMode,
  useWorkshopViewMode,
  type ViewMode,
} from "../../state";
import { useFilteredProjects, useProjectCountLabel } from "../hooks/useFilteredProjects";
import { useProjectSelectionActions } from "../hooks/useProjectSelectionActions";
import { ProjectSelectionMenuItems } from "./ProjectCardMenuItems";
import { PickAll } from "./ProjectTable";
import { PROJECT_COLUMN_SPECS, PROJECT_GROUP_LABELS } from "./ProjectTable/columns";

function viewOptions(): SegmentedOption<ViewMode>[] {
  return [
    {
      value: "grid",
      label: <GridFourIcon weight="bold" className="size-4" />,
      name: m.workshop_controls_grid_view_label(),
    },
    {
      value: "table",
      label: <TableIcon weight="bold" className="size-4" />,
      name: m.workshop_controls_table_view_label(),
    },
  ];
}

/**
 * The project list's footer: what it draws, what is picked, and the view it is drawn in.
 *
 * Per "The list's footer" in docs/ux/WORKSHOP.md.
 */
export function WorkshopListFooter() {
  const viewMode = useWorkshopViewMode();
  const setViewMode = useSetWorkshopViewMode();
  const count = useProjectCountLabel();

  return (
    <footer
      data-ui="WorkshopListFooter"
      aria-label={m.workshop_list_footer_label()}
      className="flex h-9 shrink-0 items-center gap-2 border-t border-surface-700 pr-1 pl-4 select-none"
    >
      {/* The table's header holds the same checkbox. */}
      {viewMode === "grid" && <PickAllShown />}

      <span className="truncate text-meta text-surface-400 tabular-nums">{count}</span>
      <SelectionMenu />

      <SegmentedControl
        options={viewOptions()}
        value={viewMode}
        onChange={setViewMode}
        size="sm"
        aria-label={m.workshop_list_view_label()}
        className="ml-auto shrink-0"
        action={
          <ViewOptionsPopover
            viewMode={viewMode}
            tableOptions={
              <ArrangedTableOptions
                store={useProjectTableStore}
                specs={PROJECT_COLUMN_SPECS}
                groupLabels={PROJECT_GROUP_LABELS}
              />
            }
          />
        }
      />
    </footer>
  );
}

function PickAllShown() {
  const shown = useFilteredProjects();

  return (
    <PickAll
      paths={shown.map((project) => project.path)}
      label={m.workshop_table_select_all_label()}
    />
  );
}

/** The picks, as the trigger of the commands they carry. */
function SelectionMenu() {
  const { count } = useProjectSelectionActions();

  if (count === 0) return null;

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="tonal"
            size="xs"
            right={<CaretDownIcon weight="bold" className="size-3" />}
          >
            {m.workshop_card_selection_count_label({ count })}
          </Button>
        }
      />
      <Menu.Content side="top" align="start" className="w-56">
        <ProjectSelectionMenuItems />
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * What puts a project in the workshop: New project, and the other ways in on its caret.
 *
 * One control rather than two. A project is either blank or something somebody
 * else packed, so the button takes the first and its caret holds the other three.
 */
export function NewProjectButton() {
  const openNewProjectDialog = useNewProjectDialog((s) => s.open);
  const openNewMapProjectDialog = useNewMapProjectDialog((s) => s.open);
  const imports = useProjectImports();
  const openFolder = useOpenFolder();

  return (
    <ButtonGroup>
      <IconButton
        icon={<PlusIcon />}
        size="xs"
        onClick={openNewProjectDialog}
        aria-label={m.workshop_controls_new_project_label()}
        tooltip={
          <>
            {m.workshop_controls_new_project_label()}{" "}
            <Kbd shortcut={shortcutOf("workshop.newProject")} />
          </>
        }
      />

      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretDownIcon />}
              size="xs"
              loading={imports.pending || openFolder.pending}
              aria-label={m.workshop_controls_more_label()}
              narrow
            />
          }
        />
        <Menu.Content className="w-72">
          <Menu.Item
            icon={<FolderOpenIcon weight="bold" className="size-4" />}
            shortcut={shortcutOf("workshop.openFolder")}
            onClick={openFolder.pick}
          >
            {m.workshop_folder_open_action()}
          </Menu.Item>
          <Menu.Item
            icon={<MapTrifoldIcon weight="bold" className="size-4" />}
            onClick={openNewMapProjectDialog}
          >
            {m.workshop_controls_new_map_action()}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{m.workshop_controls_import_label()}</Menu.GroupLabel>
            <Menu.Item
              icon={<FileZipIcon weight="bold" className="size-4" />}
              onClick={imports.fromFantome}
            >
              {m.workshop_controls_from_fantome_action()}
            </Menu.Item>
            <Menu.Item
              icon={<PackageIcon weight="bold" className="size-4" />}
              onClick={imports.fromModpkg}
            >
              {m.workshop_controls_from_modpkg_action()}
            </Menu.Item>
            <Menu.Item
              icon={<GitBranchIcon weight="bold" className="size-4" />}
              onClick={imports.fromGitRepo}
            >
              {m.workshop_controls_from_git_action()}
            </Menu.Item>
          </Menu.Group>
          <RecentProjectMenuItems />
        </Menu.Content>
      </Menu.Root>
    </ButtonGroup>
  );
}
