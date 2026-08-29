import {
  CaretDownIcon,
  FileZipIcon,
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
import { ViewOptionsPopover } from "@/modules/library";
import { useWorkshopDialogsStore, useWorkshopViewStore, type ViewMode } from "@/stores";

import { useProjectImports } from "../api/useProjectImports";
import { WorkshopSelectionButton } from "./WorkshopSelectionButton";

/* What the header's slots hold while no project is open. Each is one slot, so a
   route change refills the row rather than redrawing it. */

const VIEW_OPTIONS: SegmentedOption<ViewMode>[] = [
  { value: "grid", label: <GridFourIcon weight="bold" className="h-4 w-4" />, name: "Grid view" },
  { value: "list", label: <ListIcon weight="bold" className="h-4 w-4" />, name: "List view" },
];

/** The view slot without a project: which selection, which shape. */
export function WorkshopViewControls() {
  const viewMode = useWorkshopViewStore((s) => s.viewMode);
  const setViewMode = useWorkshopViewStore((s) => s.setViewMode);

  return (
    <>
      {/* Stays through a run: its Test is what ends the session it started. */}
      <WorkshopSelectionButton />

      <SegmentedControl
        options={VIEW_OPTIONS}
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
  const openNewProjectDialog = useWorkshopDialogsStore((s) => s.openNewProjectDialog);
  const imports = useProjectImports();

  return (
    <>
      <Separator orientation="vertical" />

      <ButtonGroup>
        <Tooltip
          content={
            <>
              New project <Kbd shortcut="Ctrl+N" />
            </>
          }
        >
          <IconButton
            icon={<PlusIcon weight="bold" className="h-4 w-4" />}
            variant="filled"
            size="sm"
            onClick={openNewProjectDialog}
            aria-label="New project"
          />
        </Tooltip>

        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton
                icon={<CaretDownIcon weight="bold" className="h-3.5 w-3.5" />}
                variant="filled"
                size="sm"
                loading={imports.pending}
                aria-label="Import a project"
                /* A filled half carries no border to share, so the seam is the
                   groove its own pressed state is drawn in. */
                className="w-auto border-l border-accent-700 px-1"
              />
            }
          />
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup className="w-56">
                <Menu.Group>
                  <Menu.GroupLabel>Import a project</Menu.GroupLabel>
                  <Menu.Item
                    icon={<FileZipIcon weight="bold" className="h-4 w-4" />}
                    onClick={imports.fromFantome}
                  >
                    From Fantome
                  </Menu.Item>
                  <Menu.Item
                    icon={<PackageIcon weight="bold" className="h-4 w-4" />}
                    onClick={imports.fromModpkg}
                  >
                    From Modpkg
                  </Menu.Item>
                  <Menu.Item
                    icon={<GitBranchIcon weight="bold" className="h-4 w-4" />}
                    onClick={imports.fromGitRepo}
                  >
                    From a Git repository
                  </Menu.Item>
                </Menu.Group>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </ButtonGroup>
    </>
  );
}
