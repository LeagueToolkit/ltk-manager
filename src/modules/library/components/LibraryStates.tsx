import { AlertTriangle, Filter, Plus, Search, Upload } from "lucide-react";

import { Button, Skeleton } from "@/components";
import type { AppError } from "@/lib/tauri";
import { useLibraryActions } from "@/modules/library/api";
import { hasErrorCode } from "@/utils/errors";

export function LibraryLoadingState() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min-w,240px),var(--card-max-w,320px)))] justify-center gap-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-surface-700 bg-surface-800 p-4"
        >
          <Skeleton height="10rem" rounded />
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="0.75rem" width="40%" />
        </div>
      ))}
    </div>
  );
}

export function LibraryErrorState({ error }: { error: AppError }) {
  if (hasErrorCode(error, "SCHEMA_VERSION_TOO_NEW")) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <div className="mb-4 rounded-full bg-warning/10 p-4">
          <AlertTriangle className="h-8 w-8 text-warning-text" />
        </div>
        <h3 className="mb-1 text-lg font-medium text-surface-300">
          Mod library requires a newer version
        </h3>
        <p className="mb-2 max-w-md text-surface-500">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-full bg-danger/10 p-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="mb-1 text-lg font-medium text-surface-300">Failed to load mods</h3>
      <p className="mb-2 text-surface-500">{error.message}</p>
      <p className="text-sm text-surface-600">Error code: {error.code}</p>
    </div>
  );
}

interface LibraryEmptyStateProps {
  hasSearch: boolean;
  hasFilters: boolean;
}

export function LibraryEmptyState({ hasSearch, hasFilters }: LibraryEmptyStateProps) {
  const actions = useLibraryActions();

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
      <Button
        variant="filled"
        onClick={actions.handleInstallMod}
        left={<Plus className="h-4 w-4" />}
      >
        Add Mod
      </Button>
    </div>
  );
}
