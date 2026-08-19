import { GearIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Button, EmptyState, Spinner } from "@/components";
import type { AppError } from "@/lib/tauri";
import { hasErrorCode } from "@/utils/errors";

export function GameLoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner size="md" />
    </div>
  );
}

/** Why the archive listing failed: no League path yet, or a real error. */
export function GameWadsErrorState({ error }: { error: AppError }) {
  if (hasErrorCode(error, "LEAGUE_NOT_FOUND")) {
    return (
      <EmptyState
        size="sm"
        title="League path not set"
        description="Point the manager at your League install to browse its archives."
        action={
          <Link to="/settings">
            <Button variant="outline" size="xs" left={<GearIcon className="h-4 w-4" />}>
              Open Settings
            </Button>
          </Link>
        }
      />
    );
  }

  return <EmptyState size="sm" title="Failed to read game archives" description={error.message} />;
}

/** Every entry is a bare hash, which is what an unsynced hash table leaves. */
export function UnknownHashHint() {
  return (
    <p className="shrink-0 border-b border-surface-700/50 px-3 py-1.5 text-xs text-surface-400 select-none">
      Hash tables are not downloaded, so files show as hashes. Settings → Cache syncs them.
    </p>
  );
}
