import { ArrowsClockwiseIcon, FilesIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef } from "react";
import { twMerge } from "tailwind-merge";

import { EmptyState, IconButton, Spinner, Tooltip } from "@/components";
import { errorSummary } from "@/i18n";
import type { GameFindHit, GameFindResult } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import { hasErrorCode } from "@/utils/errors";

import { TreeSearchBox } from "../components/TreeSearchBox";
import { type ContentDocumentOf, gameWadsDocument } from "../documents/contentDocument";
import {
  useExpandedGameDirs,
  useGameSearchPattern,
  useGameSearchRegex,
  useOpenDocument,
  useSetGameSearchPattern,
  useSetGameSearchRegex,
  useShutFindDirs,
  useToggleFindDir,
  useToggleGameDir,
} from "../state";
import { indexDir } from "./extractTargets";
import { GameLoadingState, GameWadsErrorState, UnknownHashHint } from "./GameBrowserStates";
import {
  buildIndexTree,
  buildSourceTree,
  holdsOnlyUnknown,
  type SourceDirNode,
  type SourceEntry,
} from "./sourceIndex";
import { SourceTree } from "./SourceTree";
import { useGameFind } from "./useGameFind";
import { useGameDir, useGameDirs, useGameIndex, useRefreshGameIndex } from "./useGameIndex";
import { useGameSearchRevealTarget } from "./useGameSearchReveal";
import { useSourcePreview } from "./useSourcePreview";

/**
 * The root game browser: every archive of the installed game, folded into one tree.
 *
 * The toolbar's box is the full search over the same tree. Empty, the document
 * browses lazily, one directory read as it opens. Typed into, the body swaps to
 * the tree the pattern leaves - every hit under its real directories - and back
 * without losing where the browse had gotten to.
 */
export function GameDocument({ active }: EditorDocumentProps<ContentDocumentOf<"game">>) {
  const pattern = useGameSearchPattern();
  const bodyRef = useRef<HTMLDivElement>(null);

  const searching = pattern.length > 0;

  return (
    <div
      data-ui="GameDocument"
      ref={bodyRef}
      className="flex min-h-0 flex-1 flex-col bg-surface-950"
    >
      {/* A row of its own rather than the strip's popover, because a route to
          the archives and a way to rebuild the index are worth a glance. */}
      <DocumentToolbar active={active}>
        <SearchField onCommit={() => focusRows(bodyRef.current)} />
        <GameStats />
        <ArchivesAction />
        <RebuildAction />
      </DocumentToolbar>

      {/* Hidden rather than unmounted, so the browse tree's expanded
          directories survive a search and back. */}
      <div hidden={searching} className="flex min-h-0 flex-1 flex-col">
        <GameIndexTree />
      </div>
      {searching && <FindResults />}
    </div>
  );
}

/* The browse tree stays mounted under `hidden` while a search shows, so the
   visible tree is the one whose rows can take focus. */
function focusRows(body: HTMLElement | null) {
  if (!body) return;

  const rows = body.querySelectorAll<HTMLElement>('[data-treeitem-index="0"]');
  const first = [...rows].find((row) => row.offsetParent !== null);
  if (first) {
    first.focus();
    return;
  }

  /* The first row virtualizes away once the tree is scrolled. The tree itself
     still takes focus, and the keys continue from the row it last held. */
  const trees = body.querySelectorAll<HTMLElement>('[role="tree"]');
  [...trees].find((tree) => tree.offsetParent !== null)?.focus();
}

function GameStats() {
  const { data } = useGameIndex();
  /* The search's own count stands in the same row and answers the same
     question of what is in front of the reader, so the two never both show. */
  const searching = useGameSearchPattern().length > 0;
  if (!data || searching) return null;

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

interface SearchFieldProps {
  /** `Enter` or `ArrowDown`, which hand the keyboard to the rows below. */
  onCommit: () => void;
}

function SearchField({ onCommit }: SearchFieldProps) {
  const pattern = useGameSearchPattern();
  const regex = useGameSearchRegex();
  const onPatternChange = useSetGameSearchPattern();
  const onRegexChange = useSetGameSearchRegex();

  const { data, error, isFetching } = useGameFind(pattern, regex);
  const counted = pattern.length > 0 && data && data.total > 0 && !error;

  const inputRef = useRef<HTMLInputElement>(null);
  useGameSearchRevealTarget(inputRef);

  return (
    <TreeSearchBox
      value={pattern}
      onChange={onPatternChange}
      regex={regex}
      onRegexChange={onRegexChange}
      label="Search the game files"
      regexLabel="Search the game files by regex"
      regexToggleLabel="Use regular expression"
      clearLabel="Clear the search"
      onCommit={onCommit}
      inputRef={inputRef}
    >
      {counted && (
        <span className="shrink-0 text-[0.6875rem] text-surface-400 tabular-nums select-none">
          {countText(data)}
        </span>
      )}
      {isFetching && <Spinner size="sm" className="h-3 w-3 shrink-0" />}
    </TreeSearchBox>
  );
}

function countText(result: GameFindResult): string {
  const total = result.total.toLocaleString();
  const label = result.total === 1 ? "match" : "matches";
  if (result.hits.length < result.total) {
    return `first ${result.hits.length.toLocaleString()} of ${total} ${label}`;
  }
  return `${total} ${label}`;
}

/**
 * The tree the pattern leaves: every matching file under its real directories.
 *
 * The hits arrive flat and in tree order, and `buildSourceTree` folds them
 * back into directories, so the filtered view reads exactly like the browse
 * tree it stands in for - same rows, same context menu, same keys. Everything
 * starts expanded, because the hits are what the pattern was typed to see.
 */
function FindResults() {
  const pattern = useGameSearchPattern();
  const regex = useGameSearchRegex();
  const { data, error, isFetching } = useGameFind(pattern, regex);
  const openFile = useSourcePreview();

  /* The parse error belongs under the box, because the fix is the next
     keystroke. Every other failure replaces the tree, because the fix is not. */
  const patternError = error && hasErrorCode(error, "VALIDATION_FAILED") ? error : null;

  const shut = useShutFindDirs();
  const toggleFindDir = useToggleFindDir();
  const tree = useMemo(() => buildSourceTree((data?.hits ?? []).map(toSourceEntry)), [data]);
  const isExpanded = useCallback((node: SourceDirNode) => !shut.has(node.id), [shut]);
  const handleToggle = useCallback(
    (node: SourceDirNode) => toggleFindDir(node.id),
    [toggleFindDir],
  );

  if (error && !patternError) return <GameWadsErrorState error={error} />;
  if (!data && !patternError) return <GameLoadingState />;

  return (
    <>
      {patternError && (
        <p className="shrink-0 border-b border-surface-700/50 px-3 pb-1.5 font-mono text-xs whitespace-pre-wrap text-danger-text">
          {errorSummary(patternError)}
        </p>
      )}
      {data && data.unnamed && <UnknownHashHint />}
      {data && data.hits.length === 0 && (
        <EmptyState
          size="sm"
          title="No match"
          description="Nothing in the install matches that pattern."
        />
      )}
      {data && data.hits.length > 0 && (
        <div
          className={twMerge(
            "flex min-h-0 flex-1 flex-col transition-opacity",
            /* Still the answer to the last pattern, dimmed rather than blanked. */
            isFetching && "opacity-50",
          )}
        >
          <SourceTree
            nodes={tree}
            ariaLabel="Search results"
            isExpanded={isExpanded}
            onToggle={handleToggle}
            onOpen={openFile}
            /* Per pattern, so a fresh search opens at its first hit rather than
               where the last one was read to. */
            scrollKey={`game-find:${regex ? "re" : "text"}:${pattern}`}
          />
        </div>
      )}
    </>
  );
}

function toSourceEntry(hit: GameFindHit): SourceEntry {
  return {
    pathHash: hit.pathHash,
    path: hit.path,
    sizeBytes: Number(hit.sizeBytes),
    wad: hit.wad,
    nameRanges: hit.nameRanges,
  };
}

function GameIndexTree() {
  /* Opt-in, where the scoped browser opts out: a whole-game tree is too large
     to hold at once, so a directory is read when it is first opened. */
  const expanded = useExpandedGameDirs();
  const toggleDir = useToggleGameDir();
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

  const handleToggle = useCallback((node: SourceDirNode) => toggleDir(node.id), [toggleDir]);

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
        /* A shut row here holds no children yet, so the backend expands it
           through the index rather than the tree walking what it has. */
        dirTargets={indexDir}
        scrollKey="game-index"
      />
    </>
  );
}
