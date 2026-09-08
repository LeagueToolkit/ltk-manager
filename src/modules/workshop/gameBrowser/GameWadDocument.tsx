import { DownloadSimpleIcon, StackPlusIcon } from "@phosphor-icons/react";
import { useCallback, useMemo } from "react";

import { Button, EmptyState } from "@/components";
import type { GameWadSummary } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import { formatBytes } from "@/utils";

import type { ContentDocumentOf } from "../documents/contentDocument";
import { useShutWadDirs, useToggleWadDir } from "../state";
import { archiveTarget } from "./extractTargets";
import { GameLoadingState, GameWadsErrorState, UnknownHashHint } from "./GameBrowserStates";
import {
  buildSourceTree,
  hasOnlyUnknownPaths,
  type SourceDirNode,
  wadBasename,
} from "./sourceIndex";
import { SourceTree } from "./SourceTree";
import { useExtractActions } from "./useExtractActions";
import { useGameWadEntries } from "./useGameWadEntries";
import { useGameWads } from "./useGameWads";
import { useSourcePreview } from "./useSourcePreview";

/** One game archive's file tree, without the archive level the tab already names. */
export function GameWadDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"game-wad">>) {
  const wadName = document.wadName;
  const { data } = useGameWads();
  const summary = findArchive(data, wadName);

  return (
    <div data-ui="GameWadDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      {/* A row under the tab rather than the strip's popover: the ways out of
          an archive are the reason this tab is open. */}
      <DocumentToolbar active={active}>
        <ArchiveStats summary={summary} />
        <ArchiveActions summary={summary} />
      </DocumentToolbar>
      <GameWadBody wadName={wadName} />
    </div>
  );
}

/* Case-insensitive, and by basename as a fallback, because the WADs list opens
   a layer's archive by its file name alone. */
function findArchive(
  wads: readonly GameWadSummary[] | undefined,
  wadName: string,
): GameWadSummary | undefined {
  if (!wads) return undefined;
  const lower = wadName.toLowerCase();
  return (
    wads.find((wad) => wad.name.toLowerCase() === lower) ??
    wads.find((wad) => wadBasename(wad.name).toLowerCase() === lower)
  );
}

function ArchiveStats({ summary }: { summary: GameWadSummary | undefined }) {
  const { data: entries } = useGameWadEntries(summary?.name ?? null);
  if (!summary) return null;

  const size = formatBytes(Number(summary.sizeBytes));
  if (!entries) {
    return <span className="text-xs text-surface-400 select-none">{size}</span>;
  }

  const label = entries.length === 1 ? "file" : "files";
  return (
    <span className="text-xs text-surface-400 select-none">
      {entries.length} {label} · {size}
    </span>
  );
}

/* The scoped browser's routes to the whole archive, which its tree cannot
   carry: the archive level is the tab, so no row stands for it. */
function ArchiveActions({ summary }: { summary: GameWadSummary | undefined }) {
  const { run, lastFolder, layerLabel, busy } = useExtractActions();
  if (!summary) return null;

  const targets = [archiveTarget(summary.name)];
  const subject = wadBasename(summary.name);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {layerLabel && (
        <Button
          variant="ghost"
          size="xs"
          left={<StackPlusIcon className="h-4 w-4" />}
          disabled={busy}
          onClick={() => run("copy", targets, subject)}
        >
          Copy into {layerLabel}
        </Button>
      )}
      {lastFolder && (
        <Button
          variant="ghost"
          size="xs"
          left={<DownloadSimpleIcon className="h-4 w-4" />}
          disabled={busy}
          onClick={() => run("quick", targets, subject)}
        >
          Extract to {lastFolder}
        </Button>
      )}
      <Button
        variant="ghost"
        size="xs"
        left={<DownloadSimpleIcon className="h-4 w-4" />}
        onClick={() => run("dialog", targets, subject)}
      >
        Extract…
      </Button>
    </div>
  );
}

function GameWadBody({ wadName }: { wadName: string }) {
  const wads = useGameWads();
  const summary = findArchive(wads.data, wadName);
  const entriesQuery = useGameWadEntries(summary?.name ?? null);
  const entries = entriesQuery.data;

  const openFile = useSourcePreview();
  const shutDirs = useShutWadDirs(wadName);
  const toggleWadDir = useToggleWadDir();

  const tree = useMemo(() => buildSourceTree(entries ?? []), [entries]);

  const isExpanded = useCallback((node: SourceDirNode) => !shutDirs.has(node.id), [shutDirs]);

  const handleToggle = useCallback(
    (node: SourceDirNode) => toggleWadDir(wadName, node.id),
    [toggleWadDir, wadName],
  );

  if (wads.isPending) return <GameLoadingState />;
  if (wads.isError) return <GameWadsErrorState error={wads.error} />;
  if (!summary) {
    return (
      <EmptyState
        size="sm"
        title="Archive not installed"
        description={`The installed game does not hold ${wadName}.`}
      />
    );
  }
  if (entriesQuery.isPending) return <GameLoadingState />;
  if (entriesQuery.isError) return <GameWadsErrorState error={entriesQuery.error} />;

  return (
    <>
      {entries && hasOnlyUnknownPaths(entries) && <UnknownHashHint />}
      <SourceTree
        nodes={tree}
        ariaLabel={`Files of ${summary.name}`}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        onOpen={openFile}
        scrollKey={`game-wad:${wadName}`}
      />
    </>
  );
}
