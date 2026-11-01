import {
  DownloadSimpleIcon,
  GridFourIcon,
  MagnifyingGlassIcon,
  TableIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
  Button,
  Field,
  FieldAffix,
  Kbd,
  SegmentedControl,
  type SegmentedOption,
  Separator,
  Toolbar,
  ToolbarRow,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import type { InstalledMod } from "@/lib/tauri";
import type { FilterOptions } from "@/modules/library/api";
import type { useLibraryActions, ViewMode } from "@/modules/library/api";
import { useLibraryViewMode } from "@/modules/library/api";

import { ActiveFilterChips } from "./ActiveFilterChips";
import { AnalyzeUncategorizedAction } from "./AnalyzeUncategorizedAction";
import { ConflictsButton } from "./ConflictsButton";
import { DocumentsToggle } from "./DocumentsToggle";
import { FilterPopover } from "./FilterPopover";
import { ModHealthCheckAction } from "./ModHealthCheckAction";
import { ProfileSelector } from "./ProfileSelector";
import { SelectionButton } from "./SelectionButton";
import { ViewOptionsPopover } from "./ViewOptionsPopover";

function viewOptions(): SegmentedOption<ViewMode>[] {
  return [
    {
      value: "grid",
      label: <GridFourIcon weight="bold" className="size-4" />,
      name: m.library_view_grid_label(),
    },
    {
      value: "table",
      label: <TableIcon weight="bold" className="size-4" />,
      name: m.library_view_table_label(),
    },
  ];
}

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  actions: ReturnType<typeof useLibraryActions>;
  isLoading: boolean;
  filterOptions: FilterOptions;
  visibleMods: InstalledMod[];
  /* A slot rather than an import: the play control belongs to launcher, which
     sits above library in the module order. */
  playButton?: ReactNode;
}

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  actions,
  isLoading,
  filterOptions,
  visibleMods,
  playButton,
}: LibraryToolbarProps) {
  const { viewMode, setViewMode } = useLibraryViewMode();
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkeys("ctrl+f", () => searchRef.current?.select(), {
    preventDefault: true,
    enableOnFormTags: true,
  });
  const isInstalling = actions.installMod.isPending || actions.bulkInstallMods.isPending;
  const importLabel = isInstalling ? "Importing..." : "Import";

  return (
    <Toolbar>
      <ToolbarRow>
        <div className="relative flex min-w-45 flex-1 items-center">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 size-4 text-surface-500" />
          <Field.Control
            ref={searchRef}
            type="text"
            placeholder="Search mods..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pr-10 pl-9"
          />
          <FieldAffix>
            <FilterPopover filterOptions={filterOptions} />
          </FieldAffix>
        </div>

        <ProfileSelector />

        <SelectionButton actions={actions} visibleMods={visibleMods} disabled={isLoading} />

        <AnalyzeUncategorizedAction disabled={isLoading} />

        <ModHealthCheckAction disabled={isLoading} />

        <ConflictsButton disabled={isLoading} />

        <DocumentsToggle />

        <SegmentedControl
          options={viewOptions()}
          value={viewMode}
          onChange={setViewMode}
          action={<ViewOptionsPopover />}
        />

        <Separator orientation="vertical" />

        <div className="flex items-center gap-5">
          <Tooltip
            content={
              <>
                Import mods <Kbd shortcut="Ctrl+I" />
              </>
            }
          >
            <Button
              variant="tonal"
              onClick={actions.handleImportMods}
              loading={isInstalling}
              aria-label="Import mods"
              left={<DownloadSimpleIcon weight="bold" className="size-4" />}
              /* Narrow windows wrap the toolbar onto a second row, so the label
                 drops and the button squares off to its icon. */
              className="max-lg:w-8 max-lg:gap-0 max-lg:px-0"
            >
              <span className="max-lg:hidden">{importLabel}</span>
            </Button>
          </Tooltip>

          {playButton}
        </div>
      </ToolbarRow>

      <ActiveFilterChips />
    </Toolbar>
  );
}
