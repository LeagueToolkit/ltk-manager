import { Filter, Plus, Search, Upload } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components";
import type { AppError, InstalledMod } from "@/lib/tauri";
import type { useLibraryActions } from "@/modules/library/api";
import { useFilteredMods, useLibraryViewMode } from "@/modules/library/api";
import { useHasActiveFilters, useLibraryFilterStore } from "@/stores";

import { ModCard } from "./ModCard";
import { ModDetailsDialog } from "./ModDetailsDialog";
import { SortableModCard } from "./SortableModCard";
import { SortableModList } from "./SortableModList";

function gridClass(viewMode: "grid" | "list", indent = false) {
  if (viewMode === "list") return indent ? "space-y-2 pl-7" : "space-y-2";
  return "grid grid-cols-[repeat(auto-fill,minmax(280px,380px))] gap-4";
}

interface LibraryContentProps {
  mods: InstalledMod[];
  searchQuery: string;
  actions: ReturnType<typeof useLibraryActions>;
  isLoading: boolean;
  error: AppError | null;
  onInstall: () => void;
  isPatcherActive?: boolean;
}

export function LibraryContent({
  mods,
  searchQuery,
  actions,
  isLoading,
  error,
  onInstall,
  isPatcherActive,
}: LibraryContentProps) {
  const { viewMode } = useLibraryViewMode();
  const [detailsMod, setDetailsMod] = useState<InstalledMod | null>(null);
  const filteredMods = useFilteredMods(mods, searchQuery);
  const hasActiveFilters = useHasActiveFilters();
  const { sort } = useLibraryFilterStore();

  const isSearching = searchQuery.length > 0;
  const isPrioritySort = sort.field === "priority";
  const dndDisabled = isSearching || isPatcherActive || !isPrioritySort || hasActiveFilters;

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <ErrorState error={error} />
      </div>
    );
  }

  if (filteredMods.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <EmptyState onInstall={onInstall} hasSearch={isSearching} hasFilters={hasActiveFilters} />
      </div>
    );
  }

  const Card = dndDisabled ? ModCard : SortableModCard;

  return (
    <>
      <div className="flex-1 overflow-auto p-6">
        <SortableModList
          mods={filteredMods}
          viewMode={viewMode}
          onReorder={actions.handleReorder}
          disabled={dndDisabled}
          onToggle={actions.handleToggleMod}
          onUninstall={actions.handleUninstallMod}
          onViewDetails={setDetailsMod}
        >
          <div className={gridClass(viewMode, !dndDisabled)}>
            {filteredMods.map((mod) => (
              <Card
                key={mod.id}
                mod={mod}
                viewMode={viewMode}
                onToggle={actions.handleToggleMod}
                onUninstall={actions.handleUninstallMod}
                onViewDetails={setDetailsMod}
                disabled={isPatcherActive}
              />
            ))}
          </div>
        </SortableModList>
      </div>
      <ModDetailsDialog
        open={detailsMod !== null}
        mod={detailsMod}
        onClose={() => setDetailsMod(null)}
      />
    </>
  );
}

function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
    </div>
  );
}

function ErrorState({ error }: { error: AppError }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-full bg-red-500/10 p-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="mb-1 text-lg font-medium text-surface-300">Failed to load mods</h3>
      <p className="mb-2 text-surface-500">{error.message}</p>
      <p className="text-sm text-surface-600">Error code: {error.code}</p>
    </div>
  );
}

function EmptyState({
  onInstall,
  hasSearch,
  hasFilters,
}: {
  onInstall: () => void;
  hasSearch: boolean;
  hasFilters: boolean;
}) {
  if (hasSearch || hasFilters) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        {hasFilters ? (
          <Filter className="mb-4 h-12 w-12 text-surface-600" />
        ) : (
          <Search className="mb-4 h-12 w-12 text-surface-600" />
        )}
        <h3 className="mb-1 text-lg font-medium text-surface-300">No mods found</h3>
        <p className="text-surface-500">
          {hasFilters ? "Try adjusting your filters" : "Try adjusting your search query"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl">
        <Upload className="h-10 w-10 text-surface-600" />
      </div>
      <h3 className="mb-1 text-lg font-medium text-surface-300">No mods installed</h3>
      <p className="mb-4 text-surface-500">Get started by adding your first mod</p>
      <Button variant="filled" onClick={onInstall} left={<Plus className="h-4 w-4" />}>
        Add Mod
      </Button>
    </div>
  );
}
