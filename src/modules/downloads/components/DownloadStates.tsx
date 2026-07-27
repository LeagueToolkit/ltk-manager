import { AlertTriangle, Search } from "lucide-react";

import { Button, Skeleton } from "@/components";

export function DownloadLoadingState() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,320px))] justify-center gap-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-lg border border-surface-700 bg-surface-800"
        >
          <Skeleton height="10rem" />
          <div className="space-y-3 p-3">
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="0.75rem" width="45%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DownloadEmptyState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <Search className="mb-4 h-10 w-10 text-surface-600" />
      <h3 className="mb-1 text-base font-medium text-surface-300">No downloadable mods found</h3>
      <p className="text-sm text-surface-500">Try changing the search or filters.</p>
    </div>
  );
}

export function DownloadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <AlertTriangle className="mb-4 h-10 w-10 text-red-400" />
      <h3 className="mb-1 text-base font-medium text-surface-300">Could not load mods</h3>
      <p className="mb-4 max-w-md text-sm text-surface-500">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
