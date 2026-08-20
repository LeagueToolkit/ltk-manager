import { ArrowsClockwiseIcon, FilesIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { EmptyState, IconButton, Tooltip } from "@/components";
import { DocumentActions, type EditorDocumentProps } from "@/modules/editor";

import { type ContentDocumentOf, gameWadsDocument } from "../documents/contentDocument";
import { useOpenDocument } from "../state";
import { GameLoadingState, GameWadsErrorState, UnknownHashHint } from "./GameBrowserStates";
import { buildIndexTree, holdsOnlyUnknown, type SourceDirNode, toggled } from "./sourceIndex";
import { SourceTree } from "./SourceTree";
import { useGameDir, useGameDirs, useGameIndex, useRefreshGameIndex } from "./useGameIndex";
import { useSourcePreview } from "./useSourcePreview";

/** The root game browser: every archive of the installed game, folded into one tree. */
export function GameDocument({ active }: EditorDocumentProps<ContentDocumentOf<"game">>) {
  return (
    <div data-ui="GameDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentActions active={active}>
        <GameStats />
        <ArchivesAction />
        <RebuildAction />
      </DocumentActions>
      <GameIndexTree />
    </div>
  );
}

function GameStats() {
  const { data } = useGameIndex();
  if (!data) return null;

  const files = data.files === 1 ? "file" : "files";
  const archives = data.archives === 1 ? "archive" : "archives";

  return (
    <span className="text-xs text-surface-400 select-none">
      {data.files.toLocaleString()} {files} · {data.archives} {archives}
    </span>
  );
}

/* The tree folds the archives away, so the one route left to a single archive
   is the list this opens. */
function ArchivesAction() {
  const openDocument = useOpenDocument();

  return (
    <Tooltip content="Game WADs">
      <IconButton
        icon={<FilesIcon className="h-4 w-4" />}
        variant="ghost"
        size="xs"
        compact
        onClick={() => openDocument(gameWadsDocument())}
        aria-label="List the game WADs"
      />
    </Tooltip>
  );
}

/* The index is a snapshot of the install taken once a session, so a game patch
   needs a way to say so. */
function RebuildAction() {
  const rebuild = useRefreshGameIndex();

  return (
    <Tooltip content="Rebuild index">
      <IconButton
        icon={
          <ArrowsClockwiseIcon
            className={twMerge("h-4 w-4", rebuild.isPending && "animate-spin")}
          />
        }
        variant="ghost"
        size="xs"
        compact
        onClick={() => rebuild.mutate()}
        disabled={rebuild.isPending}
        aria-label="Rebuild the game index"
      />
    </Tooltip>
  );
}

function GameIndexTree() {
  /* Opt-in, where the scoped browser opts out: a whole-game tree is too large
     to hold at once, so a directory is read when it is first opened. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const openFile = useSourcePreview();

  const root = useGameDir("");
  const expandedPaths = useMemo(() => [...expanded].sort(), [expanded]);
  const listings = useGameDirs(expandedPaths);

  const tree = useMemo(() => {
    if (!root.data) return [];
    const all = new Map(listings);
    all.set("", root.data);
    return buildIndexTree(all, (path) => expanded.has(path));
  }, [root.data, listings, expanded]);

  const isExpanded = useCallback((node: SourceDirNode) => expanded.has(node.id), [expanded]);

  const handleToggle = useCallback((node: SourceDirNode) => {
    setExpanded((prev) => toggled(prev, node.id));
  }, []);

  if (root.isPending) return <GameLoadingState />;
  if (root.isError) return <GameWadsErrorState error={root.error} />;
  if (root.data.dirs.length === 0 && root.data.files.length === 0) {
    return (
      <EmptyState size="sm" title="No files" description="The installed game holds no archives." />
    );
  }

  return (
    <>
      {holdsOnlyUnknown(root.data) && <UnknownHashHint />}
      <SourceTree
        nodes={tree}
        ariaLabel="Game files"
        isExpanded={isExpanded}
        onToggle={handleToggle}
        onOpen={openFile}
      />
    </>
  );
}
