import {
  DownloadSimpleIcon,
  GridFourIcon,
  ListIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
  Button,
  Field,
  FieldAffix,
  fieldAffixButtonClass,
  Kbd,
  SegmentedControl,
  type SegmentedOption,
  Separator,
  Toolbar,
  ToolbarRow,
  Tooltip,
} from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import type { FilterOptions } from "@/modules/library/api";
import type { useLibraryActions } from "@/modules/library/api";
import { useLibraryViewMode } from "@/modules/library/api";

import { ActiveFilterChips } from "./ActiveFilterChips";
import { AnalyzeUncategorizedAction } from "./AnalyzeUncategorizedAction";
import { DocumentsToggle } from "./DocumentsToggle";
import { FilterPopover } from "./FilterPopover";
import { ModHealthCheckAction } from "./ModHealthCheckAction";
import { ProfileSelector } from "./ProfileSelector";
import { SelectionButton } from "./SelectionButton";
import { ViewOptionsPopover } from "./ViewOptionsPopover";

const VIEW_OPTIONS: SegmentedOption<"grid" | "list">[] = [
  { value: "grid", label: <GridFourIcon weight="bold" className="h-4 w-4" />, name: "Grid view" },
  { value: "list", label: <ListIcon weight="bold" className="h-4 w-4" />, name: "List view" },
];

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  actions: ReturnType<typeof useLibraryActions>;
  isLoading: boolean;
  isPatcherActive: boolean;
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
  isPatcherActive,
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
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 h-4 w-4 text-surface-500" />
          <Field.Control
            ref={searchRef}
            type="text"
            placeholder="Search mods..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pr-10 pl-9"
          />
          <FieldAffix>
            <FilterPopover filterOptions={filterOptions} className={fieldAffixButtonClass} />
          </FieldAffix>
        </div>

        <ProfileSelector />

        <SelectionButton
          actions={actions}
          visibleMods={visibleMods}
          disabled={isPatcherActive || isLoading}
        />

        <AnalyzeUncategorizedAction disabled={isPatcherActive || isLoading} />

        <ModHealthCheckAction disabled={isLoading} />

        <DocumentsToggle />

        <SegmentedControl
          options={VIEW_OPTIONS}
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
              variant="light"
              size="sm"
              onClick={actions.handleImportMods}
              loading={isInstalling}
              disabled={isPatcherActive}
              aria-label="Import mods"
              left={<DownloadSimpleIcon weight="bold" className="h-4 w-4" />}
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
