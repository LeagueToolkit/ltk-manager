import { CheckCheck, CheckSquare, Grid3X3, List, Play, Plus, Search, X } from "lucide-react";

import { Button, IconButton, Kbd, Tooltip } from "@/components";
import type { InstalledMod, PatcherStatus } from "@/lib/tauri";
import type { FilterOptions } from "@/modules/library/api";
import type { useLibraryActions } from "@/modules/library/api";
import { useLibraryViewMode } from "@/modules/library/api";
import { useLibrarySelectionStore } from "@/stores";

import { ActiveFilterChips } from "./ActiveFilterChips";
import { FilterPopover } from "./FilterPopover";
import { SelectionActionBar } from "./SelectionActionBar";
import { SortDropdown } from "./SortDropdown";

interface PatcherProps {
  status: PatcherStatus | undefined;
  isStarting: boolean;
  isStopping: boolean;
  onStart: () => void;
  onStop: () => void;
}

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  actions: ReturnType<typeof useLibraryActions>;
  patcher?: PatcherProps;
  hasEnabledMods: boolean;
  isLoading: boolean;
  isPatcherActive: boolean;
  filterOptions: FilterOptions;
  visibleMods: InstalledMod[];
}

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  actions,
  patcher,
  hasEnabledMods,
  isLoading,
  isPatcherActive,
  filterOptions,
  visibleMods,
}: LibraryToolbarProps) {
  const { viewMode, setViewMode } = useLibraryViewMode();
  const selectMode = useLibrarySelectionStore((s) => s.selectMode);
  const enterSelectMode = useLibrarySelectionStore((s) => s.enterSelectMode);
  const exitSelectMode = useLibrarySelectionStore((s) => s.exitSelectMode);
  const visibleEnabledCount = visibleMods.reduce((n, m) => n + (m.enabled ? 1 : 0), 0);
  const canEnableAll = visibleMods.length > 0 && visibleEnabledCount < visibleMods.length;
  const canDisableAll = visibleEnabledCount > 0;
  const bulkDisabled = isPatcherActive || isLoading || actions.toggleMod.isPending;

  return (
    <div className="border-b border-surface-600 bg-surface-800/50 px-4 py-3" data-tauri-drag-region>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Search */}
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Search mods..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-surface-600 bg-surface-800 py-2 pr-4 pl-10 text-surface-100 transition-colors duration-150 placeholder:text-surface-500 focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-0 focus-visible:outline-none"
          />
        </div>

        <FilterPopover filterOptions={filterOptions} />

        <SortDropdown />

        {/* View toggle */}
        <div className="flex items-center gap-1">
          <Tooltip content="Grid view">
            <IconButton
              icon={<Grid3X3 className="h-4 w-4" />}
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
            />
          </Tooltip>
          <Tooltip content="List view">
            <IconButton
              icon={<List className="h-4 w-4" />}
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
            />
          </Tooltip>
        </div>

        {/* Bulk toggle */}
        <div className="flex items-center gap-1">
          <Tooltip content="Enable every mod matching the current search/filters">
            <IconButton
              icon={<CheckCheck className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              onClick={() => actions.handleSetEnabledForMods(visibleMods, true)}
              disabled={bulkDisabled || !canEnableAll}
              aria-label="Enable all visible mods"
            />
          </Tooltip>
          <Tooltip content="Disable every mod matching the current search/filters">
            <IconButton
              icon={<X className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              onClick={() => actions.handleSetEnabledForMods(visibleMods, false)}
              disabled={bulkDisabled || !canDisableAll}
              aria-label="Disable all visible mods"
            />
          </Tooltip>
        </div>

        {/* Select mode toggle */}
        <Tooltip
          content={
            selectMode
              ? "Exit select mode"
              : "Select mods to bulk-uninstall (combine with search/filters to narrow down)"
          }
        >
          <Button
            variant={selectMode ? "filled" : "outline"}
            size="sm"
            onClick={selectMode ? exitSelectMode : enterSelectMode}
            disabled={isPatcherActive || isLoading}
            left={<CheckSquare className="h-4 w-4" />}
          >
            {selectMode ? "Done" : "Select"}
          </Button>
        </Tooltip>

        {/* Actions */}
        <Tooltip
          content={
            <>
              Add mod <Kbd shortcut="Ctrl+I" />
            </>
          }
        >
          <Button
            variant="filled"
            size="sm"
            onClick={actions.handleInstallMod}
            loading={actions.installMod.isPending || actions.bulkInstallMods.isPending}
            disabled={isPatcherActive}
            left={<Plus className="h-4 w-4" />}
          >
            {actions.installMod.isPending || actions.bulkInstallMods.isPending
              ? "Installing..."
              : "Add Mod"}
          </Button>
        </Tooltip>

        {patcher && (
          <Tooltip
            content={
              <>
                Toggle patcher <Kbd shortcut="Ctrl+P" />
              </>
            }
          >
            {patcher.status?.running ? (
              <Button
                variant="outline"
                size="sm"
                onClick={patcher.onStop}
                loading={patcher.isStopping}
                disabled={
                  actions.installMod.isPending ||
                  actions.bulkInstallMods.isPending ||
                  patcher.isStopping
                }
                left={
                  !patcher.isStopping && (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                  )
                }
                className="border-green-500/40 bg-green-500/10 text-green-400 hover:border-green-500/60 hover:bg-green-500/20"
              >
                {patcher.isStopping ? "Stopping..." : "Stop Patcher"}
              </Button>
            ) : (
              <Button
                variant={hasEnabledMods ? "filled" : "default"}
                size="sm"
                onClick={patcher.onStart}
                loading={patcher.isStarting}
                left={!patcher.isStarting && <Play className="h-4 w-4" />}
                disabled={
                  isLoading ||
                  !hasEnabledMods ||
                  actions.installMod.isPending ||
                  actions.bulkInstallMods.isPending ||
                  patcher.isStopping ||
                  patcher.isStarting
                }
              >
                {patcher.isStarting ? "Building..." : "Start Patcher"}
              </Button>
            )}
          </Tooltip>
        )}
      </div>
      <ActiveFilterChips />
      {selectMode && <SelectionActionBar visibleMods={visibleMods} />}
    </div>
  );
}
