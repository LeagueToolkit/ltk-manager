import { ArrowsClockwiseIcon, FilesIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef } from "react";
import { twMerge } from "tailwind-merge";

import { EmptyState, Field, IconButton, Spinner, Tooltip } from "@/components";
import type { GameFindHit, GameFindResult } from "@/lib/tauri";
import { DocumentActions, DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import {
  useExpandedGameDirs,
  useGameSearchPattern,
  useGameSearchRegex,
  useSetGameSearchPattern,
  useSetGameSearchRegex,
  useShutFindDirs,
  useToggleFindDir,
  useToggleGameDir,
} from "@/stores";
import { hasErrorCode } from "@/utils/errors";

import { type ContentDocumentOf, gameWadsDocument } from "../documents/contentDocument";
import { useOpenDocument } from "../state";
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
      <DocumentActions active={active}>
        <GameStats />
        <ArchivesAction />
        <RebuildAction />
      </DocumentActions>

      <DocumentToolbar active={active}>
        <SearchField onCommit={() => focusRows(bodyRef.current)} />
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && pattern.length > 0) {
      event.preventDefault();
      onPatternChange("");
    }
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      onCommit();
    }
  }

  return (
    <>
      <Field.Root className="relative min-w-0 flex-1">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
        <Field.Control
          ref={inputRef}
          type="text"
          value={pattern}
          onChange={(event) => onPatternChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={regex ? "Search the game files by regex" : "Search the game files"}
          aria-label="Search the game files"
          autoComplete="off"
          spellCheck={false}
          className="h-6 pr-14 pl-7 text-xs select-text"
        />
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
          {pattern && (
            <IconButton
              icon={<XIcon weight="bold" className="h-3 w-3" />}
              variant="transparent"
              size="xs"
              compact
              onClick={() => {
                onPatternChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear the search"
              className="h-4 w-4"
            />
          )}
          <Tooltip content="Use regular expression">
            <button
              type="button"
              aria-pressed={regex}
              onClick={() => onRegexChange(!regex)}
              className={twMerge(
                "flex h-4.5 cursor-pointer items-center rounded-sm px-1 font-mono text-[10px] text-surface-400 transition-colors",
                /* DS-VEIL */ "hover:bg-surface-veil hover:text-surface-100",
                regex &&
                  "bg-accent-500/20 text-accent-300 hover:bg-accent-500/30 hover:text-accent-300",
              )}
            >
              .*
            </button>
          </Tooltip>
        </span>
      </Field.Root>

      {counted && (
        <span className="shrink-0 text-[11px] text-surface-400 tabular-nums select-none">
          {countText(data)}
        </span>
      )}
      {isFetching && <Spinner size="sm" className="h-3 w-3 shrink-0" />}
    </>
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
          {patternError.message}
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
        scrollKey="game-index"
      />
    </>
  );
}
