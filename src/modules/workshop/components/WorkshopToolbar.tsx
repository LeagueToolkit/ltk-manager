import {
  CaretDownIcon,
  DownloadSimpleIcon,
  FileZipIcon,
  GitBranchIcon,
  GridFourIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  Button,
  Field,
  FieldAffix,
  fieldAffixButtonClass,
  Kbd,
  Menu,
  SegmentedControl,
  type SegmentedOption,
  Separator,
  Toolbar,
  ToolbarRow,
  Tooltip,
} from "@/components";
import { ProfileSelector, ViewOptionsPopover } from "@/modules/library";
import { usePatcherStatus } from "@/modules/patcher";
import { useWorkshopDialogsStore, useWorkshopViewStore } from "@/stores";

import type { WorkshopFilterOptions } from "../api/useFilterOptions";
import { useImportFromModpkg } from "../api/useImportFromModpkg";
import { usePeekFantome } from "../api/usePeekFantome";
import { WorkshopActiveFilterChips } from "./WorkshopActiveFilterChips";
import { WorkshopFilterPopover } from "./WorkshopFilterPopover";
import { WorkshopSelectionButton } from "./WorkshopSelectionButton";

export type ViewMode = "grid" | "list";

const VIEW_OPTIONS: SegmentedOption<ViewMode>[] = [
  { value: "grid", label: <GridFourIcon weight="bold" className="h-4 w-4" />, name: "Grid view" },
  { value: "list", label: <ListIcon weight="bold" className="h-4 w-4" />, name: "List view" },
];

interface WorkshopToolbarProps {
  filterOptions: WorkshopFilterOptions;
}

export function WorkshopToolbar({ filterOptions }: WorkshopToolbarProps) {
  const searchQuery = useWorkshopViewStore((s) => s.searchQuery);
  const setSearchQuery = useWorkshopViewStore((s) => s.setSearchQuery);
  const viewMode = useWorkshopViewStore((s) => s.viewMode);
  const setViewMode = useWorkshopViewStore((s) => s.setViewMode);

  const { data: patcherStatus } = usePatcherStatus();
  const isPatcherActive = patcherStatus?.running ?? false;

  const openNewProjectDialog = useWorkshopDialogsStore((s) => s.openNewProjectDialog);
  const openFantomeImportDialog = useWorkshopDialogsStore((s) => s.openFantomeImportDialog);
  const openGitImportDialog = useWorkshopDialogsStore((s) => s.openGitImportDialog);

  const importFromModpkg = useImportFromModpkg();
  const peekFantome = usePeekFantome();

  const isImporting = importFromModpkg.isPending || peekFantome.isPending;

  async function handleImportModpkg() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Mod Package", extensions: ["modpkg"] }],
    });
    if (file) {
      importFromModpkg.mutate(file, {
        onError: (err) => console.error("Failed to import modpkg:", err.message),
      });
    }
  }

  async function handleImportFantome() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Fantome Archive", extensions: ["fantome", "zip"] }],
    });
    if (!file) return;

    peekFantome.mutate(file, {
      onSuccess: (result) => openFantomeImportDialog(result, file),
      onError: (err) => console.error("Failed to peek fantome:", err.message),
    });
  }

  return (
    <Toolbar>
      <ToolbarRow>
        <div className="relative flex min-w-[180px] flex-1 items-center">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 h-4 w-4 text-surface-500" />
          <Field.Control
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10 pl-9"
          />
          <FieldAffix>
            <WorkshopFilterPopover
              filterOptions={filterOptions}
              className={fieldAffixButtonClass}
            />
          </FieldAffix>
        </div>

        <ProfileSelector />

        {!isPatcherActive && <WorkshopSelectionButton />}

        <SegmentedControl
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={setViewMode}
          action={<ViewOptionsPopover includeWadFootprint={false} />}
        />

        <Separator orientation="vertical" />

        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="outline"
                size="sm"
                loading={isImporting}
                left={<DownloadSimpleIcon weight="bold" className="h-4 w-4" />}
                right={<CaretDownIcon weight="bold" className="h-3.5 w-3.5" />}
              >
                Import
              </Button>
            }
          />
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup className="w-56">
                <Menu.Item
                  icon={<FileZipIcon weight="bold" className="h-4 w-4" />}
                  onClick={handleImportFantome}
                >
                  From Fantome
                </Menu.Item>
                <Menu.Item
                  icon={<PackageIcon weight="bold" className="h-4 w-4" />}
                  onClick={handleImportModpkg}
                >
                  From Modpkg
                </Menu.Item>
                <Menu.Item
                  icon={<GitBranchIcon weight="bold" className="h-4 w-4" />}
                  onClick={openGitImportDialog}
                >
                  From Git Repository
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <Tooltip
          content={
            <>
              New project <Kbd shortcut="Ctrl+N" />
            </>
          }
        >
          <Button
            variant="filled"
            size="sm"
            onClick={openNewProjectDialog}
            left={<PlusIcon weight="bold" className="h-4 w-4" />}
          >
            New Project
          </Button>
        </Tooltip>
      </ToolbarRow>

      <WorkshopActiveFilterChips />
    </Toolbar>
  );
}
