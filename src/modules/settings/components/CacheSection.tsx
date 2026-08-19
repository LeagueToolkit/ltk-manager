import { ArrowsClockwiseIcon, DatabaseIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import {
  AlertBox,
  Button,
  EmptyState,
  SectionCard,
  Separator,
  Spinner,
  useToast,
} from "@/components";
import type { HashtableSyncProgress } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { useHashtableCacheStatus, useSyncHashtables } from "@/modules/settings/api";
import { formatBytes } from "@/utils";

/* Table ids are the upstream filenames, so the friendly names live here. */
const TABLE_LABELS: Record<string, string> = {
  game: "Game paths",
  lcu: "LCU paths",
  binentries: "Bin entries",
  bintypes: "Bin types",
  binfields: "Bin fields",
  binhashes: "Bin hashes",
  rst: "RST strings (XXH64)",
  "rst-xxh3": "RST strings (XXH3)",
};

function tableLabel(id: string): string {
  return TABLE_LABELS[id] ?? id;
}

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function CacheSection() {
  const { data: status, error } = useHashtableCacheStatus();
  const syncMutation = useSyncHashtables();
  const toast = useToast();
  const [currentFile, setCurrentFile] = useState<string | null>(null);

  const syncing = syncMutation.isPending;

  useTauriEvent<HashtableSyncProgress>("hashtable-sync-progress", (progress) =>
    setCurrentFile(progress.file),
  );

  function runSync(force: boolean) {
    setCurrentFile(null);
    syncMutation.mutate(force, {
      onSuccess: (report) => {
        if (report.upToDate) {
          toast.success("Already up to date", "The hashtable cache matches the latest release.");
          return;
        }
        const count = report.installed.length;
        toast.success(
          "Hashtables updated",
          `Updated ${count} ${count === 1 ? "table" : "tables"}.`,
        );
      },
      onError: (err) => toast.error("Sync failed", err.message),
      onSettled: () => setCurrentFile(null),
    });
  }

  if (!status) {
    return (
      <SectionCard title="Hashtables" icon={<DatabaseIcon className="h-5 w-5" />}>
        {!error && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {error && <AlertBox variant="error">{error.message}</AlertBox>}
      </SectionCard>
    );
  }

  const isEmpty = status.generatedAt === null;
  const totalBytes = status.tables.reduce((total, table) => total + Number(table.sizeBytes), 0);

  const syncButton = (
    <Button
      variant="filled"
      size="sm"
      loading={syncing}
      left={<DownloadSimpleIcon weight="bold" className="h-4 w-4" />}
      onClick={() => runSync(false)}
    >
      Sync now
    </Button>
  );

  const progressLine = syncing && (
    <div className="flex min-w-0 items-center gap-2 text-xs text-surface-400">
      <Spinner size="sm" />
      {currentFile && (
        <span className="truncate font-mono" title={currentFile}>
          {currentFile}
        </span>
      )}
      {!currentFile && <span>Checking for updates…</span>}
    </div>
  );

  return (
    <SectionCard title="Hashtables" icon={<DatabaseIcon className="h-5 w-5" />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-surface-400">
            Hash tables give game files their readable names. The cache is shared with other
            LeagueToolkit tools on this machine.
          </p>
          <p className="truncate font-mono text-xs text-surface-500" title={status.dir}>
            {status.dir}
          </p>
        </div>

        {isEmpty && (
          <>
            <EmptyState
              size="sm"
              title="No hashtables downloaded"
              description="Nothing has been downloaded yet. Sync to fetch the latest tables."
              action={syncButton}
            />
            {progressLine}
          </>
        )}

        {!isEmpty && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-surface-300">
                Updated {formatUpdatedAt(status.generatedAt!)}
              </p>
              {/* Inset on the card, not the page: DS-GROUND. */}
              <ul className="flex flex-col rounded-lg bg-surface-950/40 px-3 py-1">
                {status.tables.map((table) => (
                  <li
                    key={table.id}
                    className="flex items-baseline gap-3 border-b border-surface-700/50 py-1.5 text-sm"
                  >
                    <span className="text-surface-200">{tableLabel(table.id)}</span>
                    <span className="text-xs text-surface-500">
                      {table.entries.toLocaleString()} entries
                    </span>
                    <span className="ml-auto text-xs text-surface-400 tabular-nums">
                      {formatBytes(Number(table.sizeBytes))}
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between py-1.5 text-sm">
                  <span className="text-surface-400">Total</span>
                  <span className="text-surface-200 tabular-nums">{formatBytes(totalBytes)}</span>
                </li>
              </ul>
              {status.missing.length > 0 && (
                <p className="text-xs text-surface-500">
                  Not downloaded yet: {status.missing.map(tableLabel).join(", ")}.
                </p>
              )}
            </div>

            <Separator className="my-0" />

            <div className="flex items-center gap-3">
              {syncButton}
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                left={<ArrowsClockwiseIcon weight="bold" className="h-4 w-4" />}
                onClick={() => runSync(true)}
              >
                Re-download all
              </Button>
              <div className="ml-auto min-w-0">{progressLine}</div>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
