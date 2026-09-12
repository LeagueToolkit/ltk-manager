import { ArrowsClockwiseIcon, DatabaseIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import {
  AlertBox,
  Button,
  EmptyState,
  Progress,
  SectionCard,
  Separator,
  Spinner,
  useToast,
} from "@/components";
import { errorSummary } from "@/i18n";
import type {
  HashtableStatus,
  HashtableSyncProgress,
  HashtableSyncReport,
  HashtableUpdateCheck,
  MetaSchemaVersion,
} from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import {
  useHashtableCacheStatus,
  useHashtableUpdateCheck,
  useSyncHashtables,
} from "@/modules/settings/api";
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

/* Provenance is per table since a sync only replaces what changed, so a commit
   is only interpretable next to the table it built. */
function sourceLabel(table: HashtableStatus): string | undefined {
  if (!table.sourceRepo) return undefined;
  return table.sourceCommit ? `${table.sourceRepo} @ ${table.sourceCommit}` : table.sourceRepo;
}

function updateLabel(count: number): string {
  return `${count} ${count === 1 ? "update" : "updates"} available`;
}

/* One Sync refreshes the tables and the meta schema, so one line counts both.
   The schema is not a table and has no row of its own to mark, which is why it
   is named here rather than folded into `behind`. */
const SCHEMA_LABEL = "Meta schema";

/** How far a meta schema database reaches, in the words the patch notes use. */
function schemaLabel(version: MetaSchemaVersion): string {
  return version.patch ? `patch ${version.patch}` : `build ${version.build}`;
}

/* The stamp is on the hash lists behind the database rather than on the schema,
   and the publisher moves the two on schedules of their own, so a database that
   has gained patches can carry the stamp it was first published under. */
function hashSourceLabel(version: MetaSchemaVersion): string {
  return `Hash lists read ${formatUpdatedAt(version.generation)}`;
}

function behindLabels(updates: HashtableUpdateCheck): string[] {
  const labels = updates.behind.map((update) => tableLabel(update.id));
  return updates.schemaBehind ? [...labels, SCHEMA_LABEL] : labels;
}

/** What one sync run changed, named for what it installed rather than counted. */
function syncedLabel(report: HashtableSyncReport): string {
  const tables = report.installed.length;
  const changed: string[] = [];
  if (tables > 0) changed.push(`${tables} ${tables === 1 ? "table" : "tables"}`);
  if (report.schemaInstalled) changed.push("the meta schema");
  return `Updated ${changed.join(" and ")}.`;
}

function unsupportedLabel(ids: string[]): string {
  const names = ids.map(tableLabel).join(", ");
  return `${names} ${ids.length === 1 ? "needs" : "need"} a newer version of LTK Manager.`;
}

/**
 * How far through the whole sync we are, or null against a release that
 * recorded no table sizes — where the bar has no end to draw and the byte
 * count beside it carries the news instead.
 */
function syncFraction(progress: HashtableSyncProgress): number | null {
  if (progress.totalBytes === null) return null;
  const total = Number(progress.totalBytes);
  if (total === 0) return null;
  return Math.min(1, Number(progress.downloaded) / total);
}

function syncBytesLabel(progress: HashtableSyncProgress): string {
  const done = formatBytes(Number(progress.downloaded));
  if (progress.totalBytes === null) return done;
  return `${done} / ${formatBytes(Number(progress.totalBytes))}`;
}

function downloadSizeLabel(bytes: bigint | null): string {
  if (bytes === null) return "";
  return ` · ${formatBytes(Number(bytes))}`;
}

export function CacheSection() {
  const { data: status, error } = useHashtableCacheStatus();
  const syncMutation = useSyncHashtables();
  const { data: updates } = useHashtableUpdateCheck();
  const toast = useToast();
  const [progress, setProgress] = useState<HashtableSyncProgress | null>(null);

  const syncing = syncMutation.isPending;

  useTauriEvent<HashtableSyncProgress>("hashtable-sync-progress", setProgress);

  function runSync(force: boolean) {
    setProgress(null);
    syncMutation.mutate(force, {
      onSuccess: (report) => {
        if (report.upToDate) {
          toast.success("Already up to date", "The cache matches everything published.");
          return;
        }
        toast.success("Hashtables updated", syncedLabel(report));
      },
      onError: (err) => toast.error("Sync failed", errorSummary(err)),
      onSettled: () => setProgress(null),
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
        {error && <AlertBox variant="error">{errorSummary(error)}</AlertBox>}
      </SectionCard>
    );
  }

  const isEmpty = status.generatedAt === null;
  const totalBytes = status.tables.reduce((total, table) => total + Number(table.sizeBytes), 0);
  /* A table the cache has none of is behind too, and it has no row to mark -
     the "Not downloaded yet" line below is where those are named. */
  const behind = new Map((updates?.behind ?? []).map((update) => [update.id, update]));

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

  const fraction = progress && syncFraction(progress);

  const progressLine = syncing && (
    <div className="flex min-w-0 flex-col gap-1.5">
      {!progress && (
        <div className="flex items-center gap-2 text-xs text-surface-400">
          <Spinner size="sm" />
          <span>Checking for updates…</span>
        </div>
      )}
      {progress && (
        <>
          {/* One bar for the whole run, in its bytes where the release
              recorded them and with no end where it did not. */}
          <Progress.Root value={fraction === null ? null : fraction * 100}>
            <Progress.Track size="sm">
              <Progress.Indicator />
            </Progress.Track>
          </Progress.Root>
          <div className="flex min-w-0 items-baseline gap-3 text-xs text-surface-400">
            <span className="truncate">{tableLabel(progress.table)}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {`Table ${progress.current} of ${progress.total} · `}
              {syncBytesLabel(progress)}
            </span>
          </div>
        </>
      )}
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
              <div className="flex items-baseline gap-2">
                <p className="text-sm text-surface-300">
                  Updated {formatUpdatedAt(status.generatedAt!)}
                </p>
                {updates && !updates.upToDate && (
                  <span
                    className="rounded-full bg-info/10 px-2 py-0.5 text-xs text-info-text"
                    title={behindLabels(updates).join(", ")}
                  >
                    {updateLabel(behindLabels(updates).length)}
                    {downloadSizeLabel(updates.downloadBytes)}
                  </span>
                )}
                {updates?.upToDate && <span className="text-xs text-surface-500">Up to date</span>}
              </div>
              {/* Inset on the card, not the page: DS-GROUND. */}
              <ul className="flex flex-col rounded-lg bg-surface-950/40 px-3 py-1">
                {status.tables.map((table) => (
                  <li
                    key={table.id}
                    className="flex items-baseline gap-3 border-b border-surface-700/50 py-1.5 text-sm"
                    title={sourceLabel(table)}
                  >
                    <span className="text-surface-200">{tableLabel(table.id)}</span>
                    <span className="text-xs text-surface-500">
                      {table.entries.toLocaleString()} entries
                    </span>
                    {table.version && (
                      <span className="text-xs text-surface-500 tabular-nums">
                        {table.version}
                        {behind.has(table.id) && ` → ${behind.get(table.id)!.want}`}
                      </span>
                    )}
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
              {/* Beside the list rather than in it: the schema is not a table
                  and carries none of the columns the rows draw. */}
              <p className="text-xs text-surface-500" title={hashSourceLabel(status.schema)}>
                {SCHEMA_LABEL} {schemaLabel(status.schema)}
                {updates?.schemaBehind && ` → ${schemaLabel(updates.schemaBehind)}`}
              </p>
              {status.missing.length > 0 && (
                <p className="text-xs text-surface-500">
                  Not downloaded yet: {status.missing.map(tableLabel).join(", ")}.
                </p>
              )}
              {updates && updates.unsupportedTables.length > 0 && (
                <p className="text-xs text-warning-text">
                  {unsupportedLabel(updates.unsupportedTables)}
                </p>
              )}
            </div>

            <Separator className="my-0" />

            <div className="flex flex-col gap-3">
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
              </div>
              {progressLine}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
